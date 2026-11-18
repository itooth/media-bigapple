// Plain-text views of the public archive for AI agents. An agent given the site URL cannot run the
// React bundle and should not have to download photos to know what they show, so every public image
// is listed here with its section, parsed caption and (when reviewed) a short visual note.
import { eventPath, findEvent } from '../src/lib/eventSlug.js';
import { buildCaseItems } from '../src/lib/caseArchive.js';
import { createCaseSearch } from '../src/lib/caseSearch.js';
import { catalogEvent } from './public-events.mjs';

const SECTIONS = [
  ['highlights', '活动剪影（首页精选）'], ['gallery', '活动照片'], ['productions', '作品'],
  ['productionGallery', '作品截图'], ['videos', '活动视频'], ['productionVideos', '作品视频'], ['media', '媒体报道'],
];
export const PAGE_SIZE = 200;
const NOISE = /^(?:\d+(?: \d+)*|[0-9a-f]{8,}|IMG|VID|DSC\w*|微信图片|副本|(?:IMG|VID)[ -]?\d+(?: \d+)?)$/i;

export const mediaHash = (url = '') => url.match(/\/media\/([a-f0-9]{64})\//)?.[1] || '';

// Captions are file names such as「首页_封面_活动_教室分组实操全景_45275dbd04」.
export function parseCaption(text = '') {
  const parts = String(text).split('_').map((part) => part.trim()).filter(Boolean);
  const flags = { home: parts.includes('首页'), cover: parts.includes('封面') };
  const words = parts.filter((part) => !['首页', '封面'].includes(part) && !/^\d{5}$/.test(part) && !NOISE.test(part));
  return { ...flags, category: words.length > 1 ? words.slice(0, -1).join(' / ') : '', description: words.at(-1) || '' };
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const cell = (value) => clean(value).replaceAll('|', '／');

export function eventItems(event, notes = {}) {
  const items = [];
  for (const [key, label] of SECTIONS) for (const item of event.detail?.[key] || []) {
    if (!item || typeof item !== 'object') continue;
    const url = item.image || item.src || item.href || '';
    if (!url) continue;
    const caption = parseCaption(item.caption || item.alt || '');
    const note = notes[mediaHash(url)] || null;
    const readme = clean(item.readme).replace(/#+ ?/g, '').slice(0, 200);
    items.push({
      section: key, sectionLabel: label, url, href: item.image && item.href ? item.href : '', poster: item.poster || '',
      outlet: clean(item.outlet), date: clean(item.date),
      title: clean(item.title || item.label),
      category: caption.category, description: clean(item.description) || caption.description || readme,
      cover: caption.cover || item.image === event.image, home: key === 'highlights' || caption.home,
      note: note?.description || '', tags: note?.tags || [],
    });
  }
  return items;
}

const counts = (items) => {
  const n = (keys) => items.filter((item) => keys.includes(item.section)).length;
  return `照片 ${n(['gallery'])} · 作品 ${new Set(items.filter((i) => ['productions', 'productionGallery'].includes(i.section)).map((i) => i.title || i.url)).size} · 视频 ${n(['videos', 'productionVideos'])} · 报道 ${n(['media'])}`;
};
const slugOf = (event) => event.slug || event.uid;
const pageUrl = (origin, event) => origin + eventPath(event);
const mdUrl = (origin, event) => `${origin}/agent/events/${encodeURIComponent(slugOf(event))}.md`;

export function renderIndex(events, origin, notes = {}) {
  const lines = [
    '# BigApple Showcase 活动案例集', '',
    `> BigApple 与合作方举办的 AI 活动档案，共 ${events.length} 场，含现场照片、学员作品、视频和媒体报道。本文件是给 AI 助手读的文字版目录：不用运行网页，也不用下载图片。`, '',
    '## 怎么读', '',
    `- 单场活动的全部素材（每张图的描述和链接）：${origin}/agent/events/<slug>.md ，照片多时用 ?page=2 翻页`,
    `- 全部案例（作品）一览：${origin}/agent/cases.md （每个案例的名称、简介、网址、封面和所属活动）`,
    `- 按关键词找案例、活动和图片：${origin}/api/agent/search?q=关键词 （JSON。cases 和网页「案例」页的搜索结果一致：支持漏字、词序乱、全拼和首字母，如「光明大富」「dafuweng」「gmdfw」；events、images 要求每个词都出现）`,
    `- 单场活动原始数据：${origin}/api/site?event=<slug> （JSON）`,
    `- 给人看的网页：${origin}/events/<slug>`,
    '- 图片链接可以直接打开，是网页展示用的压缩版。「描述」来自素材文件名；「看图」一栏是看过图片后写的画面说明，只有封面和精选图有。', '',
    '## 活动（按日期从新到旧）', '',
  ];
  for (const event of events) {
    const items = eventItems(event, notes);
    const meta = [event.detail?.city, (event.tags || []).join('、'), counts(items)].map(clean).filter(Boolean).join('｜');
    lines.push(`- [${clean(event.sourceDate)} ${clean(event.partner)}](${mdUrl(origin, event)})：${meta}。${clean(event.description)}`);
  }
  return lines.join('\n') + '\n';
}

const itemLine = (item, index) => {
  // 报道是一篇文章：媒体名、标题、日期、链接，和照片的「文件名描述」不是一回事。
  if (item.section === 'media') {
    const head = [`《${item.title || item.description}》`, [item.outlet, item.date].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
    return `${index}. ${head}\n   ${item.href || item.url}${item.url && item.href ? `\n   截图：${item.url}` : ''}`;
  }
  const marks = [item.cover && '封面', item.section !== 'highlights' && item.home && '首页精选'].filter(Boolean).map((m) => `[${m}]`).join('');
  const head = [marks, item.title && `《${item.title}》`, item.description || '（文件名无描述）', item.category && `（${item.category}）`].filter(Boolean).join(' ');
  const extra = [item.note && `看图：${item.note}`, item.tags.length && `标签：${item.tags.join('、')}`, item.href && `作品地址：${item.href}`, item.poster && `封面图：${item.poster}`].filter(Boolean).join('；');
  return `${index}. ${head}${extra ? `。${extra}` : ''}\n   ${item.url}`;
};

export function renderEventDoc(event, origin, notes = {}, page = 1) {
  const items = eventItems(event, notes);
  const gallery = items.filter((item) => item.section === 'gallery');
  const pages = Math.max(1, Math.ceil(gallery.length / PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > pages) return null;
  const d = event.detail || {};
  const lines = [
    `# ${clean(d.title || event.partner)}`, '',
    `- 日期：${clean(d.date || event.sourceDate)}`, d.city && `- 地点：${clean(d.city)}`,
    event.tags?.length && `- 标签：${event.tags.join('、')}`, `- 素材：${counts(items)}`,
    `- 网页：${pageUrl(origin, event)}`, `- 原始数据：${origin}/api/site?event=${encodeURIComponent(slugOf(event))}`,
    event.image && `- 活动封面：${event.image}`, `- 返回目录：${origin}/llms.txt`, '',
    clean(d.summary || event.description), '',
  ].filter((line) => line !== false && line !== undefined && line !== null);
  for (const [key, label] of SECTIONS) {
    let list = items.filter((item) => item.section === key);
    if (!list.length) continue;
    if (key !== 'gallery' && page > 1) continue;
    let heading = `## ${label}（${list.length}）`;
    if (key === 'gallery' && pages > 1) {
      list = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      heading = `## ${label}（共 ${gallery.length} 张，第 ${page}/${pages} 页）`;
    }
    const offset = key === 'gallery' ? (page - 1) * PAGE_SIZE : 0;
    lines.push(heading, '', ...list.map((item, i) => itemLine(item, offset + i + 1)), '');
    if (key === 'gallery' && pages > 1) {
      const nav = [page > 1 && `上一页：${mdUrl(origin, event)}?page=${page - 1}`, page < pages && `下一页：${mdUrl(origin, event)}?page=${page + 1}`].filter(Boolean);
      lines.push(nav.join('；'), '');
    }
  }
  return lines.join('\n');
}

// 案例索引：和网页「案例」页同一份数据（catalogEvent → buildCaseItems）和同一个搜索函数。
// store.events() 每次改动才重建数组，所以按数组缓存即可。
const caseIndexes = new WeakMap();
export function caseIndex(events) {
  if (!caseIndexes.has(events)) {
    const items = buildCaseItems(events.map(catalogEvent));
    caseIndexes.set(events, { items, search: createCaseSearch(items) });
  }
  return caseIndexes.get(events);
}

function caseRecord(item, origin) {
  const event = { slug: item.eventSlug, uid: item.eventUid };
  return {
    title: clean(item.title), description: clean(item.description), href: item.href || '',
    image: item.image || '', images: item.slides.map((slide) => slide.image),
    video: item.video?.src || '', videoPoster: item.video?.poster || '',
    event: slugOf(event), eventTitle: clean(item.eventTitle), eventDate: clean(item.eventDate), eventCity: clean(item.eventCity),
    tags: item.tags, page: pageUrl(origin, event), doc: mdUrl(origin, event),
  };
}

export function renderCasesDoc(events, origin) {
  const { items } = caseIndex(events);
  const lines = [
    '# BigApple Showcase 全部案例', '',
    `> 共 ${items.length} 个案例（学员和合作方在活动里做出的作品：网站、小程序、海报、视频等），按所属活动日期从新到旧。`
      + `搜索：${origin}/api/agent/search?q=关键词 ；返回目录：${origin}/llms.txt`,
  ];
  let current = '';
  for (const item of items) {
    const record = caseRecord(item, origin);
    const heading = `## ${record.eventDate} ${record.eventTitle}`;
    if (heading !== current) { lines.push('', heading, '', `活动文档：${record.doc}`, ''); current = heading; }
    const extra = [record.href && `网址：${record.href}`, record.image && `封面：${record.image}`,
      record.images.length > 1 && `截图 ${record.images.length} 张（见活动文档）`, record.video && `视频：${record.video}`].filter(Boolean).join('；');
    lines.push(`- 《${cell(record.title)}》${record.description ? `：${record.description}` : ''}${extra ? `。${extra}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

const haystack = (...values) => values.flat().map(clean).join(' ').toLowerCase();

export function searchArchive(events, origin, query, notes = {}, limit = 30) {
  const terms = clean(query).toLowerCase().split(' ').filter(Boolean).slice(0, 8);
  if (!terms.length) return { query: '', cases: [], events: [], images: [] };
  const hits = (text) => terms.every((term) => text.includes(term));
  const cases = caseIndex(events).search(query);
  const found = { query: clean(query), totalCases: cases.length, cases: cases.slice(0, limit).map((item) => caseRecord(item, origin)), events: [], images: [] };
  for (const event of events) {
    const d = event.detail || {};
    const eventText = haystack(event.partner, d.title, d.city, event.tags || [], event.description, d.summary, event.sourceDate);
    const ref = { slug: slugOf(event), title: clean(event.partner), date: clean(event.sourceDate), doc: mdUrl(origin, event), page: pageUrl(origin, event) };
    if (hits(eventText)) found.events.push({ ...ref, city: clean(d.city), tags: event.tags || [], description: clean(event.description), cover: event.image || '' });
    for (const item of eventItems(event, notes)) {
      if (found.images.length >= limit) break;
      if (!hits(haystack(eventText, item.sectionLabel, item.title, item.category, item.description, item.note, item.tags))) continue;
      // Prefer images that match on their own words; event-only matches would list every photo.
      if (!hits(haystack(item.sectionLabel, item.title, item.category, item.description, item.note, item.tags)) && !item.home && !item.cover) continue;
      found.images.push({ event: ref.slug, eventTitle: ref.title, section: item.sectionLabel, title: item.title, description: item.description, note: item.note, tags: item.tags, cover: item.cover, url: item.url });
    }
  }
  found.events = found.events.slice(0, limit);
  return found;
}

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Server-side text placed inside #app. React replaces it on mount, so people never see it, while an
// agent that fetches the page without running scripts finds the catalog and the links above.
export function agentHtml(events, origin, pathname) {
  const slug = pathname.match(/^\/events\/([^/]+)/)?.[1];
  let key = ''; try { key = slug ? decodeURIComponent(slug) : ''; } catch { key = ''; }
  const event = key ? findEvent(events, key) : null;
  const link = (href, text) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  const body = event
    ? `<h1>${escapeHtml(event.detail?.title || event.partner)}</h1><p>${escapeHtml(event.description)}</p>`
      + `<p>给 AI 助手：本场活动全部照片、作品和视频的文字说明与图片链接见 ${link(mdUrl(origin, event), mdUrl(origin, event))}，全站目录见 ${link(`${origin}/llms.txt`, `${origin}/llms.txt`)}。</p>`
    : `<h1>BigApple Showcase 活动案例集</h1><p>给 AI 助手：本页由脚本渲染。文字版目录见 ${link(`${origin}/llms.txt`, `${origin}/llms.txt`)}；`
      + `全部案例 ${link(`${origin}/agent/cases.md`, `${origin}/agent/cases.md`)}；搜索接口 ${escapeHtml(origin)}/api/agent/search?q=关键词；单场活动文档如下。</p><ul>`
      + events.map((e) => `<li>${link(mdUrl(origin, e), `${clean(e.sourceDate)} ${clean(e.partner)}`)}：${escapeHtml(clean(e.description))}</li>`).join('') + '</ul>';
  return `<div class="agent-index" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">${body}</div>`;
}

export function injectAgentHtml(html, events, origin, pathname) {
  const head = `<link rel="alternate" type="text/markdown" title="AI 助手文字版目录" href="${escapeHtml(origin)}/llms.txt">`;
  return html.replace('</head>', `${head}</head>`).replace('<div id="app"></div>', () => `<div id="app">${agentHtml(events, origin, pathname)}</div>`);
}
