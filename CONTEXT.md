# Context (v0.2)

## Current state (2026-07-18, after the improvements pass)
- 31 MCP tools (was 29). New: `tv_chart_metadata` reads visible chart indicators/strategies/overlays/panes; `tv_watchlist_sync` reads the watchlist and optionally adds a symbol if missing.
- Streamable HTTP transport added in `src/server/http.ts`, opt-in via `TV_MCP_HTTP_PORT` or `TV_ENABLE_HTTP_MCP` (default 127.0.0.1:3940), alongside STDIO.
- Standalone PowerShell CLI installer added: `scripts/install-cli.ps1` downloads the latest GitHub release zip and installs to `%LOCALAPPDATA%` with Start-menu shortcut, health check, and Codex registration — no source build required.
- 24 unit tests pass (added schema tests for `tvWatchlistSyncIn` and `tvChartMetadataIn`).
- Timeframe now falls back to the URL `interval=` query when the button selector misses.
- readDialogs hardened to only report real `[role="dialog"]` / `data-name="*-dialog"` containers (was false-positiving on the watchlist `overlayScrollWrap`).
- openPineEditor uses an eval-click first to bypass TradingView's `overlap-manager-root` slider overlay that intercepts Playwright pointer clicks.
- setPineSource uses the Monaco model API, else `keyboard.insertText` after `Control+a` (the global `window.monaco` is not the same instance TradingView bundles).
- clickSave uses the title-menu "Save script" path with a save-as name prompt handler; addScriptToChart uses force + eval-click fallback.
- getTradingViewTab calls `bringToFront` so the chart legend/toolbar render (they are lazy).

## Live-verified (against the user's real FCPO chart, 2026-07-18)
- changeSymbol AAPL -> Apple Inc, reverted. changeTimeframe 5 -> 15 -> 5. Both changed:true.
- openPineEditor opened:true. setPineSource replaced the editor buffer (compile success, no errors).
- clickSave saved:true. addScriptToChart added:true. Screenshots at every step (destruct2-*).
- `tv_rename_script`: selector path is unit-tested; not yet live-exercised against a real Pine script.
- `tv_chart_metadata` and `tv_watchlist_sync`: adapter logic added; not yet live-verified.
- `tv_rename_script` and Streamable HTTP transport: not live-exercised.
- Unit tests: 24/24 (policy, schemas, timeframe URL parse, selector fixture).
- MCP smoke: initialize + tools/list -> 31 tools.

## Known limitations / remaining
- `tv_rename_script`, `tv_chart_metadata`, `tv_watchlist_sync`, and Streamable HTTP transport are not yet live-verified end-to-end.
- Layout creation via automation did not find a "New layout" menu item in this account; tv_layout_switch works against existing layouts. The destructive run therefore operated on the current chart with full reversibility (symbol/timeframe restored).
- Save-as name prompt did not appear for this account (TradingView auto-saves as "Untitled script"); the script saved and added to the chart successfully. `tv_rename_script` now provides the clean-naming follow-up.
- Drawings, alerts create/delete, watchlist add/sync, chart-data export are implemented with best-effort selectors and not individually live-verified this pass; they follow the same pattern and are approval-gated.
- Phase 5 installer is PowerShell-based (`install.ps1` from source, `install-cli.ps1` from release). No MSI/WiX yet.
- Chrome extension is a minimal MV3 connector (badge + popup + content snapshot); no trading logic.

## Repository
- Pushed to GitHub: https://github.com/firyomaefx/tradingview-chrome-mcp (public, default branch `main`).
- Initial commit `e3045f2` includes the full codebase; local-only artifacts (logs, screenshots, exports, .codex/, backups, tsconfig.tsbuildinfo) are excluded via `.gitignore`.

## Decisions
- Auto-approve destructive was used only for the verification script run; the shipped server requires dashboard approval by default.
- The destructive run operated on the user's current chart (no separate MCP-TEST layout could be created); symbol/timeframe were restored after.
- Selector fragility is now guarded by `tests/unit/selectors.test.ts` (tiny inline HTML fixture + linkedom), not a giant DOM dump.

## Next priorities
- Create a `v*.*.*` tag to trigger the new release workflow and verify the `tradingview-chrome-mcp-windows.zip` asset.
- Live-verify `tv_rename_script`, `tv_chart_metadata`, and `tv_watchlist_sync` end-to-end.
- Live-verify alerts/watchlist/export individually against a test layout.
- Add a "New layout" creator once TradingView exposes the menu item.
