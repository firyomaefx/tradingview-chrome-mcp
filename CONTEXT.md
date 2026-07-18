# Context (v0.3)

## Current state (2026-07-18, after the single-click launcher pass)
- 31 MCP tools. New tools from earlier pass: `tv_chart_metadata`, `tv_watchlist_sync`, `tv_rename_script`.
- **One-click Windows launcher**: `Launch-TV-MCP.cmd` → `scripts/Launch-TV-MCP.ps1`.
  - Detects Chrome with debug port; launches Chrome with `--remote-debugging-port=9222` if missing.
  - Starts the MCP server + dashboard in the background.
  - Opens the dashboard in the browser.
  - Creates a desktop shortcut on first run (`-CreateShortcut`).
- **Browser controller enhanced**:
  - `getBrowser` now resets stale cached connections and reconnects automatically.
  - `getTradingViewTab` filters out detached/crashed pages and prefers alive chart tabs.
  - When auto-launching Chrome, navigates to `TV_DEFAULT_TRADINGVIEW_URL` (default: `https://www.tradingview.com/chart/`).
- **Security invariant preserved**: the launcher uses the user's real Chrome profile for session continuity; it does **not** store, extract, or inject cookies, passwords, or tokens.
- Streamable HTTP transport remains opt-in via `TV_MCP_HTTP_PORT` / `TV_ENABLE_HTTP_MCP`.
- Standalone release installer `scripts/install-cli.ps1` and GitHub Actions release pipeline are in place.
- 24 unit tests pass. MCP smoke reports 31 tools.

## Live-verified (against the user's real FCPO chart, 2026-07-18)
- changeSymbol AAPL -> Apple Inc, reverted. changeTimeframe 5 -> 15 -> 5. Both changed:true.
- openPineEditor opened:true. setPineSource replaced the editor buffer (compile success, no errors).
- clickSave saved:true. addScriptToChart added:true. Screenshots at every step (destruct2-*).
- `Launch-TV-MCP.cmd` and the launcher PowerShell script are implemented and syntax-checked; **not yet live-tested on a fresh machine**.
- `tv_rename_script`, `tv_chart_metadata`, `tv_watchlist_sync`, and Streamable HTTP transport: not yet live-verified end-to-end.
- Unit tests: 24/24 (policy, schemas, timeframe URL parse, selector fixture).
- MCP smoke: initialize + tools/list -> 31 tools.

## Known limitations / remaining
- The one-click launcher has not been end-to-end tested from a clean Windows environment with/without Chrome running.
- `tv_rename_script`, `tv_chart_metadata`, `tv_watchlist_sync`, and Streamable HTTP transport are not yet live-verified end-to-end.
- Layout creation via automation did not find a "New layout" menu item in this account; tv_layout_switch works against existing layouts.
- Save-as name prompt did not appear for this account (TradingView auto-saves as "Untitled script"); `tv_rename_script` provides the clean-naming follow-up.
- Drawings, alerts create/delete, watchlist add/sync, chart-data export are implemented with best-effort selectors and not individually live-verified.
- Phase 5 installer is PowerShell-based (`install.ps1` from source, `install-cli.ps1` from release). No MSI/WiX or compiled executable yet.
- Chrome extension is a minimal MV3 connector (badge + popup + content snapshot); no trading logic.

## Repository
- Pushed to GitHub: https://github.com/firyomaefx/tradingview-chrome-mcp (public, default branch `main`).
- Latest release: `v0.2.0` (includes launcher, HTTP transport, chart metadata, watchlist sync).
- Local-only artifacts (logs, screenshots, exports, .codex/, backups, tsconfig.tsbuildinfo) are excluded via `.gitignore`.

## Decisions
- Auto-approve destructive is used only for verification script runs; the shipped server requires dashboard approval by default.
- The launcher never kills existing Chrome silently; it only closes Chrome when `TV_ALLOW_CHROME_KILL=1` is set, and even then it shows a 5-second countdown.
- Session continuity is achieved by launching Chrome with the user's real profile, not by extracting or injecting cookies/tokens.
- Selector fragility is guarded by `tests/unit/selectors.test.ts` (tiny inline HTML fixture + linkedom), not giant DOM dumps.

## Next priorities
1. Live-test `Launch-TV-MCP.cmd` end-to-end on a fresh Windows machine with and without Chrome already running.
2. Live-verify `tv_rename_script`, `tv_chart_metadata`, and `tv_watchlist_sync` end-to-end.
3. Live-verify alerts/watchlist/export individually against a test layout.
4. Find/create a TradingView "New layout" entry point so a throwaway test layout can be auto-created.
5. Build a Windows tray app / compiled executable (e.g. `pkg`) as the next packaging step.
