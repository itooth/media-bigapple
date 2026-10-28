import { monthLabelOf } from './archive.js';

function tidyText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutTitle(text, title) {
  if (!text) return '';
  if (title && text.startsWith(title)) {
    return text.slice(title.length).replace(/^[\s:：,，.。\-—]+/u, '').trim();
  }
  return text;
}

/**
 * 案例自带的描述：优先用数据里的 description，其次从「说明.md」的
 * 「## 案例简介」取；都没有就返回空字符串（卡片退回只显示所属活动）。
 */
export function caseDescription(item) {
  const title = String(item?.title || '').trim();
  const direct = tidyText(item?.description);
  if (direct) return withoutTitle(direct, title);

  const readme = String(item?.readme || '');
  if (!readme.trim()) return '';

  const section = readme.match(/##\s*案例简介\s*\r?\n([\s\S]*?)(?=\r?\n##\s|$)/u);
  if (section?.[1]) {
    const text = withoutTitle(tidyText(section[1]), title);
    if (text) return text;
  }

  // 没有「案例简介」小标题：取正文第一段不是名称/链接的文字。
  const picked = [];
  for (const line of readme.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^https?:\/\//u.test(trimmed)) continue;
    const cleaned = tidyText(trimmed);
    if (!cleaned || cleaned === title) continue;
    picked.push(cleaned);
    if (picked.join(' ').length >= 40) break;
  }
  return withoutTitle(picked.join(' '), title);
}

/**
 * 把所有活动的「用户案例」摊平成案例列表。
 * 案例本身没有日期，分月用的是所属活动的日期；组内保持活动里的原有顺序。
 */
export function buildCaseItems(events = []) {
  const items = [];
  for (const event of events) {
    const gallery = event.detail?.productionGallery || [];
    gallery.forEach((item, index) => {
      if (!item?.image) return;
      items.push({
        key: `${event.uid || event.id}-${item.id || item.path || index}`,
        title: item.title || item.alt || '未命名案例',
        image: item.image,
        alt: item.title || item.alt || '',
        description: caseDescription({ description: item.description, readme: item.readme, title: item.title || item.alt }),
        href: item.href || '',
        readme: item.readme || '',
        position: Number.isFinite(item.position) ? item.position : index,
        eventUid: event.uid || event.id,
        eventId: event.id,
        eventTitle: event.partner || '',
        eventDate: event.sourceDate || '',
        eventCity: event.detail?.city || '',
        tags: Array.isArray(event.tags) ? event.tags : [],
      });
    });
  }
  // 同月里按活动日期倒序；日期相同保持活动内原顺序（Array#sort 稳定）。
  return items.sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
}

export function tokenizeQuery(query) {
  return String(query || '').trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
}

/** 多关键词：每个词都要命中（顺序无关）。 */
export function matchesTokens(text, tokens) {
  if (!tokens?.length) return true;
  const haystack = String(text || '').toLocaleLowerCase('zh-CN');
  return tokens.every((token) => haystack.includes(token));
}

function dateSearchText(value) {
  const raw = String(value || '');
  const key = raw.slice(0, 7);
  return [raw, raw.replaceAll('-', '/'), key, key.replace('-', '/'), monthLabelOf(raw)].join(' ');
}

export function caseSearchText(item) {
  return [
    item.title,
    item.description,
    item.eventTitle,
    item.eventCity,
    item.readme,
    item.href,
    (item.tags || []).join(' '),
    dateSearchText(item.eventDate),
  ].join(' ');
}

export function eventSearchText(event, caseTitles = []) {
  return [
    event.partner,
    event.description,
    (event.tags || []).join(' '),
    event.detail?.city,
    dateSearchText(event.sourceDate),
    caseTitles.join(' '),
  ].join(' ');
}
