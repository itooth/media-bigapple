#!/usr/bin/env node
/**
 * 把「网站压缩素材」里的图上传到云端，并更新云端清单。
 *
 * 为什么需要它：页面上的图全部走云端，前端只存索引。
 * 索引里的 url 来自 src/data/publicMediaMap.generated.js（云端清单），
 * 所以新图必须先用这个脚本上传，再跑 build-media-index.mjs 生成索引。
 *
 * 用法：
 *   node scripts/upload-media.mjs --media-root <网站压缩素材目录> --folders <活动目录名...> [--dry-run]
 *
 * 只读本地图片；只有加了 --dry-run 才不写云端。已上传过（hash 相同）的会自动跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MAP = path.join(ROOT, 'src/data/publicMediaMap.generated.js');
const DEFAULT_APP = 'bigapple-onboarding-course';
const DEFAULT_INDEX = path.join(ROOT, 'src/data/mediaIndex.generated.js');
const API = 'https://api.bigapple.work';
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.mov', '.webm']);
const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

function parseArgs(argv) {
  const options = { mediaRoot: null, folders: [], map: DEFAULT_MAP, app: DEFAULT_APP, index: DEFAULT_INDEX, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--media-root') options.mediaRoot = path.resolve(argv[++i]);
    else if (arg === '--folders') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.folders.push(argv[++i]); }
    else if (arg === '--map') options.map = path.resolve(argv[++i]);
    else if (arg === '--app') options.app = argv[++i];
    else if (arg === '--index') options.index = path.resolve(argv[++i]);
    else throw new Error(`无法识别的参数：${arg}`);
  }
  if (!options.mediaRoot || options.folders.length === 0) {
    console.error('用法：node scripts/upload-media.mjs --media-root <网站压缩素材目录> --folders <活动目录名...> [--dry-run]');
    process.exit(1);
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

function readMap(file) {
  if (!fs.existsSync(file)) return {};
  const match = fs.readFileSync(file, 'utf8').match(/export default (.*);\s*$/s);
  return match ? JSON.parse(match[1]) : {};
}

function saveMap(file, map) {
  fs.writeFileSync(`${file}.tmp`, `export default ${JSON.stringify(map, null, 2)};\n`, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

function discoverFiles(root, current = root) {
  const result = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...discoverFiles(root, full));
    else if (MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      result.push({ fullPath: full, relativePath: path.relative(root, full).replaceAll(path.sep, '/') });
    }
  }
  return result;
}

async function buildFolderIdMap(indexFile) {
  const map = new Map();
  if (!fs.existsSync(indexFile)) return map;
  const { mediaEvents } = await import(pathToFileURL(indexFile).href);
  for (const event of mediaEvents || []) {
    if (event.folder) map.set(event.folder, event.id);
  }
  return map;
}

// 素材库目录名和网站压缩目录名常有「一期/二期」这类分叉，先归一化再认领
function normalizeFolder(name) {
  return name.replace(/[（(][^）)]*[）)]/gu, '').replace(/[一二三四五]期/gu, '').replace(/[\s_-]/gu, '');
}

function activityIdOf(mediaRoot, folder, folderIds) {
  if (folderIds.has(folder)) return folderIds.get(folder);
  const wanted = normalizeFolder(folder);
  for (const [candidate, id] of folderIds) {
    if (normalizeFolder(candidate) === wanted) return id;
  }
  const manifestFile = path.join(mediaRoot, folder, 'manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
    if (manifest.id) return manifest.id;
  }
  return folder;
}

async function uploadObject({ credential, app, objectKey, body, contentType }) {
  const url = `${API}/api/apps/${app}/public-objects/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    'x-bigapple-publisher-id': credential.publisherId,
    Authorization: `Bearer ${credential.token}`,
    'x-bigapple-skill-id': 'sk_405931e4-67f2-494f-aaca-8081885f54e5',
    'x-bigapple-skill-version': '2.4.0',
    'Content-Type': contentType,
  };
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'PUT', headers, body });
      if (response.ok) return response.json();
      const detail = await response.text();
      // 429/5xx 重试；其他（含额度不足 413）直接抛出，避免刷接口
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
        throw new Error(`${response.status} ${detail.slice(0, 200)}`);
      }
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
  throw new Error('upload failed');
}

const options = parseArgs(process.argv.slice(2));
const credential = readCredential();
const map = readMap(options.map);
const folderIds = await buildFolderIdMap(options.index);
let uploaded = 0;
let reused = 0;
const failures = [];

for (const folder of options.folders) {
  const folderRoot = path.join(options.mediaRoot, folder);
  if (!fs.existsSync(folderRoot)) throw new Error(`目录不存在：${folderRoot}`);
  const activityId = activityIdOf(options.mediaRoot, folder, folderIds);
  const files = discoverFiles(folderRoot);
  console.log(`\n${folder} → 活动 id ${activityId}，共 ${files.length} 个媒体文件`);
  for (const file of files) {
    const mapKey = `${activityId}/${file.relativePath}`;
    const extension = path.extname(file.fullPath).toLowerCase();
    const body = fs.readFileSync(file.fullPath);
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    if (map[mapKey]?.hash === hash) { reused += 1; continue; }
    if (options.dryRun) { uploaded += 1; continue; }
    try {
      const objectKey = `media/${hash}/${hash}${extension}`;
      const payload = await uploadObject({ credential, app: options.app, objectKey, body, contentType: CONTENT_TYPES[extension] });
      if (!payload.publicUrl) throw new Error(`没有返回 publicUrl：${JSON.stringify(payload).slice(0, 160)}`);
      map[mapKey] = { hash, url: payload.publicUrl, bytes: body.byteLength };
      uploaded += 1;
      if (uploaded % 10 === 0) {
        saveMap(options.map, map);
        console.log(`  已上传 ${uploaded} 个…`);
      }
    } catch (error) {
      failures.push(`${file.relativePath} :: ${error.message}`);
      console.error(`  ✗ ${file.relativePath} :: ${error.message}`);
    }
  }
}

if (!options.dryRun) saveMap(options.map, map);
console.log(`\n完成：${options.dryRun ? '待上传(dry-run)' : '新上传'} ${uploaded}，已存在跳过 ${reused}，失败 ${failures.length}`);
if (failures.length) console.log('失败清单见上方；修改后重跑本脚本会自动续传。');
