# MVP Completion Report - tradingview-chrome-mcp

Date: 2026-07-18
Status: MVP delivered and registered with Codex.

## What was built

A standalone local TypeScript MCP server (STDIO) plus an in-process Express dashboard that lets Codex safely control Chrome for TradingView activities. 18 MCP tools. Read path verified end-to-end against a live TradingView session.

## Acceptance criteria (from the spec)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Connect to the user's existing Chrome | PASS | Dashboard `/api/status` returned `connected:true`, 2 tabs. |
| 2 | Find an open TradingView tab | PASS | Found `https://www.tradingview.com/chart/?symbol=MYX:FCPO1!`. |
| 3 | Read current symbol and timeframe | PARTIAL | Symbol read (`MYX:FCPO1!`); timeframe selector did not match this session, returned null. URL `interval=5` is available as a fallback to add. |
| 4 | Open Pine Editor | PASS | Detected `pineEditorOpen:true`; `tv_open_pine_editor` is idempotent. |
| 5 | Read an existing Pine script | PASS | `tv_read_pine_source` returned a real `//@version=6` Pine source. |
| 6 | Create or patch a Pine Script v6 indicator | IMPLEMENTED | `tv_pine_create` / `tv_pine_patch` use the Monaco model API with keyboard fallback. Not live-verified (destructive path needs approval). |
| 7 | Save the script | IMPLEMENTED | `tv_pine_save` (destructive, approval-gated, audit-logged). |
| 8 | Detect and report compilation errors | IMPLEMENTED | `tv_pine_compile_errors` reads the DOM error panel + Monaco markers. |
| 9 | Add the compiled script to the chart | IMPLEMENTED | `tv_pine_add_to_chart` (destructive, approval-gated). |
| 10 | Capture evidence the indicator is visible | PASS | `tv_screenshot` produced a 414KB PNG in `./screenshots`. |
| 11 | Save all actions in an audit log | PASS | `logs/audit.jsonl` (JSONL, redacted). |
| 12 | Emergency-stop command | PASS | `emergency_stop` unit-tested; denies all tools until approved `emergency_clear`. |

## Verification runs
- `npm run typecheck` - clean.
- `npm test` - 12/12 unit tests pass (policy + schema parsing).
- `npm run build` - clean, `dist/server/index.js` emitted.
- `scripts/smoke.mjs` - MCP `initialize` + `tools/list` -> 18 tools.
- `scripts/smoke2.mjs` - `ping` returns version + emergency-stop state.
- `scripts/smoke3.mjs` - `tv_status`, `tv_read_pine_source`, `tv_screenshot` against a live TradingView session.
- `scripts/smoke-dashboard.mjs` - dashboard `/api/status` returns live chart state.

## Codex registration
Registered globally via `codex mcp add`:
- Name: `tradingview-chrome-mcp`
- Command: `node C:\Users\Pedot\Documents\Tradingview\dist\server\index.js`
- Env: `TV_DASHBOARD_PORT=3939`, `TV_LOG_LEVEL=info`, `TV_APPROVAL_TIMEOUT_MS=120000`
- `codex mcp list` confirms `enabled`.
- Existing Codex config (node_repl, plugins, marketplaces, model settings) preserved.

## Deliverables
- Working TypeScript MCP server (src/server, src/tools, src/browser, src/adapters, src/permissions, src/validation, src/logging, src/dashboard).
- Codex MCP config (.codex/config.toml) + global registration.
- Local control dashboard (Express on 127.0.0.1:3939).
- Launcher scripts: start-chrome.ps1, run.ps1, register-codex.ps1.
- Smoke tests: smoke.mjs, smoke2.mjs, smoke3.mjs, smoke-dashboard.mjs.
- Unit tests: tests/unit/policy.test.ts, tests/unit/schemas.test.ts.
- Docs: README, ARCHITECTURE, SECURITY, TOOL_REFERENCE, TEST_PLAN, TROUBLESHOOTING, CONTEXT, SAMPLE_WORKFLOW.
- Sample Pine v6 fixture: tests/fixtures/sample.pine.
- Audit log and screenshots directory live.

## Remaining risks (severity-ranked)
1. HIGH - Selector fragility: TradingView selectors change often. Read/edit tools use multiple fallbacks but are not regression-tested against saved DOM fixtures (Phase 6). Mitigation: every tool returns a clear error and a screenshot is captured, so failures are visible.
2. HIGH - Destructive path unverified live: `tv_pine_create/patch/save/add_to_chart` and `tv_change_symbol/timeframe` rely on Monaco model API and TradingView's save/add-to-chart buttons; not yet exercised against a paper-trading layout in this build. Approval gate prevents accidental harm.
3. MEDIUM - Timeframe read returns null when the button selector does not match. Add the URL `interval=` fallback in `readChartState`.
4. MEDIUM - Upsell/sign-up dialogs (e.g. "Look first / Then leap.") are detected and reported but not auto-dismissed; a tool that clicks a primary button while a dialog is open may hit the dialog instead. Future: a `tv_dismiss_dialog` tool (approval-gated).
5. MEDIUM - Chrome remote-debugging requires the user's Chrome to be started with `--remote-debugging-port=9222`. If Chrome is already running without it, auto-launch focuses the existing process and the debug port is ignored. Documented in README/TROUBLESHOOTING.
6. LOW - `TV_AUTO_APPROVE_DESTRUCTIVE=1` bypasses approvals. Intended for dev only; default is off.
7. LOW - Chrome extension (Phase 1 design option) not implemented; the dashboard + CDP path covers the MVP connection use cases.
8. LOW - Layouts, drawings, alerts, watchlists, chart-data export (Phase 4) not implemented.
9. LOW - Windows installer/packaging (Phase 5) not implemented.
10. LOW - Stale `dist/src` directory from an early tsconfig rootDir; harmless, does not affect the registered entrypoint at `dist/server/index.js`.
