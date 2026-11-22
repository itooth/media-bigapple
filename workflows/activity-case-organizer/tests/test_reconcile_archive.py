import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import reconcile, cloud_archive  # noqa: E402
from archive import write  # noqa: E402


def event(uid, photos=(), videos=()):
    return {'uid': uid, 'id': uid, 'detail': {'gallery': [{'image': u} for u in photos], 'productionVideos': [{'src': u} for u in videos]}}


class Compare(unittest.TestCase):
    def test_untouched_site_passes(self):
        before = [event('a', ['1']), event('b', ['2'])]
        after = [event('a', ['1', '3']), event('b', ['2'])]
        self.assertEqual(reconcile.compare(before, after, 'a'), [])

    def test_append_must_not_lose_existing_items(self):
        before = [event('a', ['1'], ['old.mp4'])]
        after = [event('a', ['1'], ['new.mp4'])]
        problems = reconcile.compare(before, after, 'a')
        self.assertTrue(any('不见了' in p for p in problems))
        self.assertEqual(reconcile.compare(before, after, 'a', replace=True), [])  # 整场更新允许替换

    def test_other_activity_changed_or_lost_is_reported(self):
        before = [event('a', ['1']), event('b', ['2']), event('c', ['3'])]
        after = [event('a', ['1']), event('b', ['9'])]
        problems = '\n'.join(reconcile.compare(before, after, 'a'))
        self.assertIn('消失', problems); self.assertIn('b', problems)

    def test_new_activity_counts_and_presence(self):
        self.assertTrue(reconcile.compare([], [], 'a'))
        self.assertTrue(reconcile.compare([], [event('a', ['1'])], 'a', expected={'gallery': 2, 'videos': 0}))
        self.assertEqual(reconcile.compare([], [event('a', ['1', '2'])], 'a', expected={'gallery': 2, 'videos': 0}), [])

    def test_urls_must_live_in_target_app_and_open(self):
        source = {'assets': [{'path': 'a.jpg', 'url': 'https://x/apps/media-staging/a'}, {'path': 'b.jpg', 'url': 'https://x/apps/prod/b'}]}
        problems = reconcile.check_urls(source, 'prod', probe=lambda url: not url.endswith('/b'))
        self.assertEqual(len(problems), 2)
        self.assertEqual(reconcile.check_urls({'assets': source['assets'][1:]}, 'prod', probe=lambda url: True), [])


class ArchiveManifest(unittest.TestCase):
    def test_manifest_lists_every_file_with_its_ledger_row_and_is_stable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / '2026-01-01_活动'
            (root / '01_活动照片').mkdir(parents=True); (root / '其他' / '其余照片').mkdir(parents=True)
            (root / '01_活动照片' / '10000_封面_活动_合影.jpg').write_bytes(b'kept')
            (root / '其他' / '其余照片' / '0002_背影.jpg').write_bytes(b'dropped')
            (root / '其他' / '发布确认.json').write_text('{}')
            write(root / 'manifest.json', {'id': '01-01-x', 'uid': root.name, 'title': '活动', 'date': '2026-01-01'})
            import hashlib
            sha = lambda b: hashlib.sha256(b).hexdigest()
            write(root / '其他' / '整理记录.json', {'chapters': ['合影'], 'entries': [
                {'sourcePath': 'a.jpg', 'sha256': sha(b'kept'), 'decision': 'selected', 'chapter': '合影', 'review': {'evidence': '全体合影'}},
                {'sourcePath': 'b.jpg', 'sha256': sha(b'dropped'), 'decision': 'burst-alt', 'representative': 'a.jpg', 'review': {'evidence': '合影时有人背身'}}]})
            first = cloud_archive.build_manifest(root)
            rows = {r['path']: r for r in first['files']}
            self.assertNotIn('其他/发布确认.json', rows)
            self.assertEqual(rows['其他/其余照片/0002_背影.jpg']['description'], '合影时有人背身')
            self.assertEqual(rows['其他/其余照片/0002_背影.jpg']['representativeSha256'], sha(b'kept'))
            self.assertEqual(rows['01_活动照片/10000_封面_活动_合影.jpg']['decision'], 'selected')
            self.assertEqual(first['chapters'], ['合影'])
            self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(cloud_archive.build_manifest(root), sort_keys=True))

    def test_object_key_is_content_addressed(self):
        self.assertEqual(cloud_archive.object_key('ab' * 32, '照片/A.JPG'), 'media/' + 'ab' * 32 + '/' + 'ab' * 32 + '.jpg')


if __name__ == '__main__':
    unittest.main()
