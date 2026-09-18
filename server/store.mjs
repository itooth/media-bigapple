import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'resellers.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS resellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, logo_url TEXT NOT NULL DEFAULT '',
      activity_ids TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      client_key TEXT NOT NULL UNIQUE, created_payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS logos (url TEXT PRIMARY KEY);
    INSERT INTO sqlite_sequence(name,seq) SELECT 'resellers',6023
      WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='resellers');`);
  const record = (row) => row ? { id: String(row.id), name: row.name, logoUrl: row.logo_url, activityIds: JSON.parse(row.activity_ids), version: row.version } : null;
  return {
    close: () => db.close(),
    list: () => db.prepare('SELECT * FROM resellers ORDER BY id').all().map(record),
    get: (id) => record(db.prepare('SELECT * FROM resellers WHERE id=?').get(id)),
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
