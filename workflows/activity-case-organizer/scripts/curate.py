#!/usr/bin/env python3
"""精选工具。都读同一份整理计划（archive.py scan 生成；apply 之后也可以读 活动目录/其他/整理记录.json）。

  sheets   <计划> <输出目录> [--per-sheet 12]  编号拼图，按拍摄顺序，连拍组加彩框
  name     <计划>                              按 decision、chapter 自动生成 targetPath
  coverage <计划> [输出.md]                    覆盖表：章节 × 主体，附精选检查结果
  html     <计划> <输出.html>                  全量审阅页：全部照片、编号、章节、决定、描述，本地直接打开

每张照片的 review.evidence 是唯一的描述来源：看拼图时写下，审阅页显示它，入选照片的文件名（即网站上的照片名称）直接用它。
规则见 references/selection.md。
"""
import argparse, html, json, os, re, sys
from pathlib import Path
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive import read, write, activity_photos, selection_problems, format_problems  # noqa: E402

PER_SHEET = 12             # 每页 12 张（4×3）
SHEET_SIZE = (1536, 1152)  # 各家模型看图前会先缩小：Claude 长边约 1568px，GPT 短边约 768px；这样最差每格仍约 256px
COLS = 4
LABEL_H = 44
PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#f032e6', '#9a6324']
FOLDERS = {'burst-alt': '相似连拍', 'reject-technical': '技术淘汰', 'archive': '其余照片'}
LABELS = {'selected': '入选', 'burst-alt': '连拍备选', 'reject-technical': '技术淘汰', 'archive': '仅归档', None: '未判断'}
UNSAFE = re.compile(r'[_\s\u3000/\\:*?"<>|]+')  # 文件名分隔符和非法字符；网站按 _ 拆段


def clean(text):
    return UNSAFE.sub('-', str(text or '')).strip('-.')


def evidence(e):
    return str((e.get('review') or {}).get('evidence') or '').strip()


def font(size):
    from PIL import ImageFont
    for path in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc',
                 'C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def numbered(plan_path):
    plan = read(plan_path)
    photos = activity_photos(plan)
    for i, e in enumerate(photos, 1):
        e['seq'] = i
    return plan, photos


def locate(plan_path, plan, e):
    """apply 之后优先用活动目录里的文件，否则用输入原件。"""
    plan_path = Path(plan_path).resolve()
    if plan_path.name == '整理记录.json' and e.get('targetPath'):
        placed = plan_path.parent.parent.joinpath(*Path(e['targetPath']).parts)
        if placed.is_file():
            return placed
    return Path(plan['sourceRoot'], e['sourcePath'])


