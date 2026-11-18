// One activity's stored source record → the event the page renders.
// Pure: the server runs it on every read, so a new skin applies to every stored activity.
// source = { record, assets, cases, social, aichongCases?, agentCatalog? }; assets are the
// activity's media-index entries (each with its cloud url), so mediaUrl never leaves the record.
import { selectActivityPhotos } from './activitySelection.js';

const scoreOf = (asset) => Number((asset.name?.match(/(?:^|_)(\d{5})_/) || [])[1] || 0);
const captionOf = (name) => name.replace(/^\d{5}_/, '').replace(/\.[^.]+$/, '');
const websiteAssetPath = (value) => value
  .replace(/\.(jpe?g|png|webp|gif|bmp)$/i, '.jpg')
  .replace(/\.(mp4|mov|m4v|avi|mkv|webm)$/i, '.mp4');
const legacyCaseTitle = (asset, index) => {
  const existing = String(asset.title || '').trim();
  if (existing && existing !== '案例素材') return existing;
  const fromFile = captionOf(asset.name || '')
    .replace(/^主图[_-]?/u, '')
    .replace(/[_-]?(网页)?封面$/u, '')
    .trim();
  return fromFile && !/^[a-f\d]{16,}$/i.test(fromFile) ? fromFile : `案例 ${index + 1}`;
};

function dateParts(value) {
  const match = String(value || '').match(/^(\d{4})[-年](\d{1,2})(?:[-月](\d{1,2}))?/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : null };
}

function fullDateLabel(value) {
  const parts = dateParts(value);
  if (!parts) return value;
  return `${parts.year}年${parts.month}月${parts.day ? `${parts.day}日` : ''}`;
}

