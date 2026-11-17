#!/usr/bin/env python3
"""修旧活动：直接在服务器上的原始记录上改，不要求本地有归档（图床 + 服务器记录就是真源）。

每次修一场，工作目录（建议 素材库/.repair/<日期>_<uid>/）里留下完整过程，可审计、可回滚：
  before.json   拉下来时线上的原样（回滚就 PUT 它）
  after.json    改完的记录（每一步都在它上面改）
  fixes.json    这次的修复单（人确认过的改动），apply 读它
  posters/      新封面文件；candidates/ 候选帧；总览.jpg 给人抽查
  pushed.json   写入后读回的记录

流程（顺序不能乱：先挪视频，再做封面，封面路径跟着视频的新位置走）：
  repair.py pull <uid> <工作目录>
  repair.py apply <工作目录>                 按 fixes.json 挪作品视频、改简介
  repair.py titles <工作目录>                视频标题去掉「活动视频_」这类文件名前缀
  repair.py posters <工作目录>               缺封面的视频直接从图床地址取帧（不下载整段），出总览图
  repair.py pick <工作目录> <视频路径> <编号>  看总览图后换帧
  repair.py upload <工作目录> --repo <网站工程>   封面传图床，写进 after.json
  repair.py check <工作目录>                 checks.py 同一套规则 + 和 before 的差异
  repair.py preview <工作目录...> --repo <网站工程>   本地预览：线上全部活动 + 这几场改后的
  repair.py push <工作目录>                  线上仍等于 before.json 才写；写后读回核对
  repair.py rollback <工作目录>              线上仍等于 pushed.json 才把 before.json 写回

fixes.json：
  {"ops": [
    {"op": "video-to-case", "video": "01_活动照片/08900_作品视频_xx.mp4", "case": "08860_WANUZU雨靴广告",
     "title": "WANUZU·雨靴广告", "caseTitle": "WANUZU雨靴广告", "intro": "雨靴品牌广告短片"},   # case 不存在就新建，要 caseTitle + intro
    {"op": "summary", "text": "一句话，≤20 字"},
    {"op": "case-intro", "case": "首页01_xx", "text": "≤15 字", "detail": "可选，写进 ## 详细说明"}
  ]}
"""
import argparse, copy, json, re, shutil, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks  # noqa: E402
import video_posters as VP  # noqa: E402

PRODUCTION_SITE = 'https://media.bigapple.work'


class RepairError(RuntimeError):
    pass


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def write(p, value):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8'); tmp.replace(p)


def same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)


# ---------- 服务器 ----------

def headers():
    import publish
    return {**publish.deployment_headers(), 'User-Agent': 'curl/8', 'Content-Type': 'application/json'}


