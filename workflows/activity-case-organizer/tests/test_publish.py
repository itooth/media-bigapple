import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'publish.py'
SPEC = importlib.util.spec_from_file_location('publish', SCRIPT)
publish_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publish_module)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def make_manifest(**overrides):
    manifest = {
        'version': 6,
        'id': 'test-activity',
        'uid': 'test-activity',
        'title': '测试活动',
        'date': '2026-11-01',
        'sourceFolder': '2026-11-01_测试活动',
    }
    manifest.update(overrides)
    return manifest


def make_media_item(path, **overrides):
    item = {
        'originalPath': path,
        'originalSha256': 'a' * 64,
        'selected': True,
        'status': 'website-ready',
        'websitePath': f'2026-11-01_测试活动/{path}',
    }
    item.update(overrides)
    return item


class PreflightChecksTests(unittest.TestCase):
    """发布前检查：manifest 缺字段 / 选中素材未就绪 / 缺发布确认，都要给中文提示并退出。"""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / '活动'
        self.root.mkdir()

    def write_confirmation(self, **overrides):
        confirmation = {
            'previewApprovedAt': '2026-11-01T00:00:00+00:00',
            'sharedDiskBackup': {'location': '/Volumes/备份盘/活动', 'confirmedAt': '2026-11-01T00:00:00+00:00'},
        }
        confirmation.update(overrides)
        write_json(self.root / '其他' / '发布确认.json', confirmation)

    def test_manifest_missing_title_raises_chinese_message(self):
        manifest = make_manifest(title='')
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_manifest(manifest)
        self.assertIn('title', str(ctx.exception))

    def test_unready_selected_media_raises(self):
        media_map = {'media': [
            make_media_item('01_活动照片/a.jpg', status='needs-review'),
            make_media_item('01_活动照片/b.jpg'),
        ]}
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_media_ready(media_map)
        self.assertIn('a.jpg', str(ctx.exception))

    def test_unselected_media_not_ready_is_ignored(self):
        media_map = {'media': [
            make_media_item('01_活动照片/a.jpg', selected=False, status='needs-review'),
            make_media_item('01_活动照片/b.jpg'),
        ]}
        # 不应抛错：未选中的素材即使没就绪也不挡发布
        publish_module.check_media_ready(media_map)

    def test_missing_confirmation_file_raises(self):
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_publish_confirmation(self.root)
        self.assertIn('发布确认.json', str(ctx.exception))

    def test_confirmation_missing_preview_approved_raises(self):
        self.write_confirmation(previewApprovedAt=None)
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_publish_confirmation(self.root)
        self.assertIn('previewApprovedAt', str(ctx.exception))

    def test_confirmation_missing_shared_disk_backup_raises(self):
        self.write_confirmation(sharedDiskBackup={'location': '', 'confirmedAt': ''})
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_publish_confirmation(self.root)
        self.assertIn('sharedDiskBackup', str(ctx.exception))

    def test_confirmation_complete_passes(self):
        self.write_confirmation()
        confirmation = publish_module.check_publish_confirmation(self.root)
        self.assertEqual(confirmation['previewApprovedAt'], '2026-11-01T00:00:00+00:00')


