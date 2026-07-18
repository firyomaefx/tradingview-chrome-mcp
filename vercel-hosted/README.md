# TradingView MCP — Vercel-Hosted Fork

This directory contains a **standalone, serverless, SSE-based MCP server** designed to run on Vercel. It is a fork of `tradingview-chrome-mcp` that replaces the local Playwright/Chrome backend with a pluggable market-data API backend.

For full architecture, schema, and security details, see the main project's [HOSTED.md](../HOSTED.md).

---

## What this standalone hosted app does

- Exposes an MCP server over **Server-Sent Events** at `/api/sse`.
- Accepts JSON-RPC tool messages at `/api/messages`.
- Authenticates clients via API key query parameter (`?key=...`).
- Logs only allow-listed parameters (`symbol`, `ticker`, `timeframe`) to Supabase for cache/rate-limit observability.
- Serves market-data tools through a `mock` or `market-data-api` backend.

**Important**: this hosted app does **not** control Chrome or automate TradingView. Browser-only tools return a clear "unavailable in hosted mode" response.

---

## Quick start

### 1. Prepare Supabase

Create a Supabase project and run the migration:

```bash
psql $DATABASE_URL -f supabase/migrations/001_initial.sql
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in at minimum:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEMETRY_ENABLED=1
MCP_API_KEYS=your-first-api-key
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token
TOOL_BACKEND=mock
```

### 3. Deploy

```bash
npm install
vercel --prod
```

### 4. Connect a client

```bash
curl -N "https://your-app.vercel.app/api/sse?key=your-first-api-key"
```

The SSE stream returns an `endpoint` event. POST JSON-RPC messages to that URL.

---

## Differences from the local project

| Concern | Local project | Hosted fork |
|---|---|---|
| Transport | STDIO + optional local HTTP | Server-Sent Events over Vercel |
| Browser control | Playwright + Chrome CDP | Not available |
| Data source | TradingView DOM | Mock or market-data API |
| Approval flow | Local dashboard | Auto-approve / external auth |
| Telemetry | None by default | Privacy-first allow-list to Supabase |
| Sessions | In-memory | Redis-backed |

---

## Privacy model

Only `symbol`, `ticker`, and `timeframe` parameters are persisted by default. Pine source, indicator configs, strategy parameters, screenshots, and account identifiers are **never** logged. Configure the allow-list via `TELEMETRY_ALLOWED_KEYS`.
