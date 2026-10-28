"""Absorb root-level input packages left behind by an earlier organizing run.

A delivery package (交接包 / 解压目录 / 原素材目录) must never stay in the
activity root. This script compares its media with what is already organized,
moves anything unique into 其他/, writes an absorption record, then removes the
package. Covered media are pure duplicates and are not kept a second time.

Usage:
    python3 scripts/absorb_input_packages.py /活动目录
    python3 scripts/absorb_input_packages.py /活动目录 --apply [--keep-package]
"""

import argparse
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path


ROOT_DIRS = {'01_活动照片', '02_案例', '03_社交媒体', '其他'}
JSON_NAMES = {'manifest.json', '媒体映射.json'}
SKIP_NAMES = {'.DS_Store', '.git', '__pycache__'}
IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.avif'}
VIDEO_SUFFIXES = {'.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mts', '.m2ts'}
MEDIA_SUFFIXES = IMAGE_SUFFIXES | VIDEO_SUFFIXES
ARCHIVE_SUFFIXES = {'.zip', '.rar', '.7z', '.tar', '.gz'}
DHASH_LIMIT = 6


def timestamp():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


MIN_STDDEV = 8
MIN_EDGE = 64


def signature(path, size=8):
    from PIL import Image
    with Image.open(path) as picture:
        grey = picture.convert('L')
        width, height = grey.size
        if min(width, height) < MIN_EDGE:
            return None
        pixels = list(grey.resize((32, 32), Image.LANCZOS).tobytes())
        mean = sum(pixels) / len(pixels)
        variance = sum((value - mean) ** 2 for value in pixels) / len(pixels)
        if variance ** 0.5 < MIN_STDDEV:
            return None
        data = grey.resize((size + 1, size), Image.LANCZOS).tobytes()
    width = size + 1
    bits = [1 if data[row * width + column] < data[row * width + column + 1] else 0
            for row in range(size) for column in range(size)]
    return {'bits': bits, 'aspect': round(grey.size[0] / grey.size[1], 3)}


def similar(one, other):
    if one is None or other is None:
        return None
    if abs(one['aspect'] - other['aspect']) / max(one['aspect'], other['aspect']) > 0.10:
        return None
    return sum(a != b for a, b in zip(one['bits'], other['bits']))


def candidates(root):
    """Root entries outside the contract are treated as input packages."""
    found = []
    for entry in sorted(root.iterdir()):
        if entry.name in ROOT_DIRS or entry.name in JSON_NAMES or entry.name in SKIP_NAMES or entry.name.startswith('._'):
            continue
        found.append(entry)
    return found


def organized_index(root):
    by_hash, image_hashes = {}, []
    for area in ('01_活动照片', '02_案例', '03_社交媒体'):
        base = root / area
        if not base.is_dir():
            continue
        for path in base.rglob('*'):
            if not path.is_file() or path.suffix.lower() not in MEDIA_SUFFIXES:
                continue
            try:
                by_hash.setdefault(sha256(path), []).append(path.relative_to(root).as_posix())
            except OSError:
                continue
            if path.suffix.lower() in IMAGE_SUFFIXES:
                try:
                    signature_value = signature(path)
                except (OSError, ValueError, ImportError):
                    continue
                if signature_value is not None:
                    image_hashes.append((signature_value, path.relative_to(root).as_posix()))
    return by_hash, image_hashes


