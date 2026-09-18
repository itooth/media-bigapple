import { mediaUrl } from '../lib/media.js';

const shantouCharacterDesign = mediaUrl('shantou-lions-training', '02_案例/案例照片/shantou-character-design.jpg');

// Confirmed BigApple-made assets that are ready for a future event detail page.
export const productionCatalog = [
  {
    id: 'shantou-character-design',
    eventId: 'shantou-lions-training',
    status: 'ready',
    image: shantouCharacterDesign,
    alt: '汕头狮子会培训活动人物角色视觉设计',
    title: '人物角色视觉设定',
    description: '为活动内容制作的角色形象与服装视觉方案。',
  },
];
