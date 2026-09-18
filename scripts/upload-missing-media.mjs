#!/usr/bin/env node
/**
 * 补齐「索引里没有云端链接」的媒体：把本地有、云端没有的文件传上去。
 *
 * 为什么需要它：前端不存图片，页面上的图全部按 sha256 对应云端对象。
 * 索引里 url 为空 = 本地有这张图、云端没有对应对象，前端不渲染（不留白框）。
 * 这个脚本只做一件事：把这些「本地有、云端没有」的图传上去，然后重跑索引即可挂上。
 *
 * 安全边界：
 *   1. 只读本地图片，不修改、不删除任何本地文件。
 *   2. 只新增云端对象；已存在（sha256 相同）的自动跳过，重复执行没有副作用。
 *   3. 不会把 A 活动的图挂到 B 活动：key 固定为 <activityId>/<相对路径>。
 *
 * 用法：
 *   node scripts/upload-missing-media.mjs --dry-run                     # 先看要传多少、多大
 *   node scripts/upload-missing-media.mjs                               # 只补图片（默认，不含视频）
 *   node scripts/upload-missing-media.mjs --include-videos              # 连视频一起补
 *   node scripts/upload-missing-media.mjs --only 09-06-duibai-sharing   # 只补指定活动
 *   node scripts/upload-missing-media.mjs --max-bytes 115343360         # 设体积上限，超了就停
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPlaceholderImage } from './lib/imageDimensions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_INDEX = path.join(ROOT, 'src/data/mediaIndex.generated.js');
const DEFAULT_MAP = path.join(ROOT, 'src/data/publicMediaMap.generated.js');
const DEFAULT_APP = 'bigapple-onboarding-course';
const API = 'https://api.bigapple.work';
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};
const WEBSITE_CANDIDATES = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
  path.join(ROOT, 'public', '网站压缩素材'),
].filter(Boolean);
const normalizeFolder = (name) => name.replace(/[（(][^）)]*[）)]/gu, '').replace(/[一二三四五]期/gu, '').replace(/[\s_-]/gu, '');
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

function parseArgs(argv) {
  const options = {
    index: DEFAULT_INDEX, map: DEFAULT_MAP, app: DEFAULT_APP, dryRun: false,
    includeVideos: false, includeSourceCode: false, only: [], maxBytes: Infinity, websiteRoot: null,
    concurrency: 4, pathPrefixes: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--include-videos') options.includeVideos = true;
    else if (arg === '--include-source-code') options.includeSourceCode = true;
    else if (arg === '--index') options.index = path.resolve(argv[++i]);
    else if (arg === '--map') options.map = path.resolve(argv[++i]);
    else if (arg === '--app') options.app = argv[++i];
    else if (arg === '--media-root') options.websiteRoot = path.resolve(argv[++i]);
    else if (arg === '--max-bytes') options.maxBytes = Number(argv[++i]);
    else if (arg === '--concurrency') options.concurrency = Math.max(1, Number(argv[++i]));
    else if (arg === '--path-prefix') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.pathPrefixes.push(argv[++i]); }
    else if (arg === '--only') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.only.push(argv[++i]); }
    else throw new Error(`无法识别的参数：${arg}`);
  }
  return options;
}

function readCredential() {
  const file = path.join(os.homedir(), '.bigapple', 'deployment-credential.json');
  if (!fs.existsSync(file)) throw new Error(`找不到部署凭据：${file}`);
  const credential = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!credential.publisherId || !credential.token) throw new Error('部署凭据缺少 publisherId / token');
  return credential;
}

const readMap = (file) => {
  if (!fs.existsSync(file)) return {};
  const match = fs.readFileSync(file, 'utf8').match(/export default (.*);\s*$/s);
  return match ? JSON.parse(match[1]) : {};
};
const saveMap = (file, map) => {
  fs.writeFileSync(`${file}.tmp`, `export default ${JSON.stringify(map, null, 2)};\n`, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
};

async function uploadObject({ credential, app, objectKey, body, contentType }) {
  const url = `${API}/api/apps/${app}/public-objects/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    'x-bigapple-publisher-id': credential.publisherId,
    Authorization: `Bearer ${credential.token}`,
    'x-bigapple-skill-id': 'sk_405931e4-67f2-494f-aaca-8081885f54e5',
    'x-bigapple-skill-version': '2.4.0',
    'Content-Type': contentType,
  };
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'PUT', headers, body });
      if (response.ok) return response.json();
      const detail = await response.text();
      // 额度/权限这类确定性错误直接抛，不重试
      if ([413, 402, 403].includes(response.status)) throw new Error(`${response.status} ${detail.slice(0, 200)}`);
      lastError = new Error(`${response.status} ${detail.slice(0, 200)}`);
    } catch (error) {
      if (/413|402|403|额度/.test(error.message)) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw lastError;
}

// 活动 id -> 「网站压缩素材」里的目录名（目录名和素材库常有「一期/二期」这类分叉）
function buildWebsiteFolderMap(websiteRoot) {
  const byNormalized = new Map();
  const byId = new Map();
  for (const entry of fs.readdirSync(websiteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    byNormalized.set(normalizeFolder(entry.name), entry.name);
    const manifestFile = path.join(websiteRoot, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestFile)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
      if (manifest.id) byId.set(manifest.id, entry.name);
    } catch { /* manifest 坏了就退回按目录名匹配 */ }
  }
  return { byNormalized, byId };
}

