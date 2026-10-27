import contextlib, io, tempfile, unittest
from pathlib import Path
from PIL import Image
from archive import scan, apply, mirror, backup, restore
from catalog import read, write, digest, compile_activity
from release_gate import check
class Workflow(unittest.TestCase):
 def test_roundtrip(self):
  with tempfile.TemporaryDirectory() as tmp,contextlib.redirect_stdout(io.StringIO()):
   root=Path(tmp); source=root/'input';source.mkdir(); Image.new('RGB',(80,60),'red').save(source/'a.png'); Image.new('RGBA',(60,30),(0,0,0,0)).save(source/'logo.png')
   (source/'notes.txt').write_text('original document')
   plan=root/'plan.json';scan(source,plan); data=read(plan)
   for e in data['entries']:
    e['targetPath']={'a.png':'01_活动照片/10000_封面_合照.png','logo.png':'01_活动照片/合作方标识.png','notes.txt':'其他/notes.txt'}[e['sourcePath']]
    e['review']={'reviewed':True,'evidence':'test fixture'}
    if e['sourcePath']=='logo.png': e['role']='logo'
   write(plan,data);scan(source,plan);self.assertTrue(all(e['targetPath'] for e in read(plan)['entries']))
   activity=root/'activity';apply(plan,activity); manifest=read(activity/'manifest.json');manifest.update(title='测试活动',date='2026-10-26',presentation={'partners':[{'path':'01_活动照片/合作方标识.png','name':'伙伴'}]});write(activity/'manifest.json',manifest)
   web=root/'web';mirror(activity,web); first=read(activity/'媒体映射.json');mirror(activity,web);second=read(activity/'媒体映射.json');self.assertEqual([m['processedAt'] for m in first['media']],[m['processedAt'] for m in second['media']])
   self.assertEqual(first['media'][1]['websitePath'].split('.')[-1],'png')
   event=compile_activity(activity,web,root/'public');self.assertEqual(len(event['detail']['gallery']),1);self.assertEqual(event['detail']['presentation']['partners'][0]['name'],'伙伴')
   image=activity/'01_活动照片/10000_封面_合照.png';image.rename(image.with_name('09900_首页02_人工名称.png'));mirror(activity,web)
   current=read(activity/'媒体映射.json');record=next(m for m in current['media'] if '人工' in m['originalPath']);self.assertEqual(record['assetId'],first['media'][0]['assetId']);self.assertFalse(record['cover']);self.assertTrue(record['homepage'])
   changed=activity/record['originalPath'];Image.new('RGB',(80,60),'blue').save(changed);mirror(activity,web);self.assertEqual(next(m for m in read(activity/'媒体映射.json')['media'] if m['originalPath']==record['originalPath'])['status'],'needs-review')
   changed_map=read(activity/'媒体映射.json');next(m for m in changed_map['media'] if m['originalPath']==record['originalPath'])['review']={'reviewed':True,'evidence':'new fixture reviewed'};write(activity/'媒体映射.json',changed_map);mirror(activity,web)
   tar=root/'full.tar.gz';backup(activity,tar);restore(tar,root/'restored');self.assertEqual(digest(activity/'manifest.json'),digest(root/'restored/manifest.json'))
   evidence=root/'evidence.json';write(evidence,{})
   with self.assertRaises(ValueError):check(activity,tar,evidence)
   receipt=read(str(tar)+'.receipt.json');write(evidence,{'approvedArchiveSha256':receipt['sha256'],'cloud':{'sha256':receipt['sha256'],'bytes':tar.stat().st_size,'url':'https://example.test/archive','downloadVerifiedAt':'2026-10-26'},'localBackupConfirmedAt':'2026-10-26'})
   check(activity,tar,evidence);(activity/'其他/notes.txt').write_text('changed')
   with self.assertRaises(ValueError):check(activity,tar,evidence)
   with self.assertRaises(ValueError):compile_activity(activity,web,root/'public')
 def test_escape_and_partial(self):
  with tempfile.TemporaryDirectory() as tmp:
   from catalog import inside
   with self.assertRaises(ValueError):inside(tmp,'../escape')
   with self.assertRaises(ValueError):inside(tmp,'/absolute')
if __name__=='__main__':unittest.main()
