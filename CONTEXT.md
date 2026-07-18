# Context (v0.3.1)

## Current state (2026-07-18, after the hardening pass)
- 32 MCP tools. New this pass: `tv_ensure_chart`.
- **One-click Windows launcher live-tested**: `Launch-TV-MCP.cmd` → `scripts/Launch-TV-MCP.ps1` successfully detected the existing Chrome debug port, started the MCP server + dashboard in the background, and `/api/status` returned connected.
- **Chrome-kill warning hardened**: launcher now shows an explicit warning and requires typing `"yes"` before force-closing Chrome when `TV_ALLOW_CHROME_KILL=1`.
- **HTTP transport bind option**: added `TV_MCP_HTTP_BIND` env var (default `127.0.0.1`, allow `0.0.0.0` for LAN). CORS remains restricted to localhost when bound locally. No telemetry or remote logging.
- **Diagnostics added to `tv_status`**: `diagnostics.chromeReachable`, `diagnostics.tradingViewTabFound`, `diagnostics.pageDomReady`.
- **Local packaging helper**: `scripts/package-zip.ps1` builds the same Windows zip the GitHub Actions release job produces.
- 24 unit tests pass. MCP smoke reports 32 tools.

## Live-verified (against the user's real FCPO chart, 2026-07-18)
- `Launch-TV-MCP.ps1` launched: Chrome debug port detected, MCP server started, dashboard reachable, `tv_status` returned full state including diagnostics.
- changeSymbol AAPL -> Apple Inc, reverted. changeTimeframe 5 -> 15 -> 5. Both changed:true.
- openPineEditor opened:true. setPineSource replaced the editor buffer (compile success, no errors).
- clickSave saved:true. addScriptToChart added:true. Screenshots at every step (destruct2-*).
- `tv_rename_script`, `tv_chart_metadata`, `tv_watchlist_sync`, and Streamable HTTP transport: not yet live-verified end-to-end.
- Unit tests: 24/24.
- MCP smoke: initialize + tools/list -> 32 tools.

## Known limitations / remaining
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
- The launcher never kills existing Chrome silently; it only closes Chrome when `TV_ALLOW_CHROME_KILL=1` is set, and now requires explicit user confirmation plus a 5-second countdown.
- Session continuity is achieved by launching Chrome with the user's real profile, not by extracting or injecting cookies/tokens.
- Streamable HTTP transport is local-only by default; LAN binding is opt-in and documented as a firewall/security responsibility.
- No request telemetry, API-key gating, or remote logging is implemented.
- Selector fragility is guarded by `tests/unit/selectors.test.ts` (tiny inline HTML fixture + linkedom), not giant DOM dumps.

## Next priorities
1. Live-verify `tv_rename_script`, `tv_chart_metadata`, and `tv_watchlist_sync` end-to-end.
2. Live-verify alerts/watchlist/export individually against a test layout.
3. Find/create a TradingView "New layout" entry point so a throwaway test layout can be auto-created.
4. Build a Windows tray app / compiled executable (e.g. `pkg`) as the next packaging step.
