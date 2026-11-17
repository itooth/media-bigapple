import contextlib, io, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import checks, audit, repair  # noqa: E402


def asset(path, url=True):
    return {'path': path, 'name': Path(path).name, 'url': f'https://img/{path}' if url else '', 'hash': 'h' + path, 'activityId': 'x'}


def source(**record):
    v1, v2 = '01_活动照片/09000_活动视频_现场.mp4', '01_活动照片/08900_作品视频_广告.mp4'
    rec = {'id': '01-01-demo', 'title': '活动', 'summary': '一句话简介', 'videos': [{'path': v1, 'name': Path(v1).name}, {'path': v2, 'name': Path(v2).name}]}
    rec.update(record)
    return {'uid': 'demo', 'record': rec, 'assets': [asset(v1), asset(v2), asset('01_活动照片/10000_封面_活动_合影.jpg')],
            'cases': [{'folder': '首页01_作品', 'title': '作品', 'readme': '## 案例简介\n一个作品\n', 'videos': []}], 'social': []}


class Checks(unittest.TestCase):
    def codes(self, s):
        return sorted({i.code for i in checks.check_source(s)})

    def test_finds_each_rule(self):
        self.assertEqual(self.codes(source()), ['video-no-poster', 'video-raw-title', 'work-video-in-activity'])
        self.assertIn('summary-template', self.codes(source(summary='活动活动资料与成员作品归档。')))
        self.assertIn('summary-too-long', self.codes(source(summary='这' * 21)))
        s = source(); s['cases'][0]['readme'] = '## 案例简介\n\n## 案例网址\n'
        self.assertIn('case-intro-missing', self.codes(s))
        s['cases'][0]['readme'] = '## 案例简介\n' + '长' * 16
        self.assertIn('case-intro-too-long', self.codes(s))

    def test_legacy_case_without_readme_is_not_judged(self):
        s = source(); s['cases'][0].pop('readme')
        self.assertNotIn('case-intro-missing', self.codes(s))

    def test_waivers_need_reason(self):
        s = source(); issue = checks.check_source(s)[0]
        w = [{'uid': 'demo', 'code': issue.code, 'reason': '故意保留'}]
        self.assertFalse(any(i.code == issue.code for i in checks.open_issues(s, w)))
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump([{'uid': 'demo', 'code': 'x'}], f)
        with self.assertRaises(ValueError):
            checks.load_waivers(f.name)

    def test_audit_offline(self):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump([source(), source(summary='短')], f)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            rows = audit.main(['--sources', f.name])
        self.assertEqual(len(rows), 10)  # 每场：2 无封面 + 2 原始标题 + 1 作品视频
        self.assertIn('体检 2 场活动', out.getvalue())


class RepairOps(unittest.TestCase):
    def test_video_to_new_case_then_poster(self):
        s = source()
        after = repair.apply_ops(s, [{'op': 'video-to-case', 'video': '01_活动照片/08900_作品视频_广告.mp4', 'case': '08800_广告片',
                                      'caseTitle': '广告片', 'intro': '品牌广告短片', 'title': '广告'}])
        self.assertEqual([v['path'] for v in after['record']['videos']], ['01_活动照片/09000_活动视频_现场.mp4'])
        case = after['cases'][-1]
        self.assertEqual(case['videos'][0]['path'], '02_案例/08800_广告片/视频/10000_广告.mp4')
        self.assertIn('## 案例简介\n品牌广告短片', case['readme'])
        self.assertTrue(any(a['path'] == case['videos'][0]['path'] and a['url'] for a in after['assets']))
        self.assertEqual(s['cases'][-1]['folder'], '首页01_作品')  # 原记录不被改
        targets = repair.poster_targets(after)
        self.assertEqual([t[1] for t in targets], ['01_活动照片/视频封面/09000_活动视频_现场.poster.jpg', '02_案例/08800_广告片/视频/10000_广告.poster.jpg'])
        for video, poster, _ in targets:
            repair.attach_poster(after, video, poster, {'url': 'https://img/p/' + poster, 'hash': 'p', 'bytes': 1})
        repair.fill_titles(after)
        self.assertEqual(checks.check_source(after), [])
        self.assertEqual(after['record']['videoTitles']['01_活动照片/09000_活动视频_现场.mp4'], '现场')

    def test_rejects_bad_text_and_unknown_ops(self):
        for op in ({'op': 'summary', 'text': '这' * 21}, {'op': 'summary', 'text': 'X活动资料与成员作品归档'},
                   {'op': 'case-intro', 'case': '首页01_作品', 'text': '长' * 16}, {'op': 'nope'},
                   {'op': 'video-to-case', 'video': '01_活动照片/08900_作品视频_广告.mp4', 'case': '新案例'}):
            with self.assertRaises(repair.RepairError):
                repair.apply_ops(source(), [op])

    def test_case_intro_keeps_other_sections(self):
        s = source(); s['cases'][0]['readme'] = '## 案例名称\n作品\n\n## 案例简介\n旧的很长很长很长很长很长很长的简介\n\n## 案例网址\nhttps://a.b\n'
        after = repair.apply_ops(s, [{'op': 'case-intro', 'case': '首页01_作品', 'text': '新简介', 'detail': '旧的很长的说明'}])
        readme = after['cases'][0]['readme']
        self.assertIn('## 案例简介\n新简介', readme); self.assertIn('https://a.b', readme); self.assertIn('## 详细说明\n旧的很长的说明', readme)

    def test_adopts_legacy_poster_field(self):
        s = source(); v = s['record']['videos'][0]
        v['poster'] = '03_社交媒体/截图/视频封面/现场.jpg'; s['assets'].append(asset(v['poster']))
        self.assertEqual(repair.adopt_legacy_posters(s), 1)
        self.assertEqual(s['record']['videoPosters'][v['path']], v['poster'])
        self.assertNotIn(v['path'], [t[0] for t in repair.poster_targets(s)])
        s2 = source(); s2['record']['videos'][0]['poster'] = '不存在.jpg'
        self.assertEqual(repair.adopt_legacy_posters(s2), 0)

    def test_clean_title(self):
        self.assertEqual(repair.clean_title('08660_活动视频_一起查看电脑作品.mp4'), '一起查看电脑作品')
        self.assertEqual(repair.clean_title('10001_作品视频_楞严咒.mp4'), '楞严咒')
        self.assertEqual(repair.clean_title('现场.mov'), '现场')


if __name__ == '__main__':
    unittest.main()
