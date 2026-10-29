import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'register_link.py'
SPEC = importlib.util.spec_from_file_location('register_link', SCRIPT)
register = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(register)
URL = 'https://example.com/game'


class RegisterLinkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name).resolve()
        self.root = self.parent / '活动'
        (self.root / '02_案例/首页01_游戏/其他').mkdir(parents=True)
        (self.root / '02_案例/首页01_游戏/其他/作品链接.md').write_text('- 游戏：' + URL + '\n', encoding='utf-8')
        self.frame = self.parent / 'frame.png'
        Image.new('RGB', (400, 300), (10, 120, 200)).save(self.frame)

    def captured(self, **overrides):
        arguments = dict(case='首页01_游戏', url=URL, candidate=str(self.frame), name='页面_开局画面',
                         kind='page-interactive', title='游戏', evidence='实看:开局画面')
        arguments.update(overrides)
        return register.register(self.root, status='captured', **arguments)

    def read(self, name):
        return json.loads((self.root / name).read_text(encoding='utf-8'))

    def test_captured_copies_frame_and_writes_both_indexes(self):
        record = self.captured()
        self.assertEqual(record['screenshotPath'], '02_案例/首页01_游戏/截图/10000_主图_页面_开局画面.png')
        self.assertTrue((self.root / record['screenshotPath']).is_file())
        link = self.read('媒体映射.json')['linkReview'][0]
        self.assertEqual((link['status'], link['captureKind'], link['sourcePath']),
                         ('captured', 'page-interactive', '02_案例/首页01_游戏/其他/作品链接.md'))
        entry = self.read('其他/整理记录.json')['entries'][0]
        self.assertEqual(entry['targetPath'], record['screenshotPath'])
        self.assertTrue(entry['review']['reviewed'])
        self.assertEqual(entry['review']['evidence'], '实看:开局画面')

    def test_first_screenshot_gets_main_prefix_once(self):
        record = self.captured(name='页面_开局画面')
        self.assertTrue(record['screenshotPath'].endswith('/10000_主图_页面_开局画面.png'))
        # 同名重登记沿用第一次的前缀，不再产生新文件
        again = self.captured(name='页面_开局画面')
        self.assertEqual(again['screenshotPath'], record['screenshotPath'])
        self.assertEqual(len(list((self.root / '02_案例/首页01_游戏/截图').iterdir())), 1)
        # 已有主图后，新截图保持原名
        other = self.captured(name='页面_第二屏')
        self.assertTrue(other['screenshotPath'].endswith('/页面_第二屏.png'))

    def test_existing_score_or_main_prefix_not_duplicated(self):
        self.assertTrue(self.captured(name='10000_主图_x')['screenshotPath'].endswith('/10000_主图_x.png'))
        shots = self.root / '02_案例/首页01_游戏/截图'
        for f in shots.iterdir():
            f.unlink()
        self.assertTrue(self.captured(name='09000_页面_y')['screenshotPath'].endswith('/09000_主图_页面_y.png'))

    def test_rerun_updates_instead_of_duplicating(self):
        self.captured()
        self.captured(title='新标题')
        self.assertEqual(len(self.read('媒体映射.json')['linkReview']), 1)
        self.assertEqual(len(self.read('其他/整理记录.json')['entries']), 1)
        self.assertEqual(self.read('媒体映射.json')['linkReview'][0]['title'], '新标题')

    def test_existing_media_entry_is_marked_reviewed(self):
        relative = '02_案例/首页01_游戏/截图/10000_主图_页面_开局画面.png'
        (self.root / '媒体映射.json').write_text(json.dumps(
            {'version': 2, 'media': [{'originalPath': relative, 'review': {'reviewed': False}}], 'linkReview': []}), encoding='utf-8')
        self.captured()
        self.assertTrue(self.read('媒体映射.json')['media'][0]['review']['reviewed'])

    def test_evidence_is_required(self):
        with self.assertRaises(ValueError):
            self.captured(evidence=None)
        self.assertFalse((self.root / '媒体映射.json').exists())

    def test_failed_link_records_error_without_files(self):
        record = register.register(self.root, '首页01_游戏', URL, status='failed', error='TimeoutError: 页面一直加载')
        self.assertEqual((record['status'], record['error']), ('failed', 'TimeoutError: 页面一直加载'))
        self.assertIsNone(record['screenshotPath'])
        self.assertFalse((self.root / '02_案例/首页01_游戏/截图').exists())
        with self.assertRaises(ValueError):
            register.register(self.root, '首页01_游戏', URL, status='failed')

    def test_failed_then_captured_replaces_record(self):
        register.register(self.root, '首页01_游戏', URL, status='failed', error='x')
        self.captured()
        links = self.read('媒体映射.json')['linkReview']
        self.assertEqual([item['status'] for item in links], ['captured'])
        self.assertNotIn('error', links[0])

    def test_refuses_missing_case_and_overwrite_of_different_file(self):
        with self.assertRaises(ValueError):
            self.captured(case='首页09_不存在')
        self.captured()
        Image.new('RGB', (400, 300), (200, 20, 20)).save(self.frame)
        with self.assertRaises(ValueError):
            self.captured()

    def test_other_mapping_keys_survive(self):
        (self.root / '媒体映射.json').write_text(json.dumps({'version': 2, 'media': [], 'linkReview': [], 'custom': 1}), encoding='utf-8')
        self.captured()
        self.assertEqual(self.read('媒体映射.json')['custom'], 1)


if __name__ == '__main__':
    unittest.main()
