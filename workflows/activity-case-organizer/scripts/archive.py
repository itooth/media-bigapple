#!/usr/bin/env python3
"""Durable intake plan, copy-only organization and incremental media mirror."""
import argparse, copy, datetime, hashlib, json, os, re, shutil, subprocess, tempfile, uuid
from pathlib import Path, PurePosixPath
IMAGE={'.jpg','.jpeg','.png','.webp','.heic','.tif','.tiff','.gif'}
VIDEO={'.mp4','.mov','.m4v','.webm','.mkv'}
IGNORED={'.DS_Store','__MACOSX','.git','__pycache__'}
ROOTS={'01_活动照片','02_案例','03_社交媒体','其他'}
VERSION='web-v1-pillow-2048-q86-ffmpeg-h264-crf24'
def read(p): return json.loads(Path(p).read_text())
def digest(p):
    with Path(p).open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
def write(p, value):
    p=Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    tmp=p.with_suffix(p.suffix+'.tmp'); tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n'); tmp.replace(p)
def inside(root, rel):
    p=PurePosixPath(rel)
    if not rel or p.is_absolute() or '..' in p.parts or '\\' in rel: raise ValueError('非法相对路径: '+rel)
    target=Path(root).joinpath(*p.parts)
    if target.is_symlink() or not target.resolve().is_relative_to(Path(root).resolve()): raise ValueError('路径越界: '+rel)
    return target
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def files(root):
    for base,dirs,names in os.walk(root,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in IGNORED and not Path(base,d).is_symlink())
        for name in sorted(names):
            p=Path(base,name)
            if name not in IGNORED and not name.startswith('._') and not p.is_symlink(): yield p

def known_judgments(archives):
    """Reviewed decisions already stored in earlier archives, keyed by content hash."""
    known={}
    for a in archives or []:
        root=Path(a).resolve(); records=[]
        if (root/'媒体映射.json').exists():
            records+=[{'sha256':m['originalSha256'],'path':m['originalPath'],'review':m.get('review'),'role':m.get('role'),'selected':m.get('selected',True)} for m in read(root/'媒体映射.json')['media']]
        mapped={r['sha256'] for r in records}
        if (root/'其他/整理记录.json').exists():
            # The media map follows the current file names; the intake record only fills in non-media files.
            records+=[{'sha256':e['sha256'],'path':e.get('targetPath'),'review':e.get('review'),'role':e.get('role'),'selected':e.get('selected',True)} for e in read(root/'其他/整理记录.json')['entries'] if e['sha256'] not in mapped]
        for r in records:
            if not r['path'] or not (r.get('review') or {}).get('reviewed'): continue
            current=root.joinpath(*Path(r['path']).parts)
            if not current.is_file() or digest(current)!=r['sha256']: continue  # renamed away or replaced
            known.setdefault(r['sha256'],{})[(str(root),r['path'])]={**r,'archive':str(root)}
    return {sha:list(v.values()) for sha,v in known.items()}

# Bursts and re-saved copies look the same but differ in bytes, so sha256 cannot catch them.
# dHash distance <= SIMILAR_MAX lists candidates; a person or model still looks and picks.
SIMILAR_MAX=18
# 连拍 = 同一瞬间的重复。只在拍摄顺序相邻的照片里找，且必须和组里每一张都像（全连接），
# 否则舞台背景相同的签到、路演、颁奖会被 A像B、B像C 串成一个几百张的大组（一场 441 张的大赛曾串出 307 张）。
BURST_MAX=8       # 一组最多 8 张；同一瞬间很少连拍更多，超过说明已经是不同瞬间
BURST_WINDOW=12   # 只和拍摄顺序前后 12 张以内的照片比较
TIME_GAP=120      # 有拍摄时间时，相隔超过 120 秒不算同一瞬间
SEQ_GAP=20        # 只有相机文件序号（如 LIY_2661）时，序号相差超过 20 不算同一瞬间
SIDECAR='来源元数据.json'  # 可选：{"相对路径或文件名": {"capturedAt": "ISO 时间", "originalName": "LIY_2661.JPG"}}
TIME_KINDS={'exif','sidecar-time','filename-time'}
FILENAME_TIME=re.compile(r'(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})')
CAMERA_SEQ=re.compile(r'(?<![A-Za-z])([A-Za-z]{2,5})_?(\d{3,6})(?!\d)')
def dhash(p):
    from PIL import Image, ImageOps
    with Image.open(p) as im:
        im=ImageOps.exif_transpose(im); ratio=im.width/max(im.height,1)
        px=im.convert('L').resize((9,8)).tobytes()
    return sum(1<<(r*8+c) for r in range(8) for c in range(8) if px[r*9+c]>px[r*9+c+1]), ratio
