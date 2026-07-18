# Context (v0.2)

## Current state (2026-07-18, after the rename-script pass)
- 29 MCP tools (was 28). New: `tv_rename_script` renames the current Pine script via the editor title menu (Rename…). Schema + adapter + registry + selector regression test added.
- Selectors corrected/added: `button[aria-label="Change symbol"]`, `button[aria-label="Change interval"]`, `button[data-name="pine-dialog-button"]`, `[data-qa-id="pine-script-save-button"]`, `[data-qa-id="add-script-to-chart"]`, `[data-qa-id="pine-script-title-button"]`, `input[placeholder="Symbol, ISIN, or CUSIP"]`, `[aria-label="Rename..."]`.
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
- `tv_rename_script`: selector path is unit-tested; the title-menu → Rename… → fill/confirm flow is implemented but not yet exercised against a live Pine script (pending user approval for the destructive rename).
- Unit tests: 22/22 (policy, schemas, timeframe URL parse, selector fixture).
- MCP smoke: initialize + tools/list -> 29 tools.

## Known limitations / remaining
- `tv_rename_script` is not yet live-verified end-to-end (the destructive submit step). The selector path and menu-fill-confirm logic are unit-tested.
- Layout creation via automation did not find a "New layout" menu item in this account; tv_layout_switch works against existing layouts. The destructive run therefore operated on the current chart with full reversibility (symbol/timeframe restored).
- Save-as name prompt did not appear for this account (TradingView auto-saves as "Untitled script"); the script saved and added to the chart successfully. `tv_rename_script` now provides the clean-naming follow-up.
- Drawings, alerts create/delete, watchlist add, chart-data export are implemented with best-effort selectors and not individually live-verified this pass; they follow the same pattern and are approval-gated.
- Phase 5 installer is PowerShell-based (install/uninstall/health/launcher with auto-reconnect). No MSI/WiX.
- Chrome extension is a minimal MV3 connector (badge + popup + content snapshot); no trading logic.

## Repository
- Pushed to GitHub: https://github.com/firyomaefx/tradingview-chrome-mcp (public, default branch `main`).
- Initial commit `e3045f2` includes the full codebase; local-only artifacts (logs, screenshots, exports, .codex/, backups, tsconfig.tsbuildinfo) are excluded via `.gitignore`.

## Decisions
- Auto-approve destructive was used only for the verification script run; the shipped server requires dashboard approval by default.
- The destructive run operated on the user's current chart (no separate MCP-TEST layout could be created); symbol/timeframe were restored after.
- Selector fragility is now guarded by `tests/unit/selectors.test.ts` (tiny inline HTML fixture + linkedom), not a giant DOM dump.

## Next priorities
- Live-verify `tv_rename_script` end-to-end against a real saved Pine script (requires user approval for the destructive rename).
- Live-verify alerts/watchlist/export individually against a test layout.
- Add a "New layout" creator once TradingView exposes the menu item.
