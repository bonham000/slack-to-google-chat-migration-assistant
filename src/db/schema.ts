export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS spaces (
  slack_channel_name TEXT PRIMARY KEY,
  google_space_id TEXT NOT NULL,
  import_mode_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT
);

CREATE TABLE IF NOT EXISTS migrated_messages (
  slack_ts TEXT NOT NULL,
  slack_channel TEXT NOT NULL,
  google_space_id TEXT NOT NULL,
  google_message_name TEXT NOT NULL,
  thread_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (slack_ts, slack_channel)
);

CREATE TABLE IF NOT EXISTS user_mappings (
  slack_id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT NOT NULL,
  match_type TEXT NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  mode TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  time_scope TEXT,
  channels_processed INTEGER DEFAULT 0,
  messages_created INTEGER DEFAULT 0,
  messages_skipped INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS config_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON migrated_messages(slack_channel);
CREATE INDEX IF NOT EXISTS idx_messages_space ON migrated_messages(google_space_id);
`;