def capture_keys(source, paths):
    """拍摄顺序。依据按可靠程度取第一个能覆盖全部照片的：EXIF 时间 > 来源元数据时间 > 文件名时间戳 > 相机文件序号 > 文件名顺序。"""
    sidecar=Path(source,SIDECAR); meta=read(sidecar) if sidecar.is_file() else {}
    info=lambda p: meta.get(p) or meta.get(Path(p).name) or {}
    def exif(p):
        try:
            from PIL import Image
            with Image.open(Path(source,p)) as im:
                ex=im.getexif(); t=ex.get_ifd(0x8769).get(36867) or ex.get(306)
            return datetime.datetime.strptime(str(t).strip(),'%Y:%m:%d %H:%M:%S').timestamp() if t else None
        except Exception: return None
    def sidecar_time(p):
        try: return datetime.datetime.fromisoformat(str(info(p)['capturedAt']).replace('Z','+00:00')).timestamp()
        except (KeyError,ValueError): return None
    def filename_time(p):
        m=FILENAME_TIME.search(Path(p).name)
        try: return datetime.datetime(*map(int,m.groups())).timestamp() if m else None
        except ValueError: return None
    def camera_seq(p):
        m=CAMERA_SEQ.search(Path(info(p).get('originalName') or p).stem)
        return (m.group(1).upper(),int(m.group(2))) if m else None
    for kind,fn in (('exif',exif),('sidecar-time',sidecar_time),('filename-time',filename_time),('camera-sequence',camera_seq)):
        keys={p:fn(p) for p in paths}
        if paths and all(v is not None for v in keys.values()): return kind,keys
    return 'source-order',{p:i for i,p in enumerate(sorted(paths))}
def similar_groups(source, entries, previous=()):
    """返回 (排序依据, {路径: 顺序}, 连拍组)。"""
    seen=set(); paths=[]
    for e in entries:
        if Path(e['sourcePath']).suffix.lower() not in IMAGE or e['sha256'] in seen: continue
        seen.add(e['sha256']); paths.append(e['sourcePath'])
    kind,keys=capture_keys(source,paths)
    ordered=sorted(paths,key=lambda p:(keys[p],p)); rank={p:i for i,p in enumerate(ordered)}
    points={}
    for p in ordered:
        try: points[p]=dhash(Path(source,p))
        except Exception: continue  # unreadable here (e.g. HEIC without plugin); visual review still applies
    def close(a,b):
        if abs(rank[a]-rank[b])>BURST_WINDOW: return False
        if kind in TIME_KINDS and abs(keys[a]-keys[b])>TIME_GAP: return False
        if kind=='camera-sequence' and (keys[a][0]!=keys[b][0] or abs(keys[a][1]-keys[b][1])>SEQ_GAP): return False
        (ha,ra),(hb,rb)=points[a],points[b]
        return abs(ra-rb)<0.05 and bin(ha^hb).count('1')<=SIMILAR_MAX
    groups=[]
    for p in ordered:
        if p not in points: continue
        home=next((g for g in reversed(groups) if rank[p]-rank[g[-1]]<=BURST_WINDOW and len(g)<BURST_MAX and all(close(p,q) for q in g)),None)
        if home: home.append(p)
        else: groups.append([p])
    kept={frozenset(g['members']):g.get('keepAll') for g in previous}
    sha={e['sourcePath']:e['sha256'] for e in entries}
    result=[{'members':sorted(m),'sha256':[sha[x] for x in sorted(m)],**({'keepAll':kept[frozenset(m)]} if kept.get(frozenset(m)) else {})} for m in groups if len(m)>1]
    return kind,rank,result
