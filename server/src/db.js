
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const storageDir = path.join(serverDir, "storage");

fs.mkdirSync(storageDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(storageDir, "trustvault.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','owner','viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS grants (
    document_id TEXT NOT NULL REFERENCES documents(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    permission TEXT NOT NULL CHECK (permission IN ('read','edit')),
    granted_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT,
    action TEXT NOT NULL,
    document_id TEXT,
    target_user_id TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','failure')),
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    previous_hash TEXT,
    event_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_heads (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    event_hash TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_documents_owner
    ON documents(owner_id);
  CREATE INDEX IF NOT EXISTS idx_grants_user
    ON grants(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_document
    ON audit_events(document_id);
  CREATE INDEX IF NOT EXISTS idx_audit_actor
    ON audit_events(actor_id);
`);

export const STORAGE_DIR = storageDir;
