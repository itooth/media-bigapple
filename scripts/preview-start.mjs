#!/usr/bin/env node
/**
 * 本地预览一键启动：
 *   1) 生成预览索引（秒级，不查云端）
 *   2) 起本地图床（读「网站压缩素材」，只监听 127.0.0.1）
 *   3) 构建活动目录（带本地图床地址）
 *   4) 起 API 服务（3001）
 *   5) 起前端 dev（5173，支持热更新：改文件名/分数后刷新即可）
 * 全程只读本地素材，不上传、不修改云端。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_PORT = 5199, API_PORT = 3001, DEV_PORT = 5173;
const MEDIA_BASE = '/local-media';  // 由 vite dev 同进程提供
const children = [];

import net from 'node:net';
function portAlive(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}


function run(command, args, env = {}, label = '') {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code) => console.log(`[preview] ${label || command} 退出，code=${code}`));
  return child;
}

function step(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出 code=${code}`))));
  });
}

process.on('SIGINT', () => { for (const child of children) child.kill('SIGINT'); process.exit(0); });

console.log('[preview] 1/5 生成预览索引…');
await step(process.execPath, ['scripts/build-preview-index.mjs']);
console.log('[preview] 2/5 图床由前端 dev 同进程提供（/local-media）');
console.log('[preview] 3/5 构建活动目录…');
await step('npm', ['run', 'build:catalog'], { VITE_MEDIA_BASE_URL: MEDIA_BASE });
console.log('[preview] 4/5 启动 API…');
run(process.execPath, ['server/index.mjs'], { PORT: String(API_PORT), ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '9527' }, 'API');
await new Promise((r) => setTimeout(r, 1500));
console.log('[preview] 5/5 启动前端预览…');
run('npx', ['vite', '--port', String(DEV_PORT), '--host', '127.0.0.1'], { VITE_MEDIA_BASE_URL: MEDIA_BASE }, '前端');
// 素材目录变动 → 自动重扫预览索引（约 0.3 秒），前端 HMR 会自动刷新
import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
const WATCH_DIRS = [
  path.resolve(ROOT, '..', '..', '本地图存档', '网站压缩素材'),
  path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材'),
  path.resolve(ROOT, '..', '..', '素材库'),
].filter((dir) => fsSync.existsSync(dir));
let regenTimer = null;
let regenerating = false;
async function regenerate(reason) {
  if (regenerating) return;
  regenerating = true;
  try {
    await step(process.execPath, ['scripts/build-preview-index.mjs']);
    console.log(`[preview] 索引已重扫（${reason}）`);
  } catch (error) {
    console.error('[preview] 重扫索引失败：', error.message);
  } finally {
    regenerating = false;
  }
}
for (const dir of WATCH_DIRS) {
  try {
    fsSync.watch(dir, { recursive: true }, (_event, filename) => {
      if (filename && (String(filename).startsWith('._') || String(filename).includes('.DS_Store'))) return;
      clearTimeout(regenTimer);
      regenTimer = setTimeout(() => regenerate(filename || dir), 1200);
    });
    console.log(`[preview] 监听素材变动：${dir}`);
  } catch (error) {
    console.error(`[preview] 无法监听 ${dir}: ${error.message}`);
  }
}

console.log(`\n[preview] 打开预览：http://127.0.0.1:${DEV_PORT}\n[preview] 改文件名/分数/增删图片后会自动重扫索引并刷新页面（约 1-2 秒）。\n`);
