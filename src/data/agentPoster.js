import { mediaByActivity } from './mediaIndex.generated.js';
import { mediaUrl } from '../lib/media.js';

const asset = mediaByActivity('agent-creation').find((entry) => entry.name.includes('活动海报'));
export default asset ? mediaUrl('agent-creation', asset.path) : '';
