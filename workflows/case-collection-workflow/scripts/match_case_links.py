"""Match a case-set link index to individual case folders.

Reads collection-level link indexes under 02_案例/ (for example 案例链接.md),
binds every URL to one case, verifies the binding against the real page title,
and can write the results into case 其他/ link files, 说明.md and a match record.

Usage:
    python3 scripts/match_case_links.py /活动目录 --verify
    python3 scripts/match_case_links.py /活动目录 --verify --apply
"""

import argparse
import importlib.util
import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


SPEC = importlib.util.spec_from_file_location('link_common', Path(__file__).with_name('link_common.py'))
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

INDEX_SUFFIXES = {'.md', '.txt', '.url'}
LEGACY_CONFIG_NAMES = {'链接对应表.md'}
COLLECTION_DIRS = ('案例集合材料', '案例素材', '原案例素材')
SCORE_PATTERN = re.compile(r'^(\d{5})_(?:首页_)?(.+)$')
PLACEHOLDER_URLS = {'站内案例详情页', '待确认', '无', '暂无', ''}
DROP_WORDS = ('备用入口', '网页版', '移动端', 'h5原型', '原型', '演示', '原版', '入口', '封面')
ENTRY_PATTERN = re.compile(r'^\s*(?:[-*+]|\d+[.、)])\s*(.+)$')
MARKDOWN_LINK = re.compile(r'\[([^\]]+)\]\(\s*(https?://[^)\s]+)\s*\)')
TITLE_PATTERN = re.compile(r'<title[^>]*>(.*?)</title>', re.IGNORECASE | re.DOTALL)
META_REFRESH = re.compile(r'<meta[^>]+http-equiv=["\']?refresh["\']?[^>]+content=["\'][^"\']*url=([^"\';>]+)', re.IGNORECASE)
JS_REDIRECT = re.compile(r'(?:location\.(?:href|replace\s*\())\s*=?\s*["\']([^"\']+)["\']', re.IGNORECASE)


def timestamp():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def normalize_name(text):
    value = str(text).strip()
    value = SCORE_PATTERN.sub(lambda match: match.group(2), value)
    value = re.sub(r'^(?:首页|封面|主图|精选)[_\s]*', '', value)
    value = re.sub(r'[（(][^）)]*[）)]', '', value)
    value = value.lower()
    for word in DROP_WORDS:
        value = value.replace(word, '')
    return re.sub(r'[\s\-_·・:：,，.。/、|+&]+', '', value)


def parse_index_entries(text):
    entries = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        markdown = MARKDOWN_LINK.search(line)
        if markdown:
            name, url = markdown.group(1), markdown.group(2)
        else:
            urls = validator.urls_in_text(line)
            if not urls:
                continue
            url = urls[0]
            name = line.split(url)[0].strip()
            match = ENTRY_PATTERN.match(name) or ENTRY_PATTERN.match(line.split(url)[0].strip())
            if match:
                name = match.group(1)
            name = re.sub(r'^[-*+]\s*', '', name)
        name = name.strip().rstrip('：:=-—>→ \t')
        if name and url:
            entries.append({'name': name, 'url': url})
    return entries


def index_files(root, explicit=None):
    case_root = root / '02_案例'
    found = []
    if explicit:
        for value in explicit:
            path = root / value
            if not path.is_file():
                raise SystemExit('link index not found: ' + value)
            found.append(path)
        return found
    candidates = []
    if case_root.is_dir():
        candidates.extend(sorted(path for path in case_root.iterdir() if path.is_file() and path.suffix.lower() in INDEX_SUFFIXES))
        for name in COLLECTION_DIRS:
            directory = case_root / name
            if directory.is_dir():
                candidates.extend(sorted(path for path in directory.rglob('*') if path.is_file() and path.suffix.lower() in INDEX_SUFFIXES))
    for path in candidates:
        if path.name in LEGACY_CONFIG_NAMES or path.is_symlink():
            continue
        if read_text(path) and validator.urls_in(path):
            found.append(path)
    return found


