import { pinyin } from 'pinyin-pro';
import { findEvent } from '../src/lib/eventSlug.js';

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));

// 案例名称的拼音（音节用空格隔开），给共用的案例搜索做全拼/首字母匹配。只在服务端算：拼音字典太大，不进浏览器。
const pinyinCache = new Map();
export function titlePinyin(title = '') {
  const key = String(title || '');
  if (!pinyinCache.has(key)) {
    const syllables = pinyin(key, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .flatMap((part) => String(part).toLowerCase().match(/[a-z0-9]+/g) || []);
    pinyinCache.set(key, syllables.join(' '));
  }
  return pinyinCache.get(key);
}

// The archive needs card/search fields, not the scene album or source metadata.
// Keep case descriptions and readmes because the search includes both; keep case videos so
// cases that only have a video still show up in the case list and search.
export function catalogEvent(event) {
  const withPinyin = (item, title) => ({ ...item, titlePinyin: titlePinyin(title) });
  return {
    ...pick(event, ['id', 'uid', 'slug', 'partner', 'description', 'sourceDate', 'image', 'alt', 'tags']),
    detail: {
      ...pick(event.detail || {}, ['title', 'city']),
      productionGallery: (event.detail?.productionGallery || []).map((item) => withPinyin(pick(item,
        ['id', 'caseId', 'path', 'title', 'alt', 'image', 'href', 'description', 'readme', 'position']), item.title || item.alt)),
      productionVideos: (event.detail?.productionVideos || []).map((item) => withPinyin(pick(item,
        ['id', 'caseId', 'caseTitle', 'title', 'src', 'poster', 'href', 'readme']), item.caseTitle || item.title)),
    },
  };
}

// Apply selection only AFTER the caller has restricted events to the brand's scope.
// No query preserves the complete legacy API contract used by existing tools/gateways.
export function publicEvents(events, params) {
  if (params.has('event')) {
    const event = findEvent(events, params.get('event'));
    return event ? [event] : [];
  }
  if (params.get('view') === 'catalog') return events.map(catalogEvent);
  return events;
}
