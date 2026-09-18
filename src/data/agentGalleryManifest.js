import { mediaByActivity } from './mediaIndex.generated.js';
import { mediaUrl } from '../lib/media.js';

const entries = mediaByActivity('agent-creation')
  .map((asset) => asset.path)
  .filter((path) => path.startsWith('01_') && /\.(jpe?g|png)$/i.test(path))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

export default entries.map((path) => mediaUrl('agent-creation', path));
