/**
 * 文件名解析：把「五位评分_分类_描述.扩展名」拆成索引需要的字段。
 * 生成器（scripts/build-media-index.mjs）和前端共用这一份，避免两边解析结果不一致。
 * 词表定义见 docs/media-contract.md。
 */

export const CATEGORY_ACTIVITY = '活动';
export const CATEGORY_CASE = '案例';
export const CATEGORY_PRESS = '社交媒体';

export const CATEGORIES = [CATEGORY_ACTIVITY, CATEGORY_CASE, CATEGORY_PRESS];

// 细分类词表：三类互不共用
export const VOCABULARY = {
  [CATEGORY_ACTIVITY]: ['海报', '大合照', '人物', '演讲', '演示', '互动', '现场信息'],
  [CATEGORY_CASE]: ['作品界面', '作品演示', '主图', '辅图', '封面'],
  [CATEGORY_PRESS]: ['报道截图', '媒体版面', '公众号截图', '视频号封面'],
};

export const MARKER_HOMEPAGE = '首页';
export const MARKER_COVER = '封面';
export const UNCLASSIFIED = '其他';

const RATING = /^\d{5}(?!\d)/u;
const SEPARATORS = /[_\s\u3000]+/u;
const LEADING_SEPARATORS = /^[\s\u3000_-]+/u;
// 这些目录名是容器名，不算内容名，不进 description 兜底
const GENERIC_DIR = /^(0\d[_-]|_deleted|新建文件夹|待整理|待确认|案例素材|素材|截图|图片|照片|首页|其他|旧镜像)/u;

const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/iu;
const VIDEO = /\.(mp4|mov|m4v|avi|mkv|webm)$/iu;

export const isImageName = (name) => IMAGE.test(name || '');
export const isVideoName = (name) => VIDEO.test(name || '');

// 去掉扩展名，按下划线、半角空格、全角空格拆段
export function splitNameSegments(name) {
  const stem = String(name || '').replace(/\.[^./]+$/u, '');
  return stem.split(SEPARATORS).filter((segment) => segment !== '');
}

// 粗分类：由相对路径的第一层目录决定，「待确认_案例素材」这类靠关键词兜底
export function categoryOfPath(relPath) {
  const top = String(relPath || '').split('/')[0] || '';
  if (/^01[_-]?活动照片/u.test(top)) return CATEGORY_ACTIVITY;
  if (/^03[_-]?社交媒体/u.test(top)) return CATEGORY_PRESS;
  if (/^02[_-]?案例/u.test(top)) return CATEGORY_CASE;
  if (/案例/u.test(top)) return CATEGORY_CASE;
  if (/社交媒体/u.test(top)) return CATEGORY_PRESS;
  if (/活动/u.test(top)) return CATEGORY_ACTIVITY;
  return null;
}

// 从路径里找最近一个有意义的上层目录名，用作描述兜底
export function lastMeaningfulDir(relPath) {
  const parts = String(relPath || '').split('/').slice(0, -1);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index].trim();
    if (!part || GENERIC_DIR.test(part)) continue;
    return part;
  }
  return '';
}

const startsWithAny = (segment, words) => words.find((word) => segment.startsWith(word)) || '';

/**
 * 解析一个文件名。
 * 文件名格式：`五位数字分数_内容分类_具体描述.扩展名`，段数不固定，
 * 分隔符可能是下划线、空格或短横线（例如 `10050 封面-活动照片_IMG_1.jpg`）。
 */
export function parseMediaName({ name, path = '', category = CATEGORY_ACTIVITY }) {
  const segments = splitNameSegments(name);
  const vocabulary = VOCABULARY[category] || VOCABULARY[CATEGORY_ACTIVITY];
  const notes = [];

  let rating = '00000';
  let rest = segments;
  if (RATING.test(segments[0] || '')) {
    rating = (segments[0] || '').slice(0, 5);
    // 评分后面可能直接贴着内容（10050封面活动.jpg），把剩下的部分留作一段
    const leftover = (segments[0] || '').slice(5).replace(LEADING_SEPARATORS, '');
    rest = leftover ? [leftover, ...segments.slice(1)] : segments.slice(1);
  } else {
    notes.push('缺评分');
  }

  let isCover = 0;
  let onHomePage = 0;
  let categoryText = '';
  const descriptionParts = [];

  for (const segment of rest) {
    const homepageMark = segment.startsWith(MARKER_HOMEPAGE);
    if (homepageMark) {
      onHomePage = 1;
      const leftover = segment.slice(MARKER_HOMEPAGE.length).replace(LEADING_SEPARATORS, '');
      if (leftover) descriptionParts.push(leftover);
      continue;
    }
    // 「封面」只在活动里代表活动封面；案例里的「封面」是案例自己的封面，算细分类
    if (segment.startsWith(MARKER_COVER) && category === CATEGORY_ACTIVITY) {
      isCover = 1;
      const leftover = segment.slice(MARKER_COVER.length).replace(LEADING_SEPARATORS, '');
      if (leftover) descriptionParts.push(leftover);
      continue;
    }
    const word = startsWithAny(segment, vocabulary);
    if (!categoryText && word) {
      categoryText = word;
      const leftover = segment.slice(word.length).replace(LEADING_SEPARATORS, '');
      if (leftover) descriptionParts.push(leftover);
      continue;
    }
    descriptionParts.push(segment);
  }

  let unclassifiedSegments = [];
  if (!categoryText) {
    categoryText = UNCLASSIFIED;
    notes.push('未分类');
    unclassifiedSegments = descriptionParts.slice();
  }

  let description = descriptionParts.join('_').trim();
  if (!description) {
    description = lastMeaningfulDir(path);
    if (description) notes.push('描述兜底为目录名');
    else {
      description = String(name || '').replace(/\.[^./]+$/u, '');
      notes.push('描述兜底为文件名');
    }
  }

  return { rating, isCover, onHomePage, categoryText, description, notes, unclassifiedSegments };
}
