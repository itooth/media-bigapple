// 案例分类：先按「案例文字 + 所属活动」自动判断，判断不出的归到「其他」。
// 分类名固定为这 6 个（用户 2026-11-18 确认）+ 其他。
// 等每个案例补了真实描述、定了标签之后，以数据里的 category 为准，这里的规则只做兜底。

export const CASE_CATEGORIES = ['电商', '游戏', '内容', '网站', '教育', '亲子'];

/** 按优先级排列：先命中哪个就算哪个，越靠前越具体。 */
const RULES = [
  ['电商', /电商|商品|主图|详情页|淘宝|天猫|京东|拼多多|带货|投放|广告图|包装|价签|橱窗|上架|雨靴|鞋类|服饰|服装|珠宝|茶叶|厨具|领饰|烫钻|花卉|花艺|家具|零食|美妆|护肤|母婴产品/u],
  ['游戏', /游戏|小游戏|闯关|密室|解谜|关卡|像素|弹幕|对战|养成|跑酷|消除|RPG|game/iu],
  ['网站', /网站|官网|网页|小程序|工具|工作台|系统|平台|看板|助手|App|应用|dashboard|studio|系统设计/iu],
  ['教育', /课程|教案|课件|教学|学习|课堂|老师|教师|学生|考试|背单词|题库|培训|讲解|知识库|笔记/iu],
  ['亲子', /亲子|小朋友|孩子|家长|儿童|宝宝|幼儿|全家/iu],
  ['内容', /视频|口播|短视频|广告片|宣传片|表情包|海报|文案|公众号|推文|直播|播客|音乐|歌曲|MV|封面图|脚本/iu],
];

/**
 * 判断一个案例属于哪个品类。
 * @param {{title?:string, description?:string, href?:string, readme?:string, eventTitle?:string, video?:object}} item
 * @returns {string} 品类名；判断不出返回空字符串
 */
export function categoryOf(item = {}) {
  const text = [item.title, item.description, item.href, item.eventTitle].filter(Boolean).join(' ');
  for (const [name, pattern] of RULES) {
    if (pattern.test(text)) return name;
  }
  return '';
}

/** 卡片上显示的品类：判断不出就归「其他」。 */
export const displayCategory = (item) => categoryOf(item) || '其他';
