import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseItems, caseDescription, caseSearchText, eventSearchText, matchesTokens, tokenizeQuery } from '../src/lib/caseArchive.js';
import { groupCases } from '../src/lib/archive.js';
import { parseRoute } from '../src/lib/routes.js';

const events = [
  {
    id: '09-12-hackathon-weekly-family',
    uid: '2026-09-12_周周黑客松亲子活动',
    partner: '周周黑客松亲子活动',
    description: '家长与小朋友一起用AI做作品。',
    sourceDate: '2026-09-12',
    tags: ['亲子'],
    detail: {
      city: '中国深圳',
      productionGallery: [
        { id: 'c1', title: '方块派对', image: '/local/a.jpg', href: 'https://block-party-3d.bigapple.work/', readme: '## 案例简介\n3D 方块游戏', position: 0 },
        { id: 'c2', title: '捕鱼大师', image: '/local/b.jpg', href: '', readme: '## 案例简介\n像素捕鱼', position: 1 },
        { id: 'c3', title: '无封面案例', image: '', href: '', readme: '', position: 2 },
      ],
    },
  },
  {
    id: '08-29-winflow-21',
    uid: '2026-08-29_Winflow第十期工作坊',
    partner: 'Winflow第十期工作坊',
    description: '工作坊现场。',
    sourceDate: '2026-08-29',
    tags: ['行业共创'],
    detail: {
      city: '中国深圳',
      productionGallery: [
        { id: 'd1', title: '中秋燕窝海报', image: '/local/c.jpg', href: '', readme: '', position: 0 },
      ],
    },
  },
];

test('buildCaseItems 摊平案例，跳过没封面的条目，并按活动日期倒序', () => {
  const cases = buildCaseItems(events);
  assert.equal(cases.length, 3);
  assert.deepEqual(cases.map((item) => item.title), ['方块派对', '捕鱼大师', '中秋燕窝海报']);
  assert.equal(cases[0].eventTitle, '周周黑客松亲子活动');
  assert.equal(cases[0].eventDate, '2026-09-12');
  assert.equal(cases[0].href, 'https://block-party-3d.bigapple.work/');
  assert.equal(cases[0].tags[0], '亲子');
});

test('groupCases 按活动月份分组，月份倒序', () => {
  const months = groupCases(buildCaseItems(events));
  assert.deepEqual(months.map((month) => month.label), ['2026年9月', '2026年8月']);
  assert.equal(months[0].events.length, 2);
  assert.equal(months[1].events.length, 1);
});

test('搜索：多关键词全部命中、大小写不敏感', () => {
  const item = buildCaseItems(events)[0];
  const text = caseSearchText(item);
  assert.deepEqual(tokenizeQuery('  方块   亲子 '), ['方块', '亲子']);
  assert.equal(matchesTokens(text, tokenizeQuery('方块 亲子')), true);
  assert.equal(matchesTokens(text, tokenizeQuery('方块 不存在')), false);
  assert.equal(matchesTokens(text, tokenizeQuery('BLOCK-PARTY')), true);
  assert.equal(matchesTokens(text, []), true);
});

test('案例搜索覆盖：案例名 / 所属活动 / 说明 / 链接 / 月份', () => {
  const [party, fishing] = buildCaseItems(events);
  assert.match(caseSearchText(party), /方块派对/);
  assert.match(caseSearchText(party), /周周黑客松亲子活动/);
  assert.match(caseSearchText(party), /3D 方块游戏/);
  assert.match(caseSearchText(party), /block-party-3d\.bigapple\.work/);
  assert.match(caseSearchText(party), /2026年9月/);
  assert.match(caseSearchText(fishing), /像素捕鱼/);
});

test('案例描述：优先用独立 description，没有就从说明.md 提取简介', () => {
  assert.equal(caseDescription({ title: '案例A', description: ' 一句自带描述。 ' }), '一句自带描述。');
  assert.equal(caseDescription({
    title: '案例B',
    readme: '# 案例名称\n\n案例B\n\n## 案例简介\n\n面向亲子的小游戏。\n\n## 案例网址\n\nhttps://example.com',
  }), '面向亲子的小游戏。');
  // 简介里重复了案例名时去掉前缀
  assert.equal(caseDescription({
    title: '案例C',
    description: '案例C：帮助整理资料。',
  }), '帮助整理资料。');
  // 没有 description / readme 时返回空，卡片只显示所属活动
  assert.equal(caseDescription({ title: '案例D' }), '');
  // 控制字符（文件名里常见的 \b）不影响显示
  assert.equal(caseDescription({ title: '案例E', description: '森林\x08赛车' }), '森林 赛车');
});

test('buildCaseItems 带上案例描述，并进入搜索范围', () => {
  const cases = buildCaseItems(events);
  assert.equal(cases[0].description, '3D 方块游戏');
  assert.equal(cases[2].description, '');
  assert.match(caseSearchText(cases[0]), /3D 方块游戏/);
});

test('活动搜索也覆盖案例名', () => {
  const titles = (events[0].detail.productionGallery || []).map((item) => item.title);
  const text = eventSearchText(events[0], titles);
  assert.match(text, /周周黑客松亲子活动/);
  assert.match(text, /方块派对/);
  assert.match(text, /亲子/);
  assert.match(text, /中国深圳/);
});

test('/cases 与 /cases/filter/:tag 路由', () => {
  assert.equal(parseRoute('/cases').page, 'cases');
  const filtered = parseRoute('/cases/filter/%E4%BA%B2%E5%AD%90');
  assert.equal(filtered.page, 'cases');
  assert.equal(filtered.tag, '亲子');
  assert.equal(parseRoute('/123/cases').tenant, '123');
  assert.equal(parseRoute('/123/cases').page, 'cases');
});