def unresolved_similar(plan):
    by={e['sourcePath']:e for e in plan['entries']}
    bad=[]
    for g in plan.get('similarGroups',[]):
        shown=[m for m in g['members'] if m in by and (by[m].get('targetPath') or '').startswith('01_活动照片/') and by[m].get('selected',True)]
        if len(shown)>1 and not str(g.get('keepAll') or '').strip(): bad.append(shown)
    return bad

# 精选检查（规则说明见 references/selection.md）。只查结构，不评判文笔；最终由人在全量审阅页把关。
DECISIONS={'selected','burst-alt','reject-technical','archive'}
EVIDENCE_MAX=40          # 描述就是入选照片在网站上的名称，一句话
EVIDENCE_REPEAT_MAX=3    # 同一句描述最多给 3 个不同瞬间；一句话套一整段区间（曾有一句套 103 张）会被拦
COVERAGE_MIN_PHOTOS=30   # 活动照片超过 30 张，必须写章节、逐张写 decision，并逐章逐主体覆盖
RATIO_MIN_PHOTOS=100     # 超过 100 张才看入选比例
RATIO_ALERT=(0.08,0.35)  # 超过 100 张且超出此比例，须写 selectionNote 说明原因
def activity_photos(plan):
    """活动照片：没分到案例和社交媒体的图片，按拍摄顺序。"""
    es=[e for e in plan['entries'] if Path(e['sourcePath']).suffix.lower() in IMAGE and not str(e.get('targetPath') or '').startswith(('02_案例/','03_社交媒体/'))]
    return sorted(es,key=lambda e:(e.get('order',10**9),e['sourcePath']))
def selection_problems(plan, shown_sha=None):
    """返回 (拦截, 提醒)。shown_sha：发布时按媒体映射里真正入选的内容哈希判断，避免人工改名后误报。"""
    if (plan.get('selectionVersion') or 0)<2: return [],[]
    photos=[e for e in activity_photos(plan) if 'inheritedFrom' not in e]
    by={e['sourcePath']:e for e in plan['entries']}
    group={m:i for i,g in enumerate(plan.get('similarGroups',[])) for m in g['members']}
    shown=(lambda e:e['sha256'] in shown_sha) if shown_sha is not None else (lambda e:str(e.get('targetPath') or '').startswith('01_活动照片/') and e.get('selected',True))
    big=len(photos)>COVERAGE_MIN_PHOTOS; errors=[]; warnings=[]; texts={}
    chapters=plan.get('chapters') or []
    for e in photos:
        p=e['sourcePath']; ev=str((e.get('review') or {}).get('evidence') or '').strip(); d=e.get('decision')
        if not ev: errors.append(f'{p} 没写描述 review.evidence'); continue
        if len(ev)>EVIDENCE_MAX: errors.append(f'{p} 的描述超过 {EVIDENCE_MAX} 字：{ev}')
        texts.setdefault(ev,[]).append(p)
        if d is None and big: errors.append(f'{p} 没写 decision')
        elif d is not None and d not in DECISIONS: errors.append(f'{p} 的 decision「{d}」不认识，只能是 {"/".join(sorted(DECISIONS))}')
        if d=='selected' and not shown(e): errors.append(f'{p} 标了 selected 却没进 01_活动照片/，先跑 curate.py name')
        if d in DECISIONS-{'selected'} and shown(e): errors.append(f'{p} 标了 {d} 却在 01_活动照片/')
        if d=='burst-alt':
            r=by.get(e.get('representative') or '')
            if not r: errors.append(f'{p} 是连拍备选，representative 要写留下那张的 sourcePath')
            elif not shown(r): errors.append(f'{p} 的代表照 {r["sourcePath"]} 没有入选')
        if big and chapters and e.get('chapter') not in chapters: errors.append(f'{p} 的 chapter「{e.get("chapter")}」不在 chapters 清单里')
    for ev,ps in texts.items():
        if len({group.get(p,p) for p in ps})>EVIDENCE_REPEAT_MAX:
            errors.append(f'同一句描述「{ev}」用在 {len(ps)} 张照片上：每张写自己看到的内容（同一连拍组内可以相同）')
    if big:
        if not chapters: errors.append(f'活动照片超过 {COVERAGE_MIN_PHOTOS} 张：在计划里写 chapters（按时间顺序的章节清单）')
        notes=plan.get('chapterNotes') or {}; subject_notes=plan.get('subjectNotes') or {}
        for c in chapters:
            if not any(e.get('chapter')==c and shown(e) for e in photos) and not str(notes.get(c) or '').strip():
                errors.append(f'章节「{c}」没有入选照片：选一张，或在 chapterNotes 写原因（如「素材中未见」）')
        subjects={}
        for e in photos:
            if str(e.get('subject') or '').strip(): subjects[e['subject']]=subjects.get(e['subject'],False) or shown(e)
        for s,ok in subjects.items():
            if not ok and not str(subject_notes.get(s) or '').strip(): errors.append(f'主体「{s}」没有任何一张入选：选一张，或在 subjectNotes 写原因')
    n=sum(shown(e) for e in photos)
    if len(photos)>RATIO_MIN_PHOTOS and not RATIO_ALERT[0]<=n/len(photos)<=RATIO_ALERT[1]:
        msg=f'入选 {n}/{len(photos)} 张（{n/len(photos):.0%}），超出常见范围 {RATIO_ALERT[0]:.0%}–{RATIO_ALERT[1]:.0%}'
        if str(plan.get('selectionNote') or '').strip():
            warnings.append(f'{msg}（说明：{plan["selectionNote"]}）')
        else:
            errors.append(f'{msg}：先按章节额度复核精简，确需保留则在计划顶层写 selectionNote 说明原因')
    return errors,warnings
