# Telemetry & Operational Sync

Operational synchronization is **mandatory** for both the Free and Pro
editions. It is how the product reports usage, licence state, and audit
metadata so the owner dashboard (a later phase) can monitor fleet health and so
licences can be validated. It is **not** user-content telemetry: Pine Script
source, indicator configs, strategy parameters, and chart data are never
synchronized.

## What gets synchronized

Only these allow-listed entities are ever enqueued (`src/sync/sync-manager.ts`):

| Entity | Supabase table (later phase) | Fields (all redacted before enqueue) |
|---|---|---|
| `telemetry.usage` | `mcp_usage_logs` | `tool_name`, allow-listed params (`symbol`, `ticker`, `timeframe`), `duration_ms`, `success`, `error_message` |
| `licence.status` | `device_licences` | `edition`, `status`, `device_id`, `activated_at`, `expires_at` — **never the licence key** |
| `audit.summary` | `audit_events` | category, action, hash, sequence — **never the redacted payload's secrets** |
| `task.summary` | `task_events` | `task_id`, `goal`, `success`, `edition`, attempt count — **never Pine source** |

## What never gets synchronized

The never-synchronize list (see [PRIVACY.md](PRIVACY.md)): passwords, cookies,
session tokens, API keys, webhook secrets, auth codes, payment/bank details,
private keys, broker credentials. These are redacted by `redact()` and have no
allow-list entity, so they cannot enter the queue.

## How it works

1. A tool call or lifecycle event writes a row to the local `sync_queue` table
   via `enqueueForSync(entity, payload)`. The payload is redacted and the
   entity is checked against the allowlist (rejected entities return `-1`).
2. A background worker (`startSyncWorker`) polls every 15 s and drains pending
   rows when a Supabase backend is configured.
3. Each row is pushed to its mapped Supabase table. Failures use exponential
   backoff (2 s → 5 min cap, max 8 attempts) after which the row is marked
   `dead` and surfaced via `sync_status`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SUPABASE_URL` | unset | Supabase project URL. When unset, rows stay pending locally. |
| `SUPABASE_SERVICE_ROLE_KEY` | unset | Service-role key used server-side only; never logged, never persisted to disk. |
| `TELEMETRY_ENABLED` | `0` | Enables the legacy usage allow-list logger (`src/telemetry/telemetry.ts`) alongside the mandatory sync queue. |
| `TELEMETRY_ALLOWED_KEYS` | `symbol,ticker,timeframe` | Comma-separated allow-list for `telemetry.usage` parameters. |

`sync_status` (MCP tool) reports `configured`, `pendingRows`, and `drainedNow`.

## Disabling cloud egress

You cannot disable *collection* of operational data into the local source of
truth (it is mandatory and local), but you can keep it from leaving the device
by **not setting** `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. In that state
the queue accumulates locally and `sync_status` reports `configured: false`.

## Backend schema (later phase)

The Supabase DDL for `mcp_usage_logs`, `device_licences`, `audit_events`, and
`task_events` (with Row Level Security policies and Edge Functions for licence
activation) is delivered in a later phase. Until then, configuring Supabase
will cause rows to retry then mark `dead` (harmless; they remain in the local
queue for later replay).