# Loop Engineering — tradingview-chrome-mcp (opencode)

You are an agent driving continued development of `tradingview-chrome-mcp`, a standalone local MCP server (TypeScript, STDIO) that lets opencode/Codex safely control Chrome for TradingView. A dashboard runs in-process on http://127.0.0.1:3939.

## Project facts
- Location: `C:\Users\Pedot\Documents\Tradingview\tradingview-chrome-mcp`.
- Build: `npm run build`. Typecheck: `npm run typecheck`. Tests: `npm test` (node:test + linkedom). Run server: `node dist/server/index.js` or `pwsh scripts/run.ps1`. Start Chrome with debugging: `pwsh scripts/start-chrome.ps1`.
- Layout: `src/server` (MCP STDIO + optional HTTP), `src/tools/registry.ts` (tools), `src/browser/controller.ts` (Playwright over CDP), `src/adapters/tradingview/adapter.ts` (DOM), `src/permissions` (policy + approvals), `src/validation/schemas.ts` (zod), `src/dashboard/server.ts` (Express on 127.0.0.1).
- One-click launcher: `Launch-TV-MCP.cmd` → `scripts/Launch-TV-MCP.ps1`.
- 31 MCP tools live. Read path + destructive path are implemented; some paths unit-tested and not all live-verified.
- Codex registration lives in `C:\Users\Pedot\.codex\config.toml` under `[mcp_servers.tradingview-chrome-mcp]`. Do not touch unrelated config.

## Safety invariants (never break)
- Domain allowlist: tradingview.com / www.tradingview.com only.
- Destructive tools require dashboard approval. `TV_AUTO_APPROVE_DESTRUCTIVE=1` is dev-only and must be reverted after any test run.
- `emergency_stop` denies everything until an approved `emergency_clear`.
- Every action is audit-logged to `logs/audit.jsonl` with credentials redacted.
- Never store cookies/passwords/tokens. Never enable live trading. Logs/screenshots stay local.
- No giant DOM dumps. Selector regression tests use the tiny inline fixture in `tests/unit/selectors.test.ts`.

## The loop — run for EVERY task and every TradingView action
1. **Observe** — read the relevant source first. For TradingView actions: detect Chrome state, confirm a TV tab is open + logged in, read current symbol/timeframe/Pine state, screenshot. Never assume the page is in the expected state.
2. **Analyze** — what's requested, required browser steps, current vs desired state, destructive effects, whether approval is needed, which selectors to use, recovery path, verification method.
3. **Design** — minimal, atomic, idempotent plan. Prefer stable selectors (aria-label, data-qa-id, data-name), accessible names, text-based targeting. Avoid blind clicks, long unverified chains, fixed sleeps without state checks, screen coordinates.
4. **Implement** — one logical action at a time. After every meaningful step: re-read state + screenshot. Use `page.evaluate` clicks to bypass TradingView's `overlap-manager-root` overlay when Playwright clicks get intercepted.
5. **Evaluate** — verify against the goal (re-read symbol/timeframe, check Pine buffer, confirm compile success, confirm indicator on chart). Capture before/after screenshots. Run `npm run typecheck && npm test`.
6. **Reflect** — update `CONTEXT.md` only here. Log what worked, what broke, new selectors learned, next priority. No success claims without visual + state verification.

## Working rules
- Inspect the environment before coding; read a file before editing it.
- Keep edits scoped to the module the task implies; leave unrelated refactors alone.
- Prefer existing patterns: zod schemas for inputs, `textOf`/fallback-selector style in the adapter, approval-gated destructive tool pattern in the registry.
- If a selector is fragile, add a fallback selector + a case in `tests/unit/selectors.test.ts`. Never add a new fixture HTML file for this.
- Tests scale with risk: narrow for small changes, broader for shared/cross-module behavior.
- Report blockers clearly. End every task with a severity-ranked list of remaining risks.

## Verification bar
A task is done only when: typecheck passes, `npm test` passes, the affected tool is exercised live (or unit-tested), and before/after screenshots exist in `./screenshots`.

## How to use opencode
- Use `opencode` subagents/tasks for parallelizable independent steps (e.g. separate adapter function + its unit test). Keep the loop sequential for anything that touches the live TradingView tab.
- Before any live TradingView action, run `ping`, `browser_status`, `tv_status` to Observe.
- Capture `tv_screenshot` before and after every destructive step as evidence.

## Current next priorities (one per loop)
1. Live-test `Launch-TV-MCP.cmd` end-to-end on a fresh Windows machine with and without Chrome already running.
2. Live-verify Phase 4 tools individually: alerts create/delete, watchlist add/sync, chart-data export, drawings.
3. Live-verify `tv_rename_script` end-to-end against a real saved Pine script.
4. Find/create a TradingView "New layout" entry point so a throwaway test layout can be auto-created.
5. Build a Windows tray app / compiled executable (e.g. `pkg`) as the next packaging step.

Start every turn by Observe-ing the current state of the file or tool you've been asked to work on.
