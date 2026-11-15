import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEvent } from '../src/lib/renderEvent.js';
import { eventPresentation, downloadItems } from '../src/lib/eventPresentation.js';

test('archive image groups and work videos survive rendering alongside legacy works', () => {
  const paths = ['02_案例/旧图.jpg', '02_案例/09000_作品/截图/主图.jpg', '02_案例/09000_作品/截图/细节.jpg', '02_案例/09000_作品/视频/宣传片.mp4', '02_案例/09000_作品/视频/宣传片.poster.jpg'];
  const source = { record: { id: 'test', title: '活动', date: '2026-11-14', cases: [{path: paths[0], name: '旧图.jpg'}], videos: [], presentation: { resources: [{ title: '课件', href: 'https://example.test/deck.pdf', downloadable: true }] } },
    assets: paths.map((path, i) => ({path, name: path.split('/').at(-1), url: `https://example.test/${i}`})),
    cases: [{folder: '09000_作品', title: '作品', path: paths[1], imagePaths: [paths[1], paths[2], 'missing.jpg'], videos: [{ path: paths[3], posterPath: paths[4], title: '宣传片' }] }] };
  const before = JSON.stringify(source), view = eventPresentation(renderEvent(source));
  assert.deepEqual(view.groups.map(g => g.slides.length), [2, 1]);
  assert.equal(view.sceneVideos.length, 0);
  assert.equal(view.workVideos.length, 1);
  assert.equal(view.workVideos[0].poster, 'https://example.test/4');
  assert.equal(view.resources[0].title, '课件');
  assert.equal(downloadItems(view).length, 5);
  assert.equal(JSON.stringify(source), before);
});

test('the case archive lists a group once and retains every image for its viewer', async () => {
  const { buildCaseItems } = await import('../src/lib/caseArchive.js');
  const items = buildCaseItems([{uid:'event', detail:{ productionGallery:[
    {id:'one',caseId:'a',title:'组图',image:'/one.jpg'},
    {id:'two',caseId:'a',title:'组图',image:'/two.jpg'},
    {id:'three',caseId:'b',title:'同名不同作品',image:'/two.jpg'}
  ]}}]);
  assert.equal(items.length,2);
  assert.deepEqual(items[0].slides.map(s=>s.image), ['/one.jpg','/two.jpg']);
});