def read_text(path):
    try:
        return path.read_text(encoding='utf-8-sig')
    except (OSError, UnicodeDecodeError):
        return ''


def load_aliases(cli_aliases=None, alias_file=None):
    """Aliases come from the command line only; the activity never stores a mapping file."""
    aliases = {}
    if alias_file:
        path = Path(alias_file).expanduser().resolve()
        if not path.is_file():
            raise SystemExit('--alias-file not found: ' + str(path))
        for raw in read_text(path).splitlines():
            line = raw.strip().lstrip('-*+ ').strip()
            if not line or line.startswith('#'):
                continue
            parts = re.split(r'\s*(?:=|→|->|=>|\|)\s*', line, maxsplit=1)
            if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                aliases[normalize_name(parts[0])] = parts[1].strip()
    for item in cli_aliases or []:
        if '=' not in item:
            raise SystemExit('--alias expects 索引名=案例目录名: ' + item)
        name, target = item.split('=', 1)
        aliases[normalize_name(name)] = target.strip()
    return aliases


def collect_cases(root):
    case_root = root / '02_案例'
    cases = []
    if not case_root.is_dir():
        return cases
    for path in sorted(case_root.iterdir()):
        if not path.is_dir() or path.is_symlink() or path.name in COLLECTION_DIRS:
            continue
        match = SCORE_PATTERN.match(path.name)
        description = path / '说明.md'
        content = read_text(description)
        headings = re.findall(r'^#{1,6}\s+(.+)$', content, re.MULTILINE)
        sections = re.split(r'^#{1,6}\s+.+$', content, flags=re.MULTILINE)
        name_value = sections[1].strip() if len(sections) > 1 else ''
        current_url = sections[-1].strip() if len(sections) > 3 else ''
        cases.append({
            'dir': path.name,
            'canonical': match.group(2) if match else path.name,
            'formalName': name_value or (match.group(2) if match else path.name),
            'descriptionPath': description,
            'currentUrl': current_url,
            'hasDescription': description.is_file(),
            'headings': headings,
            'keys': {normalize_name(match.group(2) if match else path.name), normalize_name(name_value)} - {''},
        })
    return cases


def match_entries(entries, cases, aliases):
    by_dir = {case['dir']: case for case in cases}
    by_key = {}
    for case in cases:
        for key in case['keys']:
            by_key.setdefault(key, []).append(case)
    results, unresolved = [], []
    for entry in entries:
        key = normalize_name(entry['name'])
        target, method, note = None, None, ''
        alias_dir = aliases.get(key) or aliases.get(entry['name'].strip())
        if alias_dir:
            target = by_dir.get(alias_dir)
            if target is None:
                for case in cases:
                    if normalize_name(case['canonical']) == normalize_name(alias_dir):
                        target = case
                        break
            method = 'alias'
            note = '来自人工指定的 --alias / --alias-file 映射'
        if target is None:
            candidates = by_key.get(key, [])
            if len(candidates) == 1:
                target, method, note = candidates[0], 'exact', '名称与案例完全一致'
            elif len(candidates) > 1:
                note = '多个案例同名: ' + ', '.join(case['dir'] for case in candidates)
        if target is None and len(key) >= 3:
            contains = [case for case in cases if key in case['keys'] or any(key in item for item in case['keys'])]
            if len(contains) == 1:
                target, method, note = contains[0], 'contains', '索引名与案例名互相包含，需页面复核'
        record = {'name': entry['name'], 'url': entry['url'], 'key': key,
                  'caseDir': target['dir'] if target else None, 'casePath': '02_案例/' + target['dir'] if target else None,
                  'method': method, 'note': note, 'title': '', 'httpStatus': None,
                  'verifiedAt': None, 'confidence': 'high' if method == 'exact' else 'medium' if method in {'alias', 'contains'} else 'low'}
        (results if target else unresolved).append(record)
    return results, unresolved


