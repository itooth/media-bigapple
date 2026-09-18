import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createApplication({
  events: JSON.parse(fs.readFileSync(path.join(root, 'dist-server/events.json'), 'utf8')),
  dataDir: process.env.BIGAPPLE_DATA_DIR || path.join(root, '.data'),
  distDir: path.join(root, 'dist'), adminPassword: process.env.ADMIN_PASSWORD,
  secureCookies: process.env.NODE_ENV === 'production', origin: process.env.APP_ORIGIN || '',
  storageUrl: process.env.BIGAPPLE_STORAGE_URL, storageToken: process.env.BIGAPPLE_STORAGE_TOKEN,
});
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`BigApple Events listening on port ${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
