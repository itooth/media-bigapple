#!/usr/bin/env python3
"""全站体检：只读扫服务器上每场活动的原始记录，用 checks.py 同一套规则列出问题清单。

不下载任何图片或视频，不写服务器。需要本机部署身份（读原始记录要团队白名单）。

用法：
  audit.py                                    扫正式站，打印汇总
  audit.py --csv 体检.csv                      同时写逐条清单
  audit.py --waivers 体检豁免.json              跳过已豁免的问题（每条要写理由）
  audit.py --sources 本地备份.json              不联网，扫一份已下载的原始记录列表（测试、回看用）
  audit.py --site https://media-staging.bigapple.work
"""
import argparse, collections, csv, json, sys, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import checks  # noqa: E402

PRODUCTION_SITE = 'https://media.bigapple.work'


def fetch_sources(site):
    import publish
    headers = {**publish.deployment_headers(), 'User-Agent': 'curl/8'}
    with urllib.request.urlopen(urllib.request.Request(f'{site}/api/site', headers={'User-Agent': 'curl/8'}), timeout=60) as r:
        uids = [e['uid'] for e in json.load(r)['events']]
    sources = []
    for uid in uids:
        req = urllib.request.Request(f"{site}/api/activities/{urllib.parse.quote(uid, safe='')}", headers=headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            sources.append(json.load(r)['source'])
    return sources


def audit(sources, waivers=()):
    rows = []
    for s in sources:
        title = (s.get('record') or {}).get('title', '')
        rows += [{**i.as_dict(), 'title': title} for i in checks.open_issues(s, waivers)]
    return rows


def summary(rows, total):
    by_code = collections.Counter(r['code'] for r in rows)
    by_event = collections.Counter(r['title'] for r in rows)
    lines = [f'体检 {total} 场活动，问题 {len(rows)} 条，涉及 {len(by_event)} 场', '', '按问题类型：']
    lines += [f'  {n:>4}  {code:<24} {checks.RULES.get(code, "")}' for code, n in by_code.most_common()]
    lines += ['', '问题最多的活动：'] + [f'  {n:>4}  {t}' for t, n in by_event.most_common(10)]
    return '\n'.join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--site', default=PRODUCTION_SITE)
    p.add_argument('--sources', help='已下载的原始记录列表 JSON（不联网）')
    p.add_argument('--waivers', help='豁免文件 JSON')
    p.add_argument('--csv', help='逐条清单输出路径（UTF-8 BOM，Excel 可直接打开）')
    a = p.parse_args(argv)
    sources = json.loads(Path(a.sources).read_text(encoding='utf-8')) if a.sources else fetch_sources(a.site)
    rows = audit(sources, checks.load_waivers(a.waivers))
    if a.csv:
        with open(a.csv, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['title', 'uid', 'code', 'rule', 'target', 'message'])
            w.writeheader(); w.writerows(rows)
    print(summary(rows, len(sources)))
    return rows


if __name__ == '__main__':
    main()
