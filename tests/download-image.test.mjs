import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImageDownload } from '../src/lib/downloadImage.js';

test('download keeps image bytes and a readable name with the real MIME extension', async (t) => {
  const bytes = Uint8Array.from([137, 80, 78, 71]);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
  const result = await fetchImageDownload({ image: 'https://images.test/hash.jpg', title: '明德企智' }, { label: '明德企智' });
  assert.equal(result.filename, '明德企智.png');
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});

test('album names include context and sequence, without invalid filename characters', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('image bytes', { headers: { 'content-type': 'image/webp' } }));
  const result = await fetchImageDownload({ image: '/opaque', caption: '首屏/产品:详情' }, { label: '企业官网', index: 1, count: 3 });
  assert.equal(result.filename, '企业官网-首屏_产品_详情-002.webp');
});

test('historical JPEGs served as PNG download with a jpg extension without changing bytes', async (t) => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }));
  const result = await fetchImageDownload({ image: 'https://images.test/hash.png', title: '明德企智' });
  assert.equal(result.filename, '明德企智.jpg');
  assert.equal(result.blob.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});

test('HTTP errors, HTML error pages, empty files and cancellation never become image downloads', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('missing', { status: 404 }));
  const item = { image: 'https://images.test/a.png' };
  await assert.rejects(fetchImageDownload(item));
  mock.mock.mockImplementation(async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }));
  await assert.rejects(fetchImageDownload(item));
  mock.mock.mockImplementation(async () => new Response('', { headers: { 'content-type': 'image/png' } }));
  await assert.rejects(fetchImageDownload(item));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchImageDownload(item, { signal: controller.signal }), { name: 'AbortError' });
});
