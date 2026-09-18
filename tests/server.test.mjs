import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { createApplication } from '../server/app.mjs';

const events = [
  { id: 'shared-id', uid: 'activity-a', partner: '活动甲', sourceDate: '2026-09-01', tags: ['FDE'], detail: { gallery: ['photo-a'], productions: ['work-a'] } },
  { id: 'shared-id', uid: 'activity-b', partner: '活动乙', sourceDate: '2026-08-01', tags: ['行业共创'], detail: { gallery: ['photo-b'], productions: ['work-b'] } },
];
const password = 'test-only-private-password';
async function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bigapple-test-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>BigApple Events</title><meta name="description" content="BigApple Events 合作活动档案" /></head><body>test client</body></html>');
  let server;
  async function start() {
    server = createApplication({ events, dataDir: dir, distDir: dir, adminPassword: password, ...extra });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  let base = await start(); let cookie = '';
  const request = async (url, { method = 'GET', body, headers = {}, redirect = 'follow' } = {}) => {
    const response = await fetch(base + url, { method, redirect, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'X-Admin-Request': '1', 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body) }) });
    return response;
  };
  const login = async () => { const response = await request('/api/admin/login', { method: 'POST', body: { password: extra.adminPassword ?? password } }); assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0]; return response; };
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  return { request, login, restart: async () => { await new Promise((resolve) => server.close(resolve)); base = await start(); }, dataDir: dir };
}
const createBody = (clientKey = 'a-fixed-client-key-0001') => ({ clientKey, name: 'Polo Events', logoUrl: '', activityIds: events.map((e) => e.uid) });

test('a configured four-character password authenticates and wrong passwords remain rejected', async (t) => {
  const f = await fixture(t, { adminPassword: 'test' });
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  await f.login();
  assert.equal((await f.request('/api/admin/resellers')).status, 200);
});

test('domain binding is authenticated, unique, durable and redirects old links without altering selections', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/resellers/6024/domain', { method: 'PUT', body: { hostname: 'polo-events.bigapple.work' } })).status, 401);
  await f.login();
  const first = await (await f.request('/api/admin/resellers', { method: 'POST', body: createBody() })).json();
  const second = await (await f.request('/api/admin/resellers', { method: 'POST', body: createBody('second-client-key-0002') })).json();
  for (const hostname of ['media.bigapple.work', 'api.bigapple.work', 'evil.example', 'https://polo-events.bigapple.work', 'polo.bigapple.work/evil']) {
    assert.equal((await f.request('/api/admin/resellers/6024/domain', { method: 'PUT', body: { hostname } })).status, 400);
  }
  const bound = await (await f.request('/api/admin/resellers/6024/domain', { method: 'PUT', body: { hostname: 'polo-events.bigapple.work' } })).json();
  assert.equal(bound.publicUrl, 'https://polo-events.bigapple.work');
  assert.deepEqual(bound.activityIds, first.activityIds); assert.equal(bound.version, first.version);
  assert.equal((await f.request(`/api/admin/resellers/${second.id}/domain`, { method: 'PUT', body: { hostname: 'polo-events.bigapple.work' } })).status, 409);
  const old = await f.request('/6024/events/activity-a/gallery?from=shared', { redirect: 'manual' });
  assert.equal(old.status, 302); assert.equal(old.headers.get('location'), 'https://polo-events.bigapple.work/events/activity-a/gallery?from=shared');
  await f.restart(); await f.login();
  assert.equal((await (await f.request('/api/admin/resellers')).json()).resellers[0].publicUrl, bound.publicUrl);
  assert.equal((await f.request('/api/sites/6024')).status, 200);
});

test('branded HTML uses escaped current branding and never falls back on a missing reseller', async (t) => {
  const f = await fixture(t); await f.login();
  await f.request('/api/admin/resellers', { method: 'POST', body: { ...createBody(), name: 'Polo <script>&' } });
  const html = await (await f.request('/api/sites/6024/page')).text();
  assert.match(html, /<title>Polo &lt;script&gt;&amp;<\/title>/);
  assert.match(html, /<meta name="brand-site" content="true">/);
  assert.equal(html.includes('BigApple Events'), false);
  assert.equal((await f.request('/api/sites/9999/page')).status, 404);
});

test('login, protected writes, CSRF checks and logout', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/resellers')).status, 401);
  assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: createBody() })).status, 401);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  const login = await f.login();
  assert.match(login.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/);
  assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: createBody(), headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: createBody(), headers: { 'X-Admin-Request': '' } })).status, 403);
  assert.equal((await f.request('/api/admin/logout', { method: 'POST' })).status, 200);
  assert.equal((await f.request('/api/admin/resellers')).status, 401);
});

