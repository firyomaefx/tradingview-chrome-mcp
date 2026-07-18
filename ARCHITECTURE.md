# Architecture

```
+------------------+        STDIO (JSON-RPC)        +-------------------+
|      Codex       | <----------------------------- |   MCP server      |
| (App/CLI/IDE)    |   tools/list, tools/call       |  (src/server)     |
+------------------+                                +-------------------+
                                                             |
                                  +--------------------------+
                                  v
                          +---------------+     +-------------------------+
                          |  Tool registry|---->| Permission policy +     |
                          |  (src/tools)  |     | approval queue          |
                          +---------------+     | (src/permissions)       |
                                  |             +-------------------------+
                                  v                          ^
                          +---------------+                  | approve/deny
                          | TV adapter    |                  |
                          | (src/adapters)|         +-------------------+
                          +---------------+         | Local dashboard   |
                                  |                | (src/dashboard)   |
                                  v                | Express 127.0.0.1 |
                          +---------------+         +-------------------+
                          | Browser       |                 ^
                          | controller    |                 | status/history
                          | (Playwright   +-----------------+
                          |  over CDP)    |
                          +---------------+
                                  |
                                  v
                         User's real Chrome (remote-debugging-port=9222)
                                  |
                                  v
                         tradingview.com chart tab
```

## Layers

1. **MCP server (`src/server`)** - STDIO transport by default (`StdioServerTransport`), `tools/list` and `tools/call` dispatch. Optional Streamable HTTP transport (`src/server/http.ts`) on `127.0.0.1:3940`. Boots the dashboard in-process so the approval queue is shared in memory.
2. **Tool registry (`src/tools`)** - Each tool declares its JSON schema, whether it is destructive, and its handler. Handlers are thin: they resolve the active TradingView tab and call into the adapter.
3. **Permissions (`src/permissions`)** - Domain allowlist, emergency stop, rate limit, action-chain cap, and the pending-approval queue. `evaluate()` returns `allow / block / deny`. `block` is retryable after approval; `deny` is terminal.
4. **Browser controller (`src/browser`)** - Attaches to Chrome over CDP using Playwright `connectOverCDP`. Lists tabs, finds TradingView tabs, caches the active one. Auto-launch of the user Chrome is opt-in (`TV_ALLOW_CHROME_LAUNCH=1`) to avoid silently reusing a profile that is already running.
5. **TradingView adapter (`src/adapters/tradingview`)** - All DOM-level logic. Each reader uses multiple selector strategies with fallbacks (header buttons, aria-labels, Monaco API) and falls back to URL parsing for symbol/timeframe. Writers (Pine source, save, add-to-chart) prefer the Monaco model API and keyboard input as a fallback.
6. **Dashboard (`src/dashboard`)** - Express on `127.0.0.1` only. Polls status every 3s. Exposes `/api/status`, `/api/pending`, `/api/pending/:id/approve|deny`, `/api/history`, `/api/screenshots`, `/api/screenshot`, `/api/emergency_stop`, `/api/emergency_clear`.
7. **Logging (`src/logging`)** - `pino` for runtime logs; append-only JSONL `logs/audit.jsonl` for the audit trail. All inputs are run through `redact()` to strip credentials before logging.

## Key invariants

- No tool executes against a non-allowlisted URL.
- Every tool call is audit-logged with result, duration, tab URL, and screenshot path.
- Destructive tools create a pending approval and wait up to `TV_APPROVAL_TIMEOUT_MS`; timeout = deny.
- `emergency_stop` flips a flag that makes `evaluate()` deny everything until `emergency_clear` (which itself needs approval).
- The browser controller never reads, stores, or transmits cookies, tokens, or passwords; it only drives a tab the user already has open.

## Transport roadmap

STDIO is shipped. Streamable HTTP is implemented in `src/server/http.ts` and enabled via `TV_MCP_HTTP_PORT` or `TV_ENABLE_HTTP_MCP`; it runs on a separate port from the dashboard. The tool registry and adapter are transport-agnostic.
