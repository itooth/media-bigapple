"""Stage candidate frames for case links so a model can pick the best one.

The opening frame of a game or page is often just a title card, so this tool
samples several moments instead of trusting the first paint: after load, after
the scene settles, after clicking start/continue, after a key or mouse nudge,
after scrolling, and across the video timeline when a player is present.

Everything lands outside the activity in a staging directory. Files are
content-addressed, never overwritten, and nothing in the activity is touched.
Requires Pillow and Playwright plus an installed Chromium browser.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path


SPEC = importlib.util.spec_from_file_location('link_common', Path(__file__).with_name('link_common.py'))
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
TEXT_SUFFIXES = {'.txt', '.md', '.url'}
CHROME_CANDIDATES = (
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
)
START_SELECTORS = ('button:has-text("开始")', 'text=开始游戏', 'text=开始冒险', 'text=继续', 'text=Start',
                   'text=Play', '[data-action="start"]', '.start-button', '#start')


def timestamp():
    return datetime.now().astimezone().isoformat()


def chrome_binary(explicit=None):
    if explicit:
        return explicit
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    found = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('chrome')
    if not found:
        raise ValueError('No Chromium browser found; pass --chrome /path/to/binary')
    return found


def task_key(case_path, url):
    return hashlib.sha256(json.dumps([case_path, url], ensure_ascii=False).encode()).hexdigest()


def discover(root, selected=None):
    tasks = {}
    files, unused_links = validator.business_files(root)
    for relative, path in files.items():
        parts = Path(relative).parts
        if len(parts) < 3 or parts[0] != '02_案例' or parts[1] in validator.COLLECTION_DIRS or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if selected and parts[1] not in selected:
            continue
        case_path = '/'.join(parts[:2])
        for url in validator.urls_in(path):
            key = task_key(case_path, url)
            task = tasks.setdefault(key, {'key': key, 'url': url, 'casePath': case_path,
                                          'sourcePath': relative, 'sources': [], 'videoHint': False})
            task['sources'].append({'path': relative, 'sha256': validator.sha256(path)})
            task['videoHint'] |= '视频' in path.name or Path(url.split('?')[0]).suffix.lower() in validator.VIDEOS
    return list(tasks.values())


def quality_flags(path, title='', text='', http_status=None):
    from PIL import Image, ImageStat
    flags = []
    with Image.open(path) as picture:
        picture.load()
        size = picture.size
        statistics = ImageStat.Stat(picture.convert('RGB'))
    if min(size) < 200:
        flags.append('capture-too-small')
    if max(statistics.stddev) < 3:
        flags.append('near-uniform-image')
    normalized = ' '.join(text.lower().split())
    if len(normalized) < 160 and any(word in normalized for word in ('加载中', '加载资源', 'loading', 'please wait')):
        flags.append('possible-loading-screen')
    if any(word in title.lower() for word in ('404', '403', 'error', 'just a moment', '验证码')):
        flags.append('possible-error-or-verification')
    if http_status is not None and http_status >= 400:
        flags.append('http-error-' + str(http_status))
    return size, flags


def content_score(path, text=''):
    """Advisory 0-1 richness score: colour, edges, tonal spread, minus text-thin penalty."""
    from PIL import Image, ImageFilter, ImageStat
    with Image.open(path) as picture:
        small = picture.convert('RGB').resize((320, 200))
        colourfulness = max(ImageStat.Stat(small).stddev)
        edges = ImageStat.Stat(small.convert('L').filter(ImageFilter.FIND_EDGES)).stddev[0]
        histogram = small.convert('L').histogram()
    tonal_spread = sum(1 for value in histogram if value) / 256
    visible_text = len(' '.join(str(text).split()))
    score = 0.45 * min(1.0, colourfulness / 64) + 0.35 * min(1.0, edges / 32) + 0.20 * tonal_spread
    if visible_text < 40:
        score -= 0.15
    if visible_text < 12:
        score -= 0.10
    return round(max(0.0, min(1.0, score)), 3)


def _record(page, shots, out_dir, kind, note, seconds=None, wait=0, limit=None, http_status=None):
    if limit is not None and sum(1 for shot in shots if shot['kind'].split('-')[0] == kind.split('-')[0]) >= limit:
        return
    if wait:
        page.wait_for_timeout(wait)
    target = Path(out_dir) / f'candidate-{len(shots):02d}.png'
    page.screenshot(path=str(target))
    body = ''
    try:
        body = page.locator('body').inner_text(timeout=3000)[:4000]
    except Exception:
        body = ''
    title = page.title()
    size, flags = quality_flags(target, title, body, http_status)
    shots.append({'kind': kind, 'note': note, 'seconds': seconds, 'title': title,
                  'width': size[0], 'height': size[1], 'flags': flags,
                  'contentScore': content_score(target, body), 'httpStatus': http_status, 'file': target.name})


def capture_candidates(task, binary, out_dir, timeout, limit=6, video_frames=4):
    """Sample several moments; a model then picks the most representative frame."""
    from playwright.sync_api import sync_playwright
    out_dir = Path(out_dir)
    shots = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=binary, headless=True)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
            page = context.new_page()
            page.set_default_timeout(timeout * 1000)
            response = page.goto(task['url'], wait_until='domcontentloaded', timeout=timeout * 1000)
            status = response.status if response else None
            _record(page, shots, out_dir, 'page-first', '页面载入后立即截取', wait=min(1500, timeout * 100), limit=limit, http_status=status)
            _record(page, shots, out_dir, 'page-settled', '等待动态内容渲染完成', wait=min(2500, timeout * 200), limit=limit, http_status=status)
            for selector in START_SELECTORS:
                try:
                    locator = page.locator(selector).first
                    if locator.count() and locator.is_visible():
                        locator.click(timeout=3000)
                        _record(page, shots, out_dir, 'page-interactive', '点击开始/继续入口后截取', wait=1800, limit=limit, http_status=status)
                        break
                except Exception:
                    continue
            try:
                page.mouse.click(720, 450)
                page.keyboard.press('Space')
                _record(page, shots, out_dir, 'page-interactive', '点击画面并按键后截取', wait=1500, limit=limit, http_status=status)
            except Exception:
                pass
            for ratio in (0.35, 0.7):
                try:
                    page.mouse.wheel(0, int(900 * ratio))
                    _record(page, shots, out_dir, 'page-scrolled', f'滚动到页面 {int(ratio * 100)}% 截取', wait=900, limit=limit, http_status=status)
                except Exception:
                    continue
            video = page.locator('video:visible').first
            if video.count():
                try:
                    duration = video.evaluate('(video) => Number(video.duration) || 0')
                except Exception:
                    duration = 0
                if video.get_attribute('poster') and not duration:
                    try:
                        video.evaluate('(video) => video.pause()')
                    except Exception:
                        pass
                    _record(page, shots, out_dir, 'video-poster', '视频封面帧', limit=video_frames, http_status=status)
                else:
                    try:
                        video.evaluate('(video) => { video.muted = true; video.play().catch(() => {}); }')
                    except Exception:
                        pass
                    for index in range(max(1, video_frames)):
                        position = duration * (0.15 + 0.7 * index / max(1, video_frames - 1)) if duration else 1.0 + index
                        try:
                            video.evaluate('(video, value) => { video.pause(); video.currentTime = value; }', position)
                        except Exception:
                            try:
                                video.evaluate('(video, value) => { video.currentTime = value; }', position)
                            except Exception:
                                pass
                        _record(page, shots, out_dir, 'video-frame', f'视频第 {round(position, 1)} 秒',
                                seconds=round(position, 1), wait=700, limit=video_frames, http_status=status)
            for shot in shots:
                shot['httpStatus'] = status
                shot['finalUrl'] = page.url
            return shots
        finally:
            browser.close()


def dedupe_candidates(candidates, digests):
    unique = []
    for candidate in candidates:
        digest = digests[candidate['file']]
        existing = next((item for item in unique if item['sha256'] == digest), None)
        if existing is not None:
            seen = existing.setdefault('duplicateKinds', [])
            if candidate['kind'] not in seen and candidate['kind'] != existing['kind']:
                seen.append(candidate['kind'])
            existing['duplicateNotes'] = existing.get('duplicateNotes', []) + [candidate['note']]
            continue
        unique.append({**candidate, 'sha256': digest})
    return unique


def stage_task(task, binary, output, timeout, limit=6, video_frames=4, capture_fn=capture_candidates):
    record = {**task, 'status': 'failed', 'capturedAt': timestamp(), 'candidatePaths': [],
              'candidatePath': None, 'recommendedPath': None, 'screenshotPath': None,
              'captureKind': None, 'title': '', 'candidates': [], 'error': ''}
    try:
        with tempfile.TemporaryDirectory(prefix='capture-', dir=output) as temporary:
            shots = capture_fn(task, binary, Path(temporary), timeout, limit, video_frames)
            if not shots:
                raise RuntimeError('no candidate frames were produced')
            digests = {shot['file']: validator.sha256(Path(temporary) / shot['file']) for shot in shots}
            candidates = dedupe_candidates(shots, digests)
            for index, candidate in enumerate(candidates):
                source = Path(temporary) / candidate['file']
                name = f"{task['key']}-c{index:02d}-{candidate['sha256']}.png"
                destination = output / name
                if destination.exists():
                    if destination.is_symlink() or validator.sha256(destination) != candidate['sha256']:
                        raise ValueError('existing candidate changed; refusing to overwrite')
                else:
                    with destination.open('xb') as stream, source.open('rb') as origin:
                        shutil.copyfileobj(origin, stream)
                candidate['path'] = name
                candidate['bytes'] = destination.stat().st_size
            best = max(candidates, key=lambda item: item['contentScore'])
            record['candidates'] = candidates
            record['candidatePaths'] = [item['path'] for item in candidates]
            record['recommendedPath'] = best['path']
            record['candidatePath'] = best['path']
            record['captureKind'] = best['kind']
            record['title'] = candidates[0].get('title', '')
            record['status'] = 'needs-review'
            record['error'] = ('Visual review required: pick the most representative frame; '
                               'recommended by richness score only, confirm identity and content')
            write_candidate_index(output, task['key'], candidates)
    except Exception as exception:
        record['error'] = type(exception).__name__ + ': ' + str(exception)
    return record


def write_candidate_index(output, key, candidates):
    path = output / f'{key}-candidates.json'
    path.write_text(json.dumps({'key': key, 'candidates': candidates}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path


def write_checkpoint(path, data):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def reusable(record, task, output):
    if not isinstance(record, dict) or record.get('sources') != task['sources'] or record.get('status') != 'needs-review':
        return False
    candidates = record.get('candidates') or []
    if not candidates:
        return False
    for candidate in candidates:
        try:
            path = validator.checked_path(output, candidate.get('path'))
        except ValueError:
            return False
        if not path.is_file() or validator.sha256(path) != candidate.get('sha256'):
            return False
    return True


def already_reviewed(root, task, mapping):
    for record in mapping.get('linkReview', []):
        if not isinstance(record, dict) or (record.get('casePath'), record.get('url'), record.get('status')) != (task['casePath'], task['url'], 'captured'):
            continue
        relative = record.get('screenshotPath')
        try:
            path = validator.checked_path(root, relative)
            if not relative.startswith(task['casePath'] + '/截图/'):
                continue
            for media in mapping.get('media', []):
                if isinstance(media, dict) and media.get('originalPath') == relative and isinstance(media.get('review'), dict) and media['review'].get('reviewed') is True and path.is_file() and validator.sha256(path) == media.get('originalSha256'):
                    return True
        except (ValueError, OSError):
            continue
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('activity')
    parser.add_argument('--case', action='append')
    parser.add_argument('--chrome')
    parser.add_argument('--output', help='staging directory outside activity; default sibling hidden directory')
    parser.add_argument('--timeout', type=int, default=30)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=3)
    parser.add_argument('--candidates', type=int, default=6, help='max candidate frames per link')
    parser.add_argument('--video-frames', type=int, default=4, help='sampled video moments per link')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--dry-run', action='store_true', help='read-only plan; no browser, network or output writes')
    arguments = parser.parse_args(argv)
    if arguments.timeout < 1 or arguments.candidates < 1 or arguments.video_frames < 1:
        parser.error('--timeout, --candidates and --video-frames must be positive')
    root = Path(arguments.activity).resolve(strict=True)
    tasks = discover(root, set(arguments.case or []))
    if arguments.dry_run:
        print(json.dumps({'activity': str(root), 'tasks': tasks}, ensure_ascii=False, indent=2))
        return 0
    output = Path(arguments.output).resolve() if arguments.output else root.parent / ('.' + root.name + '-link-captures')
    if output == root or root in output.parents or output in root.parents:
        parser.error('--output must be a separate directory outside activity')
    mapping_path = validator.checked_path(root, '媒体映射.json')
    mapping = json.loads(mapping_path.read_text(encoding='utf-8-sig')) if mapping_path.exists() else {}
    if not isinstance(mapping, dict) or any(not isinstance(mapping.get(key, []), list) for key in ('media', 'linkReview')):
        raise ValueError('invalid mapping; activity left unchanged')
    checkpoint = output / 'capture-review.json'
    previous = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
    if previous and previous.get('activity') != str(root):
        raise ValueError('staging directory belongs to a different activity')
    records = {row['key']: row for row in previous.get('results', [])}
    pending = [task for task in tasks if arguments.refresh or not (
        reusable(records.get(task['key']), task, output) or already_reviewed(root, task, mapping))]
    binary = chrome_binary(arguments.chrome) if pending else None
    output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=arguments.workers) as pool:
        staged = pool.map(lambda task: stage_task(task, binary, output, arguments.timeout,
                                                  arguments.candidates, arguments.video_frames), pending)
        for record in staged:
            records[record['key']] = record
            write_checkpoint(checkpoint, {'version': 2, 'activity': str(root), 'results': list(records.values())})
    current = [records[task['key']] for task in tasks if task['key'] in records]
    failed = sum(record['status'] == 'failed' for record in current)
    frames = sum(len(record.get('candidates') or []) for record in current)
    print(json.dumps({'tasks': len(tasks), 'attempted': len(pending), 'failed': failed,
                      'candidateFrames': frames, 'staging': str(output), 'activityModified': False,
                      'next': 'Inspect every candidate frame, pick the most representative one per case, '
                              'then score and commit both activity JSON indexes'}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
