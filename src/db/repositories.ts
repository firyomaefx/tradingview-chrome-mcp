/**
 * Repository functions over the local SQLite database.
 *
 * Every function takes an open `DatabaseSync` handle (from getDb()) so callers
 * — including tests with a throwaway in-memory or temp-file database — control
 * lifecycle. Redactable payloads must be passed through `redact()` *before*
 * reaching these functions; repositories do not second-guess callers.
 */
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { hostname, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { pineChecksum } from "./checksum.js";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Device identity (single row)
// ---------------------------------------------------------------------------
export interface DeviceRow {
  device_id: string;
  app_version: string;
  os: string;
  hostname: string;
}

export function ensureDevice(db: DatabaseSync, appVersion: string): DeviceRow {
  const existing = db
    .prepare("SELECT device_id FROM device WHERE id = 1")
    .get() as { device_id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE device SET last_seen = ?, app_version = ?, os = ?, hostname = ? WHERE id = 1",
    ).run(now(), appVersion, platform(), hostname());
    return {
      device_id: existing.device_id,
      app_version: appVersion,
      os: platform(),
      hostname: hostname(),
    };
  }
  const deviceId = randomUUID();
  db.prepare(
    "INSERT INTO device (id, device_id, created_at, last_seen, app_version, os, hostname) VALUES (1, ?, ?, ?, ?, ?, ?)",
  ).run(deviceId, now(), now(), appVersion, platform(), hostname());
  return { device_id: deviceId, app_version: appVersion, os: platform(), hostname: hostname() };
}

export function getDevice(db: DatabaseSync): DeviceRow | undefined {
  return db
    .prepare(
      "SELECT device_id, app_version, os, hostname FROM device WHERE id = 1",
    )
    .get() as DeviceRow | undefined;
}

// ---------------------------------------------------------------------------
// Licence (single row)
// ---------------------------------------------------------------------------
export interface LicenceRow {
  edition: string;
  licence_key: string | null;
  device_id: string | null;
  activated_at: string | null;
  expires_at: string | null;
  status: string;
  features_json: string;
  updated_at: string;
}

export function getLicence(db: DatabaseSync): LicenceRow {
  const row = db
    .prepare(
      "SELECT edition, licence_key, device_id, activated_at, expires_at, status, features_json, updated_at FROM licence WHERE id = 1",
    )
    .get() as LicenceRow | undefined;
  if (row) return row;
  db.prepare(
    "INSERT INTO licence (id, edition, status, features_json, updated_at) VALUES (1, 'free', 'active', '{}', ?)",
  ).run(now());
  return {
    edition: "free",
    licence_key: null,
    device_id: null,
    activated_at: null,
    expires_at: null,
    status: "active",
    features_json: "{}",
    updated_at: now(),
  };
}

export function setLicence(
  db: DatabaseSync,
  patch: Partial<Omit<LicenceRow, "updated_at">>,
): void {
  // Ensure the row exists so UPDATE hits something.
  getLicence(db);
  const fields: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "updated_at") continue;
    fields.push(`${k} = ?`);
    values.push(v as SQLInputValue);
  }
  fields.push("updated_at = ?");
  values.push(now());
  db.prepare(`UPDATE licence SET ${fields.join(", ")} WHERE id = 1`).run(...values);
}

// ---------------------------------------------------------------------------
// Settings & feature flags
// ---------------------------------------------------------------------------
export function getSetting(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, now());
}

export function getFlag(db: DatabaseSync, key: string): boolean | undefined {
  const row = db.prepare("SELECT value_bool FROM feature_flags WHERE key = ?").get(key) as
    | { value_bool: number }
    | undefined;
  return row ? row.value_bool === 1 : undefined;
}

export function setFlag(db: DatabaseSync, key: string, value: boolean, source: string): void {
  db.prepare(
    "INSERT INTO feature_flags (key, value_bool, source) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_bool = excluded.value_bool, source = excluded.source",
  ).run(key, value ? 1 : 0, source);
}

// ---------------------------------------------------------------------------
// Interaction log
// ---------------------------------------------------------------------------
export interface InteractionEntry {
  tool: string;
  args_redacted_json?: string | null;
  result?: string | null;
  error?: string | null;
  duration_ms?: number | null;
  tab_url?: string | null;
  screenshot?: string | null;
  client_host?: string | null;
  task_id?: number | null;
}

