import { mediaByActivity } from './mediaIndex.generated.js';
import { mediaUrl } from '../lib/media.js';

const assets = mediaByActivity('daming-yingjun-suzhou');
const images = assets.filter((asset) => asset.path.startsWith('02_') && /\.(png|jpe?g)$/i.test(asset.path));

export default images.map((asset, index) => ({
  id: `daming-production-${index + 1}`,
  image: mediaUrl('daming-yingjun-suzhou', asset.path),
  alt: asset.name,
  title: asset.name.replace(/[-_](封面|网页封面|本地作品图)$/u, ''),
  description: '宿州大明企业培训案例作品。',
}));
