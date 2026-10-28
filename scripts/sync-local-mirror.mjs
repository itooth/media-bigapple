#!/usr/bin/env node
/**
 * 把 iCloud 里的「网站压缩素材」增量同步到本机副本（../../本地图存档/网站压缩素材）。
 *
 * 为什么要它：iCloud 里的文件可能是"云上占位"，后台预览服务读它会卡住或读不到；
 * 本机副本放本地磁盘，预览只读它，iCloud 原件原样保留当备份。
 *
 * 只读 iCloud、只写本机副本目录，不上传、不改动云端任何内容。
 * 用法：node scripts/sync-local-mirror.mjs [--dry-run]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.ANLI_MIRROR_SOURCE
  || path.resolve(ROOT, '..', '..', 'anli_web_图片存档', '网站压缩素材');
const TARGET = process.env.ANLI_MIRROR_LOCAL
  || path.resolve(ROOT, '..', '..', '本地图存档', '网站压缩素材');
const dryRun = process.argv.includes('--dry-run');

function countFiles(dir) {
  let total = 0;
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name.startsWith('._')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += 1;
    }
  };
  walk(dir);
  return total;
}

if (!fs.existsSync(SOURCE)) { console.error(`找不到 iCloud 镜像目录：${SOURCE}`); process.exit(1); }
fs.mkdirSync(TARGET, { recursive: true });

console.log(`[mirror] ${SOURCE}\n[mirror]   →  ${TARGET}`);
const before = countFiles(TARGET);

await new Promise((resolve, reject) => {
  const args = ['-a', '--exclude=.DS_Store'];
  if (dryRun) args.push('-n');
  args.push(`${SOURCE}/`, `${TARGET}/`);
  const child = spawn('rsync', args, { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`rsync 退出 code=${code}`))));
  child.on('error', reject);
});

const after = countFiles(TARGET);
const sourceTotal = countFiles(SOURCE);
console.log(`[mirror] 本机副本文件数 ${before} → ${after}（iCloud 共 ${sourceTotal}）` + (dryRun ? '（预演，未写入）' : ''));
if (!dryRun && after < sourceTotal) {
  console.log(`[mirror] 还差 ${sourceTotal - after} 个文件没同步到本机（多为 iCloud 未下载），再跑一次即可继续。`);
}
