import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './app.mjs';
import { initializeDatabase } from './bootstrap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = {
  events: JSON.parse(fs.readFileSync(path.join(root, 'dist-server/events.json'), 'utf8')),
  dataDir: process.env.BIGAPPLE_DATA_DIR || path.join(root, '.data'),
  distDir: path.join(root, 'dist'), adminPassword: process.env.ADMIN_PASSWORD,
  secureCookies: process.env.NODE_ENV === 'production', origin: process.env.APP_ORIGIN || '',
  storageUrl: process.env.BIGAPPLE_STORAGE_URL, storageToken: process.env.BIGAPPLE_STORAGE_TOKEN,
};
if (!options.adminPassword || options.adminPassword.length < 12 || options.adminPassword === 'replace-with-a-long-private-password') throw new Error('请通过 ADMIN_PASSWORD 设置至少 12 位的管理员密码');
if (options.secureCookies && !process.env.BIGAPPLE_DATA_DIR) throw new Error('生产环境必须配置 BIGAPPLE_DATA_DIR 到持久化卷');
console.log('Database ready:', await initializeDatabase({ ...options, seedDir: path.join(root, 'bootstrap') }));
const server = createApplication(options);
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`BigApple Events listening on port ${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
