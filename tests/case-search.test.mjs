import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseItems } from '../src/lib/caseArchive.js';
import { createCaseSearch } from '../src/lib/caseSearch.js';
import { catalogEvent } from '../server/public-events.mjs';

const event = (uid, date, gallery, videos = []) => ({ uid, id: uid, slug: uid, partner: `活动${uid}`, sourceDate: date, tags: ['亲子'],
  detail: { city: '深圳', productionGallery: gallery, productionVideos: videos } });
const events = [
  event('a', '2026-10-01', [
    { id: 'a1', caseId: 'c1', title: '光明地标大富翁', image: '/a1.jpg', readme: '## 案例简介\n带孩子认识光明的地标', position: 0 },
    { id: 'a2', caseId: 'c2', title: '光明探索大转盘', image: '/a2.jpg', position: 1 },
    { id: 'a3', caseId: 'c3', title: 'AI宠写真', image: '/a3.jpg', href: 'https://pet.example.com', position: 2 },
  ]),
  event('b', '2026-09-01', [{ id: 'b1', caseId: 'd1', title: 'PawMatch', image: '/b1.jpg', position: 0 }],
    [{ id: 'v1', caseId: 'd2', caseTitle: '雨靴广告', title: '雨靴广告 成片', src: '/v.mp4', poster: '/p.jpg' },
     { id: 'v2', caseId: 'd1', caseTitle: 'PawMatch', title: 'PawMatch 演示', src: '/v2.mp4', poster: '/p2.jpg' }]),
].map(catalogEvent);
const items = buildCaseItems(events);
const search = createCaseSearch(items);
const titles = (q) => search(q).map((item) => item.title);

test('只有视频的案例也进案例列表，有截图的案例不重复', () => {
  assert.deepEqual(items.map((item) => item.title), ['光明地标大富翁', '光明探索大转盘', 'AI宠写真', 'PawMatch', '雨靴广告']);
  const rain = items.find((item) => item.title === '雨靴广告');
  assert.equal(rain.image, '/p.jpg');
  assert.equal(rain.video.src, '/v.mp4');
  assert.equal(rain.eventSlug, 'b');
});

test('漏字、词序乱也能搜到案例名称，最像的排第一', () => {
  assert.equal(titles('光明大富')[0], '光明地标大富翁');
  assert.equal(titles('富翁大')[0], '光明地标大富翁');
  assert.deepEqual(titles('宠物写真'), ['AI宠写真']);
  assert.equal(titles('pawmach')[0], 'PawMatch');
  assert.deepEqual(titles('不存在的东西'), []);
});

test('全拼和首字母都能搜到', () => {
  assert.deepEqual(titles('dafuweng'), ['光明地标大富翁']);
  assert.deepEqual(titles('gmdfw'), ['光明地标大富翁']);
  assert.deepEqual(titles('yuxue'), ['雨靴广告']);
});

test('原来的全文搜索照旧：简介、网址、活动名都能命中，每个词都要出现', () => {
  assert.deepEqual(titles('认识 地标'), ['光明地标大富翁']);
  assert.deepEqual(titles('pet.example.com'), ['AI宠写真']);
  assert.equal(titles('活动b').length, 2);
  assert.equal(search('').length, items.length);
});
