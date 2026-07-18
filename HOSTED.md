# Hosted Vercel SSE MCP Server

This document describes the `vercel-hosted/` directory: a **serverless, SSE-based MCP server** that runs on Vercel and serves market-data tools to external clients. It is a fork of the local `tradingview-chrome-mcp` project designed for hosted deployment.

**Important**: the hosted fork does **not** control Chrome or automate TradingView DOM. Browser-only tools (screenshots, Pine editor, alerts, drawings, layout switching) return a clear "unavailable in hosted mode" response. Use the local project for browser automation.

---

## What it does

- Exposes an MCP server over **Server-Sent Events** at `/api/sse`.
- Accepts JSON-RPC tool messages at `/api/messages`.
- Authenticates clients via API key query parameter (`?key=...`).
- Logs only allow-listed parameters (`symbol`, `ticker`, `timeframe`) to Supabase for cache/rate-limit observability.
- Supports pluggable market-data backends: `mock` or `market-data-api`.

---

## Quick deploy

### 1. Prepare Supabase

Create a new Supabase project and run the migration:

```bash
cd vercel-hosted
psql $DATABASE_URL -f supabase/migrations/001_initial.sql
```

Or copy the SQL into the Supabase SQL Editor and run it.

### 2. Configure environment variables

Copy the example file:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your values:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEMETRY_ENABLED=1
TELEMETRY_ALLOWED_KEYS=symbol,ticker,timeframe

MCP_API_KEYS=your-first-api-key,your-second-api-key

UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token

TOOL_BACKEND=mock
TV_AUTO_APPROVE_DESTRUCTIVE=1
```

### 3. Deploy to Vercel

```bash
cd vercel-hosted
npm install
vercel --prod
```

After deploy you will get a URL like `https://your-app.vercel.app`.

### 4. Connect an MCP client

```text
GET https://your-app.vercel.app/api/sse?key=your-first-api-key
```

The SSE stream sends an `endpoint` event:

```
event: endpoint
data: /api/messages?sessionId=abc-123&key=your-first-api-key
```

POST JSON-RPC tool messages to that URL. Example:

```bash
curl -X POST "https://your-app.vercel.app/api/messages?sessionId=abc-123&key=your-first-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "tv_change_symbol",
      "arguments": { "symbol": "NASDAQ:AAPL" }
    }
  }'
```

---

## Architecture

```
┌─────────────┐      GET /api/sse?key=...       ┌─────────────────────────┐
│  MCP client │  ───────────────────────────▶   │   Vercel function       │
│             │◀──── SSE endpoint event          │   creates session       │
└─────────────┘                                  │   + per-client MCP      │
       │                                         │   server instance       │
       │ POST /api/messages?sessionId=...        └───────────┬─────────────┘
       │──────────────────────────────────────────────────────▶│
       │                                          │   Redis session store   │
       │◀──── 202 Accepted                          │   (cross-region)        │
       │                                          └───────────┬─────────────┘
       │                                                      │
       │◀──── SSE event: tool result                          │
                                                            │
                                               ┌────────────▼────────────┐
                                               │  Supabase telemetry +     │
                                               │  API-key/feature flags    │
                                               └───────────────────────────┘
```

---

## Privacy model

The hosted fork is **opt-in** and separate from the local project. It does not store cookies, tokens, passwords, Pine source, indicator configs, strategy parameters, or screenshots.

By default, telemetry only logs:

- `user_id` (API-key label or id)
- `tool_name`
- `symbol`, `ticker`, `timeframe` (if present in the request)
- `duration_ms`
- `success` / `error_message`
- `timestamp`

Configure the allow-list via `TELEMETRY_ALLOWED_KEYS`. To disable telemetry entirely, set `TELEMETRY_ENABLED=0`.

The `mcp_usage_logs` table includes a generated `cache_key` column for quick cache-popularity rollup:

```sql
cache_key = lower(tool_name) || ':' || coalesce(symbol, ticker, 'unknown') || ':' || coalesce(timeframe, 'unknown')
```

