import contextlib, io, json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import video_posters as V  # noqa: E402
import publish  # noqa: E402

HAS_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))


def make_video(path, seconds=3):
    path.parent.mkdir(parents=True, exist_ok=True)
    # 前 1 秒黑场，之后是彩条：自动选帧不能选到黑场。
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'color=black:s=320x240:d=1',
                    '-f', 'lavfi', '-i', f'testsrc=s=320x240:d={seconds - 1}', '-filter_complex', '[0][1]concat=n=2:v=1',
                    '-pix_fmt', 'yuv420p', str(path)], check=True)


class PosterPaths(unittest.TestCase):
    def test_fixed_locations(self):
        self.assertEqual(V.poster_rel('01_活动照片/09000_活动视频_合影.mp4'), '01_活动照片/视频封面/09000_活动视频_合影.poster.jpg')
        self.assertEqual(V.poster_rel('02_案例/首页01_作品/视频/演示.mp4'), '02_案例/首页01_作品/视频/演示.poster.jpg')
        self.assertIsNone(V.poster_rel('其他/待补/坏.mp4'))
        for rel in ('01_活动照片/09000_活动视频_合影.mp4', '02_案例/首页01_作品/视频/演示.mp4'):
            self.assertEqual(publish.poster_path_for(rel), V.poster_rel(rel))


@unittest.skipUnless(HAS_FFMPEG, 'needs ffmpeg')
class Frames(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.root = self.tmp / '2026-01-01_活动'
        (self.root / '其他').mkdir(parents=True)
        (self.root / 'manifest.json').write_text(json.dumps({'id': '01-01-demo', 'title': 't', 'date': '2026-01-01'}))
        make_video(self.root / '01_活动照片' / '09000_活动视频_现场.mp4')
        make_video(self.root / '02_案例' / '首页01_作品' / '视频' / '演示.mp4')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_generates_registers_and_skips_black(self):
        with contextlib.redirect_stdout(io.StringIO()):
            rows, problems = V.frames(self.root)
        self.assertEqual((len(rows), problems), (2, []))
        self.assertTrue((self.root / '01_活动照片/视频封面/09000_活动视频_现场.poster.jpg').is_file())
        self.assertTrue((self.root / '02_案例/首页01_作品/视频/演示.poster.jpg').is_file())
        for _, shots, best in rows:
            self.assertGreater(V.frame_score(shots[best]), 0)
        manifest = json.loads((self.root / 'manifest.json').read_text())
        self.assertEqual(manifest['videoPosters'], {'01_活动照片/09000_活动视频_现场.mp4': '01_活动照片/视频封面/09000_活动视频_现场.poster.jpg'})
        self.assertEqual(manifest['videoTitles'], {'01_活动照片/09000_活动视频_现场.mp4': '现场'})
        entries = json.loads((self.root / '其他/整理记录.json').read_text())['entries']
        self.assertEqual(len(entries), 2); self.assertTrue(all(e['review']['reviewed'] for e in entries))
        # 候选帧和总览图在活动目录外，不进 manifest、不上传。
        self.assertFalse(any('候选' in p.as_posix() for p in self.root.rglob('*')))
        self.assertTrue((self.tmp / '.视频封面候选' / self.root.name / '总览.jpg').is_file())
        # 已有封面的不重做；pick 换帧后登记只留一条。
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(V.frames(self.root)[0], [])
            V.pick(self.root, '01_活动照片/09000_活动视频_现场.mp4', 0)
        entries = json.loads((self.root / '其他/整理记录.json').read_text())['entries']
        self.assertEqual(len(entries), 2)


class PublishChecks(unittest.TestCase):
    def media(self, *paths):
        return {'media': [{'originalPath': p, 'status': 'website-ready', 'websitePath': 'x/' + p, 'originalSha256': p} for p in paths]}

    def test_summary_rules(self):
        publish.check_summary({'summary': 'CMG 展台展示亚太植物互动作品'})
        for bad in ('', '某活动活动资料与成员作品归档。', '这是一句写了很多很多很多很多很多很多细节的简介内容'):
            with self.assertRaises(publish.PublishError):
                publish.check_summary({'summary': bad})

    def test_video_needs_poster_and_work_video_needs_case(self):
        v = '01_活动照片/09000_活动视频_现场.mp4'; poster = '01_活动照片/视频封面/09000_活动视频_现场.poster.jpg'
        with self.assertRaises(publish.PublishError):
            publish.check_videos('.', {}, self.media(v))
        with self.assertRaises(publish.PublishError):
            publish.check_videos('.', {}, self.media(v, poster))  # 没登记 videoPosters
        publish.check_videos('.', {'videoPosters': {v: poster}}, self.media(v, poster))
        case = '02_案例/首页01_作品/视频/演示.mp4'
        publish.check_videos('.', {}, self.media(case, '02_案例/首页01_作品/视频/演示.poster.jpg'))
        work = '01_活动照片/09000_作品视频_广告.mp4'
        with self.assertRaisesRegex(publish.PublishError, '作品视频'):
            publish.check_videos('.', {'videoPosters': {work: V.poster_rel(work)}}, self.media(work, V.poster_rel(work)))


if __name__ == '__main__':
    unittest.main()
