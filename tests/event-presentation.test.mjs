import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eventPresentation, downloadItems, safeUrl } from '../src/lib/eventPresentation.js';
import { downloadZip } from '../src/lib/downloadZip.js';
import { spawnSync } from 'node:child_process';

function liveCatalog() {
  const built = spawnSync(process.execPath, ['scripts/build-app.mjs', '--catalog-only'], { encoding: 'utf8', env: { ...process.env, CASE_CATALOG: '' } });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  return JSON.parse(fs.readFileSync('dist-server/events.json'));
}

test('all live activity media and links survive the presentation adapter without mutation', () => {
  const catalog = liveCatalog();
  assert(catalog.length >= 46);
  for (const event of catalog) {
    const before = JSON.stringify(event), d = event.detail, view = eventPresentation(event);
    const photos = new Set(view.photos.map(i => i.image));
    for (const p of [...d.gallery, ...d.highlights]) assert(photos.has(p.image), event.uid);
    const works = new Set(view.groups.flatMap(g => g.slides.map(i => i.image)));
    const links = new Set(view.websites.map(w => w.href));
    for (const p of [...d.productionGallery, ...d.productions]) {
      if (p.image) assert(works.has(p.image), event.uid);
      if (safeUrl(p.href)) assert(links.has(p.href), event.uid);
    }
    for (const [key, target] of [['videos','sceneVideos'],['productionVideos','workVideos']]) {
      const urls = new Set(view[target].map(v => v.src));
      for (const p of d[key] || []) assert(urls.has(p.src || p.url), event.uid);
    }
    assert.equal(JSON.stringify(event), before);
  }
});
test('same-title distinct cases and image plus website forms remain distinct; unsafe URLs rejected', () => {
  const view = eventPresentation({ detail: { gallery: ['https://example.test/a.jpg'], productionGallery: [
    { caseId: 'a', image: 'https://example.test/work.jpg', href: 'https://example.test', title: '同名' },
    { caseId: 'b', image: 'https://example.test/work.jpg', title: '同名' },
  ], presentation: { resources: [{ href: 'javascript:alert(1)' }] } } });
  assert.equal(view.photos.length, 1); assert.equal(view.groups.length, 2); assert.equal(view.websites.length, 1);
  assert.equal(view.resources.length, 0);
  assert.equal(safeUrl('//evil.test'), '');
});
test('download entries deduplicate identical URLs and never collide on file names', () => {
  const view = eventPresentation({image:'https://x.test/a.pdf',detail:{presentation:{resources:[{title:'素材',href:'https://x.test/b.pdf',downloadable:true}]}}});
  const names=downloadItems(view).map(i=>i.name); assert.equal(new Set(names).size,names.length); assert.equal(names.length,2);
});
test('ZIP contains UTF-8 names, original bytes and correct CRC; errors never return a partial archive', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response(new TextEncoder().encode('123456789'));
    const zip = new Uint8Array(await (await downloadZip([{url:'https://x.test',name:'照片/原片.txt'}], '网址')).arrayBuffer());
    const h = new DataView(zip.buffer); assert.equal(h.getUint32(0,true),0x04034b50); assert.equal(h.getUint32(14,true),0xcbf43926);
    const len=h.getUint16(26,true); assert.equal(new TextDecoder().decode(zip.slice(30,30+len)),'照片/原片.txt');
    assert.equal(new TextDecoder().decode(zip.slice(30+len,39+len)),'123456789');
    global.fetch=async()=>new Response('no',{status:404}); await assert.rejects(downloadZip([{url:'x',name:'x'}],''));
    const c=new AbortController(); c.abort(); await assert.rejects(downloadZip([{url:'x',name:'x'}],'',{signal:c.signal}));
  } finally { global.fetch=original; }
});
