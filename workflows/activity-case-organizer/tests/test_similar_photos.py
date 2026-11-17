import contextlib, io, sys, tempfile, unittest
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive import scan, apply, mirror, read, write  # noqa: E402
import publish  # noqa: E402

def shot(path, shift=0, color='navy'):
    # Same scene, slightly moved and re-encoded: different bytes, near-identical picture.
    im = Image.new('RGB', (160, 120), 'white'); d = ImageDraw.Draw(im)
    d.rectangle((20 + shift, 20, 90 + shift, 100), fill=color); d.ellipse((100, 30, 150, 80), fill='orange')
    im.save(path, quality=90 - shift)

class SimilarPhotos(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.src = root / 'in'; self.src.mkdir(); self.plan = root / 'plan.json'; self.act = root / 'act'
        shot(self.src / 'a.jpg'); shot(self.src / 'b.jpg', 2)
        im = Image.new('RGB', (160, 120), 'white'); ImageDraw.Draw(im).polygon([(0, 120), (80, 0), (160, 120)], fill='green'); im.save(self.src / 'c.jpg')
        with contextlib.redirect_stdout(io.StringIO()): scan(self.src, self.plan)
    def tearDown(self): self.tmp.cleanup()
    def fill(self, targets, keep_all=None):
        d = read(self.plan)
        for e in d['entries']: e.update(targetPath=targets[e['sourcePath']], review={'reviewed': True, 'evidence': 'test'})
        if keep_all: d['similarGroups'][0]['keepAll'] = keep_all
        write(self.plan, d)
    def test_scan_groups_bursts_only(self):
        self.assertEqual([g['members'] for g in read(self.plan)['similarGroups']], [['a.jpg', 'b.jpg']])
    def test_apply_blocks_until_one_is_moved_out(self):
        self.fill({'a.jpg': '01_活动照片/10000_活动_a.jpg', 'b.jpg': '01_活动照片/09990_活动_b.jpg', 'c.jpg': '01_活动照片/09980_活动_c.jpg'})
        with self.assertRaises(ValueError): apply(self.plan, self.act)
        self.fill({'a.jpg': '01_活动照片/10000_活动_a.jpg', 'b.jpg': '其他/相似连拍/b.jpg', 'c.jpg': '01_活动照片/09980_活动_c.jpg'})
        with contextlib.redirect_stdout(io.StringIO()): apply(self.plan, self.act)
        self.assertEqual(len(read(self.act / '其他/整理记录.json')['similarGroups']), 1)
    def test_keep_all_reason_and_publish_check(self):
        self.fill({'a.jpg': '01_活动照片/10000_活动_a.jpg', 'b.jpg': '01_活动照片/09990_活动_b.jpg', 'c.jpg': '01_活动照片/09980_活动_c.jpg'}, keep_all='两张主角不同')
        with contextlib.redirect_stdout(io.StringIO()):
            apply(self.plan, self.act); mirror(self.act, Path(self.tmp.name) / 'web')
        media = read(self.act / '媒体映射.json'); publish.check_similar_photos(self.act, media)
        rec = read(self.act / '其他/整理记录.json'); rec['similarGroups'][0].pop('keepAll'); write(self.act / '其他/整理记录.json', rec)
        with self.assertRaises(publish.PublishError): publish.check_similar_photos(self.act, media)

if __name__ == '__main__': unittest.main()
