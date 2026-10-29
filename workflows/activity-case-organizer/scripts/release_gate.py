#!/usr/bin/env python3
"""Record and check the two release confirmations: preview approved, originals on the team shared disk.

backup   记录原件已复制到团队共享硬盘（publish.py 生成网站数据前必须有）。
approve  在测试站看完预览后记录确认，绑定当前素材与元数据的指纹。
check    部署正式站前检查：两项确认都在，且确认后素材、命名、manifest、说明.md 都没有再变。
"""
import argparse, datetime, hashlib
from pathlib import Path
from archive import files
from catalog import read, write, digest

CONFIRMATION='其他/发布确认.json'

def fingerprint(activity):
    # Everything a reviewer saw, except the confirmation file itself.
    root=Path(activity); h=hashlib.sha256()
    for p in files(root):
        rel=p.relative_to(root).as_posix()
        if rel==CONFIRMATION: continue
        h.update(rel.encode()+b'\0'+digest(p).encode()+b'\n')
    return h.hexdigest()

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def load(activity):
    path=Path(activity)/CONFIRMATION
    return read(path) if path.exists() else {}

def backup(activity, location):
    if not Path(location).is_absolute(): raise ValueError('共享硬盘位置要写完整路径，例如 /Volumes/团队共享盘/活动素材/2026-10-27_活动名')
    e=load(activity); e['sharedDiskBackup']={'location':location,'confirmedAt':now()}
    write(Path(activity)/CONFIRMATION,e); print('已记录原件备份位置：'+location)

def require_backup(activity):
    b=load(activity).get('sharedDiskBackup') or {}
    if not b.get('location') or not b.get('confirmedAt'): raise ValueError('还没确认原件已复制到团队共享硬盘：复制好后运行 release_gate.py backup <活动> --location <硬盘上的目录>')
    return b

def approve(activity, preview, confirmed_by):
    require_backup(activity); e=load(activity)
    e.update(contentFingerprint=fingerprint(activity),previewApprovedAt=now(),previewUrl=preview,confirmedBy=confirmed_by)
    write(Path(activity)/CONFIRMATION,e); print('已记录预览确认。之后再改素材需要重新发布测试站并确认。')

def check(activity):
    b=require_backup(activity); e=load(activity)
    if not e.get('previewApprovedAt'): raise ValueError('测试站预览还没确认，不能部署正式站')
    if e.get('contentFingerprint')!=fingerprint(activity): raise ValueError('确认之后素材或文字又改过，请重新预览并确认（release_gate.py approve）')
    print('发布确认有效：预览已确认，原件在 '+b['location']); return e

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='cmd',required=True)
    b=sub.add_parser('backup'); b.add_argument('activity'); b.add_argument('--location',required=True,help='团队共享硬盘上的原件目录')
    a=sub.add_parser('approve'); a.add_argument('activity'); a.add_argument('--preview',required=True,help='确认时看的测试站地址'); a.add_argument('--confirmed-by',required=True,help='确认人姓名')
    c=sub.add_parser('check'); c.add_argument('activity')
    x=p.parse_args()
    if x.cmd=='backup': backup(x.activity,x.location)
    elif x.cmd=='approve': approve(x.activity,x.preview,x.confirmed_by)
    else: check(x.activity)
if __name__=='__main__':
    try: main()
    except (ValueError,FileNotFoundError) as exc: raise SystemExit('错误: '+str(exc))