def sheets(plan_path, outdir, per_sheet=PER_SHEET):
    from PIL import Image, ImageOps, ImageDraw
    plan, photos = numbered(plan_path)
    write(plan_path, plan)
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    group = {m: i + 1 for i, g in enumerate(plan.get('similarGroups', [])) for m in g['members']}
    rows = -(-per_sheet // COLS); W, H = SHEET_SIZE; cw, ch = W // COLS, H // rows; f = font(30)
    pages = []
    for start in range(0, len(photos), per_sheet):
        page = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(page)
        for k, e in enumerate(photos[start:start + per_sheet]):
            x, y = (k % COLS) * cw, (k // COLS) * ch
            try:
                with Image.open(locate(plan_path, plan, e)) as im:
                    im = ImageOps.exif_transpose(im).convert('RGB'); im.thumbnail((cw - 8, ch - LABEL_H - 8))
                    page.paste(im, (x + (cw - im.width) // 2, y + 4))
            except Exception:
                d.text((x + 12, y + 12), 'CANNOT OPEN', fill='red', font=f)
            g = group.get(e['sourcePath']); color = PALETTE[(g - 1) % len(PALETTE)] if g else 'black'
            if g:
                d.rectangle((x + 1, y + 1, x + cw - 2, y + ch - 2), outline=color, width=6)
            d.text((x + 10, y + ch - LABEL_H + 6), f"#{e['seq']}" + (f"   G{g}" if g else ''), fill=color, font=f)
        name = out / f'拼图-{start // per_sheet + 1:03d}.jpg'; page.save(name, quality=88); pages.append(name.name)
    (out / '编号.tsv').write_text(''.join(f"{e['seq']}\t{e['sourcePath']}\tG{group.get(e['sourcePath'], '')}\n" for e in photos))
    print(json.dumps({'photos': len(photos), 'sheets': len(pages), 'perSheet': per_sheet, 'orderSource': plan.get('orderSource'), 'dir': str(out)}, ensure_ascii=False))


def name(plan_path):
    plan, photos = numbered(plan_path)
    chapters = plan.get('chapters') or []
    selected = [e for e in photos if e.get('decision') == 'selected']
    if sum(bool(e.get('cover')) for e in selected) > 1:
        raise SystemExit('错误: 只能有一张照片写 cover: true')
    missing = [e['sourcePath'] for e in photos if e.get('decision') and not clean(evidence(e))]
    if missing:
        raise SystemExit('错误: 这些照片还没写描述 review.evidence：\n- ' + '\n- '.join(missing[:20]))
    index = {c: i for i, c in enumerate(chapters)}
    span = 9800 // max(1, len(chapters) + 1)  # 封面 10000；之后每个章节一段分数，按时间顺序递减
    used, counts = set(), {}
    def unique(rel, e):
        if rel in used:
            stem, ext = os.path.splitext(rel); rel = f"{stem}-{e['seq']}{ext}"
        used.add(rel); return rel
    for e in sorted(selected, key=lambda e: (index.get(e.get('chapter'), len(chapters)), e.get('order', 0), e['sourcePath'])):
        c = index.get(e.get('chapter'), len(chapters))
        if e.get('cover'):
            score = 10000
        else:
            score = max(1, 9900 - c * span - counts.get(c, 0)); counts[c] = counts.get(c, 0) + 1
        marks = ('封面_' if e.get('cover') else '') + ('首页_' if e.get('homepage') else '')
        e['targetPath'] = unique(f"01_活动照片/{score:05d}_{marks}活动_{clean(evidence(e))}{Path(e['sourcePath']).suffix.lower()}", e)
        e['selected'] = True
    for e in photos:
        folder = FOLDERS.get(e.get('decision'))
        if folder:
            e['targetPath'] = unique(f"其他/{folder}/{e['seq']:04d}_{clean(evidence(e))}{Path(e['sourcePath']).suffix.lower()}", e)
            e['selected'] = False
    write(plan_path, plan)
    print(json.dumps({'selected': len(selected), 'named': sum(1 for e in photos if e.get('decision'))}, ensure_ascii=False))


def coverage(plan_path, out=None):
    plan, photos = numbered(plan_path)
    chapters = list(plan.get('chapters') or [])
    extra = sorted({e.get('chapter') for e in photos if e.get('chapter') and e.get('chapter') not in chapters})
    if any(not e.get('chapter') for e in photos):
        extra.append(None)
    notes, subject_notes = plan.get('chapterNotes') or {}, plan.get('subjectNotes') or {}
    picked = [e for e in photos if e.get('decision') == 'selected']
    share = f"{len(picked) / len(photos):.0%}" if photos else '0%'
    lines = [f"# 覆盖表：{plan.get('eventType') or '未写活动类型'}", '',
             f"全部 {len(photos)} 张，入选 {len(picked)} 张（{share}）；拍摄顺序依据：{plan.get('orderSource') or '未知'}。", '',
             '| 章节 | 全部 | 入选编号 | 主体（✓ 有入选 / ✗ 无） | 说明 |', '|---|---:|---|---|---|']
    for c in chapters + extra:
        es = [e for e in photos if e.get('chapter') == c]
        sel = [f"#{e['seq']}" for e in es if e.get('decision') == 'selected']
        subjects = {}
        for e in es:
            if e.get('subject'):
                subjects[e['subject']] = subjects.get(e['subject'], False) or e.get('decision') == 'selected'
        cells = '、'.join(f"{s}{'✓' if ok else '✗'}" for s, ok in subjects.items())
        why = notes.get(c, '') + ''.join(f"；{s}：{subject_notes[s]}" for s in subjects if s in subject_notes)
        lines.append(f"| {c or '未标章节'} | {len(es)} | {' '.join(sel) or '—'} | {cells or '—'} | {why.strip('；')} |")
    errors, warnings = selection_problems(plan)
    lines += ['', '## 检查', '']
    lines += [f'- 拦截：{x}' for x in errors[:40]] + [f'- 提醒：{x}' for x in warnings] or ['- 通过']
    target = Path(out) if out else Path(plan_path).with_name('覆盖表.md')
    target.write_text('\n'.join(lines) + '\n')
    print(json.dumps({'file': str(target), 'errors': len(errors), 'warnings': len(warnings)}, ensure_ascii=False))


PAGE = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,"PingFang SC",system-ui,sans-serif;background:#f5f4f0;color:#222}
header{position:sticky;top:0;z-index:2;background:#fff;padding:12px 3vw;border-bottom:1px solid #ddd}h1{font-size:20px;margin:0 0 6px}
header select,header input{font:inherit;padding:5px 8px;margin-right:8px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;padding:14px 3vw}
.card{background:#fff;border:3px solid transparent;cursor:pointer}.card.selected{border-color:#2e9d4b}.card img{width:100%;aspect-ratio:3/2;object-fit:contain;background:#e8e6e0;display:block}
.meta{padding:6px 8px;font-size:13px}.meta b{font-size:15px}.tag{display:inline-block;padding:0 6px;border-radius:3px;background:#eee;margin-right:4px}.selected .tag.d{background:#2e9d4b;color:#fff}
dialog{width:min(1200px,96vw);border:0;padding:10px}dialog img{width:100%;max-height:76vh;object-fit:contain;background:#111}dialog::backdrop{background:#000c}
</style><header><h1>__TITLE__</h1><span id="count"></span><br><select id="fd"><option value="">全部决定</option></select><select id="fc"><option value="">全部章节</option></select><input id="q" placeholder="搜描述、主体、编号"></header>
<main id="grid"></main><dialog id="dlg"><img id="big"><div id="info" class="meta"></div><button id="prev">← 上一张</button> <button id="next">下一张 →</button> <button id="close">关闭</button></dialog>
<script>const D=__DATA__;let list=[],ix=0;const $=id=>document.getElementById(id);
const label=e=>`<b>#${e.seq}</b> <span class="tag d">${e.decision}</span><span class="tag">${e.chapter||'未标章节'}</span>${e.group?`<span class="tag">连拍G${e.group}</span>`:''}<br>${e.evidence||'<i>未写描述</i>'}${e.subject?`<br>主体：${e.subject}`:''}${e.rep?`<br>代表照：#${e.rep}`:''}${e.by?`<br>决定：${e.by}`:''}`;
for(const k of [...new Set(D.map(e=>e.decision))])fd.add(new Option(k,k));for(const k of [...new Set(D.map(e=>e.chapter||'未标章节'))])fc.add(new Option(k,k));
function draw(){const q=$('q').value.trim();list=D.filter(e=>(!fd.value||e.decision===fd.value)&&(!fc.value||(e.chapter||'未标章节')===fc.value)&&(!q||('#'+e.seq+' '+e.evidence+' '+e.subject).includes(q)));
$('count').textContent=`共 ${D.length} 张，入选 ${D.filter(e=>e.decision==='入选').length} 张，当前显示 ${list.length} 张。点击放大，方向键翻页。`;
grid.replaceChildren(...list.map((e,i)=>{const c=document.createElement('div');c.className='card'+(e.decision==='入选'?' selected':'');c.innerHTML=`<img loading="lazy" src="${e.src}"><div class="meta">${label(e)}</div>`;c.onclick=()=>show(i);return c}))}
function show(i){ix=(i+list.length)%list.length;const e=list[ix];big.src=e.src;info.innerHTML=label(e);if(!dlg.open)dlg.showModal()}
fd.onchange=fc.onchange=q.oninput=draw;prev.onclick=()=>show(ix-1);next.onclick=()=>show(ix+1);close.onclick=()=>dlg.close();
document.onkeydown=e=>{if(dlg.open&&e.key==='ArrowRight')show(ix+1);if(dlg.open&&e.key==='ArrowLeft')show(ix-1)};draw()</script></html>"""


def page(plan_path, out):
    plan, photos = numbered(plan_path)
    out = Path(out).resolve(); out.parent.mkdir(parents=True, exist_ok=True)
    group = {m: i + 1 for i, g in enumerate(plan.get('similarGroups', [])) for m in g['members']}
    seq = {e['sourcePath']: e['seq'] for e in photos}
    data = [{'seq': e['seq'], 'src': quote(os.path.relpath(locate(plan_path, plan, e).resolve(), out.parent).replace(os.sep, '/')),
             'decision': LABELS.get(e.get('decision'), str(e.get('decision'))), 'chapter': e.get('chapter') or '', 'subject': e.get('subject') or '',
             'evidence': evidence(e), 'group': group.get(e['sourcePath']), 'rep': seq.get(e.get('representative')),
             'by': {'user': '使用者', 'ai': 'AI'}.get(e.get('decidedBy'), '')} for e in photos]
    title = f"全量审阅 · {plan.get('eventType') or ''} · {len(photos)} 张".replace(' ·  ·', ' ·')
    body = PAGE.replace('__TITLE__', html.escape(title)).replace('__DATA__', json.dumps(data, ensure_ascii=False).replace('</', '<\\/'))
    out.write_text(body)
    print(json.dumps({'file': str(out), 'photos': len(data)}, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('sheets'); q.add_argument('plan'); q.add_argument('outdir'); q.add_argument('--per-sheet', type=int, default=PER_SHEET)
    q = sub.add_parser('name'); q.add_argument('plan')
    q = sub.add_parser('coverage'); q.add_argument('plan'); q.add_argument('out', nargs='?')
    q = sub.add_parser('html'); q.add_argument('plan'); q.add_argument('out')
    a = p.parse_args()
    if a.cmd == 'sheets': sheets(a.plan, a.outdir, a.per_sheet)
    elif a.cmd == 'name': name(a.plan)
    elif a.cmd == 'coverage': coverage(a.plan, a.out)
    else: page(a.plan, a.out)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, FileNotFoundError, KeyError) as exc:
        raise SystemExit('错误: ' + str(exc))