def detect_duplicates(results):
    groups = {}
    for record in results:
        groups.setdefault(record['url'], []).append(record['caseDir'])
    return {url: dirs for url, dirs in groups.items() if len(set(dirs)) > 1}


def fetch_title(url, timeout, hops=2):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(400000).decode('utf-8', 'replace')
            status = response.status
            final = response.url
    except urllib.error.HTTPError as error:
        return '', error.code, type(error).__name__ + ': HTTP ' + str(error.code)
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return '', None, type(error).__name__ + ': ' + str(error)
    match = TITLE_PATTERN.search(body)
    title = re.sub(r'\s+', ' ', match.group(1)).strip()[:160] if match else ''
    if hops and (not title or title.lower() in {'redirecting', 'redirect', 'loading'} or title.startswith('http')):
        target = META_REFRESH.search(body) or JS_REDIRECT.search(body)
        if target:
            next_url = urllib.parse.urljoin(final or url, target.group(1).strip())
            if next_url != url:
                return fetch_title(next_url, timeout, hops - 1)
    return title, status, ''


def verify(results, timeout, workers):
    def run(record):
        title, status, error = fetch_title(record['url'], timeout)
        record.update(title=title, httpStatus=status, error=error, verifiedAt=timestamp())
        if status and status >= 400:
            record['confidence'] = 'low'
        return record
    with ThreadPoolExecutor(max_workers=max(1, min(4, workers))) as pool:
        return list(pool.map(run, results))


def link_file_name(url, name):
    suffix = PurePosixPath(urlsplit(url).path).suffix.lower()
    if '视频' in name or suffix in validator.VIDEOS:
        return '视频链接.md'
    return '游戏链接.md'


def write_text(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(content, encoding='utf-8')
    temporary.replace(path)


def apply_results(root, results, unresolved, skipped_cases):
    written, pending, conflicts, records = [], [], [], []
    now = timestamp()
    primaries = {}
    for record in results:
        current = primaries.get(record['casePath'])
        if current is None or ('备用' in current['name'] and '备用' not in record['name']):
            primaries[record['casePath']] = record
    for record in results:
        case = root / record['casePath']
        name = link_file_name(record['url'], record['name'])
        target = case / '其他' / name
        existing = read_text(target)
        if record['url'] not in set(validator.urls_in(target)):
            body = existing.rstrip('\n')
            if not body:
                body = '# ' + name.replace('.md', '')
            body = body.lstrip('\n') + '\n\n- ' + record['name'] + '：' + record['url'] + '\n'
            write_text(target, body)
            written.append(str(target.relative_to(root)))
        if record['name'] not in read_text(target):
            text = read_text(target).rstrip('\n') + '\n- ' + record['name'] + '：' + record['url'] + '\n'
            write_text(target, re.sub(r'\n\s*\n\s*\n+', '\n\n', text))
        record_file = case / '其他' / '链接匹配记录.md'
        rows = existing_rows(read_text(record_file))
        rows = [row for row in rows if row[0] != record['name'] or row[1] != record['url']]
        rows.append([record['name'], record['url'], record['title'] or '（未取得标题）',
                     record['method'], record['confidence'], record['verifiedAt'] or now])
        write_text(record_file, render_record(rows))
        records.append(str(record_file.relative_to(root)))
        if primaries.get(record['casePath']) is not record:
            continue
        outcome = update_description(case / '说明.md', record['url'])
        if outcome == 'conflict':
            conflicts.append(record['casePath'] + ' 说明.md 已有其它真实网址，保留原值；清单链接已写入案例链接文件')
    for record in unresolved:
        pending.append('- 索引条目「' + record['name'] + '」未匹配到案例：' + record['url'] + (('；' + record['note']) if record['note'] else ''))
    for case in skipped_cases:
        pending.append('- 案例「' + case['dir'] + '」在链接清单中没有对应条目，`## 案例网址` 保持占位，不硬凑链接')
    if pending:
        pending_file = root / '其他/待确认素材.md'
        existing = read_text(pending_file)
        body = existing.rstrip('\n')
        if not body:
            body = '# 待确认素材'
        marker = '## 案例链接待确认'
        if marker in body:
            body = body[:body.index(marker)].rstrip('\n')
        body += '\n\n## 案例链接待确认（' + now + '）\n\n' + '\n'.join(pending) + '\n'
        write_text(pending_file, body.lstrip('\n'))
    return written, pending, conflicts, sorted(set(records))


def existing_rows(text):
    rows = []
    for line in text.splitlines():
        if not line.startswith('|') or line.startswith('| ---') or '索引条目' in line:
            continue
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) >= 6:
            rows.append(cells[:6])
    return rows


