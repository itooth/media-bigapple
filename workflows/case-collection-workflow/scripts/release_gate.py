#!/usr/bin/env python3
"""Check evidence for the exact archive revision before publication or handoff. Does not upload."""
import argparse
from pathlib import Path
from archive import files
from catalog import read, digest, url

def check(activity, archive, evidence):
    root=Path(activity); receipt=read(str(archive)+'.receipt.json'); e=read(evidence)
    current={p.relative_to(root).as_posix():digest(p) for p in files(root)}
    if current!=receipt['files'] or digest(archive)!=receipt['sha256']: raise ValueError('素材/元数据在备份后发生变化，请重新备份')
    if e.get('approvedArchiveSha256')!=receipt['sha256']: raise ValueError('本版本尚无预览确认记录')
    cloud=e.get('cloud',{})
    if cloud.get('sha256')!=receipt['sha256'] or cloud.get('bytes')!=Path(archive).stat().st_size or not cloud.get('downloadVerifiedAt'):
        raise ValueError('缺少完整云端备份的下载读回回执')
    url(cloud.get('url'))
    if not e.get('localBackupConfirmedAt') and not e.get('ownerWaiver',{}).get('reason'):
        raise ValueError('请确认原件已备份到指定电脑/硬盘；负责人明确豁免时记录理由')
    print('本版本的确认与备份回执检查通过。发布仍使用部署工具，并核对云端读回证据；本脚本未发布。')
def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('activity');p.add_argument('archive');p.add_argument('evidence');a=p.parse_args();check(a.activity,a.archive,a.evidence)
if __name__=='__main__':main()