class SelectedFilterTests(unittest.TestCase):
    """只有 selected 且 website-ready 的素材才进 web 临时目录。"""

    def test_selected_website_ready_media_filters_out_unselected_and_unready(self):
        media_map = {'media': [
            make_media_item('01_活动照片/a.jpg'),
            make_media_item('01_活动照片/b.jpg', selected=False),
            make_media_item('01_活动照片/c.jpg', status='needs-review'),
            make_media_item('01_活动照片/d.jpg', websitePath=None),
        ]}
        kept = publish_module.selected_website_ready_media(media_map)
        self.assertEqual([m['originalPath'] for m in kept], ['01_活动照片/a.jpg'])

    def test_build_web_staging_copies_only_selected_ready_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            activity_root = tmp_path / 'activity'
            activity_root.mkdir()
            write_json(activity_root / 'manifest.json', make_manifest())

            web_root = tmp_path / 'web-root'
            folder = '2026-11-01_测试活动'
            (web_root / folder / '01_活动照片').mkdir(parents=True)
            (web_root / folder / '01_活动照片' / 'a_hash.jpg').write_bytes(b'ready-image')
            (web_root / folder / '01_活动照片' / 'c_hash.jpg').write_bytes(b'unready-image')

            media_map = {
                '_activity_root': str(activity_root),
                'media': [
                    make_media_item('01_活动照片/a.jpg', websitePath=f'{folder}/01_活动照片/a_hash.jpg'),
                    make_media_item('01_活动照片/b.jpg', selected=False, websitePath=f'{folder}/01_活动照片/b_hash.jpg'),
                    make_media_item('01_活动照片/c.jpg', status='needs-review', websitePath=f'{folder}/01_活动照片/c_hash.jpg'),
                ],
            }

            staging_root = tmp_path / 'staging'
            staging_root.mkdir()
            dest, copied = publish_module.build_web_staging(media_map, web_root, staging_root, folder)

            self.assertEqual(copied, 1)
            self.assertTrue((dest / '01_活动照片' / 'a_hash.jpg').is_file())
            self.assertFalse((dest / '01_活动照片' / 'b_hash.jpg').exists())
            self.assertFalse((dest / '01_活动照片' / 'c_hash.jpg').exists())
            # manifest.json 复制进 web 临时目录，供 upload-media.mjs 解析活动 id
            self.assertTrue((dest / 'manifest.json').is_file())

    def test_build_web_staging_raises_when_website_ready_file_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            activity_root = tmp_path / 'activity'
            activity_root.mkdir()
            write_json(activity_root / 'manifest.json', make_manifest())
            folder = '2026-11-01_测试活动'
            web_root = tmp_path / 'web-root'
            web_root.mkdir()
            media_map = {
                '_activity_root': str(activity_root),
                'media': [make_media_item('01_活动照片/a.jpg', websitePath=f'{folder}/01_活动照片/missing.jpg')],
            }
            staging_root = tmp_path / 'staging'
            staging_root.mkdir()
            with self.assertRaises(publish_module.PublishError) as ctx:
                publish_module.build_web_staging(media_map, web_root, staging_root, folder)
            self.assertIn('mirror', str(ctx.exception))


class PublishSubprocessMockTests(unittest.TestCase):
    """publish() 主流程：mock subprocess，验证检查失败提前退出、不调用任何子进程。"""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.tmp = Path(temporary.name).resolve()
        self.activity_root = self.tmp / 'activity'
        self.activity_root.mkdir()
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        self.web_root = self.tmp / 'web-root'
        self.web_root.mkdir()

    def test_publish_stops_before_any_subprocess_when_manifest_invalid(self):
        write_json(self.activity_root / 'manifest.json', make_manifest(title=''))
        write_json(self.activity_root / '媒体映射.json', {'media': []})
        with mock.patch('subprocess.run') as mocked_run:
            with self.assertRaises(publish_module.PublishError):
                publish_module.publish(self.activity_root, self.repo, self.web_root, 'app', dry_run=True)
            mocked_run.assert_not_called()

    def test_publish_stops_before_any_subprocess_when_confirmation_missing(self):
        write_json(self.activity_root / 'manifest.json', make_manifest())
        write_json(self.activity_root / '媒体映射.json', {'media': [make_media_item('01_活动照片/a.jpg')]})
        with mock.patch('subprocess.run') as mocked_run:
            with self.assertRaises(publish_module.PublishError) as ctx:
                publish_module.publish(self.activity_root, self.repo, self.web_root, 'app', dry_run=True)
            mocked_run.assert_not_called()
        self.assertIn('发布确认.json', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