test('default all, exclude one entire activity, public scoping and persistence', async (t) => {
  const f = await fixture(t); await f.login();
  let response = await f.request('/api/admin/resellers', { method: 'POST', body: createBody() });
  assert.equal(response.status, 201); const created = await response.json();
  assert.equal(created.id, '6024'); assert.equal(created.activityIds.length, 2);
  assert.equal((await (await f.request('/api/sites/6024')).json()).events.length, 2);
  response = await f.request('/api/admin/resellers/6024', { method: 'PUT', body: { ...created, activityIds: ['activity-b'] } });
  assert.equal(response.status, 200);
  const publicSite = await (await f.request('/api/sites/6024')).json();
  assert.deepEqual(publicSite.events, [events[1]]); // Same legacy id must not leak excluded activity A.
  assert.equal(JSON.stringify(publicSite).includes('photo-a'), false);
  assert.equal(publicSite.brand.name, 'Polo Events');
  assert.equal((await (await f.request('/api/site')).json()).events.length, 2);
  assert.equal((await f.request('/api/sites/9999')).status, 404);
  assert.equal((await f.request('/6024/events/activity-b/gallery')).status, 200);
  await f.restart();
  assert.deepEqual((await (await f.request('/api/sites/6024')).json()).events, [events[1]]);
  assert.equal((await f.request('/api/admin/resellers')).status, 401);
});

test('creation retries do not duplicate; stale edits cannot overwrite newer configuration', async (t) => {
  const f = await fixture(t); await f.login();
  const first = await (await f.request('/api/admin/resellers', { method: 'POST', body: createBody() })).json();
  const repeat = await (await f.request('/api/admin/resellers', { method: 'POST', body: createBody() })).json();
  assert.equal(first.id, repeat.id);
  assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: { ...createBody(), name: 'different' } })).status, 409);
  assert.equal((await f.request('/api/admin/resellers/6024', { method: 'PUT', body: { ...first, name: 'New name' } })).status, 200);
  assert.equal((await f.request('/api/admin/resellers/6024', { method: 'PUT', body: first })).status, 409);
});

test('invalid activities, logos and empty names are rejected', async (t) => {
  const f = await fixture(t); await f.login();
  for (const value of [{ name: '' }, { activityIds: [] }, { activityIds: ['unknown'] }, { logoUrl: 'https://untrusted.example/logo.svg' }]) {
    assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: { ...createBody(), ...value } })).status, 400);
  }
});

test('logo upload is authenticated, bounded, and shared publicly only by content hash', async (t) => {
  const f = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=', 'base64');
  const upload = () => f.request('/api/admin/logos', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal((await upload()).status, 401); await f.login();
  assert.equal((await f.request('/api/admin/logos', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<script>bad</script>' })).status, 400);
  const first = await (await upload()).json(); const repeat = await (await upload()).json(); assert.equal(first.url, repeat.url);
  assert.match(first.url, /^\/logos\/[a-f0-9]{64}\.png$/);
  const image = await f.request(first.url); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await f.request('/api/admin/resellers', { method: 'POST', body: { ...createBody(), logoUrl: first.url } })).status, 201);
});

test('password attempts are limited and production cookie is secure', async (t) => {
  const f = await fixture(t, { secureCookies: true });
  const success = await f.login(); assert.match(success.headers.get('set-cookie'), /^__Host-ba_admin=.*; Secure$/);
  for (let i = 0; i < 8; i++) assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password: 'bad' } })).status, 401);
  assert.equal((await f.request('/api/admin/login', { method: 'POST', body: { password } })).status, 429);
});

test('production Logo uploads use object storage without exposing its token', async (t) => {
  let uploaded = false;
  const storage = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-storage-secret');
    assert.equal(req.method, 'PUT'); assert.match(req.url, /^\/public-objects\/logos\/[a-f0-9]{64}\.png$/);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.ok(Buffer.concat(chunks).length > 33); uploaded = true;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ publicUrl: 'https://assets.example/logo.png' }));
  });
  storage.listen(0, '127.0.0.1'); await once(storage, 'listening');
  t.after(() => new Promise((resolve) => storage.close(resolve)));
  const f = await fixture(t, { secureCookies: true, storageUrl: `http://127.0.0.1:${storage.address().port}`, storageToken: 'test-storage-secret' }); await f.login();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=', 'base64');
  const response = await f.request('/api/admin/logos', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { url: 'https://assets.example/logo.png' });
  assert.equal(uploaded, true); assert.equal(fs.existsSync(path.join(f.dataDir, 'logos')), false);
});
