/**
 * Cloud synchronization manager.
 *
 * Operational data (usage telemetry, licence status, audit summaries, task
 * summaries) is *always* collected into the local SQLite source of truth and
 * the sync queue — this is the mandatory operational synchronization required
 * of both Free and Pro editions. The queue drains to Supabase when a backend
 * is configured; until then rows remain pending locally and the user is told
 * (see TELEMETRY.md).
 *
 * Hard rules enforced here:
 *   - Only entities on the SYNC_ENTITY_ALLOWLIST may be enqueued. This is the
 *     structural guarantee that secrets never enter the queue.
 *   - Every payload is run through `redact()` before enqueue, regardless of
 *     caller, so a stolen queue row never yields a secret.
 *   - The never-synchronize categories (passwords, cookies, session tokens,
 *     API keys, webhook secrets, auth codes, payment/bank, private keys,
 *     broker credentials) are redacted by `redact()` and additionally have no
 *     allowlist entity, so they cannot be enqueued at all.
 *   - Sync runs over the existing 127.0.0.1-bound process; the outbound HTTPS
 *     call to Supabase is the only network egress and uses the service-role
 *     key held in memory (never logged, never persisted to disk).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { getDb } from "../db/database.js";
import {
  claimNextSync,
  enqueueSync,
  markSyncDead,
  markSyncFailed,
  markSyncOk,
} from "../db/repositories.js";
import { redact } from "../logging/logger.js";
import { logger } from "../logging/logger.js";

/** Entities that may be synchronized. Anything else is rejected at enqueue. */
export const SYNC_ENTITY_ALLOWLIST = [
  "telemetry.usage",
  "licence.status",
  "audit.summary",
  "task.summary",
] as const;
export type SyncEntity = (typeof SYNC_ENTITY_ALLOWLIST)[number];

const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 15_000;

let client: SupabaseClient | null = null;
let workerTimer: NodeJS.Timeout | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** Map an entity to its Supabase table. Tables are created in a later phase. */
const ENTITY_TABLE: Record<SyncEntity, string> = {
  "telemetry.usage": "mcp_usage_logs",
  "licence.status": "device_licences",
  "audit.summary": "audit_events",
  "task.summary": "task_events",
};

export function isSyncConfigured(): boolean {
  return !!(config.supabaseUrl && config.supabaseServiceRoleKey);
}

/**
 * Enqueue an operational payload for synchronization. The payload is redacted
 * and the entity is checked against the allowlist. Returns the queue row id, or
 * -1 if the entity is not allowed (and logs the rejection).
 */
export function enqueueForSync(entity: string, payload: unknown, entityId?: number | null): number {
  if (!SYNC_ENTITY_ALLOWLIST.includes(entity as SyncEntity)) {
    logger.warn({ entity }, "sync entity rejected (not allowlisted)");
    return -1;
  }
  const redacted = redact(payload);
  const json = JSON.stringify(redacted);
  return enqueueSync(getDb(), entity, json, entityId);
}

function backoffMs(attempts: number): number {
  const ms = BASE_BACKOFF_MS * 2 ** attempts;
  return Math.min(ms, MAX_BACKOFF_MS);
}

async function pushOne(row: {
  id: number;
  entity: string;
  payload_redacted_json: string;
  attempts: number;
}): Promise<void> {
  const sb = getClient();
  if (!sb) {
    // Backend not configured: leave pending. Drain when configured.
    return;
  }
  const table = ENTITY_TABLE[row.entity as SyncEntity];
  if (!table) {
    markSyncDead(getDb(), row.id, `no table mapping for ${row.entity}`);
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_redacted_json);
  } catch {
    markSyncDead(getDb(), row.id, "payload not JSON");
    return;
  }
  try {
    const { error } = await sb.from(table).insert(payload as Record<string, unknown>);
    if (error) throw new Error(error.message);
    markSyncOk(getDb(), row.id);
    logger.debug({ id: row.id, entity: row.entity }, "sync row pushed");
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      markSyncDead(getDb(), row.id, msg);
      logger.warn({ id: row.id, entity: row.entity, err: msg }, "sync row marked dead");
    } else {
      markSyncFailed(getDb(), row.id, msg, backoffMs(row.attempts));
    }
  }
}

/** Drain a batch of pending rows. Called by the worker on an interval. */
export async function drainSyncQueue(max = 10): Promise<number> {
  // Do not claim rows when no backend is configured — leave them pending so
  // they drain once a Supabase backend is wired up.
  if (!getClient()) return 0;
  let processed = 0;
  for (let i = 0; i < max; i++) {
    const row = claimNextSync(getDb());
    if (!row) break;
    await pushOne(row);
    processed++;
  }
  return processed;
}

/** Start the background sync worker. Idempotent. */
export function startSyncWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void drainSyncQueue().catch((e) =>
      logger.warn({ err: (e as Error).message }, "sync worker tick failed"),
    );
  }, POLL_INTERVAL_MS);
  if (typeof workerTimer.unref === "function") workerTimer.unref();
  logger.info({ configured: isSyncConfigured() }, "sync worker started");
}

export function stopSyncWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}