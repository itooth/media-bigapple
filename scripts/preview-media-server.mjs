#!/usr/bin/env node
/**
 * 本地预览图床：把「网站压缩素材」按 <活动id>/<相对路径> 提供出去。
 * 只监听本机 127.0.0.1，只读，不改动任何文件，不上传云端。
 * 用法：node scripts/preview-media-server.mjs [port]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 本机副本（本地图存档）优先，iCloud 原件兜底；本机没同步到的图自动回退 iCloud。
const MEDIA_ROOTS = [
  process.env.ANLI_WEBSITE_MEDIA,
  path.resolve(ROOT, '..', '..', '本地图存档', '网站压缩素材'),
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
]
  .filter(Boolean)
  .filter((candidate) => fs.existsSync(candidate));
const MEDIA_ROOT = MEDIA_ROOTS[0];
const LIBRARY_ROOT = path.resolve(ROOT, '..', '..', '素材库');
const PORT = Number(process.argv[2] || process.env.PREVIEW_MEDIA_PORT || 5199);

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function folderById() {
  const map = new Map();
  if (!fs.existsSync(LIBRARY_ROOT)) return map;
  for (const entry of fs.readdirSync(LIBRARY_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(LIBRARY_ROOT, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
      map.set(manifest.id || entry.name, entry.name);
    } catch { map.set(entry.name, entry.name); }
  }
  return map;
}

let cache = { at: 0, map: new Map() };
function resolveId(id) {
  if (Date.now() - cache.at > 3000) cache = { at: Date.now(), map: folderById() };
  return cache.map.get(id);
}

const server = http.createServer((request, response) => {
  let url = '/';
  try { url = decodeURIComponent((request.url || '/').split('?')[0]); } catch { url = (request.url || '/').split('?')[0]; }
  if (!url.startsWith('/local-media/')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('preview media server: use /local-media/<activityId>/<path>');
    return;
  }
  const rest = url.slice('/local-media/'.length);
  const slash = rest.indexOf('/');
  const activityId = slash === -1 ? rest : rest.slice(0, slash);
  const relative = slash === -1 ? '' : rest.slice(slash + 1);
  const folder = resolveId(activityId) || activityId;
  const candidates = [];
  for (const root of MEDIA_ROOTS) {
    const filePath = path.resolve(path.join(root, folder, relative));
    // 目录穿越防护：越界的候选直接丢掉，不参与回退。
    if (filePath.startsWith(path.resolve(root) + path.sep)) candidates.push(filePath);
  }
  const send = (index) => {
    const filePath = candidates[index];
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found: ' + relative);
      return;
    }
    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) { send(index + 1); return; }
      const stream = fs.createReadStream(filePath);
      stream.on('open', () => {
        if (response.headersSent) return;
        response.writeHead(200, {
          'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Content-Length': stats.size,
          'Cache-Control': 'no-store',
        });
        stream.pipe(response);
      });
      stream.on('error', (readError) => {
        if (!response.headersSent) {
          try {
            response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(`media read failed: ${readError?.code || readError?.message || 'unknown'}`);
          } catch {}
        } else {
          try { response.destroy(); } catch {}
        }
      });
      response.on('error', () => { try { stream.destroy(); } catch {} });
    });
  };
  send(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview-media] http://127.0.0.1:${PORT}/local-media/  →  ${MEDIA_ROOT}`);
});

// 任何漏网异常都只记录，不让图床进程退出
process.on('uncaughtException', (error) => console.error('[preview-media] uncaught', error?.message || error));
process.on('unhandledRejection', (reason) => console.error('[preview-media] rejection', reason));
