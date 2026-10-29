import contextlib, io, tempfile, unittest
from pathlib import Path
from PIL import Image
from archive import scan, apply, mirror, backup, restore
from catalog import read, write, digest, compile_activity
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
   # Rename alone reuses the existing display copy without re-encoding.
   self.assertEqual((record['websitePath'],record['processedAt']),(first['media'][0]['websitePath'],first['media'][0]['processedAt']))
   changed=activity/record['originalPath'];Image.new('RGB',(80,60),'blue').save(changed);mirror(activity,web);self.assertEqual(next(m for m in read(activity/'媒体映射.json')['media'] if m['originalPath']==record['originalPath'])['status'],'needs-review')
   changed_map=read(activity/'媒体映射.json');next(m for m in changed_map['media'] if m['originalPath']==record['originalPath'])['review']={'reviewed':True,'evidence':'new fixture reviewed'};write(activity/'媒体映射.json',changed_map);mirror(activity,web)
   tar=root/'full.tar.gz';backup(activity,tar);restore(tar,root/'restored');self.assertEqual(digest(activity/'manifest.json'),digest(root/'restored/manifest.json'))
   (activity/'其他/notes.txt').write_text('changed')
   with self.assertRaises(ValueError):compile_activity(activity,web,root/'public')
 def test_cross_batch_inherits_reviews(self):
  with tempfile.TemporaryDirectory() as tmp,contextlib.redirect_stdout(io.StringIO()):
   root=Path(tmp); first=root/'batch1';first.mkdir(); Image.new('RGB',(40,30),'red').save(first/'a.png')
   plan=root/'p1.json';scan(first,plan);d=read(plan);d['entries'][0].update(targetPath='01_活动照片/合照.png',review={'reviewed':True,'evidence':'seen'},selected=False);write(plan,d)
   activity=root/'activity';apply(plan,activity)
   second=root/'batch2';second.mkdir(); Image.new('RGB',(40,30),'red').save(second/'IMG_0001.png'); Image.new('RGB',(40,30),'green').save(second/'new.png')
   plan2=root/'p2.json';scan(second,plan2,[activity]);entries={e['sourcePath']:e for e in read(plan2)['entries']}
   old=entries['IMG_0001.png'];self.assertEqual(old['targetPath'],'01_活动照片/合照.png');self.assertTrue(old['review']['reviewed']);self.assertFalse(old['selected'])
   self.assertIsNone(entries['new.png']['targetPath'])
   d=read(plan2);[e.update(targetPath='01_活动照片/新图.png',review={'reviewed':True,'evidence':'seen'}) for e in d['entries'] if e['sourcePath']=='new.png'];write(plan2,d);apply(plan2,activity)
   # A file renamed in the archive is still inherited under its current name.
   mirror(activity,root/'web'); (activity/'01_活动照片/新图.png').rename(activity/'01_活动照片/人工改名.png'); mirror(activity,root/'web')
   third=root/'batch3';third.mkdir(); Image.new('RGB',(40,30),'green').save(third/'again.png'); Image.new('RGB',(40,30),'green').save(third/'again copy.png')
   plan3=root/'p3.json';scan(third,plan3,[activity]);entries3={e['sourcePath']:e for e in read(plan3)['entries']}
   self.assertEqual(entries3['again.png']['targetPath'],'01_活动照片/人工改名.png');self.assertNotIn('candidates',entries3['again.png'])
   self.assertEqual(entries3['again.png']['duplicates'],['again copy.png'])
   record=read(activity/'其他/整理记录.json');self.assertEqual(len(record['batches']),2);self.assertEqual({e['targetPath'] for e in record['entries']},{'01_活动照片/合照.png','01_活动照片/新图.png'})
 def test_catalog_cli_is_preview_only(self):
  import subprocess,sys
  with tempfile.TemporaryDirectory() as tmp:
   r=subprocess.run([sys.executable,str(Path(__file__).with_name('catalog.py')),tmp,'--website-root',tmp,'--catalog',tmp+'/c.json','--out',tmp+'/o.json','--uploads',tmp+'/u.json'],capture_output=True,text=True)
   self.assertNotEqual(r.returncode,0);self.assertIn('--public-dir',r.stderr)
 def test_escape_and_partial(self):
  with tempfile.TemporaryDirectory() as tmp:
   from catalog import inside
   with self.assertRaises(ValueError):inside(tmp,'../escape')
   with self.assertRaises(ValueError):inside(tmp,'/absolute')
if __name__=='__main__':unittest.main()
