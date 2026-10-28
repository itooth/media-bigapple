import contextlib
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'absorb_input_packages.py'
SPEC = importlib.util.spec_from_file_location('absorb_input_packages', SCRIPT)
absorb = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(absorb)


def patterned(path, size=(800, 600), shift=0):
    picture = Image.new('RGB', size, (240, 238, 232))
    draw = ImageDraw.Draw(picture)
    for index in range(12):
        draw.rectangle([20 + index * 60 + shift, 40 + index * 30, 140 + index * 60 + shift, 300 + index * 20],
                       fill=(40 + index * 12, 90 + index * 7, 150 - index * 6))
    draw.ellipse([300 + shift, 260, 700 + shift, 560], fill=(210, 120, 60))
    picture.save(path)


class AbsorbTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / '活动'
        for name in ('01_活动照片', '02_案例', '03_社交媒体'):
            (self.root / name).mkdir(parents=True)
        patterned(self.root / '01_活动照片/09000_活动照片_现场示例.jpg')
        self.pack = self.root / 'FDE-AI落地回访实践-素材交接包-20260903(1)'
        (self.pack / '03_精选').mkdir(parents=True)
        (self.pack / '07_清单').mkdir(parents=True)
        Image.open(self.root / '01_活动照片/09000_活动照片_现场示例.jpg').save(self.pack / '03_精选/01_重复图.jpg', quality=40)
        patterned(self.pack / '03_精选/02_独有图.jpg', shift=260)
        Image.new('RGB', (800, 600), (30, 90, 160)).save(self.pack / '03_精选/03_纯色图.jpg')
        (self.pack / '00_README.md').write_text('说明', encoding='utf-8')
        (self.pack / '07_清单/fde-assets.csv').write_text('a,b\n', encoding='utf-8')

    def run_main(self, *arguments):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = absorb.main([str(self.root), *arguments])
        return code, json.loads(stream.getvalue())

    def test_candidate_detection_only_outside_contract(self):
        names = [path.name for path in absorb.candidates(self.root)]
        self.assertEqual(names, [self.pack.name])

    def test_reencoded_duplicate_covered_and_flat_image_unique(self):
        by_hash, image_hashes = absorb.organized_index(self.root)
        report = absorb.classify(self.pack, by_hash, image_hashes)
        status = {item['name']: item['status'] for item in report['media']}
        self.assertEqual(status['03_精选/01_重复图.jpg'], 'covered')
        self.assertEqual(status['03_精选/02_独有图.jpg'], 'unique')
        self.assertEqual(status['03_精选/03_纯色图.jpg'], 'unique')
        self.assertEqual(sorted(report['documents']), ['00_README.md', '07_清单/fde-assets.csv'])

    def test_dry_run_changes_nothing(self):
        before = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob('*'))
        code, result = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(result['candidates'][0]['covered'], 1)
        self.assertEqual(result['candidates'][0]['unique'], 2)
        self.assertNotIn('rootAfter', result)
        self.assertEqual(before, sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob('*')))

    def test_apply_moves_unique_files_and_removes_package(self):
        code, result = self.run_main('--apply')
        self.assertEqual(code, 0)
        self.assertEqual(result['rootAfter'], ['01_活动照片', '02_案例', '03_社交媒体', '其他'])
        self.assertFalse(self.pack.exists())
        kept = sorted(path.relative_to(self.root).as_posix() for path in (self.root / '其他').rglob('*') if path.is_file())
        self.assertIn('其他/输入包吸收/FDE-AI落地回访实践-素材交接包-20260903(1)/独有媒体/03_精选/02_独有图.jpg', kept)
        self.assertIn('其他/输入包吸收/FDE-AI落地回访实践-素材交接包-20260903(1)/文档/00_README.md', kept)
        self.assertNotIn('其他/输入包吸收/FDE-AI落地回访实践-素材交接包-20260903(1)/独有媒体/03_精选/01_重复图.jpg', kept)
        record = (self.root / '其他/输入包吸收记录.md').read_text(encoding='utf-8')
        self.assertIn('已覆盖', record)
        self.assertIn('02_独有图.jpg', record)

    def test_keep_package_flag_absorbs_without_deleting(self):
        self.run_main('--apply', '--keep-package')
        self.assertTrue(self.pack.is_dir())
        self.assertFalse((self.pack / '03_精选/02_独有图.jpg').exists())
        self.assertTrue((self.pack / '03_精选/01_重复图.jpg').exists())

    def test_archive_and_loose_file_reported_not_touched(self):
        (self.root / '原始包.zip').write_bytes(b'PK\x03\x04')
        (self.root / '散落说明.txt').write_text('x', encoding='utf-8')
        code, result = self.run_main('--apply')
        self.assertEqual(code, 0)
        kinds = {item['path']: item['kind'] for item in result['candidates']}
        self.assertEqual(kinds['原始包.zip'], 'archive')
        self.assertEqual(kinds['散落说明.txt'], 'file')
        self.assertTrue((self.root / '原始包.zip').is_file())
        self.assertTrue((self.root / '散落说明.txt').is_file())

    def test_activity_without_package_is_clean(self):
        shutil.rmtree(self.pack)
        code, result = self.run_main('--apply')
        self.assertEqual(code, 0)
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['rootAfter'], ['01_活动照片', '02_案例', '03_社交媒体', '其他'])


if __name__ == '__main__':
    unittest.main()
