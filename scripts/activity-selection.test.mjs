import assert from 'node:assert/strict';
import { parseMediaName, categoryOfPath, isImageName } from '../src/lib/mediaNaming.js';
import { selectActivityPhotos } from '../src/lib/activitySelection.js';

/* ---------------------------------------------------------------- 名字解析 */

// 评分：必须是开头连续五位数字
assert.equal(parseMediaName({ name: '10000_封面_海报_x.jpg' }).rating, '10000');
assert.equal(parseMediaName({ name: '首页 (2).jpg' }).rating, '00000');
assert.equal(parseMediaName({ name: '09880_大合照_x.jpg' }).rating, '09880');

// 「封面」标记：下划线、空格、短横线三种写法都要认
for (const name of ['10050 封面 合照.jpg', '10050封面活动.jpg', '10050_封面-合照.jpg', '10050_封面 大合照_x.jpg']) {
  assert.equal(parseMediaName({ name, category: '活动' }).isCover, 1, `应为封面: ${name}`);
}

// 「首页」标记
for (const name of ['09900_首页_互动.jpg', '09880 首页 活动照片_IMG_2195.jpg', '首页.jpg']) {
  assert.equal(parseMediaName({ name, category: '活动' }).onHomePage, 1, `应进首页: ${name}`);
}

// 案例里的「封面」是案例自己的封面，不算活动封面
const caseCover = parseMediaName({ name: '08750_封面_PawMatch.jpg', category: '案例' });
assert.equal(caseCover.isCover, 0);
assert.equal(caseCover.categoryText, '封面');

// 细分类必须落在词表里，落不进去记「其他」
assert.equal(parseMediaName({ name: '09580_人物_参与者微笑.jpg', category: '活动' }).categoryText, '人物');
assert.equal(parseMediaName({ name: '09350_活动照片_微信图片_x.jpg', category: '活动' }).categoryText, '其他');
assert.equal(parseMediaName({ name: '08760_作品界面_PawMatch_05.jpg', category: '案例' }).categoryText, '作品界面');

// 描述：拼接剩余段；空了退到目录名，再退到文件名
assert.equal(parseMediaName({ name: '07486_演讲_活动现场记录_IMG_4580.jpg', category: '活动' }).description, '活动现场记录_IMG_4580');
assert.equal(parseMediaName({ name: '主图.jpg', path: '02_案例/08640_AI宠写真/截图/主图.jpg', category: '案例' }).description, '08640_AI宠写真');

// 分类由第一层目录决定，「待确认_案例素材」要落到案例
assert.equal(categoryOfPath('01_活动照片/a.jpg'), '活动');
assert.equal(categoryOfPath('02_案例/x/a.jpg'), '案例');
assert.equal(categoryOfPath('02_案例_旧镜像_2026/x.jpg'), '案例');
assert.equal(categoryOfPath('03_社交媒体/a.jpg'), '社交媒体');
assert.equal(categoryOfPath('待确认_案例素材/a.jpg'), '案例');
assert.equal(categoryOfPath('随便/a.jpg'), null);

// 图片判定：mp4 不算图片
assert.equal(isImageName('a.JPG'), true);
assert.equal(isImageName('a.mp4'), false);

/* ------------------------------------------------------------------ 选图 */

const activity = (name, extra = {}) => ({
  activityId: '01-1',
  path: `01_活动照片/${name}`,
  name,
  category: '活动',
  categoryText: '其他',
  rating: parseMediaName({ name, category: '活动' }).rating,
  description: '',
  isCover: 0,
  onHomePage: 0,
  url: 'https://example.test/x.jpg',
  hash: 'x',
  originBytes: 1,
  cloudBytes: 1,
  ...extra,
});

const marked = (name) => {
  const parsed = parseMediaName({ name, category: '活动' });
  return activity(name, { isCover: parsed.isCover, onHomePage: parsed.onHomePage });
};

const lawyers = ['首页.jpg', '首页 (2).jpg', '09900_首页_互动.jpg', '09800_现场.jpg'].map(marked);
assert.equal(selectActivityPhotos(lawyers).highlights.length, 3);

const photos = ['10000_首页_海报.jpg', '09900_封面_合照.jpg', '09800 首页人物.jpg', '09700 普通.jpg'].map(marked);
const selected = selectActivityPhotos(photos);
assert.equal(selected.cover.name, photos[1].name);
assert.deepEqual(selected.highlights.map((a) => a.name), [photos[1].name, photos[0].name, photos[2].name]);
assert.equal(selected.sorted[0].name, photos[0].name);

// 一张活动同时有 10050 和 10000 两个封面时，取评分高的那个（与改造前一致）
const twoCovers = ['10050 封面 活动照片_a.jpg', '10000_封面_海报_b.jpg'].map(marked);
assert.equal(selectActivityPhotos(twoCovers).cover.name, '10050 封面 活动照片_a.jpg');

const agent = ['10050_封面_海报_短图.jpg', '10000__海报_长图.jpg', '09300_首页_互动.jpg'].map(marked);
assert.equal(selectActivityPhotos(agent).highlights.length, 2);
assert.equal(selectActivityPhotos(agent).cover.name, agent[0].name);

assert.equal(selectActivityPhotos([marked('09900_首页_互动.jpg'), marked('09800_现场.jpg')]).cover.name, '09900_首页_互动.jpg');
// 视频不参与选图
assert.equal(selectActivityPhotos([activity('10050_封面_视频.mp4', { category: '活动', isCover: 1 })]).highlights.length, 0);
assert.equal(selectActivityPhotos([marked('09900_首页_IMG_1.jpg'), marked('09800_首页_IMG_2.jpg')]).highlights.length, 2);
// 案例图不参与活动选图
assert.equal(selectActivityPhotos([{ ...activity('封面_图.jpg'), category: '案例', path: '02_案例/封面_图.jpg' }]).sorted.length, 0);

console.log('媒体命名 + 选图回归检查通过。');
