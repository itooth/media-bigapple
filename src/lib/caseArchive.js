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

// 只取指定二级标题下的正文。下一个一级或二级标题结束本节。
function readmeSection(readme, heading) {
  const sections = String(readme || '').replace(/\r\n?/g, '\n').split(/^#{1,2}[ \t]+/m);
  for (const section of sections.slice(1)) {
    const [title, ...body] = section.split('\n');
    if (title.trim() === heading) return body.join('\n').trim();
  }
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

// 文档优先使用说明.md 的简介，避免把章节名、详细说明或旧版默认文案当作简介。
function caseDocSummary(item, title) {
  const summary = readmeSection(item.readme, '案例简介');
  if (summary !== undefined) return tidyText(summary);
  const description = item.description === '活动成员作品' ? '' : item.description;
  if (!description && /^#{1,2}[ \t]+(?:详细说明|案例名称|案例网址)[ \t]*\r?$/m.test(item.readme)) return '';
  return caseDescription({ description, readme: item.readme, title });
}

/** 标题归一：去掉空格、标点、括号里的序号，用来判断两张图是不是同一个案例。 */
function titleKey(title) {
  return String(title || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\-_·・.,:：;；!！?？'"“”‘’、/\\|]+/g, '')
    .trim();
}

/** 占位标题（“新建文件夹 (2)”“未命名案例”之类）不算真实作品名。 */
const PLACEHOLDER_TITLE = /^(新建文件夹|未命名|untitled|image|img|dsc|screenshot|截图|案例\s*\d*)$/iu;

/**
 * 吸引力分：用于案例墙默认排序。
 * 打分只看能自动判断的信号，不做视觉判断：
 *   能打开的网站 > 视频作品 > 多图完整案例 > 有真实描述 > 标题不是占位名。
 */
export function appealScore(item) {
  let score = 0;
  if (String(item.href || '').trim()) score += 100;
  if (item.video?.src) score += 80;
  if ((item.slides?.length || 0) >= 3) score += 30;
  if (item.description) score += 20;
  if (!PLACEHOLDER_TITLE.test(String(item.title || '').trim())) score += 10;
  return score;
}

/**
 * 把所有活动的「用户案例」摊平成案例列表。
 * 同一个案例的多张截图归成一张卡：先按 caseId，再按归一后的标题合并。
 * 案例本身没有日期，分月用的是所属活动的日期；组内保持活动里的原有顺序。
 */
export function buildCaseItems(events = [], { includeEventMedia = false } = {}) {
  const items = [];
  for (const event of events) {
    const screenshots = event.detail?.productionGallery || [];
    const gallery = includeEventMedia ? [...screenshots, ...(event.detail?.productions || [])] : screenshots;
    const grouped = new Map();
    // 同一个案例可能被拆成多个 caseId（历史素材没按标准整理），
    // 所以再按「归一后的标题」找一次：找到就并进已有那张卡，不新开一张。
    const byTitle = new Map();
    gallery.forEach((item, index) => {
      if (!item?.image && !(includeEventMedia && item?.href)) return;
      const groupKey = item.caseId || item.id || item.path || index;
      const title = item.title || item.alt || '未命名案例';
      const key = titleKey(title);
      const slide = { image: item.image, alt: item.alt || item.title, caption: item.title, path: item.path, sourceCaption: item.caption };
      const merged = grouped.get(groupKey) || (key ? byTitle.get(key) : null);
      if (merged) {
        if (includeEventMedia) grouped.set(groupKey, merged);
        if (item.image && !merged.slides.some(s => s.image === item.image)) merged.slides.push(slide);
        if (includeEventMedia) merged.href ||= item.href || '';
        merged.summary ||= caseDocSummary(item, title);
        merged.details ||= readmeSection(item.readme, '详细说明') || '';
        if (key && !byTitle.has(key)) byTitle.set(key, merged);
        return;
      }
      const entry = {
        key: `${event.uid || event.id}-${groupKey}`,
        slides: item.image ? [slide] : [],
        title: item.title || item.alt || '未命名案例',
        image: item.image,
        alt: item.title || item.alt || '',
        description: caseDescription({ description: item.description, readme: item.readme, title: item.title || item.alt }),
        summary: caseDocSummary(item, title),
        details: readmeSection(item.readme, '详细说明') || '',
        href: item.href || '',
        readme: item.readme || '',
        position: Number.isFinite(item.position) ? item.position : index,
        titlePinyin: item.titlePinyin || '',
        eventUid: event.uid || event.id,
        eventSlug: event.slug || '',
        eventId: event.id,
        eventTitle: event.partner || '',
        eventDate: event.sourceDate || '',
        eventCity: event.detail?.city || '',
        tags: Array.isArray(event.tags) ? event.tags : [],
      };
      grouped.set(groupKey, entry);
      if (key && !byTitle.has(key)) byTitle.set(key, entry);
      items.push(entry);
    });
    // 只有视频、没有截图的案例：用视频封面当卡片图，点开去活动页看视频。
    (event.detail?.productionVideos || []).forEach((video, index) => {
      if (!video?.src || (!video.caseId && !includeEventMedia)) return;
      const groupKey = video.caseId || video.id || video.src;
      const byId = grouped.get(groupKey);
      const title = video.caseTitle || video.title || '未命名案例';
      // 已经有同名截图案例时，视频只是这个案例的一件作品，不再单开一张卡。
      const videoKey = titleKey(title);
      const existing = byId || byTitle.get(videoKey);
      const clip = { src: video.src, poster: video.poster || '' };
      if (existing) {
        existing.videos ||= [];
        if (!existing.videos.some((item) => item.src === clip.src)) existing.videos.push(clip);
        // 网页沿用原卡片的点击行为；活动文档用 videos 展开全部视频。
        if (!byId) existing.video ||= clip;
        if (includeEventMedia) existing.href ||= video.href || '';
        existing.summary ||= caseDocSummary(video, title);
        existing.details ||= readmeSection(video.readme, '详细说明') || '';
        if (includeEventMedia) grouped.set(groupKey, existing);
        return;
      }
      const entry = {
        key: `${event.uid || event.id}-${groupKey}`, slides: [], video: clip, videos: [clip],
        title, image: video.poster || event.image || '', alt: title,
        description: caseDescription({ readme: video.readme, title }), href: video.href || '', readme: video.readme || '',
        summary: caseDocSummary(video, title),
        details: readmeSection(video.readme, '详细说明') || '',
        position: gallery.length + index, titlePinyin: video.titlePinyin || '',
        eventUid: event.uid || event.id, eventSlug: event.slug || '', eventId: event.id, eventTitle: event.partner || '',
        eventDate: event.sourceDate || '', eventCity: event.detail?.city || '', tags: Array.isArray(event.tags) ? event.tags : [],
      };
      grouped.set(groupKey, entry);
      if (videoKey && !byTitle.has(videoKey)) byTitle.set(videoKey, entry);
      items.push(entry);
    });
  }
  // 同月里按活动日期倒序；日期相同保持活动内原顺序（Array#sort 稳定）。
  // 「按吸引力」排序在 groupCases 里做，这里保持时间序作为稳定基准。
  return items.sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
}

/** 案例墙默认排序：吸引力从高到低，同分按日期新到旧，再按原来的活动内顺序。 */
export function compareByAppeal(a, b) {
  return (appealScore(b) - appealScore(a)) || String(b.eventDate).localeCompare(String(a.eventDate)) || (a.position - b.position);
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
    item.details,
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
