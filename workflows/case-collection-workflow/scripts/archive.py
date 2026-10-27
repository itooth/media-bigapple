#!/usr/bin/env python3
"""Durable intake plan, copy-only organization, incremental media mirror and verifiable backup."""
import argparse, copy, datetime, json, os, re, shutil, subprocess, tarfile, tempfile, uuid
from pathlib import Path
from catalog import read, write, digest, inside
IMAGE={'.jpg','.jpeg','.png','.webp','.heic','.tif','.tiff','.gif'}
VIDEO={'.mp4','.mov','.m4v','.webm','.mkv'}
IGNORED={'.DS_Store','__MACOSX','.git','__pycache__'}
ROOTS={'01_活动照片','02_案例','03_社交媒体','其他'}
VERSION='web-v1-pillow-2048-q86-ffmpeg-h264-crf24'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def files(root):
    for base,dirs,names in os.walk(root,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in IGNORED and not Path(base,d).is_symlink())
        for name in sorted(names):
            p=Path(base,name)
            if name not in IGNORED and not name.startswith('._') and not p.is_symlink(): yield p

def scan(source, plan_path):
    source=Path(source).resolve(); target=Path(plan_path).resolve()
    if target.is_relative_to(source): raise ValueError('整理计划放在输入目录外')
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
        e.update(sourcePath=rel,sha256=sha,bytes=p.stat().st_size)
        if not prior: e['originalName']=p.name
        entries.append(e)
    missing=[e for e in old['entries'] if e['sha256'] not in {x['sha256'] for x in entries}]
    old.update(sourceRoot=str(source),entries=entries,missing=missing,scannedAt=now()); write(target,old)
    print(json.dumps({'files':len(entries),'pending':sum(not e.get('targetPath') for e in entries),'missing':len(missing)},ensure_ascii=False))

def apply(plan_path, activity):
    plan=read(plan_path); root=Path(activity).resolve(); source=Path(plan['sourceRoot']).resolve()
    if root.is_relative_to(source) or source.is_relative_to(root): raise ValueError('输入与正式归档目录须分开')
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
    for src,dest,e in operations:
        dest.parent.mkdir(parents=True,exist_ok=True)
        if not dest.exists(): shutil.copy2(src,dest)
    record=root/'其他/整理记录.json'; write(record,{**plan,'appliedAt':now()})
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
        display=parts[0]=='01_活动照片' or (parts[0]=='02_案例' and len(parts)>3 and parts[2]=='截图') or (parts[0]=='03_社交媒体' and len(parts)>2 and parts[1]=='截图')
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

def backup(activity, output):
    root=Path(activity).resolve(); output=Path(output).resolve()
    if output.is_relative_to(root) or output.exists(): raise ValueError('备份路径必须在活动外且不存在')
    output.parent.mkdir(parents=True,exist_ok=True)
    snapshot={p.relative_to(root).as_posix():digest(p) for p in files(root)}
    with tarfile.open(output,'w:gz') as t:
        for rel in sorted(snapshot): t.add(root/rel,arcname=rel,recursive=False)
    with tempfile.TemporaryDirectory() as tmp:
        restore(output,Path(tmp)/'check',quiet=True)
        actual={p.relative_to(Path(tmp)/'check').as_posix():digest(p) for p in files(Path(tmp)/'check')}
        if actual!=snapshot: raise ValueError('备份读回校验失败')
    receipt={'sha256':digest(output),'bytes':output.stat().st_size,'files':snapshot,'verifiedAt':now()}
    write(str(output)+'.receipt.json',receipt); print('备份已完整读回并校验: '+str(output))

def restore(archive, destination, quiet=False):
    dest=Path(destination)
    if dest.exists(): raise ValueError('恢复目录必须不存在，避免覆盖现有素材')
    with tarfile.open(archive,'r:gz') as t:
        for member in t.getmembers():
            inside(dest,member.name)
            if not member.isfile(): raise ValueError('备份只允许普通文件')
        dest.mkdir(parents=True); t.extractall(dest,filter='data')
    if not quiet: print('已恢复到新目录: '+str(dest))

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='cmd',required=True)
    for name,second in [('scan','plan'),('apply','activity'),('mirror','website_root'),('backup','output'),('restore','destination')]:
        q=sub.add_parser(name); q.add_argument('source'); q.add_argument(second)
    a=p.parse_args(); args=vars(a); cmd=args.pop('cmd'); values=list(args.values()); globals()[cmd](*values)
if __name__=='__main__': main()