export function logInteraction(db: DatabaseSync, e: InteractionEntry): number {
  const r = db
    .prepare(
      `INSERT INTO interaction_log (ts, tool, args_redacted_json, result, error, duration_ms, tab_url, screenshot, client_host, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      now(),
      e.tool,
      e.args_redacted_json ?? null,
      e.result ?? null,
      e.error ?? null,
      e.duration_ms ?? null,
      e.tab_url ?? null,
      e.screenshot ?? null,
      e.client_host ?? null,
      e.task_id ?? null,
    );
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Tasks & autonomous loop
// ---------------------------------------------------------------------------
export interface TaskRow {
  id: number;
  created_at: string;
  goal: string;
  status: string;
  edition: string;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  finished_at: string | null;
  success: 0 | 1;
  error: string | null;
}

export function createTask(
  db: DatabaseSync,
  goal: string,
  opts: { edition: string; maxAttempts: number },
): number {
  const r = db
    .prepare(
      "INSERT INTO tasks (created_at, goal, status, edition, max_attempts, started_at) VALUES (?, ?, 'running', ?, ?, ?)",
    )
    .run(now(), goal, opts.edition, opts.maxAttempts, now());
  return Number(r.lastInsertRowid);
}

export function updateTask(
  db: DatabaseSync,
  id: number,
  patch: Partial<Pick<TaskRow, "status" | "attempt_count" | "finished_at" | "success" | "error">>,
): void {
  const fields: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(v as SQLInputValue);
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function getTask(db: DatabaseSync, id: number): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

// ---------------------------------------------------------------------------
// Pine scripts & versions
// ---------------------------------------------------------------------------
export function findOrCreateScript(
  db: DatabaseSync,
  name: string,
  tvSymbol?: string | null,
  tvTimeframe?: string | null,
): number {
  const existing = db
    .prepare("SELECT id FROM pine_scripts WHERE name = ? ORDER BY id DESC LIMIT 1")
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const r = db
    .prepare(
      "INSERT INTO pine_scripts (name, tv_symbol, tv_timeframe, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(name, tvSymbol ?? null, tvTimeframe ?? null, now());
  return Number(r.lastInsertRowid);
}

export function setScriptCurrentVersion(db: DatabaseSync, scriptId: number, versionId: number): void {
  db.prepare("UPDATE pine_scripts SET current_version_id = ? WHERE id = ?").run(versionId, scriptId);
}

export interface PineVersionRow {
  id: number;
  script_id: number | null;
  version_no: number;
  source: string;
  checksum: string;
  backup_path: string | null;
  source_task_id: number | null;
  notes: string | null;
  created_at: string;
}

export function nextVersionNo(db: DatabaseSync, scriptId: number): number {
  const row = db
    .prepare("SELECT MAX(version_no) AS m FROM pine_versions WHERE script_id = ?")
    .get(scriptId) as { m: number | null } | undefined;
  return (row?.m ?? 0) + 1;
}

export function createVersion(
  db: DatabaseSync,
  opts: {
    scriptId: number | null;
    source: string;
    backupPath?: string | null;
    sourceTaskId?: number | null;
    notes?: string | null;
  },
): { id: number; versionNo: number; checksum: string } {
  const versionNo = opts.scriptId != null ? nextVersionNo(db, opts.scriptId) : 0;
  const checksum = pineChecksum(opts.source);
  const r = db
    .prepare(
      "INSERT INTO pine_versions (script_id, created_at, version_no, source, checksum, backup_path, source_task_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.scriptId,
      now(),
      versionNo,
      opts.source,
      checksum,
      opts.backupPath ?? null,
      opts.sourceTaskId ?? null,
      opts.notes ?? null,
    );
  return { id: Number(r.lastInsertRowid), versionNo, checksum };
}

export function getVersion(db: DatabaseSync, id: number): PineVersionRow | undefined {
  return db.prepare("SELECT * FROM pine_versions WHERE id = ?").get(id) as
    | PineVersionRow
    | undefined;
}

// ---------------------------------------------------------------------------
// Compile errors, fixes, screenshots, backups, strategy runs
// ---------------------------------------------------------------------------
export function insertCompileErrors(
  db: DatabaseSync,
  opts: {
    taskId: number;
    versionId: number | null;
    attempt: number;
    errors: string[];
    warnings: string[];
    success: boolean;
  },
): number {
  const r = db
    .prepare(
      "INSERT INTO compile_errors (task_id, version_id, attempt, ts, errors_json, warnings_json, success) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.taskId,
      opts.versionId,
      opts.attempt,
      now(),
      JSON.stringify(opts.errors),
      JSON.stringify(opts.warnings),
      opts.success ? 1 : 0,
    );
  return Number(r.lastInsertRowid);
}

export function insertFix(
  db: DatabaseSync,
  opts: {
    taskId: number;
    versionIdBefore: number | null;
    versionIdAfter: number | null;
    attempt: number;
    llmModel?: string | null;
    patchKind: string;
    error?: string | null;
  },
): number {
  const r = db
    .prepare(
      "INSERT INTO fixes (task_id, version_id_before, version_id_after, attempt, ts, llm_model, patch_kind, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.taskId,
      opts.versionIdBefore,
      opts.versionIdAfter,
      opts.attempt,
      now(),
      opts.llmModel ?? null,
      opts.patchKind,
      opts.error ?? null,
    );
  return Number(r.lastInsertRowid);
}

export function insertScreenshot(
  db: DatabaseSync,
  taskId: number | null,
  path: string,
  purpose?: string | null,
): number {
  const r = db
    .prepare("INSERT INTO screenshots (task_id, path, ts, purpose) VALUES (?, ?, ?, ?)")
    .run(taskId, path, now(), purpose ?? null);
  return Number(r.lastInsertRowid);
}

export function insertBackup(
  db: DatabaseSync,
  scriptId: number | null,
  versionId: number | null,
  path: string,
  checksum: string,
): number {
  const r = db
    .prepare("INSERT INTO backups (script_id, version_id, path, ts, checksum) VALUES (?, ?, ?, ?, ?)")
    .run(scriptId, versionId, path, now(), checksum);
  return Number(r.lastInsertRowid);
}

export function insertStrategyRun(
  db: DatabaseSync,
  scriptId: number | null,
  reportJson: string,
  metricsJson?: string | null,
): number {
  const r = db
    .prepare("INSERT INTO strategy_runs (script_id, ts, report_json, metrics_json) VALUES (?, ?, ?, ?)")
    .run(scriptId, now(), reportJson, metricsJson ?? null);
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------
export interface SyncQueueRow {
  id: number;
  ts: string;
  entity: string;
  entity_id: number | null;
  payload_redacted_json: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  status: string;
}

export function enqueueSync(
  db: DatabaseSync,
  entity: string,
  payloadRedactedJson: string,
  entityId?: number | null,
): number {
  const r = db
    .prepare(
      "INSERT INTO sync_queue (ts, entity, entity_id, payload_redacted_json, next_attempt_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(now(), entity, entityId ?? null, payloadRedactedJson, now());
  return Number(r.lastInsertRowid);
}

/** Claim the next due pending row, marking it `in_flight` so concurrent workers do not re-fetch it. */
export function claimNextSync(db: DatabaseSync): SyncQueueRow | undefined {
  const tx = db.prepare("BEGIN");
  tx.run();
  try {
    const row = db
      .prepare(
        "SELECT * FROM sync_queue WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id ASC LIMIT 1",
      )
      .get(now()) as SyncQueueRow | undefined;
    if (!row) {
      db.prepare("COMMIT").run();
      return undefined;
    }
    db.prepare("UPDATE sync_queue SET status = 'in_flight' WHERE id = ?").run(row.id);
    db.prepare("COMMIT").run();
    // Re-select so the returned object reflects the in_flight status.
    return db.prepare("SELECT * FROM sync_queue WHERE id = ?").get(row.id) as unknown as SyncQueueRow;
  } catch (e) {
    db.prepare("ROLLBACK").run();
    throw e;
  }
}

export function markSyncOk(db: DatabaseSync, id: number): void {
  db.prepare("UPDATE sync_queue SET status = 'done', last_error = NULL WHERE id = ?").run(id);
}

export function markSyncFailed(db: DatabaseSync, id: number, error: string, backoffMs: number): void {
  const next = new Date(Date.now() + backoffMs).toISOString();
  db.prepare(
    "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, status = 'pending' WHERE id = ?",
  ).run(error.slice(0, 500), next, id);
}

export function markSyncDead(db: DatabaseSync, id: number, error: string): void {
  db.prepare("UPDATE sync_queue SET status = 'dead', last_error = ? WHERE id = ?").run(
    error.slice(0, 500),
    id,
  );
}

export function countPendingSync(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM sync_queue WHERE status IN ('pending','in_flight')")
    .get() as { c: number };
  return row.c;
}