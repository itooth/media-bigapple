import { mediaByActivity } from './mediaIndex.generated.js';

export default mediaByActivity('opus-2026-08-02')
  .map((asset) => asset.path)
  .filter((path) => path.startsWith('01_活动照片/') && /\.(jpe?g|png|webp)$/i.test(path));
