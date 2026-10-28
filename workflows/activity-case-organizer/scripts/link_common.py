"""Shared helpers for the link and intake scripts (copied verbatim from the old validate_activity.py)."""

import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit


IMAGES = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.avif'}
VIDEOS = {'.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mts', '.m2ts'}
EXCLUDED = {'.DS_Store', '__MACOSX', '.git', '__pycache__'}
JSON_NAMES = {'manifest.json', '媒体映射.json'}
TYPES = {'activity': ('活动照片', '活动视频'), 'case': ('案例', '案例视频'), 'social': ('社交媒体照片', '社交媒体视频')}
NAME_PATTERN = re.compile(r'^(\d{5})_(?:(封面|首页|主图)_)?(活动照片|活动视频|案例视频|案例|社交媒体照片|社交媒体视频)_(.+)$')
SHA_PATTERN = re.compile(r'^[0-9a-f]{64}$')
URL_PATTERN = re.compile(r'https?://[^\s<>"\u0027\u3000，。；、！？）】》」』]+', re.IGNORECASE)
ROOT_DIRS = {'01_活动照片', '02_案例', '03_社交媒体', '其他'}
COLLECTION_FILES = {'案例材料说明.md', '案例链接.md', '精选案例识别与标记.md', '照片精选与标记.md'}
FORBIDDEN_CASE_ROOT = {'链接对应表.md': 'remove generated alias file from the activity'}
COLLECTION_DIRS = {'案例集合材料', '案例素材', '原案例素材'}
PLACEHOLDER_URLS = {'站内案例详情页', '待确认', '无', '暂无', ''}



def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def checked_path(root, value):
    if not isinstance(value, str) or not value or '\\' in value:
        raise ValueError('path must be a nonempty POSIX relative path')
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {'', '.', '..'} for part in value.split('/')) or ':' in relative.parts[0]:
        raise ValueError('unsafe relative path')
    target = root.joinpath(*relative.parts)
    if any(root.joinpath(*relative.parts[:index]).is_symlink() for index in range(1, len(relative.parts) + 1)):
        raise ValueError('symlink path is not accepted')
    target.resolve().relative_to(root.resolve())
    return target


def business_files(root):
    files = {}
    links = []
    def unreadable(exception):
        raise exception
    for directory, folders, names in os.walk(root, followlinks=False, onerror=unreadable):
        parent = Path(directory)
        for name in sorted(folders + names):
            path = parent / name
            relative = path.relative_to(root).as_posix()
            if name in EXCLUDED or name.startswith('._'):
                continue
            if path.is_symlink():
                links.append(relative)
            elif path.is_file() and relative not in JSON_NAMES:
                files[relative] = path
        folders[:] = sorted(name for name in folders if name not in EXCLUDED and not name.startswith('._') and not (parent / name).is_symlink())
    return files, links


def valid_url(value):
    if not isinstance(value, str) or not URL_PATTERN.fullmatch(value):
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme.lower() in {'http', 'https'} and bool(parsed.hostname) and parsed.port != 0
    except ValueError:
        return False


def urls_in(path):
    return urls_in_text(read_text(path))


def read_text(path):
    try:
        data = path.read_bytes()
    except OSError:
        return ''
    content = None
    encodings = ('utf-16',) if data.startswith((b'\xff\xfe', b'\xfe\xff')) else ('utf-8-sig', 'gb18030')
    for encoding in encodings:
        try:
            content = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    return content or ''


def urls_in_text(content):
    urls = []
    for match in URL_PATTERN.finditer(content):
        url = match.group()
        wrapped = match.start() > 0 and content[match.start() - 1] in '([{'
        while url and url[-1] in ')]}' and (wrapped or ('?' not in url and '#' not in url)) and url.count(url[-1]) > url.count({')': '(', ']': '[', '}': '{'}[url[-1]]):
            url = url[:-1]
        if '?' not in url and '#' not in url:
            url = url.rstrip('.,;')
        if valid_url(url) and url not in urls:
            urls.append(url)
    return urls

