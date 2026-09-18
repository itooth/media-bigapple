import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function backupData(dataDir, destination) {
  if (!fs.existsSync(path.join(dataDir, 'resellers.sqlite'))) throw new Error('数据库不存在，未创建备份');
  if (fs.existsSync(destination)) throw new Error('备份目标已存在，请使用新的目录');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, 'resellers.sqlite'), { readOnly: true });
  try { await backup(db, path.join(destination, 'resellers.sqlite')); }
  finally { db.close(); }
  // Read references from the consistent snapshot, not the still-changing source.
  const snapshot = new DatabaseSync(path.join(destination, 'resellers.sqlite'), { readOnly: true });
  try {
    const logos = snapshot.prepare('SELECT url FROM logos').all().map((row) => row.url);
    for (const url of logos.filter((url) => /^\/logos\/[a-f0-9]{64}\.png$/.test(url))) {
      const target = path.join(destination, 'logos', path.basename(url));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(dataDir, 'logos', path.basename(url)), target);
    }
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify({
      createdAt: new Date().toISOString(), integrity: snapshot.prepare('PRAGMA integrity_check').get().integrity_check,
      externalLogos: logos.filter((url) => url.startsWith('https://')),
      note: '外部图床与对象存储文件不在此备份中，须保留原对象；不包含管理员密码。',
    }, null, 2));
  } finally { snapshot.close(); }
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = process.env.BIGAPPLE_DATA_DIR || path.join(root, '.data');
  const destination = process.argv[2] || path.join(dataDir, 'backups', new Date().toISOString().replaceAll(':', '-'));
  console.log('Backup saved:', await backupData(dataDir, destination));
}
