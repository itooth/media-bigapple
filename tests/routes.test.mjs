import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, tenantPath } from '../src/lib/routes.js';
import { groupEvents } from '../src/lib/archive.js';

test('reseller scope survives filter, detail and both galleries', () => {
  for (const suffix of ['', '/filter/FDE', '/events/activity-27', '/events/activity-27/gallery', '/events/activity-27/production-gallery']) {
    assert.equal(parseRoute(`/6024${suffix}`).tenant, '6024');
  }
  assert.equal(tenantPath('6024', '/'), '/6024');
  assert.equal(tenantPath('6024', '/filter/FDE'), '/6024/filter/FDE');
  assert.equal(parseRoute('/events/activity-27').page, 'detail');
  const uid = '2026-6-12_周周K12专场_副本';
  assert.equal(parseRoute(`/6024/events/${encodeURIComponent(uid)}`).eventId, uid);
});
test('unknown and malformed paths do not fall back to all events', () => {
  for (const path of ['/foo', '/6024/unknown', '/6024/events/%GG', '/6024/filter/%GG']) assert.equal(parseRoute(path).page, 'not-found');
  assert.equal(parseRoute('/admin').page, 'admin');
});

test('branded host navigation cannot enter admin or switch reseller through path or hash routing', () => {
  for (const path of ['/admin', '/6024', '/6025/events/activity-a']) {
    const route = parseRoute(path, { branded: true });
    assert.equal(route.page, 'not-found'); assert.equal(route.tenant, null);
  }
  assert.equal(parseRoute('/', { branded: true }).page, 'archive');
  assert.equal(parseRoute('/events/activity-a', { branded: true }).page, 'detail');
  assert.equal(tenantPath(null, '/'), '/');
});
test('archive grouping preserves single-digit months and undated legacy entries', () => {
  const groups = groupEvents([{ sourceDate: '2026-6-12' }, { sourceDate: '2026-06-20' }, { sourceDate: '2026' }]);
  assert.equal(groups[0].label, '2026年6月');
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[1].label, '2026');
});
