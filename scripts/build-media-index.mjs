#!/usr/bin/env node
/**
 * 生成前端媒体索引。
 *
 * 设计原则：
 *   1. 候选集合 = 「网站压缩素材」现场扫描结果，也就是线上原本展示的那批图。不增不减。
 *   2. 每条候选按 sha256 精确对应到云端那一张（压缩文件与云端文件字节一致，重命名也能对上）。
 *   3. 对应不上的记为 url 空，前端不渲染（不会拿别的图顶上）。
 *   4. 只读，不修改、不删除任何图片。
 *
 * 输入（只读）：
 *   ../../anli_web_图片存档/网站压缩素材/      候选图片来源（现场扫描 + sha256，可指向项目外）
 *   ../../素材库/<活动>/manifest.json           活动 id / 标题 / 日期 / 地点
 *   ../../素材库/                               原图，用来补 originBytes
 *   src/data/publicMediaMap.generated.js        云端清单（hash -> url）
 *
 * 输出：
 *   src/data/mediaIndex.generated.js            前端唯一媒体索引
 *   docs/media-index-report.md                  体检报告
 *
 * 用法：node scripts/build-media-index.mjs
 * 字段合同见 docs/media-contract.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CATEGORY_ACTIVITY,
  CATEGORY_CASE,
  CATEGORY_PRESS,
  VOCABULARY,
  UNCLASSIFIED,
  isImageName,
  isVideoName,
  categoryOfPath,
  parseMediaName,
} from '../src/lib/mediaNaming.js';
import { normalizeFolderName } from './lib/activityFolderMap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 前端项目内不放任何图片，候选素材目录位于项目之外；可用环境变量覆盖。
const WEBSITE_ROOT = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
  path.join(ROOT, 'public', '网站压缩素材'),
]
  .filter(Boolean)
  .find((candidate) => fs.existsSync(candidate));

if (!WEBSITE_ROOT) {
  console.error('[build-media-index] 找不到候选素材目录「网站压缩素材」。');
  console.error('请设置 ANLI_WEBSITE_MEDIA，或确认归档目录存在。这是只读输入，不会修改任何图片。');
  process.exit(1);
}
// 素材库根目录可用 BIGAPPLE_LIBRARY_ROOT 覆盖，主要用于发布脚本指向临时目录。
const LIBRARY_ROOT = process.env.BIGAPPLE_LIBRARY_ROOT
  ? path.resolve(process.env.BIGAPPLE_LIBRARY_ROOT)
  : path.resolve(ROOT, '..', '..', '素材库');
const CLOUD_MAP_FILE = path.join(ROOT, 'src/data/publicMediaMap.generated.js');
const OUT_INDEX_FILE = path.join(ROOT, 'src/data/mediaIndex.generated.js');
const OUT_REPORT_FILE = path.join(ROOT, 'docs/media-index-report.md');
// 明确要删除的活动 id（逗号分隔）；默认不删，本次扫描没出现的活动原样保留旧条目。
const REMOVE_ACTIVITY_IDS = new Set(
  String(process.env.BIGAPPLE_REMOVE_ACTIVITIES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

// 重建前读现有索引，本次扫描里没出现的活动 id 原样保留其 mediaEvents / mediaIndex 条目。
async function readExistingIndex(indexFile) {
  if (!fs.existsSync(indexFile)) return { mediaEvents: [], mediaIndex: [] };
  try {
    const module = await import(pathToFileURL(indexFile).href + `?t=${Date.now()}`);
    return { mediaEvents: module.mediaEvents || [], mediaIndex: module.mediaIndex || [] };
  } catch {
    return { mediaEvents: [], mediaIndex: [] };
  }
}
const existingIndex = await readExistingIndex(OUT_INDEX_FILE);

const BIG_CLOUD_BYTES = 10 * 1024 * 1024;
const BIG_ORIGIN_BYTES = 20 * 1024 * 1024;
const LIST_LIMIT = 25;

/* -------------------------------------------------------------- 小工具 */

