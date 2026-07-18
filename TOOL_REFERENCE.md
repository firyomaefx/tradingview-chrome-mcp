# Tool Reference (v0.2 — adds Phase 4 tools, dialog dismiss, live-verified selectors)

All tools are exposed via MCP `tools/list` and `tools/call`. Inputs are validated with zod schemas in `src/validation/schemas.ts`. Destructive tools require dashboard approval (or `TV_AUTO_APPROVE_DESTRUCTIVE=1` in dev).

## General

### `ping`
Health check. Returns `{ name, version, emergencyStop, allowedDomains }`. Read-only.

### `emergency_stop`
Immediately denies every tool until `emergency_clear`. Read-only.

### `emergency_clear`
Re-enables tools. Requires dashboard approval.

## Browser

### `browser_status`
Chrome connection status + tab summary. Read-only.

### `browser_list_tabs`
All open Chrome tabs with full URLs and titles. Read-only.

## TradingView - read

### `tv_status`
Chart state: `{ url, symbol, timeframe, isLoggedIn, pineEditorOpen, pineEditorReady, dialogs, pageReady }`. Symbol falls back to the URL `symbol=` query; timeframe falls back to the URL `interval=` query. Read-only.

### `tv_read_chart`
Alias for `tv_status`. Read-only.

### `tv_screenshot`
PNG of the active TradingView tab. Input `{ name?, fullPage? }`. Read-only.

### `tv_read_pine_source`
Current Pine Script source via the Monaco model API, with a `.view-lines` DOM fallback when TradingView bundles its own Monaco. Read-only.

### `tv_read_strategy_tester`
Strategy Tester summary if visible. Read-only.

### `tv_watchlist_read`
Symbols in the active watchlist panel. Read-only.

### `tv_layout_list`
Saved chart layout names (opens the layouts menu). Read-only.

### `tv_alert_list`
Existing alert messages (opens the alerts panel). Read-only.

## TradingView - Pine editor

### `tv_open_pine_editor`
Opens the Pine Editor (`button[data-name="pine-dialog-button"]`) using an eval-click that bypasses TradingView overlay interception. Idempotent.

### `tv_pine_create`
Replaces the editor buffer with new Pine v6 source. Input `{ name, source, overwrite? }`. Does NOT save. Uses Monaco model API or `keyboard.insertText` after `Control+a`.

### `tv_pine_patch`
Overwrites the editor buffer with replacement source. Input `{ scriptName, source }`. Does NOT save.

### `tv_pine_compile_errors`
Compile errors/warnings from the DOM panel + Monaco markers. Read-only.

### `tv_pine_save` (destructive)
Saves the script via the title-menu "Save script" path, filling a name prompt if it appears. Input `{ scriptName? }`. Approval-gated.

### `tv_pine_add_to_chart` (destructive)
Adds the current script to the chart via `button[data-qa-id="add-script-to-chart"]` (force + eval-click fallback). Approval-gated.

### `tv_rename_script` (destructive)
Renames the current Pine script via the editor title menu (`[data-qa-id="pine-script-title-button"]` → "Rename…"). Input `{ name }`. Approval-gated. Returns `{ renamed, oldName, newName, dialog }`.

### `tv_chart_metadata` (read-only)
Reads visible chart metadata from the legend/panes: `{ symbol, timeframe, visibleIndicators, overlays, strategies, paneCount }`.

## TradingView - chart configuration

### `tv_change_symbol` (destructive)
Changes symbol via the legend `Change symbol` button + symbol search. Input `{ symbol }`. Approval-gated.

### `tv_change_timeframe` (destructive)
Changes timeframe via the legend `Change interval` button + menu. Input `{ timeframe: "1"|"5"|"15"|"30"|"60"|"240"|"D"|"W"|"M" }`. Approval-gated.

## TradingView - Phase 4

### `tv_dismiss_dialogs`
Closes known TradingView upsell/notice dialogs (close/X buttons only; never clicks primary CTAs). Non-destructive.

### `tv_layout_switch` (destructive)
Switches to a saved layout by exact name. Input `{ name }`. Approval-gated.

### `tv_alert_create` (destructive)
Creates a basic alert with a message. Input `{ message }`. Approval-gated.

### `tv_alert_delete` (destructive)
Deletes the alert at a zero-based index. Input `{ index }`. Approval-gated.

### `tv_watchlist_add_symbol` (destructive)
Adds the current chart symbol to the watchlist via the star button. Input `{ symbol }`. Approval-gated.

### `tv_watchlist_sync` (destructive when adding)
Reads the active watchlist and optionally adds the current/requested symbol if missing. Input `{ symbol?, addIfMissing? }`. If `addIfMissing` is true (default) and the symbol is missing, approval is required. Returns `{ synced, added, symbols }`.

### `tv_ensure_chart` (non-destructive)
Ensures a usable TradingView chart tab is reachable. If the active tab is not on `tradingview.com`, opens the Pine Editor and returns the resulting state. Useful after the launcher auto-opens Chrome.

### `tv_chart_data_export` (destructive)
Triggers chart-data CSV export and saves the download to `./exports`. Approval-gated.

### `tv_drawing_add_trendline` (destructive, experimental)
Draws a trend line via the left drawing toolbar using two mouse clicks. Best-effort. Approval-gated.

## Result conventions

- `ok: true` - success; `data` carries the structured result.
- `ok: false, blocked: true` - blocked pending approval or a soft limit; retry after resolving the blocker.
- `ok: false, denied: true` - hard deny (domain, emergency stop, unknown tool).
- `ok: false, error: string` - runtime error; see `logs/audit.jsonl`.

## Live-verified selectors (2026-07-18)
`button[aria-label="Change symbol"]`, `button[aria-label="Change interval"]`, `button[data-name="pine-dialog-button"]`, `[data-qa-id="pine-script-save-button"]`, `[data-qa-id="add-script-to-chart"]`, `[data-qa-id="pine-script-title-button"]`, `input[placeholder="Symbol, ISIN, or CUSIP"]`, `[aria-label="Rename..."]`, `[class*="watchlist"] [class*="symbol"]`. Regression-tested in `tests/unit/selectors.test.ts`.

## Transports

- **STDIO** is the default. Use with Codex/Claude Code MCP clients.
- **Streamable HTTP** is opt-in via `TV_MCP_HTTP_PORT=3940` or `TV_ENABLE_HTTP_MCP=1`. Binds to `127.0.0.1` only with localhost CORS. Useful for remote/local HTTP clients or future web dashboards.
