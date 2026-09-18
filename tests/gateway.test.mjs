import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createGateway } from '../gateway/server.mjs';

test('deployed process uses each entrance runtime ID instead of shared configuration files', async (t) => {
  const upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url })); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  for (const id of ['6024', '6025', '6026']) {
    const child = spawn(process.execPath, ['gateway/server.mjs'], { env: { ...process.env, PORT: '0', BRAND_ORIGIN: `http://127.0.0.1:${upstream.address().port}`, BRAND_RESELLER_ID: id }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const [chunk] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(5000) });
      const port = chunk.toString().match(/ready on (\d+)/)?.[1]; assert.ok(port);
      const response = await fetch(`http://127.0.0.1:${port}/api/site`);
      assert.deepEqual(await response.json(), { path: `/api/sites/${id}` });
    } finally { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  }
});

async function fixture(t, handler) {
  const upstream = http.createServer(handler); upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const gateway = createGateway({ origin: `http://127.0.0.1:${upstream.address().port}`, resellerId: '6024', timeoutMs: 1000 });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  t.after(async () => { await new Promise((r) => gateway.close(r)); await new Promise((r) => upstream.close(r)); });
  return `http://127.0.0.1:${gateway.address().port}`;
}

test('brand root and every activity route read one shared page; API always reads fixed reseller with no forwarded credentials', async (t) => {
  const seen = [];
  const site = { brand: { name: 'Polo Events' }, events: [{ uid: 'selected-only', detail: { gallery: ['photo'], notes: 'x'.repeat(4000) } }] };
  const html = '<!doctype html><html><head><title>Polo Events</title><meta name="brand-site" content="true"></head><body>shared frontend</body></html>';
  const base = await fixture(t, (req, res) => {
    seen.push(req.url);
    assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers['x-admin-request'], undefined);
    if (req.url === '/api/sites/6024') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(site)); }
    else { assert.equal(req.url, '/api/sites/6024/page'); res.setHeader('Content-Type', 'text/html'); res.end(html); }
  });
  for (const path of ['/', '/index.html', '/events/one', '/events/one/gallery', '/events/one/production-gallery', '/filter/FDE']) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.equal(await response.text(), html);
    assert.equal(response.headers.get('location'), null);
  }
  const response = await fetch(base + '/api/site?reseller=6025&url=https://evil.example', { headers: { Cookie: 'ba_admin=private', Authorization: 'Bearer private', 'X-Admin-Request': '1', 'Accept-Encoding': 'gzip' } });
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.deepEqual(await response.json(), site); assert.equal(seen.at(-1), '/api/sites/6024');
  // A later central update is visible immediately, with no separate frontend build.
  site.brand.name = 'Polo 新名称'; site.events = [];
  assert.deepEqual(await (await fetch(base + '/api/site')).json(), site);
  assert.equal((await fetch(base + '/', { method: 'HEAD' })).status, 200);
});

test('brand entrance blocks original APIs, numeric reseller switching and all mutations before reaching upstream', async (t) => {
  let called = 0;
  const base = await fixture(t, (_req, res) => { called++; res.end('not allowed'); });
  for (const path of ['/admin', '/api/admin/session', '/api/sites/6025', '/api/sites/6024/page', '/6025', '/6024/events/one', '/unknown']) {
    const response = await fetch(base + path); assert.equal(response.status, 404); assert.match(await response.text(), /href="\/"/);
  }
  assert.equal((await fetch(base + '/api/site', { method: 'POST', body: '{}' })).status, 405);
  assert.equal(called, 0);
});

test('missing or failing upstream never redirects or reveals the original unbranded page', async (t) => {
  let mode = 'unbranded';
  const base = await fixture(t, (_req, res) => {
    if (mode === 'redirect') { res.writeHead(302, { Location: 'https://media.bigapple.work/' }); res.end(); }
    else if (mode === 'missing') { res.writeHead(404); res.end('missing'); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<html>BigApple original</html>'); }
  });
  for (const value of ['unbranded', 'redirect', 'missing']) {
    mode = value; const response = await fetch(base + '/');
    assert.equal(response.status, value === 'missing' ? 404 : 502);
    assert.equal(response.headers.get('location'), null);
    assert.equal((await response.text()).includes('BigApple original'), false);
  }
});
