// Presentation adapter: the archive payload remains the content source.
// Optional presentation fields enrich old activities without rewriting their data.
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value.trim();
  if (/^\/(?!\/)/.test(text)) return text;
  try { const url = new URL(text); return ['https:', 'http:'].includes(url.protocol) ? text : ''; } catch { return ''; }
}

const imageOf = (item) => safeUrl(typeof item === 'string' ? item : item?.image || item?.src || item?.url);
const titleOf = (item) => item?.title || item?.caption || item?.alt || '';
function images(items) {
  const seen = new Set();
  return (items || []).flatMap((item, index) => {
    item = typeof item === 'string' ? { image: item } : (item || {});
    const image = imageOf(item);
    if (!image || seen.has(image)) return [];
    seen.add(image);
    return [{ ...item, id: item.id || `image-${index}`, image, thumb: safeUrl(item.thumb) || image,
      caption: titleOf(item), alt: item.alt || titleOf(item) }];
  });
}
function videos(items) {
  const seen = new Set();
  return (items || []).flatMap((item, index) => {
    const src = safeUrl(item.src || item.url);
    if (!src || seen.has(src)) return [];
    seen.add(src);
    return [{ ...item, id: item.id || `video-${index}`, src, poster: safeUrl(item.poster), title: titleOf(item) || '现场视频' }];
  });
}
function caseKey(item, index) {
  if (item.caseId) return `id:${item.caseId}`;
  const folder = String(item.path || '').replaceAll('\\', '/').match(/(?:^|\/)02_案例\/([^/]+)/)?.[1];
  // Directory membership is evidence; similar names by themselves are not.
  return folder ? `folder:${folder}` : `item:${item.id || index}`;
}
const readmeSummary = (readme = '') => readme.match(/##\s*案例简介\s*\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() || '';

export function eventPresentation(event) {
  const detail = event.detail || {}, extra = detail.presentation || {};
  // Keep complete gallery order, then retain any selected images absent from it.
  const photos = images([...(detail.gallery || []), ...(detail.highlights || [])]);
  const poster = images(extra.poster ? [extra.poster] : [])[0];
  const cover = images(event.image ? [{ image: event.image, caption: event.alt || detail.title }] : [])[0] || photos[0];
  const hero = images([poster, cover].filter(Boolean));
  const groups = new Map();
  const allWorks = [...(detail.productionGallery || []), ...(detail.productions || [])];
  const seenWork = new Map();
  allWorks.forEach((item, index) => {
    const image = imageOf(item), href = safeUrl(item.href);
    if (!image && !href) return;
    const key = caseKey(item, index);
    // The same featured item can have another id in the full gallery. Reuse it
    // only when media, title and destination all agree; don't merge other cases.
    const signature = JSON.stringify([item.caseId || '', image, item.title || '', href]);
    if (seenWork.has(signature)) return;
    seenWork.set(signature, key);
    if (!groups.has(key)) groups.set(key, { id: key, title: item.title || item.caption || '作品',
      description: item.description || readmeSummary(item.readme), slides: [], links: [] });
    const group = groups.get(key);
    if (image && !group.slides.some((slide) => slide.image === image)) group.slides.push(...images([item]));
    if (href && !group.links.some((link) => link.href === href)) group.links.push({ href, title: item.title || '打开网站' });
  });
  for (const group of extra.imageGroups || []) {
    const key = `explicit:${group.id}`;
    if (!groups.has(key)) groups.set(key, { ...group, id: key, slides: images(group.slides || []), links: [] });
  }
  const websites = [], websiteUrls = new Set();
  for (const group of groups.values()) for (const link of group.links) {
    if (websiteUrls.has(link.href)) continue;
    websiteUrls.add(link.href);
    websites.push({ id: `${group.id}:${link.href}`, title: link.title, description: group.description,
      href: link.href, image: group.slides[0]?.image || '' });
  }
  for (const item of extra.websites || []) {
    const href = safeUrl(item.href || item.url);
    if (!href || websiteUrls.has(href)) continue;
    websiteUrls.add(href); websites.push({ ...item, href, image: imageOf(item) });
  }
  const resources = (extra.resources || []).flatMap((item, i) => {
    const href = safeUrl(item.href || item.url || item.src);
    return href ? [{ ...item, id: item.id || `resource-${i}`, title: item.title || '活动资料', href }] : [];
  });
  const media = (detail.media || []).flatMap((item) => safeUrl(item.href) ? [{ ...item, href: safeUrl(item.href) }] : []);
  const logos = (extra.partners || []).flatMap((item) => imageOf(item) ? [{ ...item, image: imageOf(item), name: item.name || '' }] : []);
  return { id: event.uid || event.id, title: extra.headline || detail.title || event.partner,
    summary: extra.intro || detail.summary || event.description || '', date: detail.date || event.sourceDate || '',
    city: detail.city || '', hero, photos, groups: [...groups.values()].filter((g) => g.slides.length),
    websites, sceneVideos: videos(detail.videos), workVideos: videos(detail.productionVideos),
    logos, resources, media };
}

export function downloadItems(view) {
  const result = [], seen = new Set(), names = new Set();
  const clean = (text) => String(text || '素材').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80);
  const add = (folder, items, key, extension) => items.forEach((item, i) => {
    const url = safeUrl(item[key]); if (!url || seen.has(url)) return;
    seen.add(url);
    let ext;
    try { ext = new URL(url, 'https://local.invalid').pathname.match(/\.([a-z\d]{1,5})$/i)?.[1]; } catch {}
    let name = `${folder}/${String(i + 1).padStart(3, '0')}_${clean(titleOf(item))}.${ext || extension}`;
    while (names.has(name)) name = name.replace(/(\.[^.]+)$/, '_2$1');
    names.add(name); result.push({ url, name });
  });
  add('01_现场照片', view.photos, 'image', 'jpg');
  add('02_现场视频', view.sceneVideos, 'src', 'mp4');
  view.groups.forEach((group, i) => add(`03_图片作品/${String(i + 1).padStart(3, '0')}_${clean(group.title)}`, group.slides, 'image', 'jpg'));
  add('04_作品视频', view.workVideos, 'src', 'mp4');
  add('05_活动资料', [...view.hero, ...view.logos], 'image', 'jpg');
  // Only declared downloadable documents become ZIP entries. Other links remain links.
  add('05_活动资料', view.resources.filter((r) => r.downloadable === true), 'href', 'pdf');
  return result;
}