const options = parseArgs(process.argv.slice(2));
const websiteRoot = options.websiteRoot || WEBSITE_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!websiteRoot) throw new Error('找不到「网站压缩素材」目录，请用 --media-root 指定');

const { mediaEvents, mediaIndex } = await import(pathToFileURL(options.index).href);
const folderByIdentity = new Map();
for (const event of mediaEvents || []) folderByIdentity.set(event.id, event.folder);
const { byNormalized, byId } = buildWebsiteFolderMap(websiteRoot);
const folderOf = (activityId) => byId.get(activityId)
  || byNormalized.get(normalizeFolder(folderByIdentity.get(activityId) || activityId))
  || null;

const isVideo = (name) => /\.(mp4|mov|webm)$/iu.test(name);
const isSourceCopy = (relPath) => relPath.includes('/源码/') || relPath.includes('待确认');

const credential = readCredential();
const map = readMap(options.map);
const missing = mediaIndex.filter((item) => !item.url);
const wanted = missing.filter((item) => {
  if (options.only.length && !options.only.includes(item.activityId)) return false;
  if (!options.includeVideos && isVideo(item.name)) return false;
  if (!options.includeSourceCode && isSourceCopy(item.path)) return false;
  if (options.pathPrefixes.length && !options.pathPrefixes.some((p) => item.path.startsWith(p))) return false;
  return true;
});

const plan = [];
let planBytes = 0;
const skipped = { noFolder: 0, noFile: 0, alreadyInMap: 0, overBudget: 0, placeholder: 0, oversize: 0 };
const overSized = [];
for (const item of wanted) {
  const folder = folderOf(item.activityId);
  if (!folder) { skipped.noFolder += 1; continue; }
  const absolute = path.join(websiteRoot, folder, item.path);
  if (!fs.existsSync(absolute)) { skipped.noFile += 1; continue; }
  const bytes = fs.statSync(absolute).size;
  // 1×1 白图是压缩坏掉的占位图，传上去只会变成白方块，绝不传
  if (isPlaceholderImage(absolute)) { skipped.placeholder += 1; continue; }
  const key = `${item.activityId}/${item.path}`;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  if (map[key]?.hash === hash) { skipped.alreadyInMap += 1; continue; }
  if (bytes > 128 * 1048576) { skipped.oversize += 1; overSized.push({ key, bytes }); continue; }
  if (planBytes + bytes > options.maxBytes) { skipped.overBudget += 1; continue; }
  planBytes += bytes;
  plan.push({ item, absolute, key, hash, bytes, folder });
}

const byActivity = new Map();
for (const row of plan) {
  const current = byActivity.get(row.item.activityId) || { count: 0, bytes: 0 };
  current.count += 1;
  current.bytes += row.bytes;
  byActivity.set(row.item.activityId, current);
}

console.log(`索引里没有云端链接：${missing.length} 条`);
console.log(`本次要补：${plan.length} 个文件，共 ${mb(planBytes)}`);
console.log(`跳过：目录认不出 ${skipped.noFolder}，本地没有 ${skipped.noFile}，云端已有 ${skipped.alreadyInMap}，超出体积上限 ${skipped.overBudget}，占位白图 ${skipped.placeholder}，单文件超 128MB ${skipped.oversize}`);
for (const item of overSized) console.log(`  超上限（传不了）：${item.key} :: ${(item.bytes / 1048576).toFixed(0)} MB`);
console.log('按活动：');
for (const [activityId, info] of [...byActivity.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${activityId.padEnd(40)} ${String(info.count).padStart(4)} 个  ${mb(info.bytes).padStart(9)}`);
}
if (options.dryRun) {
  console.log('\n--dry-run：没有写任何东西。去掉这个参数就会真正上传。');
  process.exit(0);
}

const allFailures = [];
let uploaded = 0; let failed = 0; let uploadedBytes = 0; let credentialProblem = false;
const queue = [...plan];
const uploadOne = async (row) => {
  const extension = path.extname(row.absolute).toLowerCase();
  const objectKey = `media/${row.hash}/${row.hash}${extension}`;
  const payload = await uploadObject({
    credential,
    app: options.app,
    objectKey,
    body: fs.readFileSync(row.absolute),
    contentType: CONTENT_TYPES[extension] || 'application/octet-stream',
  });
  if (!payload.publicUrl) throw new Error(`没有返回 publicUrl：${JSON.stringify(payload).slice(0, 160)}`);
  map[row.key] = { hash: row.hash, url: payload.publicUrl, bytes: row.bytes };
};
const worker = async () => {
  while (queue.length && !credentialProblem) {
    const row = queue.shift();
    try {
      await uploadOne(row);
      uploaded += 1;
      uploadedBytes += row.bytes;
      if (uploaded % 3 === 0) { saveMap(options.map, map); console.log(`  已上传 ${uploaded}/${plan.length}（${mb(uploadedBytes)}）`); }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${row.key} :: ${error.message}`);
      allFailures.push(`${row.key} :: ${error.message}`);
      if (/413|402|403|额度|quota/i.test(error.message)) credentialProblem = true;
    }
  }
};
await Promise.all(Array.from({ length: Math.min(options.concurrency, plan.length) }, () => worker()));
saveMap(options.map, map);
console.log(`\n完成：新上传 ${uploaded} 个（${mb(uploadedBytes)}），失败 ${failed}`);
if (credentialProblem) {
  console.log('云端拒绝了后续上传（多半是应用存储额度上限）。已上传的会保留，额度恢复后重跑本脚本会自动续传。');
}
console.log('下一步：node scripts/build-media-index.mjs && npm run build');
