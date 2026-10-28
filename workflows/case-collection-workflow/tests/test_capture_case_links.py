import contextlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/capture_case_links.py'
SPEC = importlib.util.spec_from_file_location('capture_case_links', SCRIPT)
capture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture)


def busy_picture(size=(400, 300)):
    picture = Image.new('RGB', size, (18, 28, 56))
    draw = ImageDraw.Draw(picture)
    for index in range(24):
        draw.rectangle([index * 16, 40 + index * 6, index * 16 + 40, 200 + index],
                       fill=(40 + index * 8, 120, 200 - index * 5))
    draw.ellipse([120, 90, 320, 260], fill=(230, 140, 60))
    return picture


def title_card(size=(400, 300)):
    picture = Image.new('RGB', size, (250, 250, 248))
    draw = ImageDraw.Draw(picture)
    draw.rectangle([150, 130, 250, 170], fill=(60, 60, 60))
    return picture


class CaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.parent = Path(temporary.name).resolve()
        self.root = self.parent / '活动'
        self.other = self.root / '02_案例/09000_游戏/其他'
        self.other.mkdir(parents=True)
        self.source = self.other / '补充.txt'
        self.source.write_text('游戏https://example.com/game\n', encoding='utf-8')
        self.output = self.parent / 'staging'
        self.output.mkdir()

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}

    @staticmethod
    def fake_capture(task, binary, out_dir, timeout, limit=6, video_frames=4):
        out_dir = Path(out_dir)
        shots = []
        title_card().save(out_dir / 'candidate-00.png')
        shots.append({'kind': 'page-first', 'note': '页面载入后立即截取', 'seconds': None, 'title': 'Game',
                      'width': 400, 'height': 300, 'flags': [], 'contentScore': 0.08, 'file': 'candidate-00.png'})
        busy_picture().save(out_dir / 'candidate-01.png')
        shots.append({'kind': 'page-interactive', 'note': '点击开始/继续入口后截取', 'seconds': None, 'title': 'Game',
                      'width': 400, 'height': 300, 'flags': [], 'contentScore': 0.88, 'file': 'candidate-01.png'})
        busy_picture((400, 240)).save(out_dir / 'candidate-02.png')
        shots.append({'kind': 'video-frame', 'note': '视频第 12.5 秒', 'seconds': 12.5, 'title': 'Game',
                      'width': 400, 'height': 240, 'flags': [], 'contentScore': 0.52, 'file': 'candidate-02.png'})
        return shots

    def test_discover_reads_nested_txt_and_dedupes_by_case(self):
        (self.other / '原文.md').write_text('https://example.com/game\n', encoding='utf-8')
        second = self.root / '02_案例/08000_另一作品/其他/nested/link.TXT'
        second.parent.mkdir(parents=True)
        second.write_text('https://example.com/game\n', encoding='utf-8')
        tasks = capture.discover(self.root)
        self.assertEqual(len(tasks), 2)
        self.assertNotEqual(tasks[0]['key'], tasks[1]['key'])
        self.assertEqual(sorted(len(task['sources']) for task in tasks), [1, 2])

    def test_stage_task_keeps_every_candidate_and_recommends_best(self):
        task = capture.discover(self.root)[0]
        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        self.assertEqual(record['status'], 'needs-review')
        self.assertEqual(len(record['candidates']), 3)
        self.assertEqual(len(record['candidatePaths']), 3)
        for candidate in record['candidates']:
            self.assertTrue((self.output / candidate['path']).is_file())
            self.assertEqual(capture.validator.sha256(self.output / candidate['path']), candidate['sha256'])
        best = max(record['candidates'], key=lambda item: item['contentScore'])
        self.assertEqual(record['recommendedPath'], best['path'])
        self.assertEqual(record['captureKind'], 'page-interactive')
        index = json.loads((self.output / f"{task['key']}-candidates.json").read_text(encoding='utf-8'))
        self.assertEqual(len(index['candidates']), 3)
        self.assertIsNone(record['screenshotPath'])

    def test_identical_candidates_are_deduped(self):
        task = capture.discover(self.root)[0]

        def repeated(task, binary, out_dir, timeout, limit=6, video_frames=4):
            out_dir = Path(out_dir)
            busy_picture().save(out_dir / 'candidate-00.png')
            busy_picture().save(out_dir / 'candidate-01.png')
            return [{'kind': 'page-first', 'note': 'a', 'seconds': None, 'title': 'T', 'width': 400, 'height': 300,
                     'flags': [], 'contentScore': 0.5, 'file': 'candidate-00.png'},
                    {'kind': 'page-settled', 'note': 'b', 'seconds': None, 'title': 'T', 'width': 400, 'height': 300,
                     'flags': [], 'contentScore': 0.6, 'file': 'candidate-01.png'}]

        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, repeated)
        self.assertEqual(len(record['candidates']), 1)
        self.assertEqual(len(list(self.output.glob('*.png'))), 1)

    def test_activity_and_source_bytes_untouched(self):
        before = self.snapshot()
        task = capture.discover(self.root)[0]
        capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        self.assertEqual(before, self.snapshot())

    def test_failed_refresh_keeps_previous_candidates(self):
        task = capture.discover(self.root)[0]
        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        keep = {candidate['path']: (self.output / candidate['path']).read_bytes() for candidate in record['candidates']}

        def failure(*arguments):
            raise TimeoutError('test timeout')

        failed = capture.stage_task(task, 'unused', self.output, 1, 6, 4, failure)
        self.assertEqual(failed['status'], 'failed')
        for name, content in keep.items():
            self.assertEqual((self.output / name).read_bytes(), content)

    def test_rerun_reuses_content_addressed_names(self):
        task = capture.discover(self.root)[0]
        first = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        second = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        self.assertEqual([item['path'] for item in first['candidates']], [item['path'] for item in second['candidates']])
        self.assertEqual(len(list(self.output.glob('*.png'))), 3)

    def test_reuse_requires_matching_source_and_candidate_bytes(self):
        task = capture.discover(self.root)[0]
        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        self.assertTrue(capture.reusable(record, task, self.output))
        self.source.write_text('changed https://example.com/game', encoding='utf-8')
        self.assertFalse(capture.reusable(record, capture.discover(self.root)[0], self.output))
        (self.output / record['candidates'][0]['path']).write_bytes(b'edited')
        self.assertFalse(capture.reusable(record, task, self.output))

    def test_altered_candidate_is_never_overwritten(self):
        task = capture.discover(self.root)[0]
        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        target = self.output / record['candidates'][1]['path']
        target.write_bytes(b'manual edit')
        rerun = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        self.assertEqual(rerun['status'], 'failed')
        self.assertEqual(target.read_bytes(), b'manual edit')

    def test_output_inside_activity_rejected(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            capture.main([str(self.root), '--output', str(self.root / '其他')])

    def test_dry_run_has_no_browser_network_or_writes(self):
        before = self.snapshot()
        with patch.object(capture, 'chrome_binary', side_effect=AssertionError('browser discovery')), contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(capture.main([str(self.root), '--dry-run']), 0)
        self.assertEqual(len(json.loads(stream.getvalue())['tasks']), 1)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(set(self.parent.iterdir()), {self.root, self.output})

    def test_checkpoint_resume_avoids_browser(self):
        task = capture.discover(self.root)[0]
        record = capture.stage_task(task, 'unused', self.output, 1, 6, 4, self.fake_capture)
        capture.write_checkpoint(self.output / 'capture-review.json', {'version': 2, 'activity': str(self.root), 'results': [record]})
        with patch.object(capture, 'chrome_binary', side_effect=AssertionError('should reuse')), contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(capture.main([str(self.root), '--output', str(self.output)]), 0)
        self.assertEqual(json.loads(stream.getvalue())['attempted'], 0)

    def test_content_score_prefers_rich_frame_over_title_card(self):
        rich = self.output / 'rich.png'
        plain = self.output / 'plain.png'
        blank = self.output / 'blank.png'
        busy_picture().save(rich)
        title_card().save(plain)
        Image.new('RGB', (400, 300), 'white').save(blank)
        self.assertGreater(capture.content_score(rich, '游戏界面 得分 关卡'), capture.content_score(plain, '点击开始'))
        self.assertGreater(capture.content_score(plain, '点击开始'), capture.content_score(blank, ''))

    def test_loading_and_uniform_frames_flagged(self):
        path = self.output / 'white.png'
        Image.new('RGB', (400, 300), 'white').save(path)
        size, flags = capture.quality_flags(path, text='加载中…')
        self.assertEqual(size, (400, 300))
        self.assertIn('near-uniform-image', flags)
        self.assertIn('possible-loading-screen', flags)

    def test_symlink_document_is_not_scanned(self):
        external = self.parent / 'external.txt'
        external.write_text('https://example.com/external', encoding='utf-8')
        (self.other / 'external.txt').symlink_to(external)
        self.assertEqual([task['url'] for task in capture.discover(self.root)], ['https://example.com/game'])


@unittest.skipUnless(os.environ.get('RUN_BROWSER_TESTS') == '1', 'set RUN_BROWSER_TESTS=1 for real Chromium tests')
class BrowserCaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *arguments):
                pass

            def do_GET(self):
                if self.path == '/poster.png':
                    stream = io.BytesIO()
                    busy_picture((640, 360)).save(stream, format='PNG')
                    self.send_response(200)
                    self.send_header('Content-Type', 'image/png')
                    self.end_headers()
                    self.wfile.write(stream.getvalue())
                    return
                pages = {
                    '/game': '<title>Game fixture</title><p>点击开始</p><button onclick="start()">开始游戏</button>'
                             '<script>function start(){const c=document.createElement("canvas");c.width=900;c.height=600;'
                             'const x=c.getContext("2d");for(let i=0;i<40;i++){x.fillStyle=`hsl(${i*9},70%,50%)`;'
                             'x.fillRect(i*18,i*8,60,300);}document.body.appendChild(c);}</script>',
                    '/loading': '<title>Game</title><p>加载中…</p>',
                    '/error': '<title>404 Error</title><h1>Not Found</h1>',
                    '/video': '<title>Video fixture</title><video width="640" height="360" poster="/poster.png" controls></video>',
                }
                self.send_response(404 if self.path == '/error' else 200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(pages.get(self.path, '').encode('utf-8'))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.binary = capture.chrome_binary()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def run_page(self, route):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        url = f'http://127.0.0.1:{self.server.server_port}{route}'
        task = {'key': capture.task_key('case', url), 'casePath': 'case', 'url': url, 'videoHint': route == '/video'}
        record = capture.stage_task(task, self.binary, Path(temporary.name), 20, 6, 3)
        if os.environ.get('BROWSER_ARTIFACTS'):
            output = Path(os.environ['BROWSER_ARTIFACTS'])
            output.mkdir(parents=True, exist_ok=True)
            for candidate in record.get('candidates', []):
                shutil.copyfile(Path(temporary.name) / candidate['path'],
                                output / f"{route[1:]}-{candidate['kind']}-{candidate['contentScore']}.png")
        return record

    def test_real_page_samples_several_moments(self):
        record = self.run_page('/game')
        self.assertEqual(record['status'], 'needs-review')
        kinds = {candidate['kind'] for candidate in record['candidates']}
        self.assertIn('page-first', kinds)
        self.assertGreaterEqual(len(record['candidates']), 2)
        self.assertTrue(all(candidate['width'] >= 200 for candidate in record['candidates']))

    def test_loading_page_flags_and_no_capture_claim(self):
        record = self.run_page('/loading')
        flagged = [candidate for candidate in record['candidates'] if 'possible-loading-screen' in candidate['flags']]
        self.assertTrue(flagged)
        self.assertIsNone(record['screenshotPath'])

    def test_error_page_flagged(self):
        record = self.run_page('/error')
        flags = {flag for candidate in record['candidates'] for flag in candidate['flags']}
        self.assertIn('http-error-404', flags)
        self.assertIn('possible-error-or-verification', flags)

    def test_video_link_samples_timeline(self):
        record = self.run_page('/video')
        kinds = {candidate['kind'] for candidate in record['candidates']}
        kinds |= {kind for candidate in record['candidates'] for kind in candidate.get('duplicateKinds', [])}
        self.assertTrue({'video-poster', 'video-frame'} & kinds, kinds)


if __name__ == '__main__':
    unittest.main()
