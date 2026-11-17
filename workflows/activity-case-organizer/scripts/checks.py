#!/usr/bin/env python3
"""唯一一套「活动记录」检查：publish.py（上线前）、repair.py（修旧活动）、audit.py（全站体检）都调用这里。

检查对象是服务器上的原始记录（source = {uid, record, assets, cases, social}），不读本地归档、不下载媒体，
所以体检只需要读线上 JSON。归档目录层面的检查（命名、主图、相似连拍）仍在 publish.py，它们只对新素材有意义。

每条问题是 Issue(code, uid, target, message)。规则改了就改这里，三处同时生效。
确实不适用的情况不改规则，写豁免（见 load_waivers）：同一 uid + code (+ target) 的问题不再报。
"""
import json, re
from dataclasses import dataclass, asdict
from pathlib import Path

SUMMARY_MAX = 20     # 活动简介：网站卡片上给人看的一句话
CASE_INTRO_MAX = 15  # 案例简介：案例卡片上的一句话；细节写「## 详细说明」给 Agent 读
TEMPLATE_SUMMARY = re.compile(r'活动资料与成员作品归档')
PLACEHOLDER = {'', '待补充', '待确认'}
IMAGE_EXT = re.compile(r'\.(jpe?g|png|webp|gif|bmp)$', re.I)
VIDEO_EXT = re.compile(r'\.(mp4|mov|m4v|avi|mkv|webm)$', re.I)

# code -> 一句话说明（体检报告表头、文档都用它）
RULES = {
    'summary-missing': '活动简介为空',
    'summary-template': '活动简介是自动生成的模板句',
    'summary-too-long': f'活动简介超过 {SUMMARY_MAX} 字',
    'case-intro-missing': '案例没有「案例简介」',
    'case-intro-too-long': f'案例简介超过 {CASE_INTRO_MAX} 字',
    'work-video-in-activity': '作品视频放在了活动视频区',
    'video-no-poster': '活动视频没有封面',
    'case-video-no-poster': '案例视频没有封面',
    'video-raw-title': '活动视频标题带文件名前缀（如「活动视频_」）',
    'asset-no-url': '素材在图床上没有地址',
}


@dataclass(frozen=True)
class Issue:
    code: str
    uid: str
    target: str
    message: str

    def as_dict(self):
        return {**asdict(self), 'rule': RULES.get(self.code, '')}


# 文件名式的视频名：「08660_活动视频_xx」「现场视频_xx」「活动_视频_IMG_9841.JPG」
RAW_VIDEO_NAME = re.compile(r'^(\d{5}_)?([^_]{0,4}_)?[^_]{0,4}视频_')
MEANINGLESS = re.compile(r'^(IMG|VID|MVIMG|DSC|PXL)?[_-]?[0-9a-f_\-]{4,}(\.(jpe?g|png|heic))?$', re.I)


def web_path(path):
    """与网站 websiteAssetPath 相同：图片按 .jpg、视频按 .mp4 查图床索引。"""
    path = IMAGE_EXT.sub('.jpg', str(path or ''))
    return VIDEO_EXT.sub('.mp4', path)


def readme_section(readme, name):
    m = re.search(rf'^#{{1,6}}\s*{name}\s*\n(.*?)(?=^#{{1,6}}\s|\Z)', readme or '', re.M | re.S)
    return m.group(1).strip() if m else None


def check_source(source):
    """返回这一场活动的全部问题（列表，可能为空）。"""
    uid = source.get('uid') or ''
    record = source.get('record') or {}
    issues = []
    add = lambda code, target, message: issues.append(Issue(code, uid, target, message))
    urls = {}
    for a in source.get('assets') or []:
        urls[web_path(a.get('path'))] = a.get('url') or ''
        if not a.get('url'):
            add('asset-no-url', a.get('path', ''), f'{a.get("path")} 没有图床地址，网站不会显示它')
    has = lambda p: bool(p) and bool(urls.get(web_path(p)))

    summary = str(record.get('summary') or '').strip()
    if not summary:
        add('summary-missing', 'summary', '活动简介为空')
    elif TEMPLATE_SUMMARY.search(summary):
        add('summary-template', 'summary', f'「{summary}」是模板句，要一句这场做了什么')
    elif len(summary) > SUMMARY_MAX:
        add('summary-too-long', 'summary', f'{len(summary)} 字：「{summary}」')

    posters = record.get('videoPosters') or {}
    titles = record.get('videoTitles') or {}
    for v in record.get('videos') or []:
        path, name = v.get('path', ''), v.get('name') or Path(v.get('path', '')).name
        if not has(path):
            continue  # 图床没有的视频网站本来就不显示，由 asset-no-url 报
        if '作品视频' in name:
            add('work-video-in-activity', path, f'{name} 是作品视频，应挂到它的案例下')
        if not has(posters.get(path)):
            add('video-no-poster', path, f'{name} 没有封面')
        shown = titles.get(path) or re.sub(r'^\d{5}_', '', Path(name).stem)
        if RAW_VIDEO_NAME.match(shown) or MEANINGLESS.match(shown):
            add('video-raw-title', path, f'{name} 会显示成「{shown}」')

    for c in source.get('cases') or []:
        title = c.get('title') or c.get('folder') or ''
        readme = c.get('readme')
        if readme is not None:  # 旧格式案例没有 readme，文字在别处，不按这条查
            intro = readme_section(readme, '案例简介')
            if intro is None or intro in PLACEHOLDER:
                add('case-intro-missing', title, f'案例「{title}」没有案例简介')
            elif len(intro) > CASE_INTRO_MAX:
                add('case-intro-too-long', title, f'{len(intro)} 字：「{intro}」')
        for v in c.get('videos') or []:
            if has(v.get('path')) and not has(v.get('posterPath')):
                add('case-video-no-poster', v.get('path', ''), f'案例「{title}」的视频 {Path(v.get("path", "")).name} 没有封面')
    return issues


def load_waivers(path):
    """豁免文件：[{"uid", "code", "target"(可省=整场这类问题都豁免), "reason"}]。没写理由的豁免无效。"""
    if not path or not Path(path).is_file():
        return []
    waivers = json.loads(Path(path).read_text(encoding='utf-8'))
    bad = [w for w in waivers if not str(w.get('reason') or '').strip()]
    if bad:
        raise ValueError(f'豁免必须写理由：{bad[:3]}')
    return waivers


def waived(issue, waivers):
    return any(w.get('uid') == issue.uid and w.get('code') == issue.code and w.get('target') in (None, '', issue.target)
               for w in waivers)


def open_issues(source, waivers=()):
    return [i for i in check_source(source) if not waived(i, waivers)]


def format_issues(issues, limit=30):
    lines = [f'- [{i.code}] {i.target}：{i.message}' for i in issues[:limit]]
    if len(issues) > limit:
        lines.append(f'- …… 另有 {len(issues) - limit} 条')
    return '\n'.join(lines)
