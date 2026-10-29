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
        'id': '11-01-test-activity',
        'uid': '2026-11-01_测试活动',
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
        self.assertIn('共享硬盘', str(ctx.exception))

    def test_preview_approval_not_needed_to_build_data(self):
        # Preview approval happens later on staging; only the shared-disk backup is required here.
        self.write_confirmation(previewApprovedAt=None)
        publish_module.check_publish_confirmation(self.root)

    def test_confirmation_missing_shared_disk_backup_raises(self):
        self.write_confirmation(sharedDiskBackup={'location': '', 'confirmedAt': ''})
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_publish_confirmation(self.root)
        self.assertIn('共享硬盘', str(ctx.exception))

    def test_confirmation_complete_passes(self):
        self.write_confirmation()
        backup = publish_module.check_publish_confirmation(self.root)
        self.assertEqual(backup['location'], '/Volumes/备份盘/活动')


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
            self.assertTrue((dest / '01_活动照片' / 'a.jpg').is_file())  # 无短哈希
            self.assertFalse((dest / '01_活动照片' / 'b.jpg').exists())
            self.assertFalse((dest / '01_活动照片' / 'c.jpg').exists())
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
        self.assertIn('共享硬盘', str(ctx.exception))


class CaseAndIdChecksTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / '活动'
        self.root.mkdir()

    def add_case(self, folder, images, intro='一句作品介绍'):
        case = self.root / '02_案例' / folder
        (case / '截图').mkdir(parents=True)
        (case / '说明.md').write_text(f'## 案例名称\n\nx\n\n## 案例简介\n\n{intro}\n\n## 案例网址\n\n待确认\n', encoding='utf-8')
        for name in images:
            (case / '截图' / name).write_bytes(b'x')
        return [make_media_item(f'02_案例/{folder}/截图/{n}') for n in images]

    def check(self, media):
        publish_module.check_cases(self.root, {'media': media})

    def test_case_without_image_is_blocked(self):
        self.add_case('首页01_苏兰', [])
        with self.assertRaises(publish_module.PublishError) as ctx:
            self.check([])
        self.assertIn('没有主图，网站不会显示', str(ctx.exception))

    def test_multiple_images_need_exactly_one_main(self):
        media = self.add_case('首页01_苏兰', ['09000_作品界面_a.png', '09000_作品界面_b.png'])
        with self.assertRaises(publish_module.PublishError) as ctx:
            self.check(media)
        self.assertIn('主图', str(ctx.exception))

    def test_single_image_or_one_main_passes(self):
        media = self.add_case('首页01_苏兰', ['a.png'])
        media += self.add_case('首页02_小明', ['10000_主图_a.png', '09000_作品界面_b.png'])
        self.check(media)

    def test_placeholder_intro_is_blocked(self):
        media = self.add_case('首页01_苏兰', ['a.png'], intro='待补充')
        with self.assertRaises(publish_module.PublishError) as ctx:
            self.check(media)
        self.assertIn('请向实习生要一句作品介绍', str(ctx.exception))

    def test_activity_id_must_not_be_uuid(self):
        with self.assertRaises(publish_module.PublishError):
            publish_module.check_activity_id_format({'id': '3f2b8c9e-1111-4222-8333-444455556666'})
        publish_module.check_activity_id_format({'id': '10-28-yiwu-ai-class'})

    def test_activity_id_conflict_with_head_snapshot(self):
        snapshot = [{'id': '10-28-yiwu-ai-class', 'folder': '2026-10-28_别的活动'}]
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.check_activity_id_conflict({'id': '10-28-yiwu-ai-class'}, snapshot, '2026-10-28_义乌')
        self.assertIn('冲突', str(ctx.exception))
        self.assertTrue(publish_module.check_activity_id_conflict({'id': '10-28-yiwu-ai-class'}, snapshot, '2026-10-28_别的活动'))
        self.assertFalse(publish_module.check_activity_id_conflict({'id': '10-29-new'}, snapshot, 'x'))

    def test_website_media_path_rules(self):
        self.assertEqual(publish_module.website_media_path('02_案例/a/截图/x.PNG'), '02_案例/a/截图/x.jpg')
        self.assertEqual(publish_module.website_media_path('01_活动照片/v.mov'), '01_活动照片/v.mp4')


class VerifyBuildTests(unittest.TestCase):
    def write_events(self, repo, events):
        (repo / 'dist-server').mkdir(parents=True)
        (repo / 'dist-server' / 'events.json').write_text(json.dumps(events), encoding='utf-8')

    def event(self, **detail):
        base = {'gallery': [{'id': 'g', 'image': 'u'}], 'videos': [], 'productions': [], 'productionGallery': [], 'highlights': []}
        base.update(detail)
        return {'id': 'a', 'uid': 'a', 'image': 'cover-url', 'detail': base}

    def test_missing_cover_and_wrong_counts_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            event = self.event()
            event['image'] = ''
            self.write_events(repo, [event])
            expected = {'gallery': 2, 'videos': 1, 'cases': ['苏兰']}
            with self.assertRaises(publish_module.PublishError) as ctx:
                publish_module.verify_build(repo, 'a', 1, False, expected)
            message = str(ctx.exception)
            for part in ('封面', 'gallery', 'videos', '苏兰'):
                self.assertIn(part, message)

    def test_dry_run_ignores_empty_urls_but_still_checks_cases(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self.write_events(repo, [self.event(productionGallery=[{'id': 'c', 'title': '苏兰', 'image': ''}])])
            publish_module.verify_build(repo, 'a', 1, True, {'gallery': 1, 'videos': 0, 'cases': ['苏兰']})
            with self.assertRaises(publish_module.PublishError):
                publish_module.verify_build(repo, 'a', 1, True, {'gallery': 1, 'videos': 0, 'cases': ['苏兰', '小明']})

    def test_complete_event_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self.write_events(repo, [self.event(productions=[{'id': 'c', 'title': '苏兰', 'image': 'u'}])])
            publish_module.verify_build(repo, 'a', 1, False, {'gallery': 1, 'videos': 0, 'cases': ['苏兰']})


class RunStreamingTests(unittest.TestCase):
    def test_nonzero_exit_raises_chinese_error(self):
        with self.assertRaises(publish_module.PublishError) as ctx:
            publish_module.run_streaming(['false'], '.', None, 'upload-media.mjs')
        self.assertIn('失败', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()


class PngStagingTests(unittest.TestCase):
    def test_png_display_copy_becomes_real_jpeg(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp); web = tmp / 'web'; act = tmp / 'activity'; act.mkdir()
            src = web / '2026-11-01_测试活动' / '01_活动照片' / 'logo_abc.png'; src.parent.mkdir(parents=True)
            Image.new('RGBA', (8, 8), (0, 0, 0, 0)).save(src)
            media_map = {'_activity_root': str(act), 'media': [make_media_item('01_活动照片/10000_封面_活动_标识.png', websitePath='2026-11-01_测试活动/01_活动照片/logo_abc.png')]}
            dest, copied = publish_module.build_web_staging(media_map, web, tmp / 'stage', '2026-11-01_测试活动')
            out = dest / '01_活动照片' / '10000_封面_活动_标识.jpg'
            self.assertEqual(copied, 1)
            with Image.open(out) as im: self.assertEqual((im.format, im.getpixel((0, 0))), ('JPEG', (255, 255, 255)))