def render_record(rows):
    lines = ['# 链接匹配记录', '', '索引条目 | URL | 页面标题 | 匹配方式 | 置信度 | 核验时间', '| --- | --- | --- | --- | --- | --- |']
    lines.extend('| ' + ' | '.join(row) + ' |' for row in rows)
    return '\n'.join(lines) + '\n'


def update_description(path, url):
    content = read_text(path)
    if not content:
        return 'missing'
    parts = re.split(r'(^#{1,6}\s+案例网址\s*$)', content, maxsplit=1, flags=re.MULTILINE)
    if len(parts) != 3:
        return 'missing'
    head, marker, rest = parts
    sections = re.split(r'(^#{1,6}\s+.+$)', rest, maxsplit=1, flags=re.MULTILINE)
    body, tail = sections[0], ''.join(sections[1:])
    current = body.strip()
    if current == url:
        return 'unchanged'
    if current not in PLACEHOLDER_URLS and validator.valid_url(current):
        return 'conflict'
    write_text(path, head + marker + '\n\n' + url + '\n' + tail)
    return 'updated'


def build_report(root, indexes, results, unresolved, duplicates, skipped_cases):
    return {
        'activity': str(root),
        'indexes': [str(path.relative_to(root)) for path in indexes],
        'summary': {
            'indexEntries': len(results) + len(unresolved),
            'assigned': len(results),
            'unassigned': len(unresolved),
            'casesWithoutLink': len(skipped_cases),
        },
        'matched': results,
        'unresolved': unresolved,
        'duplicateUrls': duplicates,
        'casesWithoutLink': [case['dir'] for case in skipped_cases],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('activity')
    parser.add_argument('--index', action='append', help='relative path of a link index file')
    parser.add_argument('--alias', action='append', help='索引名=案例目录名，可重复')
    parser.add_argument('--alias-file', help='活动目录外的人工映射文件，每行「索引名 = 案例目录名」；Skill 不会在活动里生成这种文件')
    parser.add_argument('--verify', action='store_true', help='fetch real page titles for evidence')
    parser.add_argument('--timeout', type=int, default=20)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--apply', action='store_true', help='write link files, 说明.md URLs and match records')
    arguments = parser.parse_args(argv)
    root = Path(arguments.activity).resolve(strict=True)
    indexes = index_files(root, arguments.index)
    entries = []
    for path in indexes:
        entries.extend(parse_index_entries(read_text(path)))
    cases = collect_cases(root)
    aliases = load_aliases(arguments.alias, arguments.alias_file)
    results, unresolved = match_entries(entries, cases, aliases)
    if arguments.verify:
        verified = verify(results + unresolved, arguments.timeout, arguments.workers)
        results, unresolved = verified[:len(results)], verified[len(results):]
    duplicates = detect_duplicates(results)
    claimed = {record['caseDir'] for record in results}
    skipped = [case for case in cases if case['dir'] not in claimed]
    report = build_report(root, indexes, results, unresolved, duplicates, skipped)
    if arguments.apply:
        if duplicates:
            raise SystemExit('duplicate URL across cases; fix aliases before --apply: ' + json.dumps(duplicates, ensure_ascii=False))
        written, pending, conflicts, records = apply_results(root, results, unresolved, skipped)
        report['written'] = written
        report['records'] = records
        report['conflicts'] = conflicts
        report['pending'] = pending
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