def format_problems(errors, limit=40):
    return '\n- '.join(errors[:limit])+(f'\n- ……另有 {len(errors)-limit} 条' if len(errors)>limit else '')

def scan(source, plan_path, archives=None):
    source=Path(source).resolve(); target=Path(plan_path).resolve()
    if target.is_relative_to(source): raise ValueError('整理计划放在输入目录外')
    known=known_judgments(archives)
    old=read(target) if target.exists() else {'version':1,'id':str(uuid.uuid4()),'entries':[]}
    by_path={e['sourcePath']:e for e in old['entries']}; by_hash={}
    for e in old['entries']: by_hash.setdefault(e['sha256'],[]).append(e)
    entries=[]
    source_files=list(files(source)); source_paths={p.relative_to(source).as_posix() for p in source_files}
    for p in source_files:
        rel=p.relative_to(source).as_posix(); sha=digest(p); prior=by_path.get(rel)
        if prior and prior['sha256']!=sha: prior=None
        if not prior and len(by_hash.get(sha,[]))==1 and by_hash[sha][0]['sourcePath'] not in source_paths: prior=by_hash[sha][0]
        e=copy.deepcopy(prior) if prior else {'assetId':str(uuid.uuid4()),'targetPath':None,'review':{'reviewed':False},'selected':True}
        same=known.get(sha,[])
        # One unambiguous earlier decision is reused; several placements need a human/AI choice.
        if not prior and len(same)==1:
            k=same[0]; e.update(targetPath=k['path'],review=copy.deepcopy(k['review']),selected=k['selected'],inheritedFrom={'archive':k['archive'],'path':k['path']})
            if k.get('role'): e['role']=k['role']
        elif not prior and same: e['candidates']=[{'archive':k['archive'],'path':k['path']} for k in same]
        e.update(sourcePath=rel,sha256=sha,bytes=p.stat().st_size)
        if not prior: e['originalName']=p.name
        entries.append(e)
    groups={}
    for e in entries: groups.setdefault(e['sha256'],[]).append(e['sourcePath'])
    for e in entries:
        others=[x for x in groups[e['sha256']] if x!=e['sourcePath']]
        if others: e['duplicates']=others
        else: e.pop('duplicates',None)
    missing=[e for e in old['entries'] if e['sha256'] not in {x['sha256'] for x in entries}]
    kind,rank,similar=similar_groups(source,entries,old.get('similarGroups',[]))
    first={}
    for e in entries: first.setdefault(e['sha256'],e['sourcePath'])
    for e in entries:
        if first[e['sha256']] in rank: e['order']=rank[first[e['sha256']]]
    old.setdefault('selectionVersion',2)
    old.update(sourceRoot=str(source),entries=entries,missing=missing,similarGroups=similar,orderSource=kind,scannedAt=now()); write(target,old)
    print(json.dumps({'files':len(entries),'pending':sum(not e.get('targetPath') for e in entries),'inherited':sum('inheritedFrom' in e for e in entries),'duplicateGroups':[v for v in groups.values() if len(v)>1],'missing':len(missing),'orderSource':kind,'similarGroups':[g['members'] for g in similar]},ensure_ascii=False))