def classify(package, by_hash, image_hashes):
    report = {'media': [], 'documents': [], 'archives': []}
    for path in sorted(package.rglob('*')):
        if not path.is_file() or any(part in SKIP_NAMES for part in path.relative_to(package).parts):
            continue
        relative = path.relative_to(package).as_posix()
        suffix = path.suffix.lower()
        if suffix in ARCHIVE_SUFFIXES:
            report['archives'].append(relative)
            continue
        if suffix not in MEDIA_SUFFIXES:
            report['documents'].append(relative)
            continue
        entry = {'name': relative, 'bytes': path.stat().st_size, 'status': 'unique', 'match': None, 'distance': None}
        digest = sha256(path)
        if digest in by_hash:
            entry.update(status='covered', match=by_hash[digest][0], distance=0)
        elif suffix in IMAGE_SUFFIXES:
            try:
                current = signature(path)
            except (OSError, ValueError, ImportError):
                current = None
            if current is not None:
                scored = ((similar(current, candidate), name) for candidate, name in image_hashes)
                best = min((item for item in scored if item[0] is not None), default=None)
                if best and best[0] <= DHASH_LIMIT:
                    entry.update(status='covered', match=best[1], distance=best[0])
        report['media'].append(entry)
    return report


def write_record(root, plans, now):
    lines = ['# 输入包吸收记录', '', '处理时间：' + now, '']
    for plan in plans:
        report = plan['report']
        covered = [item for item in report['media'] if item['status'] == 'covered']
        unique = [item for item in report['media'] if item['status'] == 'unique']
        lines += ['## ' + plan['package'].name, '',
                  '媒体 ' + str(len(report['media'])) + ' 个：已被现有整理结果覆盖 ' + str(len(covered))
                  + '，独有 ' + str(len(unique)) + '。', '']
        for item in unique:
            lines.append('- 独有媒体保留：`' + item['name'] + '`')
        for item in covered:
            lines.append('- 已覆盖：`' + item['name'] + '` ≈ `' + str(item['match'])
                         + '`（画面距离 ' + str(item['distance']) + '/64）')
        for name in report['documents']:
            lines.append('- 文档保留：`' + name + '`')
        for name in report['archives']:
            lines.append('- 压缩包未展开，需人工处理：`' + name + '`')
        lines.append('')
    path = root / '其他/输入包吸收记录.md'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('\n'.join(lines).rstrip('\n') + '\n', encoding='utf-8')
    return path


def absorb(root, apply_changes=False, keep_package=False):
    root = Path(root).resolve(strict=True)
    found = candidates(root)
    by_hash, image_hashes = organized_index(root)
    result = {'activity': str(root), 'applied': apply_changes, 'candidates': []}
    plans = []
    for entry in found:
        if not entry.is_dir():
            kind = 'archive' if entry.suffix.lower() in ARCHIVE_SUFFIXES else 'file'
            note = '压缩包需解压后重跑' if kind == 'archive' else '根目录散落文件，需归入四个文件夹'
            result['candidates'].append({'path': entry.name, 'kind': kind, 'note': note})
            continue
        report = classify(entry, by_hash, image_hashes)
        covered = sum(1 for item in report['media'] if item['status'] == 'covered')
        unique = sum(1 for item in report['media'] if item['status'] == 'unique')
        result['candidates'].append({'path': entry.name, 'kind': 'package', 'media': len(report['media']),
                                     'covered': covered, 'unique': unique,
                                     'documents': len(report['documents']), 'archives': report['archives']})
        plans.append({'package': entry, 'report': report})
    if not apply_changes:
        result['plans'] = plans
        return result
    destination = root / '其他/输入包吸收'
    for plan in plans:
        package = plan['package']
        target = destination / package.name
        for item in plan['report']['media']:
            if item['status'] != 'unique':
                continue
            output = target / '独有媒体' / item['name']
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(package / item['name']), str(output))
        for name in plan['report']['documents']:
            output = target / '文档' / name
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(package / name), str(output))
        if not keep_package:
            shutil.rmtree(package)
    result['record'] = write_record(root, plans, timestamp()).relative_to(root).as_posix()
    result['rootAfter'] = sorted(path.name for path in root.iterdir() if path.name not in SKIP_NAMES)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('activity')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--keep-package', action='store_true', help='absorb unique files but keep the package directory')
    arguments = parser.parse_args(argv)
    result = absorb(arguments.activity, arguments.apply, arguments.keep_package)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
