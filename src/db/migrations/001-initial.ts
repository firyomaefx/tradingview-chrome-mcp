/**
 * Initial schema — local source of truth for the Free/Pro/Team/Owner editions.
 *
 * Tables are grouped: identity/licensing, operational telemetry, autonomous
 * Pine loop, versioning/backups, and the cloud-sync queue. All redactable
 * columns store *already-redacted* JSON (see src/logging/logger.ts redact())
 * so a stolen database file never yields secrets.
 */
import type { Migration } from "../migrations.js";

const SQL = `
-- ---------------------------------------------------------------------------
-- Identity & licensing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  app_version TEXT NOT NULL,
  os TEXT NOT NULL,
  hostname TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  edition TEXT NOT NULL DEFAULT 'free',
  licence_key TEXT,
  device_id TEXT,
  activated_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  features_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  value_bool INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Operational interaction log (every MCP tool call)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interaction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_redacted_json TEXT,
  result TEXT,
  error TEXT,
  duration_ms INTEGER,
  tab_url TEXT,
  screenshot TEXT,
  client_host TEXT,
  task_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_interaction_ts ON interaction_log(ts);
CREATE INDEX IF NOT EXISTS idx_interaction_tool ON interaction_log(tool);

-- ---------------------------------------------------------------------------
-- Hash-chained append-only audit log
--   hash = sha256(prev_hash || seq || payload_redacted_json)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_redacted_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_seq ON audit_log(seq);

-- ---------------------------------------------------------------------------
-- Autonomous Pine Script debugging loop
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT 'free',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  started_at TEXT,
  finished_at TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

CREATE TABLE IF NOT EXISTS pine_scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  tv_symbol TEXT,
  tv_timeframe TEXT,
  created_at TEXT NOT NULL,
  current_version_id INTEGER
);

CREATE TABLE IF NOT EXISTS pine_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER,
  created_at TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  source TEXT NOT NULL,
  checksum TEXT NOT NULL,
  backup_path TEXT,
  source_task_id INTEGER,
  notes TEXT,
  FOREIGN KEY (script_id) REFERENCES pine_scripts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_script ON pine_versions(script_id);

CREATE TABLE IF NOT EXISTS compile_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  version_id INTEGER,
  attempt INTEGER NOT NULL,
  ts TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  success INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_task ON compile_errors(task_id);

CREATE TABLE IF NOT EXISTS fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  version_id_before INTEGER,
  version_id_after INTEGER,
  attempt INTEGER NOT NULL,
  ts TEXT NOT NULL,
  llm_model TEXT,
  patch_kind TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_fixes_task ON fixes(task_id);

CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  path TEXT NOT NULL,
  ts TEXT NOT NULL,
  purpose TEXT
);

-- ---------------------------------------------------------------------------
-- Versioning & backups (Pine Scripts are backed up before every edit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER,
  version_id INTEGER,
  path TEXT NOT NULL,
  ts TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id INTEGER,
  ts TEXT NOT NULL,
  report_json TEXT,
  metrics_json TEXT
);

-- ---------------------------------------------------------------------------
-- Cloud-sync queue (operational data only; secrets never enqueued)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  payload_redacted_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_queue(status, next_attempt_at);
`;

export const MIGRATIONS: Migration[] = [
  { id: 1, name: "initial_schema", sql: SQL },
];