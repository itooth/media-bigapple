#!/usr/bin/env python3
"""Record and check the two release confirmations: preview approved, originals on the team shared disk.

approve  在测试站看完预览后记录确认，绑定当前素材与元数据的指纹。
check    写正式站前检查：预览已确认，且确认后素材、命名、manifest、说明.md 都没有再变。
backup   可选：记录使用者另外把原件复制到了团队共享硬盘。原件保全不靠这一步——
         publish.py 写正式站时会把完整档案传到云端并逐个核对（cloud_archive.py）。
"""
import argparse, datetime, hashlib
from pathlib import Path
from archive import files, read, write, digest

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

def backup(activity, confirmed_by, location=''):
    if not confirmed_by.strip(): raise ValueError('要写明是谁确认已备份')
    e=load(activity); e['sharedDiskBackup']={'confirmedBy':confirmed_by.strip(),'location':location.strip(),'confirmedAt':now()}
    write(Path(activity)/CONFIRMATION,e); print('已记录：'+confirmed_by.strip()+' 报告原件已复制到团队共享硬盘（脚本没有核对硬盘）')

def approve(activity, preview, confirmed_by):
    if not confirmed_by.strip(): raise ValueError('要写明是谁确认的预览')
    e=load(activity)
    e.update(contentFingerprint=fingerprint(activity),previewApprovedAt=now(),previewUrl=preview,confirmedBy=confirmed_by)
    write(Path(activity)/CONFIRMATION,e); print('已记录预览确认。之后再改素材需要重新发布测试站并确认。')

def check(activity):
    e=load(activity); b=e.get('sharedDiskBackup') or {}
    if not e.get('previewApprovedAt'): raise ValueError('测试站预览还没确认，不能写正式站')
    if e.get('contentFingerprint')!=fingerprint(activity): raise ValueError('确认之后素材或文字又改过，请重新预览并确认（release_gate.py approve）')
    print('发布确认有效：预览已由 '+str(e.get('confirmedBy') or '使用者')+' 确认'+('；'+b['confirmedBy']+' 另报告已复制到共享硬盘（未核对）' if b.get('confirmedBy') else '')); return e

def main():
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='cmd',required=True)
    b=sub.add_parser('backup'); b.add_argument('activity'); b.add_argument('--confirmed-by',required=True,help='确认已备份的人'); b.add_argument('--location',default='',help='可选：共享硬盘上的目录')
    a=sub.add_parser('approve'); a.add_argument('activity'); a.add_argument('--preview',required=True,help='确认时看的测试站地址'); a.add_argument('--confirmed-by',required=True,help='确认人姓名')
    c=sub.add_parser('check'); c.add_argument('activity')
    x=p.parse_args()
    if x.cmd=='backup': backup(x.activity,x.confirmed_by,x.location)
    elif x.cmd=='approve': approve(x.activity,x.preview,x.confirmed_by)
    else: check(x.activity)
if __name__=='__main__':
    try: main()
    except (ValueError,FileNotFoundError) as exc: raise SystemExit('错误: '+str(exc))
