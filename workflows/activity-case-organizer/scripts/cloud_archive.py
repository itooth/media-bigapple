#!/usr/bin/env python3
"""完整档案上云：活动目录里的全部原件和账本（整理记录）按内容哈希存到图床，逐个核对，返回写进服务器记录的指针。

服务器上那场活动的记录是上线后的正本。只把入选照片传上去的话，落选原片和每张图的环节、人物、取舍理由
就只留在整理人的电脑上；上云后，任何人或 Agent 读服务器就能拿到整场活动的全部素材和说明，不用重新下载、重新看图。

  cloud_archive.py upload <活动目录> [--app <图床 app>]   上传并核对，打印指针（publish.py 发正式站时自动调用）
  cloud_archive.py verify <档案清单的地址>               重新核对云端每个文件都在、大小一致
"""
import argparse, concurrent.futures, hashlib, json, mimetypes, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive import files, read, digest  # noqa: E402

API = 'https://api.bigapple.work'
EXCLUDED = {'其他/发布确认.json'}  # 发布过程中会变的状态文件，不属于素材
# 这几种错误对每个文件都一样，遇到第一个就停，不再逐个重试（曾在第 42 个文件才发现版本过旧）
FATAL = {401: '部署身份无效，重新运行 check_team_access.sh', 403: '不在团队部署白名单，把 ID 发给查理',
         413: '图床额度不足，停下告诉查理', 426: '「APP 部署专员」版本过旧，去技能页更新后重跑'}
RETRY = {429, 500, 502, 503, 504}
ATTEMPTS = 8
WORKERS = 2  # 实测 6 路并发会被图床限流（429「当前任务过多」）；2 路稳定
LEDGER_FIELDS = ('decision', 'decidedBy', 'chapter', 'subject', 'cover', 'homepage', 'originalName', 'order')
TOP_FIELDS = ('eventType', 'chapters', 'chapterNotes', 'subjectNotes', 'selectionNote', 'orderSource')


class CloudError(RuntimeError):
    pass


def ledger(activity_root):
    """整理记录里每个文件的说明，按内容哈希索引（文件改名后仍对得上）。"""
    record = Path(activity_root) / '其他' / '整理记录.json'
    plan = read(record) if record.is_file() else {'entries': []}
    sha_of = {e['sourcePath']: e['sha256'] for e in plan['entries'] if e.get('sourcePath')}
    by_sha = {}
    for e in plan['entries']:
        row = {k: e[k] for k in LEDGER_FIELDS if e.get(k) is not None and e.get(k) != '' and e.get(k) is not False}
        text = str((e.get('review') or {}).get('evidence') or '').strip()
        if text:
            row['description'] = text
        if e.get('representative') in sha_of:
            row['representativeSha256'] = sha_of[e['representative']]
        if row:
            by_sha.setdefault(e['sha256'], row)
    return plan, by_sha


def build_manifest(activity_root):
    """档案清单：每个文件一行（路径、哈希、大小 + 账本里的说明）。内容只由文件决定，重跑得到同一份。"""
    root = Path(activity_root).resolve()
    manifest = read(root / 'manifest.json')
    plan, by_sha = ledger(root)
    rows = []
    for p in files(root):
        rel = p.relative_to(root).as_posix()
        if rel in EXCLUDED or p.stat().st_size == 0:
            continue
        sha = digest(p)
        rows.append({'path': rel, 'sha256': sha, 'bytes': p.stat().st_size, **by_sha.get(sha, {})})
    top = {k: plan[k] for k in TOP_FIELDS if plan.get(k)}
    return {'version': 1, 'kind': 'activity-archive', 'id': manifest.get('id'), 'uid': manifest.get('uid') or root.name,
            'title': manifest.get('title'), 'date': manifest.get('date'), **top, 'files': rows}


def object_key(sha, name):
    return f'media/{sha}/{sha}{Path(name).suffix.lower()}'


def call(method, url, headers, data=None, length=None, timeout=600):
    """返回 (status, body)。致命错误直接抛；可重试的错误退避后重试。data 可以是 bytes 或文件路径。"""
    for attempt in range(1, ATTEMPTS + 1):
        body = open(data, 'rb') if isinstance(data, Path) else data
        extra = {'Content-Length': str(length)} if length is not None else {}
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=body, method=method, headers={**headers, **extra}), timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', 'replace')[:200]
            if exc.code in FATAL:
                raise CloudError(f'{FATAL[exc.code]}（HTTP {exc.code}：{detail}）') from exc
            if exc.code not in RETRY or attempt == ATTEMPTS:
                raise CloudError(f'{method} 失败（HTTP {exc.code}）：{detail}') from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            if attempt == ATTEMPTS:
                raise CloudError(f'连不上图床：{exc}。网络恢复后重跑，已传的会跳过') from exc
        finally:
            if isinstance(data, Path):
                body.close()
        time.sleep(min(60, 3 * 2 ** (attempt - 1)))  # 3、6、12…60 秒：图床限流（429）时要等得够久


