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
  const mediaUrl = (_activityId, relativePath) => urls.get(String(relativePath || '').replace(/^\//, '')) || '';
  const imageItem = (event, asset, index, kind) => ({ id: `${event.id}-${kind}-${index}`, image: mediaUrl(event.id, asset.path), alt: captionOf(asset.name), caption: captionOf(asset.name), position: index });

  // 活动图一律从媒体索引取（索引由云端清单生成，每条都带云端 url）。
  // 索引里没有的图不会渲染，见 docs/media-contract.md 硬规则 3。
  const currentAssets = assets;
  const selection = selectActivityPhotos(currentAssets);
  const sortedAssets = selection.sorted;
  const activity = sortedAssets.map((asset, index) => imageItem(record, asset, index, 'activity'));
  const homeActivity = selection.highlights.map((asset, index) => imageItem(record, asset, index, 'home'));
  const caseItems = (record.cases || []).sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name, 'zh-CN')).map((asset, index) => {
    const normalizedAsset = { ...asset, path: websiteAssetPath(asset.path) };
    return { ...imageItem(record, normalizedAsset, index, 'case'), path: normalizedAsset.path, title: legacyCaseTitle(asset, index), description: asset.description || '活动成员作品', href: asset.href, readme: asset.readme };
  });
  // 视频清单来自旧数据，扩展名可能是 .mov，而云端存的是 .mp4；先归一化再查索引，否则会白白查不到。
  // 云端没有这个视频时 src 会是空字符串：直接不渲染，避免页面上出现空白播放器。
  // 和图片同一条硬规则——只渲染云端确实有的媒体，见 docs/media-contract.md。
  const videos = (record.videos || [])
    .map((asset, index) => ({ id: `${record.id}-video-${index}`, src: mediaUrl(record.id, websiteAssetPath(asset.path)), title: captionOf(asset.name) }))
    .filter((video) => video.src);
  let productions = caseItems.slice(0, 7);
  const folderCases = cases;
  const homepageCases = folderCases.filter((item) => Number.isInteger(item.homeOrder)).sort((a, b) => a.homeOrder - b.homeOrder);
  const featuredCases = homepageCases.length ? homepageCases : folderCases;
  let productionGallery = folderCases.length ? folderCases.map((item, index) => ({ id: `${record.id}-case-gallery-${index}`, image: mediaUrl(record.id, item.path), path: item.path, alt: item.title, caption: item.title, title: item.title, href: item.href, readme: item.readme, position: index })) : [];
  if (agentCatalog) {
    productions = agentCatalog.slice(0, 7);
    productionGallery = agentCatalog;
  }
  if (folderCases.length) productions = featuredCases.slice(0, 7).map((item, index) => ({ id: `${record.id}-case-${index}`, image: mediaUrl(record.id, item.path), alt: item.title, caption: item.title, title: item.title, href: item.href, position: index }));
  if (aichongCases?.length) productions = aichongCases.slice(0, 7).map((item, index) => ({ id: `${record.id}-case-${index}`, image: mediaUrl(record.id, item.path), alt: item.title, caption: item.title, title: item.title, href: item.href, position: index }));
  const media = social.map((item, index) => ({ id: `${record.id}-social-${index}`, type: 'news', label: item.label, href: item.href }));
  const detail = { title: record.title, date: fullDateLabel(record.date), city: record.place, summary: record.summary || `${record.title}活动资料与成员作品归档。`, highlights: homeActivity.length ? homeActivity : activity.slice(0, 5), gallery: activity, productions, productionGallery: caseItems, media, videos, productionVideos: [] };
  detail.productionGallery = productionGallery;
  // id 用于查云端媒体；folder 才是唯一标识（素材库里存在同一 id 的副本文件夹，
  // 只拿 id 当 React key 会撞车，列表在切换筛选时可能渲染错乱）。
  return { id: record.id, uid: record.folder || record.id, partner: record.title, description: detail.summary, image: selection.cover ? mediaUrl(record.id, selection.cover.path) : caseItems[0]?.image || '', alt: record.title, sourceDate: record.date, tags: Array.isArray(record.tags) ? record.tags : [], detail };
}

export const sortEvents = (events) => events.sort((a, b) => String(b.sourceDate).localeCompare(String(a.sourceDate)));
