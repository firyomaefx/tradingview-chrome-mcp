# Context (v0.3.2)

## Current state (2026-07-18)
- **32 MCP tools** in the local server, plus the same tool contract exposed by the hosted fork.
- **Standalone Windows app**: one-line installer, Start-menu + desktop shortcuts, and one-click launcher (`Launch-TV-MCP.cmd` / `scripts/Launch-TV-MCP.ps1`) are live-tested.
- **Local-first by default**: no remote telemetry, no credential storage, no cookie/token extraction.
- **Optional Streamable HTTP** on `127.0.0.1:3940` (LAN binding opt-in via `TV_MCP_HTTP_BIND=0.0.0.0`).
- **Local dashboard** on `http://127.0.0.1:3939` for status, approvals, history, screenshots, and emergency stop.
- **Vercel-hosted SSE fork** (`vercel-hosted/`) provides a separate serverless market-data MCP endpoint with privacy-first telemetry and pluggable `mock` / `market-data-api` backends.

## New in this pass
- **Flexible MCP server factory** (`src/server/mcp-server.ts`) reused by local and hosted entrypoints.
- **Centralized Zod config** (`src/config.ts`): telemetry, Redis, Supabase, API keys, tool backends.
- **Privacy-first telemetry** (`src/telemetry/telemetry.ts`): strict allow-list defaulting to `symbol`, `ticker`, `timeframe`; disabled unless `TELEMETRY_ENABLED=1`.
- **API-key auth** (`src/auth/api-keys.ts`): static env keys + Supabase-backed SHA-256 hashed keys.
- **Redis session store** (`src/sessions/store.ts`): Upstash/Vercel KV with in-memory fallback.
- **Runtime feature flags** (`src/features/flags.ts`): `disable_telemetry`, `read_only_mode`, `disable_destructive_tools`.
- **Hosted Next.js app** (`vercel-hosted/`): SSE `/api/sse`, JSON-RPC `/api/messages`, mock market-data registry, Supabase migrations.
- **Updated docs**: `README.md`, `INSTALL.md`, `ARCHITECTURE.md`, and new `HOSTED.md` with clear standalone and hosted usage.
- **Expanded tests**: 31 unit tests for local project + 4 hosted registry tests.

## Test status
- Local project: `npm run typecheck` ✅, `npm test` ✅ 31/31, `npm run build` ✅, smoke test ✅.
- Hosted app: `npm run typecheck` ✅, `npm run test` ✅ 4/4, `npm run build` ✅.
- GitHub Actions CI: both `ci` (Windows) and `hosted-app` (Ubuntu) jobs passing.

## How to start using

### Standalone Windows app (recommended)
```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```
Then double-click the **TradingView MCP** desktop shortcut.

### From source
```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git
cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

### Hosted Vercel fork
```bash
cd vercel-hosted
cp .env.local.example .env.local
# fill in Supabase/Redis/API keys
npm install
vercel --prod
```
See [HOSTED.md](HOSTED.md) for full details.

## Repository
- https://github.com/firyomaefx/tradingview-chrome-mcp (public, default branch `main`).
- Latest release: `v0.2.0`.
- CI: `.github/workflows/ci.yml` tests both local and hosted apps on every push.

## Key decisions
- Local project keeps local-first invariants: no telemetry by default, no credential storage.
- Hosted fork is opt-in and separate; telemetry only logs allow-listed cache parameters.
- Browser-only tools in hosted mode return explicit "unavailable" errors.
- Standalone install is PowerShell-based; no compiled executable yet.
