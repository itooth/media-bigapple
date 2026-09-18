import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'resellers.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('数据库版本高于当前程序，请使用匹配的版本'); }
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS resellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, logo_url TEXT NOT NULL DEFAULT '',
      activity_ids TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      client_key TEXT NOT NULL UNIQUE, created_payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS logos (url TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS activities (
      uid TEXT PRIMARY KEY, payload TEXT NOT NULL, position INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bootstrap_receipts (key TEXT PRIMARY KEY, reseller_id INTEGER NOT NULL REFERENCES resellers(id));
    INSERT INTO sqlite_sequence(name,seq) SELECT 'resellers',6023
      WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='resellers');
    PRAGMA user_version=1; COMMIT;`);
  const record = (row) => row ? { id: String(row.id), name: row.name, logoUrl: row.logo_url, activityIds: JSON.parse(row.activity_ids), version: row.version } : null;
  return {
    close: () => db.close(),
    list: () => db.prepare('SELECT * FROM resellers ORDER BY id').all().map(record),
    get: (id) => record(db.prepare('SELECT * FROM resellers WHERE id=?').get(id)),
    // Release catalog is authoritative for activity content; reseller selections
    // are separate and are never reset by a new release.
    syncCatalog(events) {
      if (!Array.isArray(events) || !events.length || events.some((e) => typeof e.uid !== 'string' || !e.uid) || new Set(events.map((e) => e.uid)).size !== events.length) throw new Error('活动目录为空或包含重复编号');
      const hash = crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare("SELECT value FROM settings WHERE key='catalog_hash'").get()?.value !== hash) {
          db.exec('UPDATE activities SET active=0');
          const upsert = db.prepare('INSERT INTO activities(uid,payload,position,active) VALUES (?,?,?,1) ON CONFLICT(uid) DO UPDATE SET payload=excluded.payload,position=excluded.position,active=1');
          events.forEach((event, index) => upsert.run(event.uid, JSON.stringify(event), index));
          db.prepare("INSERT INTO settings(key,value) VALUES ('catalog_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(hash);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    events: () => db.prepare('SELECT payload FROM activities WHERE active=1 ORDER BY position').all().map((row) => JSON.parse(row.payload)),
    siteEvents(id) {
      return db.prepare(`SELECT a.payload FROM activities a JOIN resellers r ON r.id=?
        WHERE a.active=1 AND EXISTS (SELECT 1 FROM json_each(r.activity_ids) s WHERE s.value=a.uid)
        ORDER BY a.position`).all(id).map((row) => JSON.parse(row.payload));
    },
    hasBootstrap: (key) => !!db.prepare('SELECT 1 FROM bootstrap_receipts WHERE key=?').get(key),
    getClientKey: (id) => db.prepare('SELECT client_key FROM resellers WHERE id=?').get(id)?.client_key,
    installSeeds(entries) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const entry of entries) {
          if (this.hasBootstrap(entry.key)) continue;
          const existing = this.get(entry.id);
          if (existing && this.getClientKey(entry.id) !== entry.clientKey) throw new Error(`初始化编号 ${entry.id} 已被其他代理商使用，请先核对`);
          // Recognize the original local row without overwriting manual changes.
          if (!existing) {
            const value = { name: entry.name, logoUrl: entry.logoUrl, activityIds: entry.activityIds };
            const hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
            db.prepare('INSERT INTO resellers(id,name,logo_url,activity_ids,client_key,created_payload) VALUES (?,?,?,?,?,?)')
              .run(entry.id, entry.name, entry.logoUrl, JSON.stringify(entry.activityIds), entry.clientKey, hash);
            if (entry.logoUrl) this.addLogo(entry.logoUrl);
          }
          db.prepare('INSERT INTO bootstrap_receipts(key,reseller_id) VALUES (?,?)').run(entry.key, entry.id);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    hasLogo: (url) => !!db.prepare('SELECT 1 FROM logos WHERE url=?').get(url),
    addLogo: (url) => db.prepare('INSERT OR IGNORE INTO logos(url) VALUES (?)').run(url),
    create(value, clientKey, payloadHash) {
      const existing = db.prepare('SELECT * FROM resellers WHERE client_key=?').get(clientKey);
      if (existing) return { record: record(existing), conflict: existing.created_payload !== payloadHash };
      const result = db.prepare('INSERT INTO resellers(name,logo_url,activity_ids,client_key,created_payload) VALUES (?,?,?,?,?)')
        .run(value.name, value.logoUrl, JSON.stringify(value.activityIds), clientKey, payloadHash);
      return { record: this.get(Number(result.lastInsertRowid)), conflict: false };
    },
    update(id, value, version) {
      const result = db.prepare('UPDATE resellers SET name=?,logo_url=?,activity_ids=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=?')
        .run(value.name, value.logoUrl, JSON.stringify(value.activityIds), id, version);
      return result.changes ? this.get(id) : null;
    },
  };
}
