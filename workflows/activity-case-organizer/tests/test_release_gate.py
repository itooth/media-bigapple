import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from release_gate import backup, approve, check  # noqa: E402


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / '2026-10-27_活动'
        (self.root / '01_活动照片').mkdir(parents=True)
        (self.root / '01_活动照片' / 'a.jpg').write_bytes(b'one')

    def test_preview_approval_gates_production_and_backup_is_optional(self):
        with self.assertRaisesRegex(ValueError, '预览'): check(self.root)
        with self.assertRaisesRegex(ValueError, '谁确认'): approve(self.root, 'https://media-staging.bigapple.work', ' ')
        approve(self.root, 'https://media-staging.bigapple.work', '实习生')
        self.assertEqual(check(self.root)['confirmedBy'], '实习生')
        with self.assertRaisesRegex(ValueError, '谁确认'): backup(self.root, ' ')
        backup(self.root, '小王')
        self.assertEqual(check(self.root)['sharedDiskBackup']['confirmedBy'], '小王')  # 记录下来，但不改变确认结果

    def test_change_after_approval_requires_new_approval(self):
        approve(self.root, 'https://media-staging.bigapple.work', '实习生')
        (self.root / '01_活动照片' / 'a.jpg').write_bytes(b'two')
        with self.assertRaisesRegex(ValueError, '重新'): check(self.root)


if __name__ == '__main__':
    unittest.main()
