import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectActivityPhotos } from '../src/lib/activitySelection.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const library = path.join(root, '素材库');
const web = path.join(root, 'anli_web/anli_web/public/网站压缩素材');
function files(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(path.join(dir, entry.name), `${prefix}${entry.name}/`)
    : [{ name: entry.name, path: `${prefix}${entry.name}`, bytes: fs.statSync(path.join(dir, entry.name)).size }]);
}
let errors = 0;
for (const entry of fs.readdirSync(library, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  const manifest = path.join(library, entry.name, 'manifest.json');
  if (fs.existsSync(manifest)) {
    try { JSON.parse(fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { console.log('INVALID JSON:', manifest, error.message); errors++; }
  }
  if (process.argv.includes('--json-only')) continue;
  const originals = files(path.join(library, entry.name, '01_活动照片'), '01_活动照片/').filter((a) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(a.name));
  const compressed = files(path.join(web, entry.name, '01_活动照片'), '01_活动照片/').filter((a) => /\.(jpe?g|png|webp|gif|bmp)$/i.test(a.name));
  const actual = new Set(compressed.map((a) => a.path));
  const expected = new Set(originals.map((a) => a.path.replace(/\.[^.]+$/, '.jpg')));
  for (const name of expected) if (!actual.has(name)) { console.log('MISSING:', entry.name, name); errors++; }
  for (const name of actual) if (!expected.has(name)) { console.log('STALE:', entry.name, name); errors++; }
  const selection = selectActivityPhotos(compressed);
  console.log(JSON.stringify({ activity: entry.name, photos: originals.length, cover: selection.cover?.name, homepage: selection.highlights.map((a) => a.name) }));
}
console.log('Audit errors:', errors);
process.exitCode = errors ? 1 : 0;
