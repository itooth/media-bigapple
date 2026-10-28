#!/usr/bin/env python3
"""Compile an archive v6 / media map v2 into the existing media-bigapple catalog."""
import argparse, copy, hashlib, json, re, shutil
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

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

def title(name):
    return re.sub(r'^(?:(?:\d{5}|首页\d*|封面|主图)_)+','',name)
def url(value):
    p=urlsplit(value or '')
    if p.scheme not in ('http','https') or not p.netloc: raise ValueError('需要真实 http(s) URL')
    return value

def compile_activity(activity, website_root, public_dir=None, uploads=None):
    root=Path(activity); manifest=read(root/'manifest.json'); mapping=read(root/'媒体映射.json')
    if manifest.get('version')!=6 or mapping.get('version')!=2: raise ValueError('需要 manifest v6 和媒体映射 v2')
    uid=manifest.get('uid') or manifest['id']; extra=manifest.get('presentation',{})
    if not uid or not manifest.get('title'): raise ValueError('需要稳定 ID 和活动标题')
    assets={a['path']:a for a in manifest['assets']}
    if len(assets)!=len(manifest['assets']): raise ValueError('重复资产路径')
    for rel,a in assets.items():
        p=inside(root,rel)
        if not p.is_file() or digest(p)!=a['sha256'] or p.stat().st_size!=a['bytes']: raise ValueError('原件变化，请重新同步: '+rel)
    media=[]; resolved={}
    for m in mapping['media']:
        rel=m['originalPath']
        if rel not in assets or m['originalSha256']!=assets[rel]['sha256']: raise ValueError('映射与原件不一致: '+rel)
        if m.get('selected',True) is False: continue
        if m.get('status')!='website-ready': raise ValueError('存在未就绪的选中素材: '+rel)
        p=inside(website_root,m['websitePath']); sha=m['websiteSha256']
        if not p.is_file() or digest(p)!=sha: raise ValueError('展示文件缺失或变化: '+rel)
        if uploads is not None:
            receipt=uploads.get(sha,{})
            if receipt.get('sha256')!=sha or receipt.get('bytes')!=p.stat().st_size: raise ValueError('缺少上传回执: '+rel)
            href=url(receipt['url'])
        else:
            if public_dir is None: raise ValueError('预览需要 --public-dir')
            target=Path('case-assets')/hashlib.sha256(uid.encode()).hexdigest()[:16]/(sha+p.suffix.lower())
            dest=Path(public_dir)/target; dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.exists(): shutil.copy2(p,dest)
            elif digest(dest)!=sha: raise ValueError('预览文件损坏: '+str(dest))
            href='/'+target.as_posix()
        resolved[rel]=href; media.append((m,href))
    d={'title':manifest['title'],'date':manifest.get('date') or '', 'city':manifest.get('venue') or '',
       'summary':manifest.get('summary') or '', 'gallery':[], 'highlights':[], 'productions':[], 'productionGallery':[],
       'videos':[], 'productionVideos':[], 'media':[], 'presentation':{}}
    cases={}; cover=''
    def rank(pair):
        m=pair[0]; name=Path(m['originalPath']).name; home=re.search(r'首页(\d+)_',m['originalPath'])
        return (0 if m.get('cover') else 1, int(home[1]) if home else 999, 0 if m.get('homepage') else 1, -(m.get('score') or 0), m['originalPath'])
    for m,href in sorted(media,key=rank):
        rel=m['originalPath']; parts=PurePosixPath(rel).parts; caption=m.get('caption') or title(Path(rel).stem)
        item={'id':m.get('assetId') or hashlib.sha256(rel.encode()).hexdigest()[:16], 'path':rel,'caption':caption,'title':caption}
        if m['mediaType']=='video': item['src']=href
        else: item.update(image=href,alt=caption)
        role=m.get('role')
        if role in ('poster','logo','resource'):
            continue
        if parts[0]=='01_活动照片':
            if m['mediaType']=='video': d['videos'].append(item)
            else:
                d['gallery'].append(item)
                if m.get('homepage') or m.get('cover'): d['highlights'].append(item)
                if m.get('cover') and not cover: cover=href
        elif parts[0]=='02_案例' and len(parts)>2:
            case_path='/'.join(parts[:2]); stable=manifest.get('caseIds',{}).get(case_path,case_path)
            case=cases.setdefault(case_path,{'id':stable,'title':title(parts[1]),'description':'','items':[],'links':[]})
            item.update(caseId=stable,title=case['title']); case['items'].append(item)
            if m['mediaType']=='video': d['productionVideos'].append(item)
            else: d['productionGallery'].append(item)
    # Current local case names and descriptions win; never infer ownership by title similarity.
    for case_path,case in cases.items():
        desc=inside(root,case_path+'/说明.md')
        if desc.exists():
            text=desc.read_text(); match=re.search(r'##\s*案例简介\s*\n([\s\S]*?)(?=\n##|$)',text)
            if match: case['description']=match[1].strip()
            match=re.search(r'##\s*案例网址\s*\n([\s\S]*?)(?=\n##|$)',text)
            if match:
                for link in re.findall(r'https?://[^\s<>]+',match[1]): case['links'].append(url(link.rstrip(')）')))
        for item in case['items']: item['description']=case['description']
    for link in mapping.get('linkReview',[]):
        href=url(link['url']); path=link.get('casePath','')
        if path:
            case=cases.setdefault(path,{'id':manifest.get('caseIds',{}).get(path,path),'title':title(PurePosixPath(path).name),'description':'','items':[],'links':[]})
            if href not in case['links']: case['links'].append(href)
        elif link.get('kind')=='social': d['media'].append({'title':link.get('title','报道'),'href':href})
    websites=[]
    for case in cases.values():
        image=next((i['image'] for i in case['items'] if i.get('image')),'')
        for i,href in enumerate(case['links']): websites.append({'id':case['id']+':'+str(i),'title':case['title'],'description':case['description'],'href':href,'image':image})
    # References to local assets are explicit, never guessed from file names.
    presentation=copy.deepcopy(extra); presentation['websites']=websites+presentation.get('websites',[])
    def resolve_image(value):
        if isinstance(value,str): value={'path':value}
        value=copy.deepcopy(value)
        if value.get('path'):
            if value['path'] not in resolved: raise ValueError('展示字段引用了未就绪素材: '+value['path'])
            value['image']=resolved[value['path']]; value.pop('path')
        return value
    if presentation.get('poster'): presentation['poster']=resolve_image(presentation['poster'])
    presentation['partners']=[resolve_image(i) for i in presentation.get('partners',[])]
    for r in presentation.get('resources',[]):
        if r.get('path'):
            rel=r.pop('path'); asset=assets.get(rel)
            if not asset or Path(rel).suffix.lower() not in ('.pdf','.ppt','.pptx','.doc','.docx'):
                raise ValueError('仅允许明确选择的 PDF/PPT/Word 文档: '+rel)
            sha=asset['sha256']; p=inside(root,rel)
            if uploads is not None:
                receipt=uploads.get(sha,{})
                if receipt.get('sha256')!=sha or receipt.get('bytes')!=p.stat().st_size: raise ValueError('文档缺少上传回执: '+rel)
                r['href']=url(receipt['url'])
            else:
                target=Path('case-assets')/hashlib.sha256(uid.encode()).hexdigest()[:16]/(sha+p.suffix.lower())
                dest=Path(public_dir)/target; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(p,dest); r['href']='/'+target.as_posix()
            r['downloadable']=True
        else: url(r.get('href') or r.get('url'))
    d['presentation']=presentation
    event={'uid':uid,'id':manifest['id'],'partner':manifest['title'],'description':d['summary'],'sourceDate':manifest.get('date') or '',
           'image':cover or next((p['image'] for p in d['gallery']),''),'alt':manifest['title'],'tags':manifest.get('tags',[]),'detail':d}
    return event

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('activity'); p.add_argument('--website-root',required=True)
    p.add_argument('--catalog',required=True); p.add_argument('--out',required=True); p.add_argument('--public-dir'); p.add_argument('--uploads')
    p.add_argument('--backup',help='发布必填：archive.py backup 生成的完整备份包'); p.add_argument('--evidence',help='发布必填：预览确认与备份回执')
    a=p.parse_args()
    if a.uploads:
        # Publication output is only produced for a confirmed, fully backed-up revision.
        if not (a.backup and a.evidence): raise ValueError('发布需要 --backup 与 --evidence，先完成备份确认')
        from release_gate import check; check(a.activity,a.backup,a.evidence)
    catalog=read(a.catalog); event=compile_activity(a.activity,a.website_root,a.public_dir,read(a.uploads) if a.uploads else None)
    matches=[i for i,e in enumerate(catalog) if e['uid']==event['uid']]
    if len(matches)>1: raise ValueError('站点存在重复 UID')
    if matches:
        previous=catalog[matches[0]]
        event={**previous,**event,'detail':{**previous.get('detail',{}),**event['detail']}}
        catalog[matches[0]]=event
    else: catalog.insert(0,event)
    write(a.out,catalog); print(json.dumps({'activities':len(catalog),'updatedUid':event['uid'],'output':a.out},ensure_ascii=False))
if __name__=='__main__': main()
