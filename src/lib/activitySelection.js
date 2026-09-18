import { CATEGORY_ACTIVITY, isImageName } from './mediaNaming.js';

const ratingOf = (item) => Number(item.rating) || 0;

/**
 * 从一个活动的索引记录里挑出封面和第一屏「活动剪影」。
 * 规则与改造前一致：
 *   - 候选 = `01_活动照片/` 下的图片，按评分从高到低
 *   - 封面 = 评分最高的、带「封面」标记的那张；没有标记就退回评分最高的一张
 *   - 剪影 = 带「首页」标记的图，去掉封面本身
 *   - 剪影为空时退回评分最高的前 5 张
 * 注意：候选只认索引里有云端 url 的记录，没有 url 的图不会进列表（硬规则 3）。
 * @param {Array} records 某个活动的索引记录（见 mediaByActivity）
 */
export function selectActivityPhotos(records = []) {
  const sorted = records
    .filter((item) => item.category === CATEGORY_ACTIVITY
      && item.path?.startsWith('01_活动照片/')
      && isImageName(item.name)
      && item.url)
    .slice()
    .sort((a, b) => ratingOf(b) - ratingOf(a) || a.name.localeCompare(b.name, 'zh-CN'));

  const markedCover = sorted.find((item) => item.isCover === 1) || null;
  const homepage = sorted.filter((item) => item.onHomePage === 1 && item !== markedCover);
  const selected = markedCover ? [markedCover, ...homepage] : homepage;
  const cover = markedCover || sorted[0] || null;

  return { sorted, cover, highlights: selected.length ? selected : sorted.slice(0, 5) };
}
