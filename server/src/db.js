import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* Schema. Every user-owned table carries user_id and is keyed by it, so the same
   message fingerprint can exist for two users without colliding. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE user_settings (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_import_id TEXT,
    labels         TEXT NOT NULL DEFAULT '[]',
    prefs          TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE categories (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id       TEXT NOT NULL,
    name     TEXT NOT NULL,
    color    TEXT NOT NULL,
    icon     TEXT NOT NULL DEFAULT 'folder',
    position INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  ) WITHOUT ROWID;

  CREATE TABLE rules (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match       TEXT NOT NULL CHECK (match IN ('contains', 'domain', 'starts', 'regex')),
    pattern     TEXT NOT NULL,
    category_id TEXT,
    labels      TEXT NOT NULL DEFAULT '[]',
    enabled     INTEGER NOT NULL DEFAULT 1,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX rules_user ON rules(user_id, position);

  CREATE TABLE imports (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    at          TEXT NOT NULL,
    file_name   TEXT,
    export_date TEXT,
    format      TEXT,
    counts      TEXT NOT NULL,
    stored_file TEXT,
    PRIMARY KEY (user_id, id)
  ) WITHOUT ROWID;

  CREATE TABLE items (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id               TEXT NOT NULL,            -- message fingerprint
    date             TEXT NOT NULL,            -- YYYY-MM-DD of the original message
    time             TEXT NOT NULL,            -- HH:MM
    seq              INTEGER NOT NULL DEFAULT 0,
    sender           TEXT,
    raw              TEXT NOT NULL DEFAULT '', -- original message, never edited
    body             TEXT NOT NULL DEFAULT '', -- original minus WhatsApp markers
    wa_text          TEXT,                     -- newer text if the message was edited in WhatsApp
    media            TEXT,
    doc_name         TEXT,
    forwarded        INTEGER NOT NULL DEFAULT 0,
    title            TEXT NOT NULL DEFAULT '',
    text             TEXT,                     -- user-edited display text (NULL = use original)
    note             TEXT NOT NULL DEFAULT '',
    category_id      TEXT NOT NULL DEFAULT 'inbox',
    type             TEXT NOT NULL DEFAULT 'note',
    labels           TEXT NOT NULL DEFAULT '[]',
    fields           TEXT NOT NULL DEFAULT '{}',
    flags            TEXT NOT NULL DEFAULT '{}',
    pinned           INTEGER NOT NULL DEFAULT 0,
    locked           INTEGER NOT NULL DEFAULT 0,
    color            TEXT,
    done             INTEGER NOT NULL DEFAULT 0,
    watched          INTEGER NOT NULL DEFAULT 0,
    used             INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'trashed', 'purged')),
    possible_edit_of TEXT,
    dup_of           TEXT,
    import_id        TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    trashed_at       TEXT,
    PRIMARY KEY (user_id, id)
  ) WITHOUT ROWID;
  CREATE INDEX items_user_status ON items(user_id, status);
  CREATE INDEX items_user_slot   ON items(user_id, date, time);

  -- older fingerprints that now point at an existing card (WhatsApp edits, merged duplicates)
  CREATE TABLE item_aliases (
    user_id INTEGER NOT NULL,
    alias   TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (user_id, alias),
    FOREIGN KEY (user_id, item_id) REFERENCES items(user_id, id) ON DELETE CASCADE
  ) WITHOUT ROWID;
  `,
  `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  `
];

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export const nowIso = () => new Date().toISOString();
