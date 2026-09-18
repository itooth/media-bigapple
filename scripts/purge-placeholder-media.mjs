#!/usr/bin/env node
/**
 * 清理「1×1 白图」：本地压缩坏掉的占位图，绝对不能出现在页面上。
 *
 * 为什么需要：压缩那一步会产出 631 字节的 1×1 白图（文件名正常、能打开）。
 * 一旦它们拿到云端链接，页面就会出现一个个白方块（旧版 9/9 构建就是这个毛病）。
 * 这个脚本把这类图从云端删掉、并从云端清单里摘除，于是索引里 url 为空、页面不渲染。
 *
 * 只删「像素 ≤ 2×2」的占位图对应的云端对象；正常图片一律不动。
 *
 * 用法：
 *   node scripts/purge-placeholder-media.mjs --dry-run   # 先看要删什么
 *   node scripts/purge-placeholder-media.mjs             # 真删（云端 + 清单）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { imageDimensions } from './lib/imageDimensions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.bigapple.work';
const INDEX_FILE = path.join(ROOT, 'src/data/mediaIndex.generated.js');
const MAP_FILE = path.join(ROOT, 'src/data/publicMediaMap.generated.js');
const WEBSITE_ROOT = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
  path.join(ROOT, 'public', '网站压缩素材'),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));

const dryRun = process.argv.includes('--dry-run');

const normalizeFolder = (name) => name.replace(/[（(][^）)]*[）)]/gu, '').replace(/[一二三四五]期/gu, '').replace(/[\s_-]/gu, '');
const readCredential = () => JSON.parse(fs.readFileSync(path.join(os.homedir(), '.bigapple', 'deployment-credential.json'), 'utf8'));
const appIdOfUrl = (url) => (String(url).match(/\/apps\/([^/]+)\//) || [])[1] || null;

const { mediaIndex, mediaEvents } = await import(pathToFileURL(INDEX_FILE).href);
const folderNameOf = Object.fromEntries((mediaEvents || []).map((e) => [e.id, e.folder]));
const dirs = fs.readdirSync(WEBSITE_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const byId = {}; const byNorm = {};
for (const dir of dirs) {
  byNorm[normalizeFolder(dir)] = dir;
  const manifest = path.join(WEBSITE_ROOT, dir, 'manifest.json');
  if (!fs.existsSync(manifest)) continue;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed.id) byId[parsed.id] = dir;
  } catch { /* 认不出就退回按目录名匹配 */ }
}
const folderOf = (activityId) => byId[activityId] || byNorm[normalizeFolder(folderNameOf[activityId] || activityId)];
const isImage = (name) => /\.(jpe?g|png)$/iu.test(name);

const placeholders = [];
let scanned = 0;
for (const entry of mediaIndex) {
  if (!isImage(entry.name)) continue;
  const folder = folderOf(entry.activityId);
  if (!folder) continue;
  const absolute = path.join(WEBSITE_ROOT, folder, entry.path);
  if (!fs.existsSync(absolute)) continue;
  scanned += 1;
  const size = imageDimensions(absolute);
  if (!size || (size.width > 2 && size.height > 2)) continue; // 正常图，跳过
  placeholders.push({ ...entry, absolute, size, mapKey: `${entry.activityId}/${entry.path}` });
}

console.log(`扫描本地图片 ${scanned} 张，发现占位白图 ${placeholders.length} 张`);
for (const item of placeholders) {
  console.log(`  ${item.activityId} | ${item.size.width}×${item.size.height} | ${(fs.statSync(item.absolute).size)} 字节 | ${item.path.slice(0, 72)}`);
  console.log(`      云端链接: ${item.url || '（本来就没有，页面已经不渲染）'}`);
}

if (!placeholders.length) { console.log('没有需要清理的，收工。'); process.exit(0); }
if (dryRun) { console.log('\n--dry-run：什么都没删。'); process.exit(0); }

const credential = readCredential();
const headers = {
  'x-bigapple-publisher-id': credential.publisherId,
  Authorization: `Bearer ${credential.token}`,
  'x-bigapple-skill-id': 'sk_405931e4-67f2-494f-aaca-8081885f54e5',
  'x-bigapple-skill-version': '2.4.0',
};
let mapText = fs.readFileSync(MAP_FILE, 'utf8');
const map = JSON.parse(mapText.match(/export default ([\s\S]*);\s*$/)[1]);
let deleted = 0; const failures = [];
for (const item of placeholders) {
  const record = map[item.mapKey];
  const appId = record ? appIdOfUrl(record.url) : null;
  if (record && appId) {
    const key = `media/${record.hash}/${record.hash}${path.extname(item.path).toLowerCase()}`;
    const response = await fetch(`${API}/api/apps/${appId}/public-objects/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers });
    if (response.ok || response.status === 404) { deleted += 1; console.log(`  已删云端对象 ${appId} :: ${key.slice(0, 60)}…`); }
    else { failures.push(`${item.mapKey} :: ${response.status} ${(await response.text()).slice(0, 120)}`); continue; }
  }
  delete map[item.mapKey]; // 摘掉清单记录 → 索引里 url 为空 → 页面不渲染
}
fs.writeFileSync(`${MAP_FILE}.tmp`, `export default ${JSON.stringify(map, null, 2)};\n`, 'utf8');
fs.renameSync(`${MAP_FILE}.tmp`, MAP_FILE);
console.log(`\n完成：删除云端对象 ${deleted} 个，清单摘除 ${placeholders.length} 条，失败 ${failures.length}`);
for (const failure of failures) console.log('  ✗ ' + failure);
console.log('下一步：node scripts/build-media-index.mjs && npm run build');