def list_objects(app, headers):
    """图床里这个 app 已有的对象：是否传过只问图床，不靠本地记录。"""
    _, body = call('GET', f'{API}/api/apps/{app}/public-objects', headers, timeout=120)
    return {o['key']: o['publicUrl'] for o in json.loads(body).get('objects', [])}


def put_object(app, key, data, content_type, headers):
    length = data.stat().st_size if isinstance(data, Path) else len(data)
    url = f'{API}/api/apps/{app}/public-objects/' + '/'.join(urllib.parse.quote(part, safe='') for part in key.split('/'))
    _, body = call('PUT', url, {**headers, 'Content-Type': content_type}, data, length)
    public = json.loads(body).get('publicUrl')
    if not public:
        raise CloudError(f'上传 {key} 没有返回地址')
    return public


def remote_size(url):
    """云端文件的大小；取不到返回 None。"""
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-0'})
        with urllib.request.urlopen(request, timeout=60) as r:
            total = (r.headers.get('Content-Range') or '').rpartition('/')[2]
            return int(total) if total.isdigit() else int(r.headers.get('Content-Length') or -1)
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
        return None


def verify_rows(rows, workers=16):
    """逐个核对云端大小，返回对不上的路径。"""
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        sizes = list(pool.map(lambda r: remote_size(r['url']), rows))
    return [r['path'] for r, size in zip(rows, sizes) if size != r['bytes']]


def upload(activity_root, app, headers, workers=WORKERS, log=print):
    root = Path(activity_root).resolve()
    manifest = build_manifest(root)
    rows = manifest['files']
    unique = {}
    for r in rows:
        unique.setdefault(r['sha256'], r)
    existing = list_objects(app, headers)
    urls = {sha: existing[object_key(sha, r['path'])] for sha, r in unique.items() if object_key(sha, r['path']) in existing}
    todo = [r for sha, r in unique.items() if sha not in urls]
    total = sum(r['bytes'] for r in rows)
    log(f'完整档案：{len(rows)} 个文件，{total / 1e6:.0f} MB；云端已有 {len(urls)} 个，需上传 {len(todo)} 个')

    def send(r):
        kind = mimetypes.guess_type(r['path'])[0] or 'application/octet-stream'
        return r['sha256'], put_object(app, object_key(r['sha256'], r['path']), root.joinpath(*Path(r['path']).parts), kind, headers)

    if todo:  # 先传一个试通：身份、版本、额度有问题在这里就停
        sha, url = send(todo[0]); urls[sha] = url
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        jobs = [pool.submit(send, r) for r in todo[1:]]
        try:
            for n, job in enumerate(concurrent.futures.as_completed(jobs), 2):
                sha, url = job.result(); urls[sha] = url
                if n % 50 == 0:
                    log(f'  已上传 {n}/{len(todo)}')
        except CloudError:
            for job in jobs:
                job.cancel()
            raise
    for r in rows:
        r['url'] = urls[r['sha256']]
    wrong = verify_rows(list(unique.values()))
    if wrong:
        raise CloudError(f'云端有 {len(wrong)} 个文件大小对不上或打不开，重跑会补传：' + '、'.join(wrong[:5]))
    body = json.dumps(manifest, ensure_ascii=False, indent=1).encode('utf-8')
    sha = hashlib.sha256(body).hexdigest()
    key = object_key(sha, '档案清单.json')
    manifest_url = existing.get(key) or put_object(app, key, body, 'application/json; charset=utf-8', headers)
    if remote_size(manifest_url) != len(body):
        raise CloudError('档案清单上传后核对不一致，请重跑')
    log(f'完整档案已上云并逐个核对：{len(rows)} 个文件，清单 {manifest_url}')
    return {'manifest': manifest_url, 'sha256': sha, 'files': len(rows), 'bytes': total}, manifest


def verify(manifest_url, log=print):
    with urllib.request.urlopen(urllib.request.Request(manifest_url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120) as r:
        manifest = json.load(r)
    wrong = verify_rows(manifest['files'])
    log(f"{manifest.get('title')}：{len(manifest['files'])} 个文件，对不上 {len(wrong)} 个" + (''.join('\n- ' + p for p in wrong[:20]) if wrong else ''))
    return wrong


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('upload'); q.add_argument('activity'); q.add_argument('--app', default=None)
    q = sub.add_parser('verify'); q.add_argument('manifest')
    a = p.parse_args(argv)
    try:
        if a.cmd == 'verify':
            raise SystemExit(1 if verify(a.manifest) else 0)
        import publish
        pointer, _ = upload(a.activity, a.app or publish.DEFAULT_APP, publish.deployment_headers())
        print(json.dumps(pointer, ensure_ascii=False))
    except CloudError as exc:
        raise SystemExit('错误: ' + str(exc))


if __name__ == '__main__':
    main()