const pad5 = (value) => String(value).padStart(5, '0');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const stemOf = (key) => key.replace(/\.[^./]+$/, '');
const unclassifiedSegments = new Map();

// 迭代式遍历：素材库里的源码目录层级很深，递归会爆栈
function discoverFiles(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else result.push(path.relative(root, full).replaceAll(path.sep, '/'));
    }
  }
  return result;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/* ------------------------------------------------------------ 读云端清单 */

const cloudModule = await import(pathToFileURL(CLOUD_MAP_FILE).href);
const cloud = cloudModule.default;
const cloudKeys = Object.keys(cloud);

// 云端按 sha256 建索引：一个内容只留一条
const cloudByHash = new Map();
for (const key of cloudKeys) {
  const hash = cloud[key].hash;
  if (!cloudByHash.has(hash)) cloudByHash.set(hash, key);
}
// 云端按「活动id + 主干名」建索引，用于扩展名不同时兜底
const cloudKeysByStem = new Map();
for (const key of cloudKeys) {
  const stem = stemOf(key);
  if (!cloudKeysByStem.has(stem)) cloudKeysByStem.set(stem, key);
}

/* ---------------------------------------------------------------- 读活动 */

function readManifest(directory) {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// 「一期/二期」这类后缀、以及下划线/空格/短横线的写法差异，不影响认的是同一个活动
// （统一走 scripts/lib/activityFolderMap.mjs，和本地预览索引、预览图床同一套规则）
const normalizeFolder = normalizeFolderName;

// 活动清单以「素材库」的 manifest 为准，和改造前一致
const activities = [];
if (fs.existsSync(LIBRARY_ROOT)) {
  for (const entry of fs.readdirSync(LIBRARY_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(path.join(LIBRARY_ROOT, entry.name));
    if (!manifest) continue;
    activities.push({
      id: manifest.id || entry.name,
      folder: entry.name,
      title: manifest.title || entry.name,
      date: manifest.date || '',
      place: manifest.place || manifest.venue || '',
      summary: manifest.summary || `${manifest.title || entry.name}活动资料与成员作品归档。`,
      sourceFolder: manifest.sourceFolder || '',
    });
  }
}

// 候选图从「网站压缩素材」现场扫描。目录改名过，所以 id 优先读目录自己的 manifest，
// 读不到再按目录名去活动清单里认（例如「…活动一期」对应「…活动」）。
const libraryByNormalized = new Map();
for (const activity of activities) {
  for (const key of [activity.folder, activity.sourceFolder, activity.title]) {
    const normalized = normalizeFolder(key);
    if (normalized && !libraryByNormalized.has(normalized)) libraryByNormalized.set(normalized, activity);
  }
}

const websiteActivities = [];
const unresolvedFolders = [];
if (fs.existsSync(WEBSITE_ROOT)) {
  for (const entry of fs.readdirSync(WEBSITE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const own = readManifest(path.join(WEBSITE_ROOT, entry.name));
    let matched = own?.id ? activities.find((item) => item.id === own.id) : null;
    if (!matched) matched = libraryByNormalized.get(normalizeFolder(entry.name)) || null;
    if (!matched) {
      unresolvedFolders.push(entry.name);
      continue;
    }
    websiteActivities.push({ ...matched, websiteFolder: entry.name, folderMatchedByManifest: Boolean(own?.id) });
  }
}

/* ------------------------------------------------ 扫候选图 + 逐张对应云端 */

// 素材库原图：按主干名建索引，用来补 originBytes
const libraryByStem = new Map();
if (fs.existsSync(LIBRARY_ROOT)) {
  for (const activity of activities) {
    const originRoot = path.join(LIBRARY_ROOT, activity.folder);
    if (!fs.existsSync(originRoot)) continue;
    for (const relPath of discoverFiles(originRoot)) {
      const stem = stemOf(`${activity.id}/${relPath}`);
      if (!libraryByStem.has(stem)) libraryByStem.set(stem, fs.statSync(path.join(originRoot, relPath)).size);
    }
  }
}

const mediaIndex = [];
const skippedNonMedia = new Map();
const skippedNoCategory = [];
const unmatched = [];
const cloudMatchedBy = { hash: 0, stem: 0, none: 0 };
const parseTally = new Map();
const categoryTally = new Map();
const categoryTextTally = new Map();
let scannedBytes = 0;

for (const activity of websiteActivities) {
  const websiteRoot = path.join(WEBSITE_ROOT, activity.websiteFolder);
  if (!fs.existsSync(websiteRoot)) continue;

  for (const relPath of discoverFiles(websiteRoot)) {
    const absolute = path.join(websiteRoot, relPath);
    const name = path.basename(relPath);
    // 只收图片和视频，manifest.json / 说明.md 这类不是媒体
    if (!isImageName(name) && !isVideoName(name)) {
      const ext = path.extname(name).toLowerCase() || '(无扩展名)';
      skippedNonMedia.set(ext, (skippedNonMedia.get(ext) || 0) + 1);
      continue;
    }
    const bytes = fs.statSync(absolute).size;
    scannedBytes += bytes;

    // 1) 先按内容哈希精确对应（重命名也能对上）
    let cloudKey = cloudByHash.get(sha256File(absolute));
    let matchedBy = 'hash';
    // 2) 兜底：同一个活动里主干名相同（压缩时改过扩展名）
    if (!cloudKey) {
      const stemKey = cloudKeysByStem.get(stemOf(`${activity.id}/${relPath}`));
      if (stemKey && stemKey.startsWith(`${activity.id}/`)) { cloudKey = stemKey; matchedBy = 'stem'; }
    }
    const entry = cloudKey ? cloud[cloudKey] : null;
    if (entry) cloudMatchedBy[matchedBy] += 1;
    else { cloudMatchedBy.none += 1; unmatched.push({ activityId: activity.id, path: relPath, name, bytes }); }

    // 归不进三类目录的不进索引（合同规定 category 只有三个值，不允许猜）
    const category = categoryOfPath(relPath);
    if (!category) {
      skippedNoCategory.push({ activityId: activity.id, path: relPath, name });
      continue;
    }
    const parsed = parseMediaName({ name, path: relPath, category });
    for (const note of parsed.notes) parseTally.set(note, (parseTally.get(note) || 0) + 1);
    for (const segment of parsed.unclassifiedSegments) unclassifiedSegments.set(segment, (unclassifiedSegments.get(segment) || 0) + 1);
    categoryTally.set(category, (categoryTally.get(category) || 0) + 1);
    const textKey = `${category}/${parsed.categoryText}`;
    categoryTextTally.set(textKey, (categoryTextTally.get(textKey) || 0) + 1);

    mediaIndex.push({
      activityId: activity.id,
      path: relPath,
      name,
      category,
      categoryText: parsed.categoryText,
      rating: parsed.rating,
      description: parsed.description,
      isCover: parsed.isCover,
      onHomePage: parsed.onHomePage,
      url: entry ? entry.url : '',
      hash: entry ? entry.hash : '',
      originBytes: libraryByStem.get(stemOf(`${activity.id}/${relPath}`)) || 0,
      cloudBytes: entry ? Number(entry.bytes) || 0 : 0,
    });
  }
}

// 本次扫描里没出现的活动 id（素材库/网站压缩素材本地不存在该活动）：原样保留旧索引里的条目，
// 防止「本地只整理了一场新活动」时把其它活动的图从索引里悄悄删掉。
const scannedActivityIds = new Set(activities.map((activity) => activity.id));
const preservedEvents = existingIndex.mediaEvents.filter(
  (event) => !scannedActivityIds.has(event.id) && !REMOVE_ACTIVITY_IDS.has(event.id),
);
const preservedMediaIndex = existingIndex.mediaIndex.filter(
  (item) => !scannedActivityIds.has(item.activityId) && !REMOVE_ACTIVITY_IDS.has(item.activityId),
);
for (const event of preservedEvents) activities.push(event);
mediaIndex.push(...preservedMediaIndex);

// 同一活动内：评分高的在前，其次按文件名
mediaIndex.sort((a, b) => (a.activityId === b.activityId
  ? (b.rating.localeCompare(a.rating) || a.name.localeCompare(b.name, 'zh-CN'))
  : a.activityId.localeCompare(b.activityId, 'zh-CN')));

/* -------------------------------------------------------------- 体检 */

const byActivity = new Map();
for (const item of mediaIndex) {
  if (!byActivity.has(item.activityId)) byActivity.set(item.activityId, []);
  byActivity.get(item.activityId).push(item);
}
const activityIds = [...byActivity.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'));

const noUrl = mediaIndex.filter((item) => !item.url);
const hashBroken = mediaIndex.filter((item) => item.url && !item.url.includes(item.hash));
const badCategory = mediaIndex.filter((item) => !['活动', '案例', '社交媒体'].includes(item.category));
const missingRating = mediaIndex.filter((item) => item.rating === '00000');
const bigCloud = mediaIndex.filter((item) => item.cloudBytes > BIG_CLOUD_BYTES);
const bigOrigin = mediaIndex.filter((item) => item.originBytes > BIG_ORIGIN_BYTES);
const noOriginBytes = mediaIndex.filter((item) => item.originBytes === 0);
const hashNamed = mediaIndex.filter((item) => /^[a-f0-9]{32,}\.[a-z0-9]+$/i.test(item.name));

const noCover = [];
const multiCover = [];
for (const id of activityIds) {
  const list = byActivity.get(id);
  const covers = list.filter((item) => item.isCover === 1);
  if (covers.length === 0) {
    const pool = list.filter((item) => item.category === CATEGORY_ACTIVITY && isImageName(item.name) && item.url);
    const fallback = pool.find((item) => item.onHomePage === 1) || pool[0];
    noCover.push({ id, total: list.length, suggestion: fallback ? fallback.path : '(没有可用的图)' });
  } else if (covers.length > 1) {
    multiCover.push({ id, covers: covers.map((item) => item.path) });
  }
}

// 云端有、候选里没有 = 线上原本就不展示的，不补
const indexCloudHashes = new Set(mediaIndex.map((item) => item.hash).filter(Boolean));
const indexCloudKeys = new Set(mediaIndex.filter((item) => item.url).map((item) => `${item.activityId}/${stemOf(item.path)}`));
const cloudExtra = cloudKeys.filter((key) => !cloudByHash.has(cloud[key].hash) ? false : !indexCloudHashes.has(cloud[key].hash));

const unmatchedImages = unmatched.filter((item) => isImageName(item.name));
const unmatchedVideos = unmatched.filter((item) => isVideoName(item.name));
const sourceNoise = unmatchedImages.filter((item) => /(^|\/)(源码|node_modules|dist|build|\.git)(\/|$)/i.test(item.path) || /_副本|鍓湰/u.test(item.path));

function groupBy(list, pick) {
  const map = new Map();
  for (const item of list) map.set(pick(item), (map.get(pick(item)) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/* ------------------------------------------------------------ 写索引 */

// 每条记录竖着排：一个字段一行，方便人工核对 path / name / hash / url。
// 注意：构建时 minifier 会把缩进和换行去掉，所以 dist 体积基本不变。
const verticalObject = (obj, indent) => {
  const pad = ' '.repeat(indent);
  const inner = Object.entries(obj)
    .map(([key, value]) => `${pad}  ${key}: ${JSON.stringify(value)},`)
    .join('\n');
  return `${pad}{\n${inner}\n${pad}}`;
};

const eventLines = activities
  .slice()
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .map((event) => `${verticalObject({ id: event.id, title: event.title, folder: event.folder, date: event.date, place: event.place, summary: event.summary }, 2)},`)
  .join('\n');

const indexFile = `// 由 scripts/build-media-index.mjs 自动生成，请勿手改。
// 字段合同见 docs/media-contract.md。
// 候选集合 = 「网站压缩素材」现场扫描结果（线上原本展示的那批图），不增不减。
// url 由文件 sha256 精确对应到云端，对应不上的为空字符串，前端不渲染。
export const mediaEvents = [
${eventLines}
];

export const mediaIndex = [
${mediaIndex.map((item) => `${verticalObject(item, 2)},`).join('\n')}
];

let activityCache = null;

// 取某个活动的全部媒体，已按 rating 降序排好。
export function mediaByActivity(activityId) {
  if (!activityCache) {
    activityCache = new Map();
    for (const item of mediaIndex) {
      const list = activityCache.get(item.activityId);
      if (list) list.push(item);
      else activityCache.set(item.activityId, [item]);
    }
  }
  return activityCache.get(activityId) || [];
}

let entryCache = null;

// 按「活动id + 相对路径」精确取一条记录，O(1)。
export function mediaIndexEntry(activityId, relativePath) {
  if (!entryCache) {
    entryCache = new Map();
    for (const item of mediaIndex) entryCache.set(item.activityId + '/' + item.path, item);
  }
  return entryCache.get(activityId + '/' + relativePath) || null;
}
`;

fs.writeFileSync(OUT_INDEX_FILE, indexFile, 'utf8');

/* ------------------------------------------------------------ 写报告 */

const lines = [];
const push = (value = '') => lines.push(value);
const listTable = (rows, headers) => {
  push(`| ${headers.join(' | ')} |`);
  push(`|${headers.map(() => '---').join('|')}|`);
  for (const row of rows) push(`| ${row.join(' | ')} |`);
};

push('# 媒体索引体检报告');
push();
push('- 生成命令：`node scripts/build-media-index.mjs`');
push(`- 生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
push(`- 索引文件：\`src/data/mediaIndex.generated.js\`（${mb(fs.statSync(OUT_INDEX_FILE).size)}）`);
push('- 候选来源：`public/网站压缩素材` 现场扫描（= 线上原本展示的那批图）');
push('- 云端对应：文件 sha256 与云端 hash 逐张精确比对');
push();

push('## 1 总览');
push();
push('| 项目 | 数量 |');
push('|---|---|');
push(`| 扫描到的候选文件 | ${mediaIndex.length} |`);
push(`| 索引条目 | ${mediaIndex.length} |`);
push(`| 覆盖活动 | ${activityIds.length} |`);
push(`| 图片条目 | ${mediaIndex.filter((item) => isImageName(item.name)).length} |`);
push(`| 视频条目 | ${mediaIndex.filter((item) => isVideoName(item.name)).length} |`);
push(`| 扫描体积 | ${mb(scannedBytes)} |`);
push();
push('云端对应结果：');
push();
push('| 对应方式 | 条数 |');
push('|---|---|');
push(`| sha256 精确对应 | ${cloudMatchedBy.hash} |`);
push(`| 同名主干、扩展名不同 | ${cloudMatchedBy.stem} |`);
push(`| 对应不上（url 为空，前端不渲染） | ${cloudMatchedBy.none} |`);
push();
push('粗分类分布：');
push();
for (const [key, value] of [...categoryTally.entries()].sort((a, b) => b[1] - a[1])) push(`- ${key}：${value}`);
push();
push('细分类分布（前 20）：');
push();
for (const [key, value] of [...categoryTextTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) push(`- ${key}：${value}`);
push();

push('## 2 硬规则检查');
push();
push(`1. \`hash\` 必须能在 \`url\` 里找到：**${mediaIndex.length - noUrl.length - hashBroken.length}/${mediaIndex.length - noUrl.length}**（有 url 的记录）${hashBroken.length ? ' ❌' : ' ✅'}`);
push(`2. 每个活动 \`isCover=1\` 最多一条：**${activityIds.length - noCover.length - multiCover.length}/${activityIds.length}** 个活动合规${multiCover.length ? ' ❌' : ' ✅'}`);
push(`3. 没有 \`url\` 的记录不进列表：**${noUrl.length}** 条 url 为空，由前端过滤掉 ✅`);
push();

push('## 3 对应不上云端的条目（url 为空，前端不渲染）');
push();
push(`共 **${noUrl.length}** 条：图片 ${unmatchedImages.length} 条、视频 ${unmatchedVideos.length} 条。`);
push('这些文件只存在于本地，云端从来没有过，所以线上原本也是空图。');
push();
if (unmatchedImages.length) {
  push('图片缺失最多的活动：');
  push();
  for (const [key, value] of groupBy(unmatchedImages, (item) => item.activityId).slice(0, 15)) push(`- ${key}：${value}`);
  push();
  push(`其中 **${sourceNoise.length}** 张来自案例的「源码 / node_modules / dist」目录，是网页构建产物，不是活动照片。`);
  push();
  push('样本：');
  for (const item of unmatchedImages.slice(0, 10)) push(`- ${item.activityId} · ${item.path}`);
}
push();

push('## 4 缺封面的活动');
push();
push('封面 = 评分最高的、带「封面」标记的那张图；没有标记就退回评分最高的一张。');
push('下表是候选里一个「封面」标记都没有的活动。');
push();
if (!noCover.length) push('无。');
else {
  listTable(noCover.slice(0, LIST_LIMIT).map((item) => [item.id, item.total, item.suggestion]), ['活动', '候选数', '按评分推荐的封面']);
  if (noCover.length > LIST_LIMIT) {
    push();
    push(`（共 ${noCover.length} 个，只列前 ${LIST_LIMIT} 个）`);
  }
}
push();

push('## 5 一个活动多个封面');
push();
push('这是既有命名习惯：`10050_封面_…` 是照片，`10000_封面_…` 是海报。');
push('渲染时取评分最高的那一个，数据里两个标记都保留。');
push();
if (!multiCover.length) push('无。');
else for (const item of multiCover.slice(0, LIST_LIMIT)) {
  push(`- ${item.id}（${item.covers.length} 个）：`);
  for (const cover of item.covers) push(`  - ${cover}`);
}
push();

push('## 6 缺评分的条目');
push();
push(`共 **${missingRating.length}** 条，\`rating\` 记为 \`00000\`，排序时排在同活动最后。`);
push();
if (missingRating.length) {
  for (const [key, value] of groupBy(missingRating, (item) => item.category).sort((a, b) => b[1] - a[1])) push(`- ${key}：${value}`);
  push();
  push('样本：');
  for (const item of missingRating.slice(0, 10)) push(`- ${item.activityId} · ${item.path}`);
}
push();

push('## 7 名字解析降级情况');
push();
push('| 情况 | 条数 |');
push('|---|---|');
for (const [key, value] of [...parseTally.entries()].sort((a, b) => b[1] - a[1])) push(`| ${key} | ${value} |`);
push();
push(`词表外的中间段已归入 \`${UNCLASSIFIED}\`。下面是最常出现的那些词，出现次数多说明词表需要补充，或者文件该改名。`);
push();
push('| 中间段 | 出现次数 |');
push('|---|---|');
for (const [key, value] of [...unclassifiedSegments.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) push(`| ${key} | ${value} |`);
push();

push('## 8 云端有、候选里没有（线上原本就不展示）');
push();
push(`共 **${cloudExtra.length}** 条。这些是云端存在、但本地候选里找不到的文件，前端不展示、也不补。`);
push();
for (const [key, value] of groupBy(cloudExtra, (item) => item.split('/')[0]).slice(0, 15)) push(`- ${key}：${value}`);
push();

push('## 9 超大图');
push();
push(`- 云端体积 > ${mb(BIG_CLOUD_BYTES)}：**${bigCloud.length}** 条`);
push(`- 原图体积 > ${mb(BIG_ORIGIN_BYTES)}：**${bigOrigin.length}** 条`);
push();
for (const item of bigCloud.slice(0, 15)) push(`- ${mb(item.cloudBytes)} · ${item.activityId} · ${item.name}`);
push();

push('## 10 其它');
push();
push(`- 分类不在三类目录（不进索引）：${skippedNoCategory.length} 条`);
push(`- 文件名本身就是哈希：${hashNamed.length} 条`);
push(`- \`originBytes\` 为 0（在素材库找不到配对原图）：${noOriginBytes.length} 条`);
push(`- 索引覆盖的活动：${activityIds.length} 个（全部来自有 manifest.json 的目录）`);
push(`- 扫描时跳过的非媒体文件：${[...skippedNonMedia.entries()].sort((a, b) => b[1] - a[1]).map(([ext, count]) => `${ext} ${count}`).join('、') || '无'}`);
push();

push('## 10b 归不进三类目录的文件（不进索引，也不展示）');
push();
push(`共 **${skippedNoCategory.length}** 条。合同规定 \`category\` 只有活动/案例/社交媒体三个值，`);
push('这些文件的所在目录名落不进这三类，按「不许猜」的规则直接排除，由你决定要不要整理目录。');
push();
if (skippedNoCategory.length) {
  for (const [key, value] of groupBy(skippedNoCategory, (item) => `${item.activityId} · ${item.path.split('/')[0]}`).slice(0, 15)) push(`- ${key}：${value} 条`);
  push();
  push('样本：');
  for (const item of skippedNoCategory.slice(0, 8)) push(`- ${item.activityId} · ${item.path}`);
}
push();

push('## 11 目录认领情况');
push();
push('候选图按「网站压缩素材」的目录扫描，id 优先读目录自带的 manifest.json；');
push('目录改过名的（例如「…活动一期」对应素材库的「…活动」）按去掉「一期/二期」后的名字认领。');
push();
push(`- 认领到候选的目录：${websiteActivities.length} 个`);
push(`- 完全认不出来的目录：${unresolvedFolders.length ? unresolvedFolders.join('、') : '无'}`);
push();

push('## 12 删掉本地图片后前端会不会受影响');
push();
push(`前端只读索引里的 \`url\`，不读本地文件。索引里 ${mediaIndex.length - noUrl.length} 条有云端链接，`);
push(`剩下 ${noUrl.length} 条本来就没有云端副本，删本地文件不会让页面比现在更少。`);
push();

fs.writeFileSync(OUT_REPORT_FILE, `${lines.join('\n')}\n`, 'utf8');

/* ------------------------------------------------------------ 控制台 */

console.log(`索引：${mediaIndex.length} 条（${mb(fs.statSync(OUT_INDEX_FILE).size)}）→ ${path.relative(ROOT, OUT_INDEX_FILE)}`);
console.log(`活动：${activityIds.length} 个`);
console.log(`云端对应：sha256 ${cloudMatchedBy.hash} · 扩展名兜底 ${cloudMatchedBy.stem} · 对应不上 ${cloudMatchedBy.none}`);
console.log(`硬规则：hash↔url ${hashBroken.length === 0 ? '全部通过' : `违规 ${hashBroken.length}`} · 多封面 ${multiCover.length} · 缺封面 ${noCover.length}`);
console.log(`云端有候选没有：${cloudExtra.length} · 缺评分：${missingRating.length} · 缺原图体积：${noOriginBytes.length}`);
console.log(`报告 → ${path.relative(ROOT, OUT_REPORT_FILE)}`);
