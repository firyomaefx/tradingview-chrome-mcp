# Troubleshooting

## "Could not connect to Chrome"
- Make sure no other Chrome instance is using your profile, then start Chrome with `--remote-debugging-port=9222 --user-data-dir=<your profile>`.
- Verify: open `http://127.0.0.1:9222/json` in a browser; you should see a JSON list of tabs. If not, the debug port is not active.
- If Chrome is already running without the flag, restart it fully (check Task Manager for lingering `chrome.exe`).
- Set `TV_ALLOW_CHROME_LAUNCH=1` and `TV_CHROME_PATH` to let the server launch it for you (close Chrome first).

## "No open TradingView tab found"
- Open `https://www.tradingview.com/chart/` in the same Chrome profile.
- `browser_list_tabs` to confirm the tab is visible to the server.

## `tv_read_pine_source` returns `source: null`
- The Pine Editor is closed or the Monaco model is not ready. Call `tv_open_pine_editor`, then retry.
- If still null, TradingView may have changed the editor container; check `tv_screenshot` and update selectors in `src/adapters/tradingview/adapter.ts`.

## Timeframe reads as null
- The timeframe button selector did not match. The URL `interval=` query is not currently used as a fallback; you can add it in `readChartState`. Symbol is parsed from URL as a fallback.

## Destructive tool returns BLOCKED
- An approval is pending on the dashboard at `http://127.0.0.1:3939`. Approve or deny it there.
- If you need to run unattended in dev, set `TV_AUTO_APPROVE_DESTRUCTIVE=1` (paper trading only).

## "DENIED: Emergency stop is active"
- Call `emergency_clear` (approved on the dashboard) or click "Clear" in the dashboard.

## Dashboard does not load
- Make sure port 3939 is free or set `TV_DASHBOARD_PORT`.
- The dashboard binds to `127.0.0.1`; it is not reachable from another machine by design.

## Playwright install
If you see errors about missing browser binaries, note we only use `connectOverCDP`, not Playwright's bundled browsers. You do not need `npx playwright install` for the default flow. You only need it if you enable `TV_ALLOW_TEMP_PROFILE=1`.

## Logs
- Runtime: stdout (pretty) or `logs/*.log`.
- Audit: `logs/audit.jsonl` (one JSON object per line).
- Screenshots: `screenshots/*.png`.