def apply(plan_path, activity):
    plan=read(plan_path); root=Path(activity).resolve(); source=Path(plan['sourceRoot']).resolve()
    if root.is_relative_to(source) or source.is_relative_to(root): raise ValueError('输入与正式归档目录须分开')
    bad=unresolved_similar(plan)
    if bad: raise ValueError('相似照片每组只留一张进 01_活动照片/，其余放 其他/相似连拍/；确实要都留，就在计划 similarGroups 里给这组写 keepAll 理由：\n'+'\n'.join(' / '.join(g) for g in bad))
    errors,warnings=selection_problems(plan)
    if errors: raise ValueError('精选检查没通过（规则见 references/selection.md）：\n- '+format_problems(errors))
    for w in warnings: print('提醒：'+w)
    record=root/'其他/整理记录.json'; earlier=read(record) if record.exists() else None
    placed={}
    for x in (earlier or {}).get('entries',[]):
        if x.get('targetPath'): placed.setdefault(x['sha256'],[]).append(x['targetPath'])
    operations=[]; targets=set()
    for e in plan['entries']:
        rel=e.get('targetPath')
        if not rel or Path(rel).parts[0] not in ROOTS: raise ValueError('先完成分类和命名: '+e['sourcePath'])
        src=inside(source,e['sourcePath']); dest=inside(root,rel)
        if digest(src)!=e['sha256']: raise ValueError('输入已变化，请重新扫描')
        if rel in targets: raise ValueError('重复目标路径: '+rel)
        targets.add(rel)
        if dest.exists() and digest(dest)!=e['sha256']: raise ValueError('人工文件已修改，拒绝覆盖: '+rel)
        operations.append((src,dest,e))
    moved=set()
    for src,dest,e in operations:
        dest.parent.mkdir(parents=True,exist_ok=True)
        if dest.exists(): continue
        # 审阅后改了取舍（如把连拍备选恢复入选）：把上次放好的同一文件挪过去，不留两份，旧位置不再进相册
        old=[t for t in placed.get(e['sha256'],[]) if t!=e['targetPath'] and t not in targets and t not in moved and inside(root,t).is_file() and digest(inside(root,t))==e['sha256']]
        if old: inside(root,old[0]).rename(dest); moved.add(old[0])
        else: shutil.copy2(src,dest)
    merged={**plan,'appliedAt':now()}
    if earlier:
        current={e['targetPath'] for e in plan['entries']}
        kept=[e for e in earlier['entries'] if e.get('targetPath') not in current and e.get('targetPath') not in moved]
        merged['entries']=kept+plan['entries']; merged['similarGroups']=list({tuple(g.get('sha256') or g['members']):g for g in earlier.get('similarGroups',[])+plan.get('similarGroups',[])}.values()); merged['batches']=earlier.get('batches',[{'id':earlier.get('id'),'sourceRoot':earlier.get('sourceRoot'),'appliedAt':earlier.get('appliedAt')}])
    merged.setdefault('batches',[]).append({'id':plan['id'],'sourceRoot':plan['sourceRoot'],'appliedAt':merged['appliedAt']})
    write(record,merged)
    mp=root/'manifest.json'
    if not mp.exists(): write(mp,{'version':6,'id':plan['id'],'uid':plan['id'],'title':'','sourceFolder':root.name,'date':None,'venue':'','organizer':'','coOrganizers':[],'summary':'','tags':[],'assets':[],'caseIds':{},'presentation':{}})
    print('归档复制完成；输入原件保留。')

