import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'match_case_links.py'
SPEC = importlib.util.spec_from_file_location('match_case_links', SCRIPT)
matcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(matcher)

DESCRIPTION = '# 案例名称\n\n{name}\n\n## 案例简介\n\n简介。\n\n## 案例网址\n\n站内案例详情页\n'


class LinkIndexTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / '活动'
        (self.root / '03_社交媒体').mkdir(parents=True)
        for name in ('01_活动照片', '其他'):
            (self.root / name).mkdir()
        (self.root / '03_社交媒体/活动相关链接.md').write_text('# 活动相关链接\n', encoding='utf-8')
        self.add_case('08200_交易复盘', '交易复盘')
        self.add_case('08200_诗歌背诵游戏', '诗歌背诵游戏')

    def add_case(self, folder, name):
        case = self.root / '02_案例' / folder
        (case / '截图').mkdir(parents=True)
        (case / '说明.md').write_text(DESCRIPTION.format(name=name), encoding='utf-8')
        return case

    def write_index(self, text, name='案例链接.md'):
        path = self.root / '02_案例' / name
        path.write_text(text, encoding='utf-8')
        return path

    def entries(self, name='案例链接.md'):
        return matcher.parse_index_entries(matcher.read_text(self.root / '02_案例' / name))

    def run_main(self, *arguments):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            code = matcher.main([str(self.root), *arguments])
        return code, json.loads(stream.getvalue())

    def test_parses_bullet_markdown_and_bare_forms(self):
        entries = matcher.parse_index_entries(
            '# 标题\n\n'
            '- 100天计划：https://example.com/a.html\n'
            '- [方块派对](https://example.com/b)\n'
            '背古诗小游戏 https://example.com/c\n'
            '没有链接的一行\n')
        self.assertEqual([entry['name'] for entry in entries], ['100天计划', '方块派对', '背古诗小游戏'])
        self.assertEqual(entries[0]['url'], 'https://example.com/a.html')

    def test_normalize_removes_score_marker_and_noise(self):
        self.assertEqual(matcher.normalize_name('08200_诗花令-静夜思'), '诗花令静夜思')
        self.assertEqual(matcher.normalize_name('诗歌背诵游戏（备用入口）'), '诗歌背诵游戏')
        self.assertEqual(matcher.normalize_name('Deal Review移动端'), 'dealreview')

    def test_normalize_strips_home_and_score_prefix(self):
        self.assertEqual(matcher.normalize_name('首页01_苏兰'), '苏兰')
        self.assertEqual(matcher.normalize_name('08200_苏兰'), '苏兰')

    def test_two_char_name_matches_home_prefixed_case_and_description_uses_clean_name(self):
        self.add_case('首页01_苏兰', '苏兰')
        (self.root / '02_案例/首页01_苏兰/说明.md').unlink()
        self.write_index('- 苏兰：https://example.com/sulan\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), {})
        self.assertEqual(unresolved, [])
        self.assertEqual((results[0]['caseDir'], results[0]['method']), ('首页01_苏兰', 'exact'))
        matcher.ensure_description(self.root / '02_案例/首页01_苏兰')
        text = (self.root / '02_案例/首页01_苏兰/说明.md').read_text(encoding='utf-8')
        self.assertIn('## 案例名称\n\n苏兰\n', text)
        self.assertNotIn('首页01', text)

    def test_exact_match_binds_to_single_case(self):
        self.write_index('- 诗歌背诵游戏：https://example.com/poem/index.html\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), {})
        self.assertEqual(unresolved, [])
        self.assertEqual(results[0]['caseDir'], '08200_诗歌背诵游戏')
        self.assertEqual(results[0]['method'], 'exact')
        self.assertEqual(results[0]['confidence'], 'high')

    def test_same_work_secondary_entry_binds_to_same_case(self):
        self.write_index('- 诗歌背诵游戏：https://example.com/poem/index.html\n- 诗歌背诵游戏（备用入口）：https://example.com/poem/\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), {})
        self.assertEqual(unresolved, [])
        self.assertEqual({record['caseDir'] for record in results}, {'08200_诗歌背诵游戏'})
        self.assertEqual(matcher.detect_duplicates(results), {})

    def test_command_line_alias_binds_unrelated_names(self):
        self.write_index('- Deal Review移动端：https://example.com/deal_review.html\n')
        aliases = matcher.load_aliases(['Deal Review移动端=08200_交易复盘'])
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), aliases)
        self.assertEqual(unresolved, [])
        self.assertEqual(results[0]['caseDir'], '08200_交易复盘')
        self.assertEqual(results[0]['method'], 'alias')
        self.assertEqual(results[0]['confidence'], 'medium')

    def test_alias_file_is_read_only_from_outside_activity(self):
        mapping = self.root.parent / '映射-人工.md'
        mapping.write_text('- Deal Review移动端 = 08200_交易复盘\n', encoding='utf-8')
        aliases = matcher.load_aliases(alias_file=mapping)
        self.write_index('- Deal Review移动端：https://example.com/deal_review.html\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), aliases)
        self.assertEqual(unresolved, [])
        self.assertEqual(results[0]['caseDir'], '08200_交易复盘')
        self.assertEqual(results[0]['method'], 'alias')
        self.assertEqual(results[0]['confidence'], 'medium')

    def test_activity_never_creates_alias_file(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        self.run_main('--apply')
        self.assertFalse((self.root / '02_案例/链接对应表.md').exists())
        self.assertEqual([path.name for path in (self.root / '02_案例').iterdir() if path.is_file()], ['案例链接.md'])

    def test_name_without_evidence_stays_unresolved(self):
        self.write_index('- MBTI潮流健身杂志：https://example.com/mbti.html\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), {})
        self.assertEqual(results, [])
        self.assertEqual(unresolved[0]['name'], 'MBTI潮流健身杂志')
        self.assertIsNone(unresolved[0]['caseDir'])

    def test_duplicate_url_across_cases_is_reported(self):
        self.write_index('- 交易复盘：https://example.com/same.html\n- 诗歌背诵游戏：https://example.com/same.html\n')
        results, unresolved = matcher.match_entries(self.entries(), matcher.collect_cases(self.root), {})
        self.assertEqual(unresolved, [])
        self.assertIn('https://example.com/same.html', matcher.detect_duplicates(results))
        with self.assertRaises(SystemExit):
            self.run_main('--apply')

    def test_apply_writes_link_file_record_and_description(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        code, report = self.run_main('--apply')
        self.assertEqual(code, 0)
        self.assertEqual(report['summary'], {'indexEntries': 1, 'assigned': 1, 'unassigned': 0, 'casesWithoutLink': 1})
        case = self.root / '02_案例/08200_交易复盘'
        self.assertIn('https://example.com/deal/index.html', (case / '其他/作品链接.md').read_text(encoding='utf-8'))
        self.assertIn('| 交易复盘 |', (case / '其他/链接匹配记录.md').read_text(encoding='utf-8'))
        self.assertIn('https://example.com/deal/index.html', (case / '说明.md').read_text(encoding='utf-8'))
        self.assertIn('08200_诗歌背诵游戏', (self.root / '其他/待确认素材.md').read_text(encoding='utf-8'))

    def test_apply_is_idempotent(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        self.run_main('--apply')
        link_file = self.root / '02_案例/08200_交易复盘/其他/作品链接.md'
        first = link_file.read_text(encoding='utf-8')
        self.run_main('--apply')
        self.assertEqual(first, link_file.read_text(encoding='utf-8'))
        self.assertEqual(first.count('https://example.com/deal/index.html'), 1)

    def test_apply_keeps_manual_description_url_and_reports_conflict(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        description = self.root / '02_案例/08200_交易复盘/说明.md'
        description.write_text(DESCRIPTION.format(name='交易复盘').replace('站内案例详情页', 'https://manual.example.com/page'), encoding='utf-8')
        code, report = self.run_main('--apply')
        self.assertEqual(code, 0)
        self.assertIn('https://manual.example.com/page', description.read_text(encoding='utf-8'))
        self.assertTrue(report['conflicts'])

    def test_legacy_link_file_is_still_appended(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        other = self.root / '02_案例/08200_交易复盘/其他'
        other.mkdir(parents=True, exist_ok=True)
        (other / '游戏链接.md').write_text('# 游戏链接\n\n- 旧：https://example.com/old\n', encoding='utf-8')
        self.run_main('--apply')
        self.assertIn('https://example.com/deal/index.html', (other / '游戏链接.md').read_text(encoding='utf-8'))
        self.assertFalse((other / '作品链接.md').exists())

    def test_apply_creates_description_template_when_missing(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        description = self.root / '02_案例/08200_交易复盘/说明.md'
        description.unlink()
        self.run_main('--apply')
        text = description.read_text(encoding='utf-8')
        for heading in ('## 案例名称', '## 案例简介', '## 案例网址'):
            self.assertIn(heading, text)
        self.assertTrue(text.rstrip().endswith('https://example.com/deal/index.html'))
        self.assertIn('交易复盘', text)

    def test_video_link_goes_to_video_file(self):
        self.write_index('- 交易复盘：https://example.com/demo.mp4\n')
        self.run_main('--apply')
        other = self.root / '02_案例/08200_交易复盘/其他'
        self.assertTrue((other / '视频链接.md').is_file())
        self.assertFalse((other / '作品链接.md').exists())

    def test_read_only_run_writes_nothing(self):
        self.write_index('- 交易复盘：https://example.com/deal/index.html\n')
        before = {path.relative_to(self.root).as_posix() for path in self.root.rglob('*')}
        code, report = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(report['summary']['assigned'], 1)
        self.assertNotIn('written', report)
        self.assertEqual(before, {path.relative_to(self.root).as_posix() for path in self.root.rglob('*')})

    def test_missing_index_file_rejected(self):
        with self.assertRaises(SystemExit):
            matcher.index_files(self.root, ['02_案例/不存在.md'])

    def test_collection_directory_index_is_scanned(self):
        collection = self.root / '02_案例/案例集合材料'
        collection.mkdir()
        (collection / '补充链接.txt').write_text('交易复盘 https://example.com/deal/index.html\n', encoding='utf-8')
        self.assertEqual([path.name for path in matcher.index_files(self.root)], ['补充链接.txt'])

    def test_verify_records_title_and_failure_lowers_confidence(self):
        base = {'name': '交易复盘', 'url': 'https://example.com/deal/index.html', 'key': '交易复盘',
                'caseDir': '08200_交易复盘', 'casePath': '02_案例/08200_交易复盘', 'method': 'contains',
                'note': '', 'title': '', 'httpStatus': None, 'verifiedAt': None, 'confidence': 'medium'}
        original = matcher.fetch_title
        self.addCleanup(setattr, matcher, 'fetch_title', original)
        matcher.fetch_title = lambda url, timeout: ('合作尽调浏览页', 200, '')
        verified = matcher.verify([dict(base)], 5, 1)[0]
        self.assertEqual(verified['title'], '合作尽调浏览页')
        self.assertIsNotNone(verified['verifiedAt'])
        matcher.fetch_title = lambda url, timeout: ('', 502, 'HTTPError: HTTP 502')
        failed = matcher.verify([dict(base)], 5, 1)[0]
        self.assertEqual(failed['confidence'], 'low')


if __name__ == '__main__':
    unittest.main()
