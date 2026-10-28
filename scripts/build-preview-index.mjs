#!/usr/bin/env node
/**
 * 本地预览用的媒体索引（不查云端、不算哈希，秒级完成）。
 *
 * 为什么需要它：正式索引要先上传云端、再按 sha256 对上云端链接；
 * 本地预览阶段不碰云端，所以这里直接扫「网站压缩素材」，把 url 写成占位值
 * （non-empty，保证前端"有 url 才渲染"的过滤规则放行），真正地址由
 * VITE_MEDIA_BASE_URL 指向的本地预览服务提供。
 *
 * 只读素材目录，不修改、不删除任何图片。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activityIdsByMediaFolder, readLibraryActivities } from './lib/activityFolderMap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 压缩镜像多份并存：本机副本（本地图存档）优先，iCloud 原件兜底。
// 索引按活动目录取并集：本机有的用本机，本机没同步到的仍按 iCloud 记录列出。
const WEBSITE_ROOTS = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.resolve(ROOT, '..', '..', '本地图存档', '网站压缩素材'),
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
]
  .filter(Boolean)
  .filter((candidate) => fs.existsSync(candidate));
if (!WEBSITE_ROOTS.length) { console.error('找不到「网站压缩素材」目录'); process.exit(1); }

const LIBRARY_ROOT = path.resolve(ROOT, '..', '..', '素材库');
const OUT = path.join(ROOT, 'src/data/mediaIndex.generated.js');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']);

const baseVocabulary = {
  '封面': '封面', '首页': '首页', '主图': '主图', '活动照片': '活动照片',
  '活动视频': '活动视频', '案例': '案例', '案例视频': '案例视频',
  '社交媒体照片': '社交媒体照片', '社交媒体视频': '社交媒体视频',
  '大合照': '大合照', '合照': '合照', '海报': '海报', '现场信息': '现场信息',
  '演讲': '演讲', '互动': '互动', '协作': '协作', '其他': '其他',
};

function parseName(name) {
  const stem = name.replace(/\.[^./]+$/, '');
  const scoreMatch = stem.match(/^(\d{1,5})/);
  const rating = scoreMatch ? String(Number(scoreMatch[1])).padStart(5, '0') : '';
  const rest = scoreMatch ? stem.slice(scoreMatch[1].length).replace(/^[_\s]+/, '') : stem;
  const segments = rest.split(/[_\s]+/).filter(Boolean);
  let isCover = 0, onHomePage = 0;
  if (segments.includes('封面')) isCover = 1;
  if (segments.includes('首页')) onHomePage = 1;
  const categoryText = segments.find((s) => baseVocabulary[s] && !['封面', '首页', '主图'].includes(s)) || '其他';
  return { rating, description: rest, isCover, onHomePage, categoryText };
}

function categoryOf(relativePath) {
  if (relativePath.startsWith('01_活动照片/')) return '活动';
  if (relativePath.startsWith('03_社交媒体/')) return '报道';
  return '其他';
}

const index = [];
let folders = 0;
// 先按活动目录汇总各镜像根的文件（靠前的根优先），再统一生成索引。
// 活动 id 以「素材库」的 manifest 为准；镜像目录名和它不一致（少/多「一期」这类）也能认出来。
const activities = readLibraryActivities(LIBRARY_ROOT);
const filesByFolder = new Map();
for (const root of WEBSITE_ROOTS) {
  const idsByFolder = activityIdsByMediaFolder(root, activities);
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!filesByFolder.has(entry.name)) {
      filesByFolder.set(entry.name, { activityId: idsByFolder.get(entry.name) || entry.name, files: new Map() });
    }
    const files = filesByFolder.get(entry.name).files;
    const walk = (current) => {
      for (const item of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, item.name);
        if (item.isDirectory()) { walk(full); continue; }
        if (item.name.startsWith('._') || item.name === '.DS_Store') continue;
        const ext = path.extname(item.name).toLowerCase();
        if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) continue;
        const relative = path.relative(path.join(root, entry.name), full).split(path.sep).join('/');
        if (files.has(relative)) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        files.set(relative, { name: item.name, size });
      }
    };
    walk(path.join(root, entry.name));
  }
}
for (const [, { activityId, files }] of filesByFolder) {
  folders += 1;
  for (const [relative, file] of files) {
    const parsed = parseName(file.name);
    index.push({
      activityId, path: relative, name: file.name, category: categoryOf(relative),
      categoryText: parsed.categoryText, rating: parsed.rating, description: parsed.description,
      isCover: parsed.isCover, onHomePage: parsed.onHomePage,
      url: `local/${activityId}/${relative}`, hash: '', originBytes: 0,
      cloudBytes: file.size,
    });
  }
}
index.sort((a, b) => a.activityId.localeCompare(b.activityId) || (Number(b.rating) || 0) - (Number(a.rating) || 0) || a.name.localeCompare(b.name, 'zh-CN'));

const body = index.map((item) => `  ${JSON.stringify(item)},`).join('\n');
const content = `// 本地预览索引（由 scripts/build-preview-index.mjs 生成，请勿手改）。
// 正式索引由 scripts/build-media-index.mjs 生成；本文件只在本地预览时使用。
export const mediaEvents = [];

export const mediaIndex = [
${body}
];

let activityCache = null;
export function mediaByActivity(activityId) {
  if (!activityCache) {
    activityCache = new Map();
    for (const item of mediaIndex) {
      const list = activityCache.get(item.activityId);
      if (list) list.push(item); else activityCache.set(item.activityId, [item]);
    }
  }
  return activityCache.get(activityId) || [];
}

let entryCache = null;
export function mediaIndexEntry(activityId, relativePath) {
  if (!entryCache) {
    entryCache = new Map();
    for (const item of mediaIndex) entryCache.set(item.activityId + '/' + item.path, item);
  }
  return entryCache.get(activityId + '/' + relativePath) || null;
}
`;

const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (previous === content) {
  console.log(`[preview-index] ${folders} 个活动目录，${index.length} 条媒体记录（内容无变化，未重写）`);
} else {
  fs.writeFileSync(OUT, content);
  console.log(`[preview-index] ${folders} 个活动目录，${index.length} 条媒体记录（已更新）`);
}