def mirror(activity, website_root):
    root=Path(activity).resolve(); web=Path(website_root).resolve()
    if web.is_relative_to(root) or root.is_relative_to(web): raise ValueError('展示镜像须在活动目录之外')
    manifest=read(root/'manifest.json'); previous=read(root/'媒体映射.json') if (root/'媒体映射.json').exists() else {'version':2,'media':[]}
    by_path={m['originalPath']:m for m in previous['media']}; by_hash={}
    for m in previous['media']: by_hash.setdefault(m['originalSha256'],[]).append(m)
    plan=read(root/'其他/整理记录.json') if (root/'其他/整理记录.json').exists() else {'entries':[]}
    planned={e['targetPath']:e for e in plan['entries']}; assets=[]; media=[]; failures=[]; encoded=0
    for p in files(root):
        rel=p.relative_to(root).as_posix()
        if rel in ('manifest.json','媒体映射.json'): continue
        sha=digest(p); assets.append({'path':rel,'name':p.name,'type':p.suffix.lower()[1:] or 'file','bytes':p.stat().st_size,'sha256':sha})
        parts=Path(rel).parts
        display=parts[0]=='01_活动照片' or (parts[0]=='02_案例' and len(parts)>3 and parts[2] in ('截图','视频')) or (parts[0]=='03_社交媒体' and len(parts)>2 and parts[1]=='截图')
        if not display or p.suffix.lower() not in IMAGE|VIDEO: continue
        prior=by_path.get(rel)
        if not prior:
            same=[m for m in by_hash.get(sha,[]) if Path(m['originalPath']).parts[0]==parts[0]]
            if len(same)==1 and not inside(root,same[0]['originalPath']).exists(): prior=same[0]
        e=planned.get(rel,{})
        if e and e['sha256'] != sha: e={}
        if not e:
            same=[x for x in plan['entries'] if x['sha256']==sha]
            if len(same)==1: e=same[0]
        m=copy.deepcopy(prior or {}); unchanged=prior and prior['originalSha256']==sha
        m.update(originalName=m.get('originalName') or e.get('originalName') or p.name,normalizedName=p.name,originalPath=rel,originalSha256=sha,originalBytes=p.stat().st_size,
          assetId=m.get('assetId') or e.get('assetId') or str(uuid.uuid4()),mediaType='image' if p.suffix.lower() in IMAGE else 'video',
          cover='封面' in p.stem,homepage='首页' in p.stem or '首页' in '/'.join(parts[:-1]),score=int(p.name[:5]) if re.match(r'^\d{5}_',p.name) else None,
          review=m.get('review') if unchanged else e.get('review',{'reviewed':False}),selected=m.get('selected',e.get('selected',True)),role=m.get('role',e.get('role')))
        if not m.get('review',{}).get('reviewed'):
            m.update(status='needs-review',websitePath=None,websiteSha256=None,websiteBytes=None); media.append(m); failures.append(rel); continue
        suffix=Path(prior['websitePath']).suffix if unchanged and prior.get('websitePath') else ('.jpg' if m['mediaType']=='image' else '.mp4')
        dest_rel=(Path(root.name)/Path(rel).parent/(p.stem+'_'+sha[:10]+suffix)).as_posix(); dest=inside(web,dest_rel)
        if unchanged and prior.get('websitePath') and prior.get('compression')==VERSION:
            old=inside(web,prior['websitePath'])
            if old.is_file() and digest(old)==prior.get('websiteSha256'): dest_rel,dest=prior['websitePath'],old
        reusable=unchanged and prior.get('compression')==VERSION and dest.exists() and digest(dest)==prior.get('websiteSha256')
        if not reusable:
            dest.parent.mkdir(parents=True,exist_ok=True)
            tmp=dest.with_name(dest.stem+'.tmp'+suffix)
            try:
                if m['mediaType']=='image':
                    from PIL import Image, ImageOps
                    with Image.open(p) as im:
                        im=ImageOps.exif_transpose(im); m.update(width=im.width,height=im.height)
                        # Preserve alpha in PNG; logos must not acquire a black background.
                        if 'A' in im.getbands() or 'transparency' in im.info:
                            suffix='.png'; dest_rel=(Path(root.name)/Path(rel).parent/(p.stem+'_'+sha[:10]+suffix)).as_posix(); dest=inside(web,dest_rel); tmp=dest.with_name(dest.stem+'.tmp'+suffix)
                            im.thumbnail((2048,2048)); im.save(tmp,'PNG',optimize=True)
                        else:
                            im=im.convert('RGB'); im.thumbnail((2048,2048)); im.save(tmp,'JPEG',quality=86,optimize=True)
                else:
                    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(p),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-crf','24','-preset','medium','-c:a','aac','-movflags','+faststart',str(tmp)],check=True)
                tmp.replace(dest); encoded+=1
            except Exception as exc:
                m.update(status='failed',error=str(exc),websitePath=None,websiteSha256=None,websiteBytes=None); media.append(m); failures.append(rel); continue
        m.update(websitePath=dest_rel,websiteSha256=digest(dest),websiteBytes=dest.stat().st_size,compression=VERSION,status='website-ready',processedAt=m.get('processedAt') if reusable else now())
        m.pop('error',None); media.append(m)
    # Preserve unknown metadata and stable case IDs, including a folder rename with identical asset IDs.
    old_case_assets={}
    for m in previous['media']:
        parts=Path(m['originalPath']).parts
        if parts[0]=='02_案例' and len(parts)>2: old_case_assets.setdefault('/'.join(parts[:2]),set()).add(m.get('assetId'))
    identities=manifest.setdefault('caseIds',{})
    for m in media:
        parts=Path(m['originalPath']).parts
        if parts[0]=='02_案例' and len(parts)>2:
            key='/'.join(parts[:2])
            if key not in identities:
                candidates=[k for k,v in old_case_assets.items() if m.get('assetId') in v and k in identities]
                identities[key]=identities[candidates[0]] if len(candidates)==1 else str(uuid.uuid4())
    renamed={old['originalPath']:new['originalPath'] for old in previous['media'] for new in media
        if old.get('assetId') and old.get('assetId')==new.get('assetId') and old['originalPath']!=new['originalPath']}
    renamed_cases={}
    for old,new in renamed.items():
        a=Path(old).parts; b=Path(new).parts
        if a[0]=='02_案例' and b[0]=='02_案例' and len(a)>2 and len(b)>2:
            renamed_cases['/'.join(a[:2])]='/'.join(b[:2])
    for link in previous.get('linkReview',[]):
        for field in ('sourcePath','screenshotPath'):
            if link.get(field) in renamed: link[field]=renamed[link[field]]
        if link.get('casePath') in renamed_cases:
            old=link['casePath']; new=renamed_cases[old]; link['casePath']=new
            for field in ('sourcePath','screenshotPath'):
                if str(link.get(field,'')).startswith(old+'/'): link[field]=new+link[field][len(old):]
    def update_refs(value):
        if isinstance(value,dict):
            if value.get('path') in renamed: value['path']=renamed[value['path']]
            for item in value.values(): update_refs(item)
        elif isinstance(value,list):
            for item in value: update_refs(item)
    update_refs(manifest.get('presentation',{}))
    manifest.update(assets=assets,sourceFolder=root.name)
    previous.update(version=2,activity=root.name,media=media,generatedAt=now())
    history=root.parent/'.case-history'/manifest['id']/now().replace(':','-'); history.mkdir(parents=True,exist_ok=True)
    for name in ('manifest.json','媒体映射.json'):
        if (root/name).exists(): shutil.copy2(root/name,history/name)
    write(root/'manifest.json',manifest); write(root/'媒体映射.json',previous)
    print(json.dumps({'assets':len(assets),'media':len(media),'encoded':encoded,'pendingOrFailed':failures},ensure_ascii=False))

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='cmd',required=True)
    for name,second in [('scan','plan'),('apply','activity'),('mirror','website_root')]:
        q=sub.add_parser(name); q.add_argument('source'); q.add_argument(second)
        if name=='scan': q.add_argument('--archive',action='append',dest='archives',help='已整理活动目录，复用其中已审核的判断')
    a=p.parse_args(); args=vars(a); cmd=args.pop('cmd'); values=list(args.values()); globals()[cmd](*values)
if __name__=='__main__':
    try: main()
    except (ValueError,FileNotFoundError) as exc: raise SystemExit('错误: '+str(exc))
