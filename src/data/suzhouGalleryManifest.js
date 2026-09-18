import { mediaByActivity } from './mediaIndex.generated.js';
import { mediaUrl } from '../lib/media.js';

const entries = mediaByActivity('daming-yingjun-suzhou')
  .filter((asset) => asset.path.startsWith('01_') && /\.(jpe?g|png)$/i.test(asset.path))
  .sort((a, b) => {
    const posterA = /海报/.test(a.name) ? 0 : 1;
    const posterB = /海报/.test(b.name) ? 0 : 1;
    return posterA - posterB || a.path.localeCompare(b.path, undefined, { numeric: true });
  });

export default entries.map((asset, index) => ({
  id: `suzhou-photo-${index + 1}`,
  image: mediaUrl('daming-yingjun-suzhou', asset.path),
  alt: `宿州大明企业培训现场照片 ${index + 1}`,
  caption: '宿州大明企业培训活动现场',
}));
