# tradingview-chrome-mcp

A standalone local MCP server that lets Codex safely control Chrome for TradingView activities: read charts, edit Pine Script v6, manage indicators, capture screenshots, read the Strategy Tester, and sync watchlists. No live-trade execution.

The server speaks the Model Context Protocol over **STDIO** (default) and optionally **Streamable HTTP** on `http://127.0.0.1:3940`, and also runs a local control-panel dashboard on `http://127.0.0.1:3939` for status, approvals, history, and the emergency-stop button.

## Why this design

- **Standalone local MCP server** (STDIO + optional Streamable HTTP) linked to Codex through MCP.
- **Reuses your existing logged-in Chrome session** via the Chrome DevTools Protocol. No separate temp profile unless you opt in.
- **Domain allowlist** (`tradingview.com`, `www.tradingview.com`) and **destructive-action approvals** gate every write.
- **Audit log** of every action with screenshots and tab URLs.
- **Emergency stop** kills all tool execution immediately.

## Requirements

- Node.js >= 20.10 (tested on Node 25)
- Google Chrome (or any Chromium with `--remote-debugging-port` support)
- A TradingView account and at least one open chart tab

## One-click launch (Windows)

After installing from source or via the release installer, double-click **`Launch-TV-MCP.cmd`** in the project root. It will:

1. Detect whether Chrome already has the debug port open.
2. If not, launch Chrome with `--remote-debugging-port=9222` on your real profile.
3. Start the MCP server + dashboard in the background.
4. Open the dashboard in your browser.
5. Create a desktop shortcut on first run for future true single-click launches.

```powershell
# Or run from PowerShell directly:
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

Set `TV_ALLOW_CHROME_KILL=1` before running to let the launcher gracefully close any existing Chrome instances that do not have the debug port open. Without it, the launcher exits with instructions so it never destroys user work silently.

Configure the landing URL:

```powershell
$env:TV_DEFAULT_TRADINGVIEW_URL = "https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD"
pwsh scripts/Launch-TV-MCP.ps1
```

## Install guide for Codex

### Option A: one-line PowerShell installer (no source build)

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

This downloads the latest release, installs to `%LOCALAPPDATA%\tradingview-chrome-mcp`, creates a Start-menu shortcut, and registers the server with Codex. Requires Node.js but **no npm build step**.

### Option B: install from source

```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git; cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/register-codex.ps1
```

### Manual Codex config

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
| `TV_MCP_HTTP_PORT` | unset | If set, enable Streamable HTTP MCP transport on this port (default 3940). |
| `TV_ENABLE_HTTP_MCP` | unset | If `1`, enable Streamable HTTP MCP transport (uses TV_MCP_HTTP_PORT). |
| `TV_MCP_HTTP_BIND` | `127.0.0.1` | Bind address for Streamable HTTP transport. Set to `0.0.0.0` to allow LAN connections (firewall responsibility). |
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | URL to open when auto-launching Chrome. |
| `TV_ALLOW_CHROME_KILL` | unset | If `1`, the launcher may close existing Chrome instances to enable the debug port. |

## Safety model

See [SECURITY.md](SECURITY.md). The short version: read tools never touch TradingView state; destructive tools (`tv_pine_save`, `tv_pine_add_to_chart`, `tv_change_symbol`, `tv_change_timeframe`, `tv_rename_script`, `tv_watchlist_sync`) require a dashboard approval, are audit-logged, and are blocked if the emergency stop is armed. The launcher reuses your existing Chrome profile; it does not store, extract, or inject cookies, passwords, or tokens. HTTP transport is localhost-only by default and never logs requests to remote servers.

## Tools

See [TOOL_REFERENCE.md](TOOL_REFERENCE.md) for the full list and parameter schemas. Quick summary: `ping`, `emergency_stop`, `emergency_clear`, `browser_status`, `browser_list_tabs`, `tv_status`, `tv_read_chart`, `tv_screenshot`, `tv_open_pine_editor`, `tv_read_pine_source`, `tv_pine_create`, `tv_pine_patch`, `tv_pine_compile_errors`, `tv_pine_save`, `tv_pine_add_to_chart`, `tv_rename_script`, `tv_change_symbol`, `tv_change_timeframe`, `tv_read_strategy_tester`, `tv_chart_metadata`, `tv_watchlist_read`, `tv_watchlist_add_symbol`, `tv_watchlist_sync`, `tv_dismiss_dialogs`, `tv_layout_list`, `tv_layout_switch`, `tv_alert_create`, `tv_alert_list`, `tv_alert_delete`, `tv_chart_data_export`, `tv_drawing_add_trendline`.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Type-check and compile to `dist/`. |
| `npm start` | Run the compiled server (STDIO + dashboard). |
| `npm run dev` | Run with `tsx watch` for development. |
| `npm run dashboard` | Run only the dashboard entrypoint. |
| `npm test` | Unit tests (policy + schemas). |
| `npm run typecheck` | Type-check only. |
| `pwsh scripts/package-zip.ps1` | Build a redistributable Windows zip locally. |
| `Launch-TV-MCP.cmd` | Double-click one-click Windows launcher. |

## Troubleshooting

See [TEST_PLAN.md](TEST_PLAN.md) for the failure matrix and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Status

MVP+. Read path (status, chart, Pine source, screenshot, strategy tester, chart metadata, watchlist read) is verified end-to-end against a live TradingView session. Editing tools (`tv_pine_create`, `tv_pine_patch`, `tv_pine_save`, `tv_pine_add_to_chart`, `tv_rename_script`) rely on TradingView selectors that change over time; they use multiple fallbacks and Monaco API access. Layouts, drawings, alerts, watchlist add/sync, and chart-data export are Phase 4 and implemented with best-effort selectors.
