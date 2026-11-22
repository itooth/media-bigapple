import contextlib, io, json, sys, tempfile, unittest
from urllib.parse import unquote
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive import scan, apply, read, write, selection_problems, COVERAGE_MIN_PHOTOS  # noqa: E402
import curate  # noqa: E402


def drift(path, step):
    # The bar moves a little each frame: neighbours look alike, far frames do not.
    im = Image.new('RGB', (160, 120), 'white'); d = ImageDraw.Draw(im)
    d.rectangle((step * 9, 10, step * 9 + 40, 110), fill='navy'); im.save(path)


def scene(path, seed):
    im = Image.new('RGB', (160, 120), 'white'); d = ImageDraw.Draw(im)
    for k in range(6):
        x = (seed * 37 + k * 53) % 140; y = (seed * 17 + k * 29) % 100
        d.rectangle((x, y, x + 18, y + 18), fill=('black', 'red', 'green', 'blue')[(seed + k) % 4])
    im.save(path)


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a)


class Selection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.src = self.root / 'in'; self.src.mkdir(); self.plan = self.root / 'plan.json'

    def tearDown(self):
        self.tmp.cleanup()

    def test_gradual_chain_does_not_merge_into_one_group(self):
        for i in range(14):
            drift(self.src / f'IMG_{1000 + i}.jpg', i)
        quiet(scan, self.src, self.plan); plan = read(self.plan)
        self.assertEqual(plan['orderSource'], 'camera-sequence')
        self.assertTrue(all(len(g['members']) <= 8 for g in plan['similarGroups']))
        self.assertNotIn(14, [len(g['members']) for g in plan['similarGroups']])

    def test_far_apart_in_sequence_is_not_a_burst(self):
        drift(self.src / 'LIY_0100.jpg', 0); drift(self.src / 'LIY_0900.jpg', 0)
        quiet(scan, self.src, self.plan)
        self.assertEqual(read(self.plan)['similarGroups'], [])

    def big_plan(self, n=COVERAGE_MIN_PHOTOS + 2):
        for i in range(n):
            scene(self.src / f'IMG_{2000 + i}.jpg', i)
        quiet(scan, self.src, self.plan); plan = read(self.plan)
        plan['similarGroups'] = []; plan['chapters'] = ['签到', '颁奖']
        for i, e in enumerate(sorted(plan['entries'], key=lambda e: e['order'])):
            e.update(review={'reviewed': True, 'evidence': f'第{i}张的具体画面'}, chapter='签到', decision='archive', subject='')
        return plan

    def test_range_label_is_blocked(self):
        plan = self.big_plan()
        for e in plan['entries'][:5]:
            e['review']['evidence'] = '项目路演与现场交流'
        errors, _ = selection_problems(plan)
        self.assertTrue(any('项目路演与现场交流' in x for x in errors))

    def test_burst_alt_needs_selected_representative(self):
        plan = self.big_plan(); a, b = plan['entries'][:2]
        b.update(decision='burst-alt')
        self.assertTrue(any('representative' in x for x in selection_problems(plan)[0]))
        b['representative'] = a['sourcePath']
        self.assertTrue(any('代表照' in x for x in selection_problems(plan)[0]))

    def test_chapter_and_subject_gaps_block_until_selected_or_explained(self):
        plan = self.big_plan(); plan['entries'][3]['subject'] = '评委甲'
        errors, _ = selection_problems(plan)
        self.assertTrue(any('章节「签到」' in x for x in errors) and any('章节「颁奖」' in x for x in errors) and any('评委甲' in x for x in errors))
        plan['entries'][3]['decision'] = 'selected'; plan['chapterNotes'] = {'颁奖': '素材中未见'}
        write(self.plan, plan); quiet(curate.name, self.plan); plan = read(self.plan)
        self.assertEqual(selection_problems(plan)[0], [])
        self.assertTrue(plan['entries'][3]['targetPath'].startswith('01_活动照片/'))
        self.assertIn('第3张的具体画面', plan['entries'][3]['targetPath'])

    def test_small_event_skips_coverage(self):
        for i in range(5):
            scene(self.src / f'IMG_{3000 + i}.jpg', i)
        quiet(scan, self.src, self.plan); plan = read(self.plan)
        for i, e in enumerate(plan['entries']):
            e.update(review={'reviewed': True, 'evidence': f'小活动第{i}张'}, targetPath=f'01_活动照片/0900{i}_活动_小活动第{i}张.jpg')
        plan['similarGroups'] = []
        self.assertEqual(selection_problems(plan)[0], [])

    def test_name_uses_evidence_and_chapter_order_then_reapply_moves(self):
        plan = self.big_plan()
        es = sorted(plan['entries'], key=lambda e: e['order'])
        es[0].update(decision='selected', chapter='颁奖', cover=True)
        es[1].update(decision='selected', chapter='签到', review={'reviewed': True, 'evidence': '嘉宾_在 签到/处'})
        es[2].update(decision='selected', chapter='颁奖')
        write(self.plan, plan); quiet(curate.name, self.plan); plan = read(self.plan)
        by = {e['sourcePath']: e for e in plan['entries']}
        cover, sign, award = (by[x['sourcePath']]['targetPath'] for x in es[:3])
        self.assertTrue(cover.startswith('01_活动照片/10000_封面_活动_'))
        self.assertIn('嘉宾-在-签到-处', sign)
        self.assertGreater(int(Path(sign).name[:5]), int(Path(award).name[:5]))  # 签到 comes before 颁奖
        activity = self.root / 'act'; quiet(apply, self.plan, activity)
        by[es[2]['sourcePath']]['decision'] = 'archive'; write(self.plan, plan)
        quiet(curate.name, self.plan); quiet(apply, self.plan, activity)
        self.assertFalse((activity / award).exists())
        self.assertEqual(len(list((activity / '01_活动照片').iterdir())), 2)

    def test_sheets_coverage_and_page_cover_every_photo(self):
        plan = self.big_plan(); plan['entries'][0]['decision'] = 'selected'; plan['chapterNotes'] = {'颁奖': '素材中未见'}
        write(self.plan, plan); quiet(curate.name, self.plan)
        quiet(curate.sheets, self.plan, self.root / 'sheets')
        self.assertEqual(len(list((self.root / 'sheets').glob('拼图-*.jpg'))), -(-len(plan['entries']) // curate.PER_SHEET))
        quiet(curate.coverage, self.plan, self.root / '覆盖表.md')
        self.assertIn('| 签到 |', (self.root / '覆盖表.md').read_text())
        quiet(curate.page, self.plan, self.root / 'review' / 'index.html')
        body = (self.root / 'review' / 'index.html').read_text()
        data = json.loads(body.split('const D=')[1].split(';let list')[0])
        self.assertEqual(len(data), len(plan['entries']))
        self.assertTrue(all((self.root / 'review' / unquote(d['src'])).resolve().is_file() for d in data))


    def test_extreme_ratio_blocks_without_selection_note(self):
        entries = [{'sourcePath': f'p{i:03d}.jpg', 'sha256': f'h{i:03d}', 'order': i, 'chapter': '签到',
                    'decision': 'selected' if i < 50 else 'archive',
                    'targetPath': f'01_活动照片/{9900-i:05d}_活动_图{i}.jpg' if i < 50 else f'其他/其余照片/{i:04d}_图{i}.jpg',
                    'selected': i < 50, 'review': {'reviewed': True, 'evidence': f'第{i}张具体画面'}} for i in range(105)]
        plan = {'selectionVersion': 2, 'chapters': ['签到'], 'entries': entries, 'similarGroups': []}
        errors, warnings = selection_problems(plan)
        self.assertTrue(any('selectionNote' in x for x in errors))
        plan['selectionNote'] = '五十位讲者每人一张'
        errors, warnings = selection_problems(plan)
        self.assertEqual(errors, [])
        self.assertTrue(any('五十位讲者' in x for x in warnings))


if __name__ == '__main__':
    unittest.main()
