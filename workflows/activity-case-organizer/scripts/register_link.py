"""Register the outcome of one case link: chosen frame or a recorded failure.

After capture_case_links.py staged candidates and a model viewed them, this copies the
chosen frame into 02_案例/<案例>/截图/, upserts the linkReview record in 媒体映射.json and
marks the screenshot as reviewed (evidence required) in 其他/整理记录.json, which
`archive.py mirror` reads for new screenshots. If the media is already in 媒体映射.json its
review is updated too. A failed link can be registered with --status failed --error.
`archive.py mirror` keeps linkReview, so run mirror and catalog afterwards.

Usage:
    python3 scripts/register_link.py /活动目录 --case 首页02_新安校园 --url https://x/ \
        --candidate /暂存/xxx-c02-....png --name 页面_发布一条新动态表单 \
        --kind page-interactive --title 新安人 --evidence "实看:发布动态表单"
    python3 scripts/register_link.py /活动目录 --case 首页02_新安校园 --url https://x/ \
        --status failed --error "TimeoutError: 页面一直加载"
"""

import argparse
import importlib.util
import json
import os
import shutil
import tempfile
import uuid
from datetime import datetime
from pathlib import Path


HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


common = load('link_common')
KINDS = ('page-first', 'page-settled', 'page-interactive', 'page-scrolled', 'video-poster', 'video-frame')
STATUSES = ('captured', 'failed', 'verified-no-capture')


def now():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def read_json(path, default):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    os.replace(temporary, path)


def find_source(root, case_path, url):
    discover = load('capture_case_links').discover
    for task in discover(root, {case_path.split('/')[1]}):
        if task['url'] == url:
            return task['sourcePath']
    return None


def register(root, case, url, status='captured', candidate=None, name=None, kind=None, title='',
             evidence=None, error=None, source=None, reason=None):
    root = Path(root).resolve(strict=True)
    if not common.valid_url(url):
        raise ValueError('invalid --url')
    case_path = '02_案例/' + case
    if not (root / case_path).is_dir() or '/' in case:
        raise ValueError(f'case folder not found: {case_path} (create it first, see links-and-intake.md)')
    if status not in STATUSES:
        raise ValueError('--status must be one of ' + ', '.join(STATUSES))
    source = source or find_source(root, case_path, url)
    if not source:
        raise ValueError('cannot find the file that lists this URL under the case; pass --source <相对路径>')
    common.checked_path(root, source)
    record = {'url': url, 'casePath': case_path, 'sourcePath': source, 'title': title, 'status': status,
              'captureKind': None, 'screenshotPath': None, 'capturedAt': now()}
    mapping_path = root / '媒体映射.json'
    mapping = read_json(mapping_path, {'version': 2, 'activity': root.name, 'media': []})
    mapping.setdefault('linkReview', [])
    plan_path = root / '其他/整理记录.json'
    plan = read_json(plan_path, None)
    if status == 'captured':
        if not (candidate and name and kind and evidence):
            raise ValueError('captured needs --candidate, --name, --kind and --evidence (what you actually saw)')
        if kind not in KINDS:
            raise ValueError('--kind must be one of ' + ', '.join(KINDS))
        source_file = Path(candidate).resolve(strict=True)
        if source_file.suffix.lower() not in common.IMAGES:
            raise ValueError('--candidate must be an image')
        if root in source_file.parents:
            raise ValueError('--candidate should be a staged frame outside the activity')
        if '/' in name or '\\' in name or name.startswith('.'):
            raise ValueError('--name is a file name without folders')
        destination = root / case_path / '截图' / (name + source_file.suffix.lower())
        relative = destination.relative_to(root).as_posix()
        digest = common.sha256(source_file)
        if destination.exists():
            if destination.is_symlink() or common.sha256(destination) != digest:
                raise ValueError('a different file already exists at ' + relative)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source_file, destination)
        record.update(captureKind=kind, screenshotPath=relative, evidence=evidence)
        review = {'reviewed': True, 'evidence': evidence, 'confidence': 0.8}
        entry = None
        if plan is None:
            plan = {'version': 1, 'entries': []}
        for item in plan.setdefault('entries', []):
            if item.get('targetPath') == relative:
                entry = item
        if entry is None:
            entry = {'assetId': str(uuid.uuid4()), 'targetPath': relative, 'selected': True,
                     'sourcePath': source_file.name, 'originalName': destination.name}
            plan['entries'].append(entry)
        entry.update(review=review, sha256=digest, bytes=destination.stat().st_size)
        for media in mapping.get('media', []):
            if isinstance(media, dict) and media.get('originalPath') == relative:
                media['review'] = review
        write_json(plan_path, plan)
    else:
        if status == 'failed':
            if not error:
                raise ValueError('failed needs --error')
            record['error'] = error
        elif not reason:
            raise ValueError('verified-no-capture needs --reason')
        else:
            record['reason'] = reason
    links = [item for item in mapping['linkReview'] if not (isinstance(item, dict) and item.get('casePath') == case_path and item.get('url') == url)]
    links.append(record)
    mapping['linkReview'] = links
    write_json(mapping_path, mapping)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('activity')
    parser.add_argument('--case', required=True, help='案例目录名,如 首页02_新安校园')
    parser.add_argument('--url', required=True)
    parser.add_argument('--status', default='captured', choices=STATUSES)
    parser.add_argument('--candidate', help='选定的候选帧(暂存目录里的 png)')
    parser.add_argument('--name', help='截图文件名(不含扩展名),写实际画面内容')
    parser.add_argument('--kind', choices=KINDS)
    parser.add_argument('--title', default='')
    parser.add_argument('--evidence', help='实看到了什么(captured 必填)')
    parser.add_argument('--error', help='失败原因(failed 必填)')
    parser.add_argument('--reason', help='verified-no-capture 的理由')
    parser.add_argument('--source', help='列出该 URL 的源文件(相对活动目录);默认自动查找')
    arguments = parser.parse_args(argv)
    try:
        record = register(arguments.activity, arguments.case, arguments.url, arguments.status, arguments.candidate,
                          arguments.name, arguments.kind, arguments.title, arguments.evidence, arguments.error,
                          arguments.source, arguments.reason)
    except (ValueError, OSError) as exception:
        parser.exit(2, 'register_link: ' + str(exception) + '\n')
    print(json.dumps({'registered': record, 'next': 'archive.py mirror, then catalog.py'}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
