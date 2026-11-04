import test from 'node:test';
import assert from 'node:assert/strict';
import { assignSlugs, eventPath, findEvent } from '../src/lib/eventSlug.js';

test('one event per day gets a bare date slug; same-day events get stable ASCII suffixes', () => {
  const events = assignSlugs([
    { uid: '2026-10-11_牛客松北大汇丰商学院活动', id: 'a', sourceDate: '2026-10-11' },
    { uid: '2026-6-12_周周K12专场', id: 'b', sourceDate: '2026-6-12' },
    { uid: '2026-10-19_新客松A', id: 'c', sourceDate: '2026-10-19' },
    { uid: '2026-10-19_新客松B', id: 'd', sourceDate: '2026-10-19' },
    { uid: '2026-待定_其他案例', id: 'e', sourceDate: '2026-待定' },
  ]);
  assert.equal(events[0].slug, '2026-10-11');
  assert.equal(events[1].slug, '2026-06-12');
  assert.equal(events[2].slug, '2026-10-19');
  assert.match(events[3].slug, /^2026-10-19-[a-z0-9]{4}$/);
  assert.notEqual(events[2].slug, events[3].slug);
  assert.match(events[4].slug, /^event-[a-z0-9]{4}$/);
  for (const event of events) assert.match(eventPath(event), /^[\x21-\x7e]+$/);
  assert.deepEqual(assignSlugs([events[2]]), [events[2]]);
});

test('manual slug overrides; invalid or duplicate slugs fail the build', () => {
  assert.equal(assignSlugs([{ uid: 'x', sourceDate: '2026-10-11', slug: '2026-10-11-pkuhsbc' }])[0].slug, '2026-10-11-pkuhsbc');
  assert.throws(() => assignSlugs([{ uid: 'x', sourceDate: '2026-10-11', slug: '北大' }]));
  assert.throws(() => assignSlugs([{ uid: 'x', slug: 'a' }, { uid: 'y', slug: 'a' }]));
});

test('old Chinese folder links and legacy ids still resolve', () => {
  const events = assignSlugs([{ uid: '2026-10-11_牛客松北大汇丰商学院活动', id: '10-11', sourceDate: '2026-10-11' }]);
  for (const key of ['2026-10-11', '2026-10-11_牛客松北大汇丰商学院活动', '10-11']) assert.equal(findEvent(events, key), events[0]);
  assert.equal(findEvent(events, 'nope'), null);
});

const original = { uid: 'fixed', partner: '原名', sourceDate: '2026-10-19' };
const registry = { fixed: '2026-10-19' };
test('changing a title preserves the registered address', () => {
  assert.equal(assignSlugs([{ ...original, partner: '新名' }], registry)[0].slug, '2026-10-19');
});
test('changing a date preserves the registered address', () => {
  assert.equal(assignSlugs([{ ...original, sourceDate: '2027-01-01' }], registry)[0].slug, '2026-10-19');
});
test('adding a same-day activity preserves the issued date link', () => {
  const result=assignSlugs([original, {uid:'new',sourceDate:'2026-10-19'}],registry);
  assert.equal(result[0].slug,'2026-10-19'); assert.match(result[1].slug,/^2026-10-19-[a-z0-9]{4}$/);
  assert.equal(findEvent(result,'2026-10-19').uid,'fixed');
});
test('missing UID blocks a folder rename until registry key is migrated', () => {
  assert.throws(()=>assignSlugs([{...original,uid:'renamed'}],registry,{requireAllRegistered:true}),/修改 key/);
  assert.equal(assignSlugs([{...original,uid:'renamed'}],{renamed:'2026-10-19'},{requireAllRegistered:true})[0].slug,'2026-10-19');
});
test('registry validation, manual priority and reservation precede automatic allocation', () => {
  assert.throws(()=>assignSlugs([],{a:'中文'}));
  assert.throws(()=>assignSlugs([],{a:'same',b:'same'}));
  assert.equal(assignSlugs([{...original,slug:'custom'}],registry)[0].slug,'custom');
  assert.throws(()=>assignSlugs([{uid:'x',slug:''}]));
  assert.throws(()=>assignSlugs([{uid:'x',slug:'2026-10-19'}],registry));
});

test('server-added activities keep their link across restarts and never take a bundled link', async () => {
  const { openStore } = await import('../server/store.mjs');
  const os = await import('node:os'); const fsp = await import('node:fs'); const p = await import('node:path');
  const dir = fsp.mkdtempSync(p.join(os.tmpdir(), 'slug-store-'));
  const event = (uid, sourceDate) => ({ id: uid, uid, partner: uid, sourceDate, tags: [], detail: { productionGallery: [] } });
  let store = openStore(dir);
  store.syncCatalog([event('server-a', '2099-01-01')]);
  store.upsertActivity(event('server-b', '2099-01-01'), 'test');
  store.upsertActivity(event('server-c', '2026-10-19'), 'test'); // 2026-10-19 belongs to 新客松 in eventSlugs.json
  const before = Object.fromEntries(store.events().map((e) => [e.uid, e.slug]));
  assert.equal(before['server-a'], '2099-01-01');
  assert.match(before['server-b'], /^2099-01-01-[a-z0-9]{4}$/);
  assert.match(before['server-c'], /^2026-10-19-[a-z0-9]{4}$/);
  store.close();
  store = openStore(dir);
  assert.deepEqual(Object.fromEntries(store.events().map((e) => [e.uid, e.slug])), before);
  store.close(); fsp.rmSync(dir, { recursive: true, force: true });
});
