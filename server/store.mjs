import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'resellers.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  if (db.prepare('PRAGMA user_version').get().user_version > 2) { db.close(); throw new Error('数据库版本高于当前程序，请使用匹配的版本'); }
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS resellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, logo_url TEXT NOT NULL DEFAULT '',
      activity_ids TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      client_key TEXT NOT NULL UNIQUE, created_payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS logos (url TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS reseller_domains (
      reseller_id INTEGER PRIMARY KEY REFERENCES resellers(id), hostname TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS activities (
      uid TEXT PRIMARY KEY, payload TEXT NOT NULL, position INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL, payload TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bootstrap_receipts (key TEXT PRIMARY KEY, reseller_id INTEGER NOT NULL REFERENCES resellers(id));
    INSERT INTO sqlite_sequence(name,seq) SELECT 'resellers',6023
      WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='resellers');
    PRAGMA user_version=2; COMMIT;`);
  const record = (row) => {
    if (!row) return null;
    const domain = db.prepare('SELECT hostname FROM reseller_domains WHERE reseller_id=?').get(row.id);
    return { id: String(row.id), name: row.name, logoUrl: row.logo_url, activityIds: JSON.parse(row.activity_ids), version: row.version, publicUrl: domain ? `https://${domain.hostname}` : '' };
  };
  return {
    close: () => db.close(),
    list: () => db.prepare('SELECT * FROM resellers ORDER BY id').all().map(record),
    get: (id) => record(db.prepare('SELECT * FROM resellers WHERE id=?').get(id)),
    bindDomain(id, hostname) {
      const owner = db.prepare('SELECT reseller_id FROM reseller_domains WHERE hostname=?').get(hostname);
      if (owner && String(owner.reseller_id) !== String(id)) return null;
      db.prepare('INSERT INTO reseller_domains(reseller_id,hostname) VALUES (?,?) ON CONFLICT(reseller_id) DO UPDATE SET hostname=excluded.hostname').run(id, hostname);
      return this.get(id);
    },
    // The server database is the activity source of truth. A release's bundled catalog
    // only seeds an empty database; afterwards activities change through upsertActivity.
    syncCatalog(events) {
      if (!Array.isArray(events) || !events.length || events.some((e) => typeof e.uid !== 'string' || !e.uid) || new Set(events.map((e) => e.uid)).size !== events.length) throw new Error('活动目录为空或包含重复编号');
      db.exec('BEGIN IMMEDIATE');
      try {
        if (!db.prepare('SELECT 1 FROM activities LIMIT 1').get()) {
          const insert = db.prepare('INSERT INTO activities(uid,payload,position,active) VALUES (?,?,?,1)');
          events.forEach((event, index) => insert.run(event.uid, JSON.stringify(event), index));
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    // Adds or replaces one activity; the previous version is kept in activity_revisions.
    upsertActivity(event, actor) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT payload, active FROM activities WHERE uid=?').get(event.uid);
        db.prepare('INSERT INTO activity_revisions(uid,payload,actor,created_at) VALUES (?,?,?,?)').run(event.uid, previous?.active ? previous.payload : null, actor, new Date().toISOString());
        db.prepare('INSERT INTO activities(uid,payload,position,active) VALUES (?,?,0,1) ON CONFLICT(uid) DO UPDATE SET payload=excluded.payload,active=1').run(event.uid, JSON.stringify(event));
        db.exec('COMMIT');
        return { created: !previous?.active };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    deactivateActivity(uid, actor) {
      const row = db.prepare('SELECT payload FROM activities WHERE uid=? AND active=1').get(uid);
      if (!row) return false;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO activity_revisions(uid,payload,actor,created_at) VALUES (?,?,?,?)').run(uid, row.payload, actor, new Date().toISOString());
        db.prepare('UPDATE activities SET active=0 WHERE uid=?').run(uid);
        db.exec('COMMIT');
        return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    // Newest activity first, the same order the bundled catalog used (sourceDate descending).
    events: () => db.prepare("SELECT payload FROM activities WHERE active=1 ORDER BY json_extract(payload,'$.sourceDate') DESC, position").all().map((row) => JSON.parse(row.payload)),
    siteEvents(id) {
      return db.prepare(`SELECT a.payload FROM activities a JOIN resellers r ON r.id=?
        WHERE a.active=1 AND EXISTS (SELECT 1 FROM json_each(r.activity_ids) s WHERE s.value=a.uid)
        ORDER BY json_extract(a.payload,'$.sourceDate') DESC, a.position`).all(id).map((row) => JSON.parse(row.payload));
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