---

## Authentication

### Static API keys

Set `MCP_API_KEYS` to a comma-separated list. These keys work immediately without a database round-trip.

### Supabase-backed API keys

For production, store SHA-256 key hashes in `mcp_api_keys`:

```sql
insert into mcp_api_keys (key_hash, label, rate_limit_per_minute, allowed_tools)
values (
  'sha256-of-your-key',
  'prod-client-1',
  120,
  array['tv_status', 'tv_chart_metadata', 'tv_change_symbol', 'tv_change_timeframe']
);
```

Use the `scripts/hash-key.js` helper (create it first) to hash a plaintext key before inserting.

Only SHA-256 hashes are stored; plaintext keys are never persisted.

---

## Feature flags

Runtime flags are read from `mcp_feature_flags` when Supabase telemetry is enabled, or from environment variables otherwise.

| Key | Env fallback | Effect |
|---|---|---|
| `disable_telemetry` | `FLAG_DISABLE_TELEMETRY=1` | Stop writing usage rows. |
| `read_only_mode` | `FLAG_READ_ONLY_MODE=1` | Block all destructive tools. |
| `disable_destructive_tools` | `FLAG_DISABLE_DESTRUCTIVE_TOOLS=1` | Block destructive tools (same as read-only for tools). |

Seed defaults are inserted by the migration.

---

## Tool backends

| Backend | Use case | How |
|---|---|---|
| `mock` | Local testing, CI, demo | Deterministic fake prices. |
| `market-data-api` | Production | Integrate a real data provider in `lib/tools/registry.ts`. |

Set `TOOL_BACKEND=market-data-api` and replace the `marketDataProvider` implementation in `lib/tools/registry.ts` with calls to your licensed provider (Polygon, Yahoo Finance, Twelve Data, etc.).

---

## Sessions and multi-region behavior

SSE transports are stateful. By default:

- The GET `/api/sse` handler creates a session in Redis and keeps a live transport in the function instance.
- The POST `/api/messages` handler checks the in-memory transport first.
- If the POST lands on a different instance, it returns `409 Conflict` so the client can reconnect.

For single-region Hobby deployments this rarely matters. For Pro multi-region deployments, pin functions to one region or switch to a stateless polling design.

---

## Supabase schema reference

### `mcp_usage_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint | Primary key. |
| `user_id` | text | API-key label/id. |
| `tool_name` | text | Tool name. |
| `parameters` | jsonb | Allow-listed parameters only. |
| `duration_ms` | integer | Tool execution time. |
| `success` | boolean | Whether the call succeeded. |
| `error_message` | text | Optional error text. |
| `created_at` | timestamptz | Timestamp. |
| `cache_key` | text | Generated rollup for cache analytics. |

### `mcp_api_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key. |
| `key_hash` | text | SHA-256 of the API key. Unique. |
| `label` | text | Human-readable name. |
| `rate_limit_per_minute` | integer | Reserved for future rate limiting. |
| `allowed_tools` | text[] | Optional tool whitelist. |
| `is_active` | boolean | Toggle key access. |

### `mcp_feature_flags`

| Column | Type | Notes |
|---|---|---|
| `key` | text | Primary key. |
| `value` | boolean | Flag state. |
| `updated_at` | timestamptz | Last update. |

---

## Testing locally

```bash
cd vercel-hosted
npm install
cp .env.local.example .env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MCP_API_KEYS
npm run dev
```

Then connect a test client:

```bash
curl -N "http://localhost:3000/api/sse?key=your-api-key"
```

---

## Limitations

- No browser automation. All Playwright/CDP tools are disabled.
- Destructive tool approval is auto-approved (`TV_AUTO_APPROVE_DESTRUCTIVE=1`) because there is no local dashboard. Add an external authorization layer before exposing destructive hosted tools.
- Session affinity is best-effort; a 409 reconnect is possible across regions.
