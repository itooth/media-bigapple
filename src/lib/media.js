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
  // 本地预览模式：显式设置 VITE_MEDIA_BASE_URL 时，一律读本机预览服务，不碰云端。
  // 这条分支只在 `npm run dev` 预览时生效；正式构建不带这个变量，永远走云端链接。
  if (configuredBase) return `${configuredBase}/${activityId}/${normalizedPath}`;
  const entry = mediaIndexEntry(activityId, normalizedPath);
  if (entry) return entry.url;
  return '';
}

// 兼容旧调用：应用封面这类素材只有云端链接，没有本地文件。
export const cloudMediaUrl = mediaUrl;