def api(site, uid, method='GET', body=None):
    req = urllib.request.Request(f"{site}/api/activities/{urllib.parse.quote(uid, safe='')}", method=method, headers=headers(),
                                 data=json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as exc:
        raise RepairError(f'{method} {uid} 失败（HTTP {exc.code}）：{exc.read().decode("utf-8", "replace")[:200]}') from exc


def site_events(site):
    with urllib.request.urlopen(urllib.request.Request(f'{site}/api/site', headers={'User-Agent': 'curl/8'}), timeout=60) as r:
        return json.load(r)['events']


# ---------- 记录上的改动（纯函数，便于测试） ----------

def score_of(name):
    m = re.match(r'^(\d{5})_', Path(name).name)
    return int(m.group(1)) if m else 0


def clean_title(name):
    """「08660_活动视频_一起查看电脑作品.mp4」-> 「一起查看电脑作品」。"""
    stem = Path(name).stem
    stem = re.sub(r'^\d{5}_', '', stem)
    return re.sub(r'^(活动视频|作品视频|视频)_', '', stem)


def readme_for(title, intro, detail=''):
    text = f'# {title}\n\n## 案例名称\n{title}\n\n## 案例简介\n{intro}\n'
    return text + (f'\n## 详细说明\n{detail}\n' if detail else '')


def set_readme_section(readme, name, text):
    pattern = re.compile(rf'(^#{{1,6}}\s*{name}\s*\n)(.*?)(?=^#{{1,6}}\s|\Z)', re.M | re.S)
    if pattern.search(readme or ''):
        return pattern.sub(lambda m: m.group(1) + text + '\n\n', readme, count=1).rstrip() + '\n'
    return (readme or '').rstrip() + f'\n\n## {name}\n{text}\n'


def op_video_to_case(source, op):
    record, assets = source['record'], source['assets']
    video = op['video']
    entry = next((v for v in record.get('videos') or [] if v['path'] == video), None)
    if not entry:
        raise RepairError(f'活动视频里没有 {video}')
    folder = op['case']
    case = next((c for c in source['cases'] if c.get('folder') == folder), None)
    if case is None:
        if not op.get('caseTitle') or not op.get('intro'):
            raise RepairError(f'新建案例 {folder} 要写 caseTitle 和 intro')
        if len(op['intro']) > checks.CASE_INTRO_MAX:
            raise RepairError(f'案例简介超过 {checks.CASE_INTRO_MAX} 字：{op["intro"]}')
        home = re.match(r'^首页(\d{2})_', folder)
        case = {'folder': folder, 'title': op['caseTitle'], 'homeOrder': int(home.group(1)) if home else None,
                'score': score_of(folder) or (10000 - int(home.group(1)) if home else 0), 'href': '', 'path': '',
                'readme': readme_for(op['caseTitle'], op['intro'], op.get('detail', '')), 'imagePaths': [], 'videos': []}
        source['cases'].append(case)
    case.setdefault('videos', [])
    title = op.get('title') or clean_title(video)
    score = 10000 - 10 * len(case['videos'])
    new = f'02_案例/{folder}/视频/{score:05d}_{title}.mp4'
    if any(a['path'] == new for a in assets):
        raise RepairError(f'目标路径已存在：{new}')
    old_poster = (record.get('videoPosters') or {}).get(video)
    for a in assets:
        if a['path'] == video:
            a.update(path=new, name=Path(new).name, category='案例', rating=f'{score:05d}', description=title)
    if old_poster:  # 旧封面跟着视频走会放错目录；删掉，posters 步骤按新位置重做
        source['assets'] = [a for a in assets if a['path'] != old_poster]
    record['videos'] = [v for v in record['videos'] if v['path'] != video]
    for key in ('videoPosters', 'videoTitles'):
        (record.get(key) or {}).pop(video, None)
    case['videos'].append({'path': new, 'title': title, 'posterPath': ''})
    return new


def op_summary(source, op):
    text = op['text'].strip()
    if not text or len(text) > checks.SUMMARY_MAX or checks.TEMPLATE_SUMMARY.search(text):
        raise RepairError(f'活动简介要 1–{checks.SUMMARY_MAX} 字且不是模板句：{text}')
    source['record']['summary'] = text


def op_case_intro(source, op):
    case = next((c for c in source['cases'] if c.get('folder') == op['case']), None)
    if case is None:
        raise RepairError(f'没有案例 {op["case"]}')
    text = op['text'].strip()
    if not text or len(text) > checks.CASE_INTRO_MAX:
        raise RepairError(f'案例简介要 1–{checks.CASE_INTRO_MAX} 字：{text}')
    readme = case.get('readme') or readme_for(case.get('title', ''), text)
    readme = set_readme_section(readme, '案例简介', text)
    if op.get('detail'):
        readme = set_readme_section(readme, '详细说明', op['detail'])
    case['readme'] = readme


OPS = {'video-to-case': op_video_to_case, 'summary': op_summary, 'case-intro': op_case_intro}


def apply_ops(source, ops):
    source = copy.deepcopy(source)
    for op in ops:
        if op.get('op') not in OPS:
            raise RepairError(f'不认识的修复动作：{op}')
        OPS[op['op']](source, op)
    return source


def fill_titles(source):
    record = source['record']
    titles = record.setdefault('videoTitles', {})
    changed = 0
    for v in record.get('videos') or []:
        if v['path'] not in titles:
            titles[v['path']] = clean_title(v.get('name') or v['path']); changed += 1
    return changed


def adopt_legacy_posters(source):
    """旧数据里视频条目自带 poster 字段（网站不读），图床上也有这张图：直接登记进 videoPosters，不用重新取帧。"""
    urls = {checks.web_path(a['path']): a.get('url') for a in source['assets']}
    posters = source['record'].setdefault('videoPosters', {})
    adopted = 0
    for v in source['record'].get('videos') or []:
        old = v.get('poster')
        if old and not urls.get(checks.web_path(posters.get(v['path']))) and urls.get(checks.web_path(old)):
            posters[v['path']] = old; adopted += 1
    return adopted


def poster_targets(source):
    """缺封面的视频 -> 封面相对路径（与 video_posters.poster_rel 同一约定）。"""
    urls = {checks.web_path(a['path']): a.get('url') for a in source['assets']}
    has = lambda p: bool(p) and bool(urls.get(checks.web_path(p)))
    out = []
    posters = source['record'].get('videoPosters') or {}
    for v in source['record'].get('videos') or []:
        if has(v['path']) and not has(posters.get(v['path'])):
            out.append((v['path'], VP.poster_rel(v['path']), urls[checks.web_path(v['path'])]))
    for c in source['cases']:
        for v in c.get('videos') or []:
            if has(v['path']) and not has(v.get('posterPath')):
                out.append((v['path'], VP.poster_rel(v['path']), urls[checks.web_path(v['path'])]))
    return out


def attach_poster(source, video, poster, cloud):
    """把已上传的封面挂进记录：加一个素材，活动视频写 videoPosters，案例视频写 posterPath。"""
    record = source['record']
    in_case = video.startswith('02_案例/')
    source['assets'] = [a for a in source['assets'] if a['path'] != poster]
    source['assets'].append({'activityId': record['id'], 'path': poster, 'name': Path(poster).name,
                             'category': '案例' if in_case else '活动', 'categoryText': '其他', 'rating': f'{score_of(video):05d}',
                             'description': clean_title(video) + '·封面', 'isCover': 0, 'onHomePage': 0,
                             'url': cloud['url'], 'hash': cloud['hash'], 'originBytes': cloud['bytes'], 'cloudBytes': cloud['bytes']})
    if in_case:
        for c in source['cases']:
            for v in c.get('videos') or []:
                if v['path'] == video:
                    v['posterPath'] = poster
    else:
        record.setdefault('videoPosters', {})[video] = poster


def diff_summary(before, after):
    b, a = {x['path'] for x in before['assets']}, {x['path'] for x in after['assets']}
    bc, ac = {c.get('folder') for c in before['cases']}, {c.get('folder') for c in after['cases']}
    lines = [f'素材 {len(b)} -> {len(a)}（新增 {len(a - b)}，移走 {len(b - a)}）',
             f'案例 {len(bc)} -> {len(ac)}（新增 {sorted(ac - bc)}）',
             f'活动视频 {len(before["record"].get("videos") or [])} -> {len(after["record"].get("videos") or [])}']
    changed = [k for k in set(before['record']) | set(after['record']) if before['record'].get(k) != after['record'].get(k)]
    lines.append(f'记录字段有变化：{sorted(changed)}')
    lost = [p for p in b - a if not any(x.get('hash') == next(y for y in before['assets'] if y['path'] == p).get('hash') for x in after['assets'])]
    if lost:
        lines.append(f'注意：{len(lost)} 个素材从记录里删除了（图床文件还在）：{lost[:5]}')
    return '\n'.join(lines)


# ---------- 命令 ----------

def work(path):
    w = Path(path).resolve()
    if not (w / 'before.json').is_file():
        raise RepairError(f'{w} 不是修复工作目录，先 pull')
    return w


def cmd_pull(uid, workdir, site):
    w = Path(workdir).resolve()
    if (w / 'before.json').exists():
        raise RepairError(f'{w} 已有 before.json；接着修就直接用，重来换一个新目录')
    source = api(site, uid)['source']
    write(w / 'before.json', source); write(w / 'after.json', source)
    write(w / 'meta.json', {'uid': uid, 'site': site})
    issues = checks.check_source(source)
    print(f'已拉取 {uid}：素材 {len(source["assets"])}、案例 {len(source["cases"])}、活动视频 {len(source["record"].get("videos") or [])}；'
          f'现有问题 {len(issues)} 条\n' + checks.format_issues(issues))


def cmd_apply(workdir):
    w = work(workdir)
    fixes = read(w / 'fixes.json')
    after = apply_ops(read(w / 'after.json'), fixes.get('ops', []))
    write(w / 'after.json', after)
    print(f'已按修复单改 {len(fixes.get("ops", []))} 处\n' + diff_summary(read(w / 'before.json'), after))


def cmd_titles(workdir):
    w = work(workdir)
    after = read(w / 'after.json'); n = fill_titles(after); write(w / 'after.json', after)
    print(f'补了 {n} 个视频标题')


def cmd_posters(workdir, redo=False):
    w = work(workdir)
    after = read(w / 'after.json')
    adopted = adopt_legacy_posters(after)
    if adopted:
        write(w / 'after.json', after)
        print(f'沿用旧数据里已有的封面 {adopted} 张（图床上已有，不重新取帧）')
    targets = poster_targets(after)
    rows, problems, picked = [], [], read(w / 'posters.json') if (w / 'posters.json').exists() else {}
    for video, poster, url in targets:
        if poster in picked and (w / 'posters' / poster).is_file() and not redo:
            continue  # 断点续跑：做过的跳过
        out = w / 'candidates' / Path(video).with_suffix('').as_posix().replace('/', '__')
        shots, best = VP.candidates(url, out)
        if shots is None:
            problems.append(f'{video}：{best}'); continue
        dest = w / 'posters' / poster; dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(shots[best], dest)
        picked[poster] = {'video': video, 'frame': best, 'by': 'auto'}
        write(w / 'posters.json', picked)
        rows.append((video, shots, best))
    if rows:
        for k in range(0, len(rows), 9):  # 一张图最多 9 行，太长看不清
            VP.contact_sheet(w, rows[k:k + 9], w / f'总览{k // 9 + 1}.jpg')
    print(json.dumps({'posters': len(rows), 'sheets': sorted(str(p) for p in w.glob('总览*.jpg')),
                      'rows': [f'{i}. {v} -> #{b}' for i, (v, _, b) in enumerate(rows)], 'problems': problems}, ensure_ascii=False, indent=1))


def cmd_pick(workdir, video, index):
    w = work(workdir)
    poster = VP.poster_rel(video)
    found = sorted((w / 'candidates' / Path(video).with_suffix('').as_posix().replace('/', '__')).glob(f'{int(index)}_*.jpg'))
    if not poster or not found:
        raise RepairError(f'没有 {video} 的候选帧 #{index}')
    shutil.copy2(found[0], w / 'posters' / poster)
    picked = read(w / 'posters.json'); picked[poster] = {'video': video, 'frame': int(index), 'by': 'manual'}
    write(w / 'posters.json', picked)
    print(f'已换成 #{index}：{poster}')


def cmd_upload(workdir, repo):
    import publish
    w = work(workdir); meta = read(w / 'meta.json'); after = read(w / 'after.json')
    picked = read(w / 'posters.json') if (w / 'posters.json').exists() else {}
    if not picked:
        print('没有要上传的封面'); return
    with tempfile.TemporaryDirectory(prefix='bigapple-repair-') as tmp:
        root = Path(tmp) / meta['uid']
        for poster in picked:
            dest = root / poster; dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(w / 'posters' / poster, dest)
        write(root / 'manifest.json', {'id': after['record']['id']})
        env = {**__import__('os').environ, 'BIGAPPLE_DEPLOY_SKILL_DIR': str(publish.deploy_skill_dir())}
        publish.run_streaming(['node', 'scripts/upload-media.mjs', '--media-root', tmp, '--folders', meta['uid'],
                               '--map', str(w / 'upload-map.js'), '--index', str(w / 'no-index.js')], Path(repo), env, 'upload-media.mjs')
    cloud = json.loads(re.search(r'export default (.*);\s*$', (w / 'upload-map.js').read_text(encoding='utf-8'), re.S).group(1))
    for poster, info in picked.items():
        attach_poster(after, info['video'], poster, cloud[f'{after["record"]["id"]}/{poster}'])
    write(w / 'after.json', after)
    print(f'封面已上传并挂进记录：{len(picked)} 张')


def cmd_check(workdir, waivers=None):
    w = work(workdir)
    before, after = read(w / 'before.json'), read(w / 'after.json')
    issues = checks.open_issues(after, checks.load_waivers(waivers))
    print(diff_summary(before, after))
    print(f'剩余问题 {len(issues)} 条（修之前 {len(checks.check_source(before))} 条）')
    if issues:
        print(checks.format_issues(issues))
    return issues


def cmd_preview(workdirs, repo, port, site):
    ws = [work(d) for d in workdirs]
    changed = {read(w / 'meta.json')['uid']: read(w / 'after.json') for w in ws}
    events = site_events(site)
    sources = [changed.get(e['uid']) or api(site, e['uid'])['source'] for e in events]
    tmp = Path(tempfile.mkdtemp(prefix='bigapple-preview-'))
    write(tmp / 'sources.json', sources); write(tmp / 'slugs.json', {e['uid']: e['slug'] for e in events})
    print(f'本地预览 http://localhost:{port}/ （只有 {list(changed)} 与线上不同；Ctrl+C 结束）', flush=True)
    subprocess.run(['node', str(Path(__file__).with_name('preview_server.mjs')), '--repo', str(Path(repo).resolve()),
                    '--sources', str(tmp / 'sources.json'), '--slugs', str(tmp / 'slugs.json'), '--data', str(tmp / 'data'), '--port', str(port)])


def cmd_push(workdir):
    w = work(workdir); meta = read(w / 'meta.json')
    before, after = read(w / 'before.json'), read(w / 'after.json')
    issues = checks.check_source(after)
    if issues:
        print('提示：写入后仍有这些问题（已和使用者确认可以先上线时才继续）：\n' + checks.format_issues(issues))
    live = api(meta['site'], meta['uid'])['source']
    if not same(live, before):
        raise RepairError('线上记录在 pull 之后被别人改过，停止写入。重新 pull，把修复单再 apply 一遍')
    result = api(meta['site'], meta['uid'], 'PUT', {'source': after})
    back = api(meta['site'], meta['uid'])['source']
    if not same(back, after):
        raise RepairError('写入后读回不一致，请立即检查；回滚：PUT before.json')
    write(w / 'pushed.json', back)
    print(f'已写入 {meta["site"]}：{meta["uid"]}，读回一致，网站共 {result.get("activities")} 场。回滚用 {w / "before.json"}')


def cmd_rollback(workdir):
    w = work(workdir); meta = read(w / 'meta.json')
    if not (w / 'pushed.json').is_file():
        raise RepairError('这个目录还没 push 过，不需要回滚')
    live = api(meta['site'], meta['uid'])['source']
    if not same(live, read(w / 'pushed.json')):
        raise RepairError('线上在这次 push 之后又被改过，回滚会覆盖别人的改动；先和使用者确认')
    before = read(w / 'before.json')
    api(meta['site'], meta['uid'], 'PUT', {'source': before})
    if not same(api(meta['site'], meta['uid'])['source'], before):
        raise RepairError('回滚后读回不一致，请立即检查')
    (w / 'pushed.json').rename(w / 'rolled-back.json')
    print(f'已回滚 {meta["uid"]} 到 pull 时的版本，读回一致')


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('pull'); q.add_argument('uid'); q.add_argument('workdir'); q.add_argument('--site', default=PRODUCTION_SITE)
    for name in ('apply', 'titles', 'push', 'rollback'):
        sub.add_parser(name).add_argument('workdir')
    q = sub.add_parser('posters'); q.add_argument('workdir'); q.add_argument('--redo', action='store_true')
    q = sub.add_parser('pick'); q.add_argument('workdir'); q.add_argument('video'); q.add_argument('index', type=int)
    q = sub.add_parser('upload'); q.add_argument('workdir'); q.add_argument('--repo', required=True)
    q = sub.add_parser('check'); q.add_argument('workdir'); q.add_argument('--waivers')
    q = sub.add_parser('preview'); q.add_argument('workdirs', nargs='+'); q.add_argument('--repo', required=True)
    q.add_argument('--port', type=int, default=4320); q.add_argument('--site', default=PRODUCTION_SITE)
    a = p.parse_args(argv)
    try:
        {'pull': lambda: cmd_pull(a.uid, a.workdir, a.site), 'apply': lambda: cmd_apply(a.workdir), 'titles': lambda: cmd_titles(a.workdir),
         'posters': lambda: cmd_posters(a.workdir, a.redo), 'pick': lambda: cmd_pick(a.workdir, a.video, a.index),
         'upload': lambda: cmd_upload(a.workdir, a.repo), 'check': lambda: cmd_check(a.workdir, a.waivers),
         'preview': lambda: cmd_preview(a.workdirs, a.repo, a.port, a.site), 'push': lambda: cmd_push(a.workdir),
         'rollback': lambda: cmd_rollback(a.workdir)}[a.cmd]()
    except (RepairError, ValueError) as exc:
        raise SystemExit('错误: ' + str(exc))


if __name__ == '__main__':
    main()
