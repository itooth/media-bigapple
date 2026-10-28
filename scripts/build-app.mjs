import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readSeeds } from '../server/bootstrap.mjs';

function vite(args, env = {}) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status || 1);
}
// src/data is the maintained content source. A compiled catalog (from the case
// workflow) is used only when named explicitly, and a missing one fails closed.
const catalogPath = process.env.CASE_CATALOG;
let allEvents;
if (catalogPath) {
  if (!fs.existsSync(catalogPath)) throw new Error('指定的活动数据文件不存在');
  allEvents = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  console.log('Content source:', catalogPath);
} else {
  vite(['build', '--ssr', 'src/data/events.js', '--outDir', '.catalog-build'], { CATALOG_BUILD: '1' });
  ({ allEvents } = await import(pathToFileURL(path.resolve('.catalog-build/events.js'))));
}
if (!allEvents.length || new Set(allEvents.map((e) => e.uid)).size !== allEvents.length) throw new Error('Missing or duplicate activity identity');
fs.mkdirSync('dist-server', { recursive: true });
fs.writeFileSync('dist-server/events.json', JSON.stringify(allEvents));
console.log(`Catalog: ${allEvents.length} activities, ${allEvents.reduce((n, e) => n + e.detail.productionGallery.length, 0)} works`);
console.log(`Launch configuration: ${readSeeds(path.resolve('bootstrap'), allEvents).length} resellers validated`);
if (!process.argv.includes('--catalog-only')) vite(['build']);
