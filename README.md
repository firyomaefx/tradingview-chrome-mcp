# tradingview-chrome-mcp

A standalone local MCP server that lets Codex safely control Chrome for TradingView activities: read charts, edit Pine Script v6, manage indicators, capture screenshots, and read the Strategy Tester. No live-trade execution.

The server speaks the Model Context Protocol over STDIO and also runs a local control-panel dashboard on `http://127.0.0.1:3939` for status, approvals, history, and the emergency-stop button.

## Why this design

- **Standalone local MCP server** (STDIO now, Streamable HTTP later) linked to Codex through MCP.
- **Reuses your existing logged-in Chrome session** via the Chrome DevTools Protocol. No separate temp profile unless you opt in.
- **Domain allowlist** (`tradingview.com`, `www.tradingview.com`) and **destructive-action approvals** gate every write.
- **Audit log** of every action with screenshots and tab URLs.
- **Emergency stop** kills all tool execution immediately.

## Requirements

- Node.js >= 20.10 (tested on Node 25)
- Google Chrome (or any Chromium with `--remote-debugging-port` support)
- A TradingView account and at least one open chart tab

## Quick start

1. Close all Chrome windows, then start Chrome with remote debugging on your real profile:

   ```powershell
   & "$env:LocalAppData\Google\Chrome\Application\chrome.exe" `
     --remote-debugging-port=9222 `
     --user-data-dir="$env:LocalAppData\Google\Chrome\User Data" `
     --remote-allow-origins=* --no-first-run --no-default-browser-check
   ```

   Log in to TradingView and open a chart. (You can also let the server launch Chrome for you by setting `TV_ALLOW_CHROME_LAUNCH=1` and `TV_CHROME_PATH`; make sure Chrome is closed first, otherwise the existing process ignores the debug flag.)

2. Install and build:

   ```powershell
   npm install
   npm run build
   ```

3. Register with Codex (see [Install guide](#install-guide-for-codex) below).

4. Verify the dashboard: open `http://127.0.0.1:3939` while the server is running.

## Install guide for Codex

Add the server to your Codex MCP config. In `C:\Users\Pedot\.codex\config.toml`:

```toml
[mcp_servers.tradingview-chrome-mcp]
command = "node"
args = ["C:\\Users\\Pedot\\Documents\\Tradingview\\dist\\server\\index.js"]
env = { TV_DASHBOARD_PORT = "3939", TV_LOG_LEVEL = "info", TV_APPROVAL_TIMEOUT_MS = "120000" }
startup_timeout_sec = 30
```

Or via the CLI:

```powershell
codex mcp add tradingview-chrome-mcp node "C:\Users\Pedot\Documents\Tradingview\dist\server\index.js"
codex mcp list
```

The configuration works with the Codex App, Codex CLI, and the Codex IDE extension because all three read the same `mcp_servers` table.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TV_CDP_URL` | `http://127.0.0.1:9222` | Chrome DevTools Protocol endpoint to attach to. |
| `TV_CHROME_PATH` | auto-detected | Path to `chrome.exe` for auto-launch. |
| `TV_CHROME_USER_DATA` | `%LocalAppData%\Google\Chrome\User Data` | Chrome profile dir for auto-launch. |
| `TV_ALLOW_CHROME_LAUNCH` | unset | If `1`, the server may launch your Chrome with the debug port. |
| `TV_ALLOW_TEMP_PROFILE` | unset | If `1`, allow a throwaway temp profile (not recommended). |
| `TV_DASHBOARD_PORT` | `3939` | Local dashboard HTTP port. |
| `TV_LOG_LEVEL` | `info` | `trace\|debug\|info\|warn\|error` |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | How long an approval waits before auto-denying. |
| `TV_AUTO_APPROVE_DESTRUCTIVE` | unset | If `1`, skip dashboard approval (development only). |

## Safety model

See [SECURITY.md](SECURITY.md). The short version: read tools never touch TradingView state; destructive tools (`tv_pine_save`, `tv_pine_add_to_chart`, `tv_change_symbol`, `tv_change_timeframe`) require a dashboard approval, are audit-logged, and are blocked if the emergency stop is armed.

## Tools

See [TOOL_REFERENCE.md](TOOL_REFERENCE.md) for the full list and parameter schemas. Quick summary: `ping`, `emergency_stop`, `emergency_clear`, `browser_status`, `browser_list_tabs`, `tv_status`, `tv_read_chart`, `tv_screenshot`, `tv_open_pine_editor`, `tv_read_pine_source`, `tv_pine_create`, `tv_pine_patch`, `tv_pine_compile_errors`, `tv_pine_save`, `tv_pine_add_to_chart`, `tv_change_symbol`, `tv_change_timeframe`, `tv_read_strategy_tester`.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Type-check and compile to `dist/`. |
| `npm start` | Run the compiled server (STDIO + dashboard). |
| `npm run dev` | Run with `tsx watch` for development. |
| `npm run dashboard` | Run only the dashboard entrypoint. |
| `npm test` | Unit tests (policy + schemas). |
| `npm run typecheck` | Type-check only. |

## Troubleshooting

See [TEST_PLAN.md](TEST_PLAN.md) for the failure matrix and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Status

MVP. Read path (status, chart, Pine source, screenshot, strategy tester) is verified end-to-end against a live TradingView session. Editing tools (`tv_pine_create`, `tv_pine_patch`, `tv_pine_save`, `tv_pine_add_to_chart`) rely on TradingView selectors that change over time; they use multiple fallbacks and Monaco API access. Layouts, drawings, alerts, watchlists, and chart-data export are Phase 4 and not yet implemented.
