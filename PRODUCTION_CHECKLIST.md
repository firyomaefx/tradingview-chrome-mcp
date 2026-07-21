# Production Checklist

What is done in the current foundation, what remains, and the acceptance
criteria the spec requires before calling the product production-ready.

## ✅ Done in this foundation (v0.4.0)

- [x] Local SQLite source of truth (`node:sqlite`, no native dep) — `src/db/`
      with migration runner + 16 core tables.
- [x] Hash-chained append-only audit log with `verifyAuditChain()` tamper
      detection — `src/audit/audit-chain.ts`.
- [x] Sync queue with exponential backoff + Supabase operational-sync client,
      entity allowlist + mandatory redaction — `src/sync/sync-manager.ts`.
- [x] Licensing skeleton: Free/Pro/Team/Owner editions, feature gating, offline
      activation, online-activation interface hook — `src/licensing/`.
- [x] Hardened redaction covering the full never-synchronize list (keys +
      value patterns) — `src/logging/logger.ts`.
- [x] Autofix loop persisted: task → versions (checksum + backup) → compile
      errors → fixes → screenshots → audit chain → sync enqueue.
- [x] New MCP tools: `licence_status`, `activate_licence`, `edition_limits`,
      `audit_verify`, `sync_status`.
- [x] Tests: db migrations/repositories, audit tamper detection, sync
      allowlist/redact/backoff, licensing gating, redaction (80 passing).
- [x] Docs: PRIVACY, TELEMETRY, LICENSING, FREE_VS_PRO, this checklist.

## ⬜ Remaining (mapped to the spec's phases)

### Phase A — Cloud backend & licensing server
- [ ] Supabase DDL: `mcp_usage_logs`, `device_licences`, `audit_events`,
      `task_events` with RLS policies.
- [ ] Edge Functions: licence activation, device binding, telemetry ingest.
- [ ] Wire `DeviceActivationClient` to the activation Edge Function.
- [ ] Windows Credential Manager integration for storing the licence key + API
      keys (currently env-based).

### Phase B — Owner dashboard
- [ ] Fleet/owner admin app (separate `apps/owner-dashboard`) reading
      `device_licences`, `audit_events`, `task_events` with RLS.
- [ ] Owner-only controls: revoke licence, feature-flag rollout, audit export.

### Phase C — Updater & rollback
- [ ] Automatic updater with signed manifests; staged apply + rollback.
- [ ] Database backup snapshot before each migration for rollback.

### Phase D — Monorepo restructure
- [ ] Move to `apps/` (local-server, owner-dashboard) + `packages/` (db, audit,
      sync, licensing, adapter, tools) + `supabase/` (migrations, functions).
- [ ] Keep the standalone `.exe` build green through the move.

### Phase E — Strategy tester & broader logging
- [ ] Strategy tester extraction/comparison (Pro+), persisted to
      `strategy_runs`.
- [ ] Chrome/TradingView/Pine structured logging categories surfaced to the
      dashboard.

### Phase F — Hardening & acceptance
- [ ] Adversarial security re-audit (secrets, RLS, binding, injection).
- [ ] Integration + e2e tests for the autofix loop against a mock TradingView.
- [ ] Production acceptance sign-off against the spec's criteria (below).

## Production acceptance criteria (from the spec)

1. Free and Pro both perform mandatory operational cloud sync; secrets never
   leave the device (verified by tests + audit).
2. Audit log is hash-chained and tamper-evident (`audit_verify` passes on a
   clean chain, fails on a mutated row).
3. Every Pine Script edit is backed up before applying; only small patches are
   applied; success is never claimed without compilation + visual verification.
4. Local services bind to `127.0.0.1`; Chrome debugging is never public.
5. Live trading / broker order execution is disabled in every edition.
6. No infinite loops (autofix attempt cap enforced by edition).
7. Destructive actions require approval (existing `permissions` layer).
8. Sensitive values are redacted before local storage and before sync.
9. User transparency: dashboard + `licence_status` / `sync_status` /
   `audit_verify` tools surface state to the user and the AI host.

## Verification commands

```powershell
npm run typecheck   # TypeScript clean
npm test            # 80 unit tests
npm run build       # emits dist/
npm run smoke:extension   # extension WebSocket round-trip (extension driver)
```