export function renderEvent({ record, assets = [], cases = [], social = [], aichongCases = null, agentCatalog = null }) {
  const urls = new Map(assets.map((item) => [item.path, item.url]));
  const mediaUrl = (_activityId, relativePath) => {
    const clean = String(relativePath || '').replace(/^\//, '');
    if (urls.has(clean)) return urls.get(clean) || '';
    // Some older manifests normalize PNG/JPEG names while the media index keeps
    // the uploaded extension. Try the alternate image extension without inventing
    // a URL; only an indexed path can return a result.
    const alternate = /\.jpg$/iu.test(clean) ? clean.replace(/\.jpg$/iu, '.png')
      : /\.png$/iu.test(clean) ? clean.replace(/\.png$/iu, '.jpg') : '';
    return alternate ? (urls.get(alternate) || '') : '';
  };
  // path 一并带出去：后台在照片查看器里点「设为封面」时，要拿它指回索引里那一张。
  const imageItem = (event, asset, index, kind) => ({ id: `${event.id}-${kind}-${index}`, image: mediaUrl(event.id, asset.path), alt: captionOf(asset.name), caption: captionOf(asset.name), position: index, path: asset.path });

  // 活动图一律从媒体索引取（索引由云端清单生成，每条都带云端 url）。
  // 索引里没有的图不会渲染，见 docs/media-contract.md 硬规则 3。
  const currentAssets = assets;
  const selection = selectActivityPhotos(currentAssets, record.coverPath || '');
  const sortedAssets = selection.sorted;
  const activity = sortedAssets.map((asset, index) => imageItem(record, asset, index, 'activity'));
  const homeActivity = selection.highlights.map((asset, index) => imageItem(record, asset, index, 'home'));
  const caseItems = [...(record.cases || [])].sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name, 'zh-CN')).map((asset, index) => {
    const normalizedAsset = { ...asset, path: websiteAssetPath(asset.path) };
    return { ...imageItem(record, normalizedAsset, index, 'case'), path: normalizedAsset.path, title: legacyCaseTitle(asset, index), description: asset.description || '活动成员作品', href: asset.href, readme: asset.readme };
  });
  // 视频清单来自旧数据，扩展名可能是 .mov，而云端存的是 .mp4；先归一化再查索引，否则会白白查不到。
  // 云端没有这个视频时 src 会是空字符串：直接不渲染，避免页面上出现空白播放器。
  // 和图片同一条硬规则——只渲染云端确实有的媒体，见 docs/media-contract.md。
  const videos = (record.videos || [])
    .map((asset, index) => {
      const posterPath = record.videoPosters?.[asset.path];
      const poster = posterPath ? mediaUrl(record.id, websiteAssetPath(posterPath)) : '';
      return { id: `${record.id}-video-${index}`, src: mediaUrl(record.id, websiteAssetPath(asset.path)),
        title: record.videoTitles?.[asset.path] || captionOf(asset.name), ...(poster ? { poster } : {}) };
    })
    .filter((video) => video.src);
  let productions = caseItems.slice(0, 7);
  const folderCases = cases;
  const homepageCases = folderCases.filter((item) => Number.isInteger(item.homeOrder)).sort((a, b) => a.homeOrder - b.homeOrder);
  const featuredCases = homepageCases.length ? homepageCases : folderCases;
  const caseSlides = (item, index) => {
    const screenshotFolder = item.path?.includes('/截图/') ? item.path.slice(0, item.path.indexOf('/截图/') + 4) : '';
    const archivedPaths = screenshotFolder ? assets.filter((asset) => asset.path.startsWith(screenshotFolder) && /\.(jpg|jpeg|png|webp|gif)$/i.test(asset.path))
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.path.localeCompare(b.path, 'zh-CN')).map((asset) => asset.path) : [];
    const paths = [...new Set([item.path, ...(item.imagePaths || archivedPaths)].filter(Boolean))];
    const caseId = item.folder || item.path || `case-${index}`;
    const base = { caseId, alt: item.title, caption: item.title, title: item.title, href: item.href, readme: item.readme };
    const slides = paths.filter((p) => mediaUrl(record.id, p)).map((p, n) => ({ ...base,
      id: `${record.id}-case-${index}-${n}`, image: mediaUrl(record.id, p), path: p, position: n }));
    return slides.length ? slides : item.href ? [{ ...base, id: `${record.id}-case-${index}`, image: '', path: item.path || '', position: 0 }] : [];
  };
  const folderSlides = folderCases.flatMap(caseSlides);
  const coveredPaths = new Set(folderSlides.map((item) => item.path));
  // Keep legacy works when a new folder-based case is appended to an old activity.
  let productionGallery = [...folderSlides, ...caseItems.filter((item) => !coveredPaths.has(item.path))];
  const productionVideos = folderCases.flatMap((item, index) => (item.videos || []).map((video, n) => ({
    id: `${record.id}-work-video-${index}-${n}`, title: video.title || item.title,
    caseId: item.folder || item.path || `case-${index}`, caseTitle: item.title || '', href: item.href || '', readme: item.readme || '',
    src: mediaUrl(record.id, websiteAssetPath(video.path)),
    poster: video.posterPath ? mediaUrl(record.id, websiteAssetPath(video.posterPath)) : '',
  }))).filter((video) => video.src);
  if (agentCatalog) {
    productions = agentCatalog.slice(0, 7);
    productionGallery = agentCatalog;
  }
  if (folderCases.length) productions = featuredCases.slice(0, 7).flatMap((item, index) => caseSlides(item, index).slice(0, 1));
  if (aichongCases?.length) productions = aichongCases.slice(0, 7).map((item, index) => ({ id: `${record.id}-case-${index}`, image: mediaUrl(record.id, item.path), alt: item.title, caption: item.title, title: item.title, href: item.href, position: index }));
  // 报道：老数据只有 label + href，新数据多出媒体名、标题、日期和截图。
  // 老数据不补默认值以外的字段，前端按「有就显示」处理，保证历史记录不报错。
  const media = social.map((item, index) => ({
    id: item.id || `${record.id}-social-${index}`,
    type: 'news',
    label: item.label || item.title || '活动报道',
    href: item.href,
    ...(item.outlet ? { outlet: item.outlet } : {}),
    ...(item.title ? { title: item.title } : {}),
    ...(item.date ? { date: item.date } : {}),
    ...(item.image ? { image: item.image } : {}),
  }));
  const detail = { title: record.title, date: fullDateLabel(record.date), city: record.place, summary: record.summary || `${record.title}活动资料与成员作品归档。`, highlights: homeActivity.length ? homeActivity : activity.slice(0, 5), gallery: activity, productions, productionGallery: caseItems, media, videos, productionVideos, ...(record.presentation ? { presentation: record.presentation } : {}) };
  detail.productionGallery = productionGallery;
  // id 用于查云端媒体；folder 才是唯一标识（素材库里存在同一 id 的副本文件夹，
  // 只拿 id 当 React key 会撞车，列表在切换筛选时可能渲染错乱）。
  return { id: record.id, uid: record.folder || record.id, ...(record.slug !== undefined ? { slug: record.slug } : {}), partner: record.title, description: detail.summary, image: selection.cover ? mediaUrl(record.id, selection.cover.path) : caseItems[0]?.image || '', alt: record.title, sourceDate: record.date, tags: Array.isArray(record.tags) ? record.tags : [], ...(record.coverPath ? { coverPath: record.coverPath } : {}), detail };
}

export const sortEvents = (events) => events.sort((a, b) => String(b.sourceDate).localeCompare(String(a.sourceDate)));
