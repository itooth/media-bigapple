// 本地预览：用网站工程的服务端渲染一份给定的原始记录列表，链接（slug）沿用线上，便于和正式站逐场对比。
// node preview_server.mjs --repo <网站工程> --sources sources.json --slugs slugs.json --data <临时目录> --port 4320
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const repo = path.resolve(arg('repo')), dataDir = path.resolve(arg('data')), port = Number(arg('port') || 4320);
const events = JSON.parse(fs.readFileSync(arg('sources'), 'utf8'));
const slugs = JSON.parse(fs.readFileSync(arg('slugs'), 'utf8'));
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
const { openStore } = await import(pathToFileURL(path.join(repo, 'server/store.mjs')).href);
openStore(dataDir).close();
const { DatabaseSync } = await import('node:sqlite');
const dbFile = fs.readdirSync(dataDir).find((f) => f.endsWith('.db') || f.endsWith('.sqlite'));
const db = new DatabaseSync(path.join(dataDir, dbFile));
db.prepare("INSERT INTO settings(key,value) VALUES ('event_slugs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(slugs));
db.close();
const { createApplication } = await import(pathToFileURL(path.join(repo, 'server/app.mjs')).href);
createApplication({ events, dataDir, distDir: path.join(repo, 'dist'), adminPassword: crypto.randomBytes(24).toString('hex') })
  .listen(port, '127.0.0.1', () => console.log(`预览 http://localhost:${port}/`));
