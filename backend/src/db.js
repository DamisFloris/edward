// SQLite integrato in Node (node:sqlite) -> nessuna dipendenza nativa da compilare sul Raspberry.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "edward.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    start       TEXT NOT NULL,       -- ISO 8601
    end         TEXT,                -- ISO 8601 (opzionale)
    all_day     INTEGER NOT NULL DEFAULT 0,
    color       TEXT DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS briefings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,        -- YYYY-MM-DD
    data       TEXT NOT NULL,        -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_briefings_date ON briefings(date);

  -- segreti/token (mai esposti dall'API delle impostazioni)
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- contatori di utilizzo mensili (ricerche web, pagine lette, ...)
  CREATE TABLE IF NOT EXISTS usage (
    month TEXT NOT NULL,              -- YYYY-MM
    key   TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, key)
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,       -- running | ok | error
    log         TEXT DEFAULT ''
  );
`);

// ---- helper ----
const kvGet = db.prepare("SELECT value FROM kv WHERE key = ?");
const kvSet = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
const kvDel = db.prepare("DELETE FROM kv WHERE key = ?");
export const secrets = {
  get: (key) => {
    const r = kvGet.get(key);
    return r ? JSON.parse(r.value) : null;
  },
  set: (key, value) => kvSet.run(key, JSON.stringify(value)),
  delete: (key) => kvDel.run(key),
};

const usageInc = db.prepare(
  "INSERT INTO usage (month, key, count) VALUES (?, ?, 1) ON CONFLICT(month, key) DO UPDATE SET count = count + 1",
);
const usageMonth = db.prepare("SELECT key, count FROM usage WHERE month = ? ORDER BY key");
const thisMonth = () => new Date().toISOString().slice(0, 7);
export const usage = {
  inc: (key) => usageInc.run(thisMonth(), key),
  month: (month = thisMonth()) => Object.fromEntries(usageMonth.all(month).map((r) => [r.key, r.count])),
};
