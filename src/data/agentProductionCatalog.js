import { cloudMediaUrl } from '../lib/media.js';
import { mediaIndex } from './mediaIndex.generated.js';

// 应用封面不在活动照片目录里，本地没有对应文件，
// 统一走云端媒体链接，前端不再打包任何图片。
const activityId = '08-22-ai-agent-17';

const catalog = [
  ['personal-info', '个人信息工作台', '02_案例/首页01_09900_个人信息工作台/截图/主图.jpg', '个人信息、行动与记忆管理工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_e449722c6aff01c2/personal-info-workbench/index.html'],
  ['btc-research', 'BTC 研究助手', '02_案例/首页02_09850_BTC 研究助手/截图/主图.jpg', '面向 BTC 信息分析的研究助手。', 'https://app.dalijiao.com:9303/uploads/deployment/p_021e7052032efd36/btc-research-assistant/index.html'],
  ['family-care', '心语家庭关怀', '02_案例/08500_心语家庭关怀/截图/主图.jpg', '面向家庭沟通与关怀的智能应用。', 'https://app.dalijiao.com:9303/uploads/deployment/p_05ed01be7b4b3c4a/xin-yu-family-care/index.html'],
  ['study-pressure', '学习压力重生', '02_案例/08500_学习压力重生/截图/主图.jpg', '帮助理解和应对学习压力的互动作品。', 'https://app.dalijiao.com:9303/uploads/deployment/p_37c56be667f9aea8/study-pressure-rebirth/index.html'],
  ['dual-city', '双城记', '02_案例/首页03_09800_双城记/截图/主图.jpg', '连接深圳与云南本地生活的技能交换社区。', 'https://fengliwei001.github.io/dual-city/index.html'],
  ['chip-customer', '芯片客户工作台', '02_案例/08500_芯片客户工作台/截图/主图.jpg', '面向芯片业务的客户管理工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_33d8d089ef6f1397/chip-customer-workbench/index.html'],
  ['pi-order', 'PI 订单工作台', '02_案例/08500_PI 订单工作台/截图/主图.jpg', '订单匹配、审核与 PI 生成工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_fdb0c56c000719d3/pi-order-workbench-demo/index.html'],
  ['interview-trainer', '面试语音训练器', '02_案例/08500_面试语音训练器/截图/主图.jpg', '通过语音互动进行面试训练。', 'https://app.dalijiao.com:9303/uploads/deployment/p_b15814b0fb3ab84e/interview-voice-trainer/index.html'],
  ['four-fruits', 'Four Fruits', '02_案例/08500_Four Fruits/截图/主图.jpg', '围绕四种水果展开的互动作品。', 'https://app.dalijiao.com:9303/uploads/deployment/p_58d5950b9391b4e7/four-fruits/index.html'],
  ['activity-workbench', '活动工作台', '02_案例/首页04_09750_活动工作台/截图/主图.jpg', '活动策划与执行协作工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_0c4ce3966e443912/activity-workbench/index.html'],
  ['customer-success', '客户成功工作台', '02_案例/08500_客户成功工作台/截图/主图.jpg', '客户成功业务管理工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_549484dc81000827/customer-success-workbench/index.html'],
  ['digital-colleague', '行政数字同事', '02_案例/08500_行政数字同事/截图/主图.jpg', '辅助行政事务处理的数字同事。', 'https://app.dalijiao.com:9303/uploads/deployment/p_b9c53b243fb623bb/xingzheng-shuzi-tongshi/index.html'],
  ['homeroom', '班主任工作台', '02_案例/08500_班主任工作台/截图/主图.jpg', '面向班级信息与事务管理的工作台。', 'https://app.dalijiao.com:9303/uploads/deployment/p_593c6341dc4a7ade/homeroom-workbench/index.html'],
  ['ui-accelerator', 'UI 方案加速器', '02_案例/首页05_09700_UI 方案加速器/截图/主图.jpg', '辅助生成和推进 UI 方案。', 'https://app.dalijiao.com:9303/uploads/deployment/p_78fb9a0f8f4e7d61/ui-solution-accelerator/index.html'],
  ['ugc-sales', 'UGC 销售 Agent', '02_案例/08500_UGC 销售 Agent/截图/主图.jpg', '围绕 UGC 内容开展销售协作的 Agent。', 'https://app.dalijiao.com:9303/uploads/deployment/p_bf09c031f4e96ef5/ugc-sales-agent/index.html'],
  ['health-plan', '健康计划', '02_案例/首页06_09650_健康计划/截图/主图.jpg', '生成并维护个人健康计划的智能助手。', 'https://app.dalijiao.com:9303/uploads/deployment/p_f507d0a5372aa66c/jiankang-plan-demo/index.html'],
];

// 这几张封面是写死的路径；素材重新整理后文件名多了后缀（主图.jpg → 主图_xxx.jpg），
// 精确对不上时，在同一案例目录里找「主图*」，避免整条案例因为找不到封面而被丢掉。
function resolveCoverPath(mediaPath) {
  const exact = mediaIndex.some((item) => item.activityId === activityId && item.path === mediaPath);
  if (exact) return mediaPath;
  const dir = mediaPath.slice(0, mediaPath.lastIndexOf('/') + 1);
  const ext = mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase();
  const candidates = mediaIndex
    .filter((item) => item.activityId === activityId && item.path.startsWith(dir) && /主图/.test(item.path))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  const sameExt = candidates.find((item) => item.path.toLowerCase().endsWith(ext));
  return (sameExt || candidates[0])?.path || '';
}

export default catalog.map(([id, title, mediaPath, description, href]) => ({
  id: `agent-${id}`,
  image: cloudMediaUrl(activityId, resolveCoverPath(mediaPath)),
  title,
  description,
  href,
})).filter((item) => item.image);
