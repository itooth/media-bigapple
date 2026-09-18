import { mediaByActivity } from './mediaIndex.generated.js';
import { mediaUrl } from '../lib/media.js';

function videos(activityId, prefix) {
  if (import.meta.env.VITE_EXCLUDE_VIDEOS === 'true') return [];

  return mediaByActivity(activityId)
    .filter((asset) => asset.path.startsWith(prefix) && /\.(mp4|mov|webm)$/i.test(asset.path))
    .map((asset, index) => ({
      id: `${activityId}-video-${index + 1}`,
      src: mediaUrl(activityId, asset.path),
      title: asset.name,
      caption: asset.name,
      alt: asset.name,
    }));
}

export const agentActivityVideos = videos('agent-creation', '01_');
export const damingActivityVideos = videos('daming-yingjun-suzhou', '01_');
export const damingProductionVideos = videos('daming-yingjun-suzhou', '02_');
