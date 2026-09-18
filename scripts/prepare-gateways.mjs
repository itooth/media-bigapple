import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, '.release', `gateways-${new Date().toISOString().replaceAll(':', '-')}`);
const sites = JSON.parse(fs.readFileSync(path.join(root, 'gateway/sites.json')));
for (const { slug, resellerId } of sites) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^\d+$/.test(resellerId)) throw new Error('Invalid brand entrance');
  const dir = path.join(destination, slug);
  fs.mkdirSync(path.join(dir, 'gateway'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server'));
  fs.writeFileSync(path.join(dir, 'Dockerfile'), fs.readFileSync(path.join(root, 'gateway/Dockerfile'), 'utf8').replace('__RESELLER_ID__', resellerId));
  fs.copyFileSync(path.join(root, 'gateway/server.mjs'), path.join(dir, 'gateway/server.mjs'));
  fs.copyFileSync(path.join(root, 'server/response.mjs'), path.join(dir, 'server/response.mjs'));
  console.log(`${slug}: ${dir}`);
}
