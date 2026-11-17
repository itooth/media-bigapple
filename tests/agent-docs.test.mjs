import test from 'node:test';
import assert from 'node:assert/strict';
import { injectAgentHtml, parseCaption, renderCasesDoc, renderEventDoc, renderIndex, searchArchive, PAGE_SIZE } from '../server/agent-docs.mjs';

const hash = 'a'.repeat(64);
const url = (h) => `https://media.bigapple.app/x/media/${h}/${h}.jpg`;
const event = {
  id: 'e1', uid: '2026-11-11_活动', slug: '2026-11-11', partner: '黑客松培训', sourceDate: '2026-11-11', description: '课堂与作品。', image: url(hash), tags: ['高校'],
  detail: {
    title: '黑客松培训', city: '肇庆', highlights: [{ image: url(hash), caption: '首页_封面_活动_教室分组实操全景_45275dbd04' }],
    gallery: Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({ image: url(String(i).padStart(64, 'b')), caption: `活动照片_IMG_${i}` })),
    productions: [{ image: url('c'.repeat(64)), title: '你先别跑', caption: '你先别跑', href: 'https://example.com/game' }],
    media: [{ type: 'news', label: '公众号报道', href: 'https://mp.weixin.qq.com/s/x' }],
  },
};
const notes = { [hash]: { description: '约三十名学生分组围坐操作电脑', tags: ['分组讨论', '适合封面'] } };
const origin = 'https://media.bigapple.work';

test('captions drop file-name noise but keep flags and words', () => {
  assert.deepEqual(parseCaption('首页_封面_活动_教室分组实操全景_45275dbd04'), { home: true, cover: true, category: '活动', description: '教室分组实操全景' });
  assert.equal(parseCaption('活动照片_IMG_6851').description, '活动照片');
  assert.equal(parseCaption('10000_主图_金库派对对局_ec21d50a67').description, '金库派对对局');
});

test('index lists every event with its document link', () => {
  const text = renderIndex([event], origin, notes);
  assert.match(text, /共 1 场/);
  assert.ok(text.includes(`${origin}/agent/events/2026-11-11.md`));
  assert.match(text, /照片 203 · 作品 1 · 视频 0 · 报道 1/);
});

test('event document carries notes, work links and paginates large galleries', () => {
  const first = renderEventDoc(event, origin, notes, 1);
  assert.ok(first.includes('看图：约三十名学生分组围坐操作电脑；标签：分组讨论、适合封面'));
  assert.ok(first.includes('作品地址：https://example.com/game'));
  assert.ok(first.includes(`第 1/2 页`) && first.includes('?page=2'));
  const second = renderEventDoc(event, origin, notes, 2);
  assert.ok(second.includes(`${PAGE_SIZE + 1}. `) && !second.includes('## 作品'));
  assert.equal(renderEventDoc(event, origin, notes, 3), null);
  assert.equal(renderEventDoc(event, origin, notes, Number('x')), null);
});

test('search matches image notes and requires every term', () => {
  const found = searchArchive([event], origin, '分组 封面', notes);
  assert.equal(found.images[0].url, url(hash));
  assert.equal(searchArchive([event], origin, '分组 不存在的词', notes).images.length, 0);
  assert.equal(searchArchive([event], origin, '黑客松', notes).events[0].doc, `${origin}/agent/events/2026-11-11.md`);
});

test('search returns whole cases with fuzzy and pinyin matching, and cases.md lists every case', () => {
  const withCase = { ...event, detail: { ...event.detail, productionGallery: [
    { id: 'g1', caseId: 'k1', title: '光明地标大富翁', image: url('d'.repeat(64)), href: 'https://example.com/dfw', readme: '## 案例简介\n地标棋盘游戏' },
    { id: 'g2', caseId: 'k1', title: '光明地标大富翁', image: url('e'.repeat(64)) },
  ] } };
  for (const q of ['光明大富', 'dafuweng', 'gmdfw']) {
    const found = searchArchive([withCase], origin, q, notes);
    assert.equal(found.cases.length, 1, q);
    assert.deepEqual({ ...found.cases[0], images: found.cases[0].images.length }, {
      title: '光明地标大富翁', description: '地标棋盘游戏', href: 'https://example.com/dfw', image: url('d'.repeat(64)), images: 2,
      video: '', videoPoster: '', event: '2026-11-11', eventTitle: '黑客松培训', eventDate: '2026-11-11', eventCity: '肇庆', tags: ['高校'],
      page: `${origin}/events/2026-11-11`, doc: `${origin}/agent/events/2026-11-11.md`,
    });
  }
  const doc = renderCasesDoc([withCase], origin);
  assert.match(doc, /共 1 个案例/);
  assert.ok(doc.includes('- 《光明地标大富翁》：地标棋盘游戏。网址：https://example.com/dfw'));
  assert.ok(renderIndex([withCase], origin).includes(`${origin}/agent/cases.md`));
});

test('page html gets an escaped agent index inside the React root', () => {
  const html = injectAgentHtml('<head></head><div id="app"></div>', [{ ...event, partner: '<b>x</b>' }], origin, '/');
  assert.ok(html.includes('rel="alternate"') && html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));
  assert.ok(injectAgentHtml('<div id="app"></div>', [event], origin, '/events/2026-11-11').includes('/agent/events/2026-11-11.md'));
});

test('server exposes llms.txt, event documents, search and the injected page', async (t) => {
  const { default: fs } = await import('node:fs'); const { default: os } = await import('node:os'); const { default: path } = await import('node:path');
  const { once } = await import('node:events'); const { createApplication } = await import('../server/app.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-agent-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body><div id="app"></div></body></html>');
  const server = createApplication({ events: [{ id: 'a', uid: 'activity-a', partner: '活动甲', sourceDate: '2026-09-01', detail: { gallery: [] } }], dataDir: dir, distDir: dir, adminPassword: 'test-only-private-password' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(`${base}/llms.txt`);
  assert.equal(index.headers.get('content-type'), 'text/plain; charset=utf-8');
  const link = (await index.text()).match(/\((http[^)]+\.md)\)/)[1];
  assert.ok(link.startsWith(base));
  const doc = await fetch(link);
  assert.equal(doc.status, 200); assert.match(await doc.text(), /^# 活动甲/);
  assert.equal((await fetch(`${base}/agent/events/missing.md`)).status, 404);
  assert.equal((await fetch(`${link}?page=9`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/agent/search?q=${encodeURIComponent('活动甲')}`)).json()).events.length, 1);
  assert.match(await (await fetch(`${base}/`)).text(), /<div id="app"><div class="agent-index"/);
  const cases = await fetch(`${base}/agent/cases.md`);
  assert.equal(cases.status, 200); assert.match(await cases.text(), /^# BigApple Events 全部案例/);
  assert.deepEqual((await (await fetch(`${base}/api/agent/search?q=x`)).json()).cases, []);
});
