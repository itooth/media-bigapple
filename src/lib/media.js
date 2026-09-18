import { mediaIndexEntry } from '../data/mediaIndex.generated.js';

// 前端不存放任何图片：所有图片都从云端链接取。
// 索引里的 url 就是云端那张图，hash 能在 url 里找到（见 docs/media-contract.md）。
const configuredBase = (import.meta.env.VITE_MEDIA_BASE_URL || '').replace(/\/$/, '');

/**
 * 取一张图的地址。
 * @param {string} activityId 活动编号，如 '01-1'
 * @param {string} relativePath 相对路径，从 `01_活动照片/` 起，如 '01_活动照片/10000_封面_海报_x.jpg'
 * @returns {string} 云端链接；索引里没有这张图时返回空字符串（调用方不要渲染）
 */
export function mediaUrl(activityId, relativePath) {
  const normalizedPath = String(relativePath || '').replace(/^\//, '');
  const entry = mediaIndexEntry(activityId, normalizedPath);
  if (entry) return entry.url;
  // 只有显式配置了本地媒体服务器时才回退到本地路径，正常情况永远走云端
  if (configuredBase) return `${configuredBase}/${activityId}/${normalizedPath}`;
  return '';
}

// 兼容旧调用：应用封面这类素材只有云端链接，没有本地文件。
export const cloudMediaUrl = mediaUrl;
