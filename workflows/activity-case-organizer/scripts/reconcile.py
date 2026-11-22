#!/usr/bin/env python3
"""发布对账：写服务器前存一份线上原样，写完自动比对。对任何活动通用，publish.py 每次写入都会调用。

查三件事：
  1. 别的活动一个字没变、一场没少；
  2. 追加或补档案时，这场原有的内容一项没少（整场更新按数量核对）；
  3. 这批素材的地址都在本次目标图床里、都能打开（写入前查，不过就不写）。
过程留在 <素材库>/.publish-history/<活动 id>/<时间>-<app>/，格式与 repair.py 的工作目录相同，
所以对不上时可以直接 `repair.py rollback <目录>` 退回写入前的版本。
"""
import concurrent.futures, datetime, json, urllib.error, urllib.parse, urllib.request
from pathlib import Path

KEEP = ('gallery', 'videos', 'productionGallery', 'productionVideos', 'media')  # 整份清单；highlights、productions 只是其中的精选


def same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)


def write(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def fetch_site(site):
    with urllib.request.urlopen(urllib.request.Request(f'{site}/api/site', headers={'User-Agent': 'curl/8'}), timeout=120) as r:
        return json.load(r)['events']


def fetch_source(site, uid, headers):
    """服务器上这场活动的原始记录；还没有这场时返回 None。"""
    request = urllib.request.Request(f"{site}/api/activities/{urllib.parse.quote(uid, safe='')}", headers={**headers, 'User-Agent': 'curl/8'})
    try:
        with urllib.request.urlopen(request, timeout=120) as r:
            return json.load(r)['source']
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def item_urls(event):
    detail = event.get('detail') or {}
    return {(key, item.get('image') or item.get('src') or item.get('href')) for key in KEEP for item in detail.get(key) or []
            if item.get('image') or item.get('src') or item.get('href')}


def compare(before, after, uid, replace=False, expected=None):
    """before/after 是写入前后的全站活动列表。replace=True 是整场更新，旧内容可以被替换。"""
    b = {e['uid']: e for e in before}; a = {e['uid']: e for e in after}
    problems = []
    lost = [u for u in b if u not in a]
    if lost:
        problems.append('这些活动从网站上消失了：' + '、'.join(lost))
    changed = [u for u in b if u != uid and u in a and not same(b[u], a[u])]
    if changed:
        problems.append(f'这次只该改「{uid}」，但这些活动也变了（如果同时有别人在发布属正常，请核对）：' + '、'.join(changed))
    if uid not in a:
        problems.append(f'写入后网站上找不到「{uid}」')
        return problems
    if uid in b and not replace:
        missing = sorted(item_urls(b[uid]) - item_urls(a[uid]))
        if missing:
            problems.append(f'这场活动原有的 {len(missing)} 项内容不见了：' + '、'.join(f'{k}:{str(u)[-40:]}' for k, u in missing[:5]))
    if expected and (replace or uid not in b):
        detail = a[uid].get('detail') or {}
        for key, label in (('gallery', '活动照片'), ('videos', '活动视频')):
            if key in expected and len(detail.get(key) or []) != expected[key]:
                problems.append(f'{label}线上 {len(detail.get(key) or [])} 个，应为 {expected[key]} 个')
    return problems


def reachable(url):
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-0'})
        with urllib.request.urlopen(request, timeout=60) as r:
            return r.status in (200, 206)
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return False


def check_urls(source, app, workers=16, probe=reachable):
    """这批素材的地址必须在本次目标图床里（正式站不能引用测试图床），并且能打开。"""
    assets = [(a.get('path') or '', a.get('url') or '') for a in source.get('assets') or [] if a.get('url')]
    wrong = [p for p, u in assets if f'/apps/{app}/' not in u]
    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        alive = list(pool.map(lambda item: probe(item[1]), assets))
    dead = [p for (p, _), ok in zip(assets, alive) if not ok]
    problems = []
    if wrong:
        problems.append(f'{len(wrong)} 个素材的地址不在图床 {app} 里（多半是先传过测试图床）：' + '、'.join(wrong[:5]))
    if dead:
        problems.append(f'{len(dead)} 个素材的地址打不开：' + '、'.join(dead[:5]))
    return problems


def start(activity_root, activity_id, app, site, uid, headers):
    """写入前：存全站原样和这场的原始记录。返回过程目录。"""
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    history = Path(activity_root).resolve().parent / '.publish-history' / str(activity_id) / f'{stamp}-{app}'
    write(history / 'site-before.json', fetch_site(site))
    before = fetch_source(site, uid, headers)
    if before is not None:
        write(history / 'before.json', before)
    write(history / 'meta.json', {'uid': uid, 'site': site, 'app': app, 'existed': before is not None})
    return history


def finish(history, headers, replace=False, expected=None):
    """写入后：读回比对。返回问题列表（空 = 对上了）。"""
    history = Path(history); meta = json.loads((history / 'meta.json').read_text(encoding='utf-8'))
    after = fetch_site(meta['site'])
    write(history / 'site-after.json', after)
    pushed = fetch_source(meta['site'], meta['uid'], headers)
    if pushed is not None:
        write(history / 'pushed.json', pushed)
    before = json.loads((history / 'site-before.json').read_text(encoding='utf-8'))
    problems = compare(before, after, meta['uid'], replace, expected)
    write(history / 'report.json', {'problems': problems, 'activities': [len(before), len(after)]})
    return problems


def rollback_hint(history):
    history = Path(history)
    if (history / 'before.json').is_file():
        return f'退回写入前的版本：python3 "$SKILL/scripts/repair.py" rollback "{history}"'
    return '这是新增的活动，要撤下请找查理（/admin 下架）。'
