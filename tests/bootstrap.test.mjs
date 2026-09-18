import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { initializeDatabase } from '../server/bootstrap.mjs';
import { backupData } from '../scripts/backup-data.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=', 'base64');
const events = [{ uid: 'a', partner: '活动甲', detail: { gallery: ['original-photo'] } }, { uid: 'b', partner: '活动乙' }];
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-bootstrap-'));
  const seedDir = path.join(root, 'seed'), dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(seedDir, 'logos'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'logos', 'brand.png'), png);
  const entries = [6024, 6025, 6026].map((id) => ({ id, key: `launch-${id}`, clientKey: `launch-client-${id}`, name: `品牌 ${id}`, logo: 'brand.png', activityIds: events.map((e) => e.uid) }));
  fs.writeFileSync(path.join(seedDir, 'resellers.json'), JSON.stringify({ version: 1, resellers: entries }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, entries, options: { events, seedDir, dataDir } };
}

test('fresh launch seeds three brands; repeated releases preserve all administrator edits and numbering', async (t) => {
  const { options } = setup(t);
  assert.deepEqual(await initializeDatabase(options), { activities: 2, imported: 3, resellers: 3 });
  let store = openStore(options.dataDir);
  const first = store.get(6024);
  const edited = store.update(6024, { ...first, name: '管理员改名', logoUrl: '', activityIds: ['b'] }, first.version);
  store.close();
  assert.equal((await initializeDatabase(options)).imported, 0);
  store = openStore(options.dataDir);
  assert.deepEqual(store.get(6024), edited);
  assert.deepEqual(store.siteEvents(6024), [events[1]]);
  const created = store.create({ name: 'New brand', logoUrl: '', activityIds: ['a'] }, 'another-client-key-0001', 'hash');
  assert.equal(created.record.id, '6027');
  store.close();
});

test('existing local reseller is adopted without overwriting its saved selections; conflicting IDs stop import', async (t) => {
  const { options, entries } = setup(t);
  let store = openStore(options.dataDir);
  store.create({ name: '已经手动修改', logoUrl: '', activityIds: ['b'] }, entries[0].clientKey, 'original-hash');
  store.close();
  await initializeDatabase(options);
  store = openStore(options.dataDir);
  assert.equal(store.get(6024).name, '已经手动修改');
  assert.deepEqual(store.get(6024).activityIds, ['b']); store.close();
  const other = { ...options, dataDir: path.join(path.dirname(options.dataDir), 'collision') };
  store = openStore(other.dataDir);
  store.create({ name: '其他品牌', logoUrl: '', activityIds: ['a'] }, 'unrelated-client-key', 'hash'); store.close();
  await assert.rejects(initializeDatabase(other), /已被其他代理商使用/);
  store = openStore(other.dataDir);
  assert.equal(store.list().length, 1); assert.equal(store.get(6024).name, '其他品牌'); store.close();
});

test('catalog updates persist content and archive removed IDs without resetting reseller selections', async (t) => {
  const { options } = setup(t); await initializeDatabase(options);
  const next = [{ ...events[1], partner: '活动乙更新' }, { uid: 'c', partner: '新增活动' }];
  await initializeDatabase({ ...options, events: next });
  let store = openStore(options.dataDir);
  assert.deepEqual(store.events(), next);
  assert.deepEqual(store.get(6025).activityIds, ['a', 'b']);
  assert.deepEqual(store.siteEvents(6025), [next[0]]);
  assert.throws(() => store.syncCatalog([events[0], events[0]]), /重复/);
  assert.deepEqual(store.events(), next); store.close();
  // Roll back the content release; same ID resolves to the original full activity.
  await initializeDatabase(options);
  store = openStore(options.dataDir); assert.deepEqual(store.siteEvents(6025), events); store.close();
});

test('production asset failure can be retried without partial reseller rows or duplicate imports', async (t) => {
  const { options } = setup(t); let fail = true; const keys = [];
  const storage = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-token');
    for await (const _ of req) { /* consume upload */ }
    keys.push(req.url);
    if (fail) { res.writeHead(503); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ publicUrl: `https://assets.example${req.url}` }));
  });
  storage.listen(0, '127.0.0.1'); await once(storage, 'listening');
  t.after(() => new Promise((resolve) => storage.close(resolve)));
  const production = { ...options, secureCookies: true, storageUrl: `http://127.0.0.1:${storage.address().port}`, storageToken: 'test-token' };
  await assert.rejects(initializeDatabase(production), /Logo 上传失败/);
  let store = openStore(options.dataDir); assert.equal(store.list().length, 0); store.close();
  fail = false; await initializeDatabase(production);
  const uploads = keys.length;
  await initializeDatabase(production); assert.equal(keys.length, uploads);
  assert.equal(new Set(keys).size, 1);
  store = openStore(options.dataDir); assert.equal(store.list().length, 3);
  assert.match(store.get(6026).logoUrl, /^https:/); store.close();
  assert.equal(fs.existsSync(path.join(options.dataDir, 'logos')), false);
});

test('online SQLite backup restores configuration, catalog, receipts and local logo bytes', async (t) => {
  const { root, options } = setup(t); await initializeDatabase(options);
  const store = openStore(options.dataDir);
  const destination = path.join(root, 'backup');
  await backupData(options.dataDir, destination);
  const restored = openStore(destination);
  assert.deepEqual(restored.list(), store.list()); assert.deepEqual(restored.events(), events);
  assert.equal(restored.hasBootstrap('launch-6024'), true);
  assert.deepEqual(fs.readFileSync(path.join(destination, restored.get(6024).logoUrl)), png);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'))).integrity, 'ok');
  store.close(); restored.close();
  await assert.rejects(backupData(options.dataDir, destination), /已存在/);
});

test('previous configuration-only schema is upgraded without losing the existing row', async (t) => {
  const { options, entries } = setup(t);
  fs.mkdirSync(options.dataDir);
  const legacy = new DatabaseSync(path.join(options.dataDir, 'resellers.sqlite'));
  legacy.exec(`CREATE TABLE resellers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,logo_url TEXT NOT NULL DEFAULT '',activity_ids TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,client_key TEXT NOT NULL UNIQUE,created_payload TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE logos(url TEXT PRIMARY KEY);`);
  legacy.prepare('INSERT INTO resellers(id,name,activity_ids,client_key,created_payload) VALUES (6024,?,?,?,?)').run('旧版本品牌', '["b"]', entries[0].clientKey, 'hash'); legacy.close();
  await initializeDatabase(options);
  const store = openStore(options.dataDir);
  assert.equal(store.get(6024).name, '旧版本品牌'); assert.deepEqual(store.get(6024).activityIds, ['b']);
  assert.equal(store.list().length, 3); assert.deepEqual(store.events(), events); store.close();
});
