import fs from 'node:fs';
import path from 'node:path';
import { openStore } from './store.mjs';
import { saveLogo, validateLogo } from './logos.mjs';

// Public launch configuration only: no passwords, cookies or local SQLite files.
export function readSeeds(seedDir, events) {
  const seeds = JSON.parse(fs.readFileSync(path.join(seedDir, 'resellers.json'), 'utf8'));
  if (seeds.version !== 1 || !Array.isArray(seeds.resellers)) throw new Error('初始化配置版本无效');
  const ids = new Set(), keys = new Set(), clients = new Set();
  const known = new Set(events.map((e) => e.uid));
  return seeds.resellers.map((entry) => {
    if (!Number.isSafeInteger(entry.id) || entry.id < 6024 || ids.has(entry.id) || typeof entry.key !== 'string' || !entry.key || keys.has(entry.key) || typeof entry.clientKey !== 'string' || !/^[\w-]{16,80}$/.test(entry.clientKey) || clients.has(entry.clientKey)) throw new Error('初始化代理商编号或标识无效');
    if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.trim().length > 60) throw new Error('初始化网站名称无效');
    if (!Array.isArray(entry.activityIds) || !entry.activityIds.length || new Set(entry.activityIds).size !== entry.activityIds.length) throw new Error('初始化活动范围无效');
    if (entry.activityIds.some((id) => !known.has(id))) throw new Error(`初始化活动不存在：${entry.name}`);
    if (typeof entry.logo !== 'string' || !/^[a-z0-9-]+\.png$/.test(entry.logo)) throw new Error('初始化 Logo 文件名无效');
    const bytes = fs.readFileSync(path.join(seedDir, 'logos', entry.logo)); validateLogo(bytes);
    ids.add(entry.id); keys.add(entry.key); clients.add(entry.clientKey);
    return { ...entry, bytes };
  });
}

export async function initializeDatabase({ events, seedDir, ...options }) {
  const store = openStore(options.dataDir);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(seedDir, 'resellers.json'), 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.resellers)) throw new Error('初始化配置版本无效');
    // Already applied seeds may refer to activities removed in later releases.
    // Only validate their content when there is new launch data to import.
    const pending = manifest.resellers.filter((e) => !store.hasBootstrap(e.key));
    let entries = [];
    if (pending.length) {
      // Validation uses the whole initial catalog so duplicate keys are rejected.
      // For applied rows, their original IDs need not be present in a newer catalog.
      const historicalIds = manifest.resellers.filter((e) => store.hasBootstrap(e.key)).flatMap((e) => e.activityIds || []);
      const validationEvents = [...events, ...historicalIds.map((uid) => ({ uid }))];
      entries = readSeeds(seedDir, validationEvents).filter((e) => !store.hasBootstrap(e.key));
      for (const entry of entries) {
        if (entry.activityIds.some((id) => !events.some((event) => event.uid === id))) throw new Error(`初始化活动不存在：${entry.name}`);
        const existing = store.get(entry.id);
        if (existing && store.getClientKey(entry.id) !== entry.clientKey) throw new Error(`初始化编号 ${entry.id} 已被其他代理商使用，请先核对`);
      }
      // Resolve all assets before committing any new reseller. Retrying an object
      // upload uses the same content hash and never creates a duplicate reseller.
      for (const entry of entries) entry.logoUrl = store.get(entry.id)?.logoUrl ?? await saveLogo(entry.bytes, options);
    }
    store.syncCatalog(events);
    store.installSeeds(entries);
    return { activities: store.events().length, imported: entries.length, resellers: store.list().length };
  } finally { store.close(); }
}
