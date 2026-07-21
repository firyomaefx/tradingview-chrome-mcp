# Context (v0.4.0)

## Current state (2026-07-22)
- **48 MCP tools** in the local server, including the new `licence_status`,
  `activate_licence`, `edition_limits`, `audit_verify`, and `sync_status`.
- **Local SQLite source of truth** (`src/db/`, `node:sqlite` — no native
  dependency): migration runner + 16 core tables (device, licence,
  feature_flags, settings, interaction_log, audit_log, tasks, pine_scripts,
  pine_versions, compile_errors, fixes, screenshots, backups, strategy_runs,
  sync_queue). Path resolved lazily from `TV_DATA_DIR`.
- **Hash-chained append-only audit log** (`src/audit/audit-chain.ts`):
  `hash = sha256(prev_hash || seq || payload)`; `verifyAuditChain()` detects
  tampering; `audit_verify` tool surfaces it.
- **Mandatory operational sync** (`src/sync/sync-manager.ts`): entity
  allowlist + redaction + exponential backoff; drains to Supabase when
  configured, else queues locally. Never-sync categories are structurally
  barred from the queue.
- **Licensing skeleton** (`src/licensing/`): Free/Pro/Team/Owner editions,
  `EDITION_LIMITS` feature gating, offline activation + online-activation
  interface hook. Live trading disabled in every edition.
- **Hardened redaction** (`src/logging/logger.ts`): full never-synchronize
  key list + value patterns (OpenAI/Anthropic keys, JWTs, Bearer, card groups).
- **Autofix loop persisted**: task → Pine versions (SHA-256 + on-disk backup
  before every edit) → compile errors → fixes → screenshots → audit chain →
  sync enqueue. Small LLM patches only; no success without compile + visual
  verification.
- **Chrome extension driver** + **standalone Windows `.exe`** (v0.2.0 release)
  still ship.

## Test status
- `npm run typecheck` ✅, `npm test` ✅ 80/80, `npm run build` ✅.
- New tests: `db.test.ts` (migrations, repositories, audit tamper, sync
  allowlist/backoff, licensing), `edition.test.ts`, `redaction.test.ts`.

## Editions
Free (default, no key) and Pro (`TV-PRO-<uuid>`). Team/Owner interfaces
reserved. See [LICENSING.md](LICENSING.md) and [FREE_VS_PRO.md](FREE_VS_PRO.md).

## Docs added this pass
[PRIVACY.md](PRIVACY.md), [TELEMETRY.md](TELEMETRY.md), [LICENSING.md](LICENSING.md),
[FREE_VS_PRO.md](FREE_VS_PRO.md), [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md),
updated [SECURITY.md](SECURITY.md).

## What remains (per PRODUCTION_CHECKLIST.md)
Supabase DDL + RLS + Edge Functions, owner dashboard, automatic updater with
rollback, `apps/`+`packages/`+`supabase/` monorepo restructure, strategy
tester extraction, Windows Credential Manager integration, adversarial
re-audit, integration/e2e tests. These are subsequent phases; they need
external infra and would destabilize the shipping `.exe` if rushed.

## Key invariants (unchanged + strengthened)
- No tool executes against a non-allowlisted URL.
- Every tool call is audit-logged; the audit log is now hash-chained.
- Destructive tools require approval; timeout = deny.
- Browser controller never reads/stores cookies, tokens, or passwords.
- Secrets are redacted before local storage **and** before sync; secrets have
  no sync allow-list entity.
- Local services bind to `127.0.0.1`; Chrome debugging is never public.
- Live trading disabled in every edition.
- Pine Scripts are backed up before every edit; only small patches are applied.

## Repository
- https://github.com/firyomaefx/tradingview-chrome-mcp (default branch `main`).
- Latest release: `v0.2.0` (standalone `.exe`).