#!/usr/bin/env python3
"""给活动里的每个视频生成封面图（poster）。

一个视频 = 两个文件：视频本体 + 一张封面 JPG。封面放在固定位置，网站按记录里的引用显示：
  活动视频 01_活动照片/xxx.mp4   -> 01_活动照片/视频封面/xxx.poster.jpg，写进 manifest.videoPosters
  案例视频 02_案例/<案例>/视频/xxx.mp4 -> 同目录 xxx.poster.jpg（网站按同名约定读取）
两处都不会进相册（视频封面/ 目录和 .poster. 文件名被相册排除）。

用法：
  video_posters.py frames <活动目录>              每个缺封面的视频抽候选帧、自动挑一张、出总览图
  video_posters.py frames <活动目录> --redo       已有封面的也重挑
  video_posters.py pick <活动目录> <视频相对路径> <候选编号>   看总览图后换成指定候选帧
之后照常跑 archive.py mirror，封面会和照片一起进展示副本并上传。
"""
import re, argparse, datetime, hashlib, json, shutil, subprocess, sys, tempfile
from pathlib import Path

VIDEO = {'.mp4', '.mov', '.m4v', '.webm', '.mkv'}
POINTS = (0.08, 0.22, 0.36, 0.50, 0.64, 0.78)   # 避开片头黑场和片尾字幕
POSTER_MAX = 1280


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def write(p, value):
    p = Path(p); tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'); tmp.replace(p)


def sha256(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def poster_rel(video_rel):
    """视频相对路径 -> 封面相对路径（固定约定，网站和发布检查都按这个找）。"""
    v = Path(video_rel)
    if v.parts[0] == '01_活动照片':
        return (Path('01_活动照片') / '视频封面' / (v.stem + '.poster.jpg')).as_posix()
    if v.parts[0] == '02_案例' and len(v.parts) > 3 and v.parts[2] == '视频':
        return v.with_name(v.stem + '.poster.jpg').as_posix()
    return None


def activity_videos(root):
    root = Path(root)
    found = []
    for base in [root / '01_活动照片', *sorted((root / '02_案例').glob('*/视频'))]:
        if not base.is_dir():
            continue
        for p in sorted(base.rglob('*')):
            if p.is_file() and p.suffix.lower() in VIDEO and not p.name.startswith('._'):
                rel = p.relative_to(root).as_posix()
                if poster_rel(rel):
                    found.append(rel)
    return found


UA = ['-user_agent', 'curl/8', '-rw_timeout', '30000000']  # 图床对默认 UA 返回 403；网络读 30 秒没数据就放弃
NET_TIMEOUT = 90   # 单次取帧最长秒数；图床偶尔卡住，超时重试一次


def is_url(src):
    return str(src).startswith(('http://', 'https://'))


def duration(path):
    for _ in range(2):
        try:
            out = subprocess.run(['ffprobe', '-v', 'error', *(UA if is_url(path) else []), '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                                 capture_output=True, text=True, timeout=NET_TIMEOUT).stdout.strip()
            return float(out)
        except (ValueError, subprocess.TimeoutExpired):
            continue
    return None


def grab(path, seconds, dest):
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-y', *(UA if is_url(path) else []), '-ss', f'{seconds:.2f}', '-i', str(path), '-frames:v', '1',
           '-vf', f"scale='min({POSTER_MAX},iw)':-2", '-pix_fmt', 'yuvj420p', '-q:v', '3', str(dest)]
    for _ in range(2):
        try:
            subprocess.run(cmd, check=True, timeout=NET_TIMEOUT, capture_output=True)
            if Path(dest).is_file():
                return True
        except subprocess.TimeoutExpired:
            continue
    return Path(dest).is_file()


def frame_score(path):
    """越清晰、亮度适中、画面有内容的帧分越高；黑场、过曝、纯色、糊帧分低。"""
    from PIL import Image, ImageFilter, ImageStat
    with Image.open(path) as im:
        g = im.convert('L'); g.thumbnail((320, 320))
        mean = ImageStat.Stat(g).mean[0]; spread = ImageStat.Stat(g).stddev[0]
        edges = ImageStat.Stat(g.filter(ImageFilter.FIND_EDGES)).var[0]
    if spread < 12:
        return 0.0
    light = 1.0 if 45 <= mean <= 210 else 0.3
    return round(edges * light * min(spread, 60) / 60, 2)


def sheet_dir(root):
    """候选帧是临时判断材料，放在活动目录外（同 .case-history），不进 manifest、不上传。"""
    root = Path(root).resolve()
    return root.parent / '.视频封面候选' / root.name


def candidates_dir(root, video_rel):
    return sheet_dir(root) / Path(video_rel).with_suffix('').as_posix().replace('/', '__')


def contact_sheet(root, rows, dest):
    """一张总览图：每个视频一行，候选帧带编号，自动选中的标绿框。看这一张就能抽查。"""
    from PIL import Image, ImageDraw, ImageFont
    cell, label = 220, 26
    try:
        font = ImageFont.truetype('/System/Library/Fonts/PingFang.ttc', 18)
    except OSError:
        font = ImageFont.load_default()
    sheet = Image.new('RGB', (cell * len(POINTS), (cell + label) * len(rows)), 'white')
    draw = ImageDraw.Draw(sheet)
    for r, (video_rel, frames, chosen) in enumerate(rows):
        y = r * (cell + label)
        draw.text((4, y + 3), f'{r}. {Path(video_rel).name}', fill='black', font=font)
        for i, f in enumerate(frames):
            with Image.open(f) as im:
                im.thumbnail((cell - 8, cell - 8)); x = i * cell
                sheet.paste(im, (x + 4, y + label))
                if i == chosen:
                    draw.rectangle([x + 2, y + label - 2, x + 6 + im.width, y + label + 2 + im.height], outline='lime', width=5)
                draw.rectangle([x + 4, y + label, x + 30, y + label + 24], fill='yellow')
                draw.text((x + 9, y + label + 1), str(i), fill='red', font=font)
    sheet.save(dest, quality=72)
    return dest


def register(root, video_rel, poster, evidence):
    """把封面登记成已审核素材：archive.py mirror 只处理已审核的文件。"""
    root = Path(root)
    rel = poster_rel(video_rel)
    record_path = root / '其他' / '整理记录.json'
    plan = read(record_path) if record_path.exists() else {'version': 1, 'entries': []}
    plan['entries'] = [e for e in plan.get('entries', []) if e.get('targetPath') != rel]
    plan['entries'].append({'targetPath': rel, 'sourcePath': f'(由 {video_rel} 取帧)', 'sha256': sha256(poster),
                            'bytes': poster.stat().st_size, 'originalName': poster.name, 'selected': True, 'role': 'video-poster',
                            'review': {'reviewed': True, 'evidence': evidence}})
    write(record_path, plan)
    if rel.startswith('01_活动照片/'):
        manifest = read(root / 'manifest.json')
        manifest.setdefault('videoPosters', {})[video_rel] = rel
        # 文件名按契约是「分数_活动视频_描述」，网站标题只要描述；人工写过的标题不覆盖
        titles = manifest.setdefault('videoTitles', {})
        if not titles.get(video_rel):
            titles[video_rel] = re.sub(r'^([^_]{0,4}_)?[^_]{0,4}视频_', '', re.sub(r'^\d{5}_', '', Path(video_rel).stem)).replace('_', ' ') or Path(video_rel).stem
        write(root / 'manifest.json', manifest)


def install(root, video_rel, frame, evidence):
    dest = Path(root) / poster_rel(video_rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(frame, dest)
    register(root, video_rel, dest, evidence)
    return dest


def candidates(src, out):
    """在 POINTS 处取帧到 out/，返回 (帧列表, 自动选中编号)；src 可以是本地文件或图床地址（直接按时间点读，不下载整段）。
    读不出时长或一帧都取不到时返回 (None, 原因)。"""
    total = duration(src)
    if not total:
        return None, '读不出时长（文件可能损坏或网络不通）'
    if Path(out).exists():
        shutil.rmtree(out)
    Path(out).mkdir(parents=True)
    shots, scores = [], []
    for i, point in enumerate(POINTS):
        f = Path(out) / f'{i}_{total * point:.1f}s.jpg'
        try:
            ok = grab(src, total * point, f)
        except subprocess.CalledProcessError:
            ok = False
        if ok:
            shots.append(f); scores.append(frame_score(f))
    if not shots:
        return None, '取帧失败'
    return shots, max(range(len(shots)), key=lambda i: scores[i])


def frames(activity, redo=False):
    root = Path(activity).resolve()
    rows, problems = [], []
    for video_rel in activity_videos(root):
        if not redo and (root / poster_rel(video_rel)).is_file():
            continue
        shots, best = candidates(root / video_rel, candidates_dir(root, video_rel))
        if shots is None:
            problems.append(f'{video_rel}：{best}，没生成封面'); continue
        install(root, video_rel, shots[best], f'自动选帧 #{best}（{shots[best].stem.split("_", 1)[1]}，清晰度 {frame_score(shots[best])}），待人工抽查')
        rows.append((video_rel, shots, best))
    sheet = None
    if rows:
        sheet = contact_sheet(root, rows, sheet_dir(root) / '总览.jpg')
    print(json.dumps({'posters': len(rows), 'sheet': str(sheet) if sheet else None,
                      'rows': [f'{i}. {v} -> #{b}' for i, (v, _, b) in enumerate(rows)], 'problems': problems}, ensure_ascii=False, indent=1))
    return rows, problems


def pick(activity, video_rel, index):
    root = Path(activity).resolve()
    if not poster_rel(video_rel):
        raise SystemExit(f'错误: {video_rel} 不在 01_活动照片/ 或 02_案例/<案例>/视频/ 下')
    matches = sorted(candidates_dir(root, video_rel).glob(f'{int(index)}_*.jpg'))
    if not matches:
        raise SystemExit(f'错误: 没有候选帧 #{index}，先跑 frames')
    dest = install(root, video_rel, matches[0], f'人工选帧 #{index}（{matches[0].stem.split("_", 1)[1]}）')
    print(f'已换封面：{dest.relative_to(root)}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    f = sub.add_parser('frames'); f.add_argument('activity'); f.add_argument('--redo', action='store_true')
    k = sub.add_parser('pick'); k.add_argument('activity'); k.add_argument('video'); k.add_argument('index', type=int)
    a = p.parse_args()
    if a.cmd == 'frames':
        frames(a.activity, a.redo)
    else:
        pick(a.activity, a.video, a.index)


if __name__ == '__main__':
    main()
