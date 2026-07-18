# tradingview-chrome-mcp

A **standalone local MCP server** that lets Codex safely control Chrome for TradingView: read charts, edit Pine Script v6, manage indicators, capture screenshots, read the Strategy Tester, and sync watchlists. No live-trade execution. No remote telemetry.

The server speaks the Model Context Protocol over **STDIO** (default) and optionally **Streamable HTTP** on `http://127.0.0.1:3940`, plus a local control-panel dashboard on `http://127.0.0.1:3939` for status, approvals, history, and the emergency-stop button.

A separate **Vercel-hosted SSE fork** (`vercel-hosted/`) is included for teams that want a serverless market-data MCP endpoint with privacy-first usage telemetry. See [HOSTED.md](HOSTED.md) for that path.

---

## Quick start (standalone Windows app)

The fastest way to run this is as a **standalone Windows application** with a one-click launcher.

### 1. Install (one-line, no build)

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

This downloads the latest release zip, installs to `%LOCALAPPDATA%\tradingview-chrome-mcp`, creates a Start-menu shortcut, and registers the server with Codex **if the Codex CLI is installed**. Requires Node.js but **no npm build step**.

> If you see a warning that `codex` was not found, install the Codex CLI first (`npm install -g @anthropic-ai/codex-cli`) or register the server manually.

### 2. Launch

Double-click the **"TradingView MCP"** desktop shortcut, or open the Start-menu entry. On first launch it will:

1. Detect whether Chrome already has the debug port open.
2. If not, launch Chrome with `--remote-debugging-port=9222` on your real profile.
3. Start the MCP server + dashboard in the background.
4. Open `http://127.0.0.1:3939` in your browser.
5. Create a desktop shortcut so future launches are truly one-click.

Alternatively, run from PowerShell:

```powershell
# If you installed via the one-liner:
pwsh "$env:LOCALAPPDATA\tradingview-chrome-mcp\scripts\Launch-TV-MCP.ps1" -CreateShortcut

# Or from a cloned repo:
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

### 3. Use in Codex

Once launched, ask Codex anything like:

- "Read my TradingView chart"
- "Create a Pine Script v6 EMA crossover indicator and add it to the chart"
- "Change symbol to NASDAQ:AAPL and switch timeframe to 15 minutes"
- "Take a screenshot of the chart"

Destructive actions (symbol change, Pine save, layout switch, etc.) pop up in the dashboard for approval.

---

## Why this design

- **Standalone local MCP server** (STDIO + optional Streamable HTTP) linked to Codex through MCP.
- **Reuses your existing logged-in Chrome session** via the Chrome DevTools Protocol. No separate temp profile unless you opt in.
- **Domain allowlist** (`tradingview.com`, `www.tradingview.com`) and **destructive-action approvals** gate every write.
- **Local-only audit log** of every action with screenshots and tab URLs.
- **Emergency stop** kills all tool execution immediately.
- **No remote telemetry** in the local server by default.

---

## Requirements

- Node.js >= 20.10 (tested on Node 25)
- Google Chrome (or any Chromium with `--remote-debugging-port` support)
- A TradingView account and at least one open chart tab

---

## Installation options

| Method | When to use | Command |
|---|---|---|
| **One-line installer** (recommended) | Windows users who want a standalone app | [see above](#quick-start-standalone-windows-app) |
| **From source** | Developers or non-Windows platforms | [INSTALL.md](INSTALL.md#option-b-install-from-source) |
| **Vercel-hosted market-data fork** | Teams needing a remote SSE MCP endpoint | [HOSTED.md](HOSTED.md) |

Detailed install and launch instructions are in [INSTALL.md](INSTALL.md).

---

## One-click launcher configuration

Set these environment variables before running the launcher to customize behavior.

| Variable | Default | Purpose |
|---|---|---|
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | Where to navigate if no chart tab is open. |
| `TV_ALLOW_CHROME_LAUNCH` | `0` | Set to `1` to let the launcher start Chrome if none is found with a debug port. |
| `TV_ALLOW_CHROME_KILL` | `0` | Set to `1` to let the launcher close conflicting Chrome instances. Prompts for typed confirmation. |
| `TV_DASHBOARD_PORT` | `3939` | Port for the local control dashboard. |
| `TV_MCP_HTTP_PORT` | `3940` | Port for the optional Streamable HTTP transport. Set to `0` to disable. |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | How long destructive actions wait for dashboard approval. |

Example landing directly on XAUUSD:

```powershell
$env:TV_DEFAULT_TRADINGVIEW_URL = "https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD"
pwsh scripts/Launch-TV-MCP.ps1
```

---

## Available tools

The server exposes 30+ tools grouped into:

- **Diagnostics**: `ping`, `mcp_client_info` (detects Claude, Codex, ChatGPT, Cursor, VS Code, etc.)
- **Chart reading**: `tv_status`, `tv_read_chart`, `tv_chart_metadata`, `tv_change_symbol`, `tv_change_timeframe`
- **Pine Script**: `tv_open_pine_editor`, `tv_read_pine_source`, `tv_pine_create`, `tv_pine_patch`, `tv_pine_save`, `tv_pine_add_to_chart`, `tv_pine_compile_errors`, `tv_rename_script`
- **Watchlists**: `tv_watchlist_read`, `tv_watchlist_add_symbol`, `tv_watchlist_sync`
- **Alerts**: `tv_alert_create`, `tv_alert_list`, `tv_alert_delete`
- **Layouts**: `tv_layout_list`, `tv_layout_switch`
- **Utilities**: `tv_screenshot`, `tv_dismiss_dialogs`, `tv_read_strategy_tester`, `tv_chart_data_export`, `browser_status`, `emergency_stop`, `emergency_clear`

See [TOOL_REFERENCE.md](TOOL_REFERENCE.md) for full schema and semantics.

---

## Architecture

For component diagrams, invariants, and the transport roadmap, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Security & privacy

- **No credential storage.** The server never reads, stores, or transmits cookies, tokens, or passwords.
- **Local audit logs.** Every action is written to `logs/audit.jsonl` on your machine; inputs are redacted before logging.
- **Approval-gated writes.** Destructive tools require explicit dashboard approval.
- **Emergency stop.** Instantly disables all tools.
- **The hosted Vercel fork is opt-in and separate.** It only logs parameter allow-list keys (`symbol`, `ticker`, `timeframe`) for cache observability. See [HOSTED.md](HOSTED.md#security--privacy).

---

## Project layout

```
tradingview-chrome-mcp/
├── src/                  # Local MCP server
│   ├── server/           # STDIO + HTTP transports
│   ├── tools/            # Tool registry
│   ├── adapters/         # TradingView DOM automation
│   ├── browser/          # Playwright/CDP controller
│   ├── dashboard/        # Local Express control panel
│   ├── permissions/      # Policy + approval queue
│   ├── telemetry/        # Privacy-first telemetry helpers (disabled locally)
│   ├── auth/             # API-key helpers (used by hosted fork)
│   ├── sessions/         # Redis session store (used by hosted fork)
│   ├── features/         # Runtime feature flags
│   └── config.ts         # Centralized config
├── scripts/              # Launchers, installer, helpers
├── extension/              # Optional Chrome extension
├── vercel-hosted/          # Separate Vercel SSE fork
└── tests/                  # Unit tests
```

---

## License

MIT. See [LICENSE](LICENSE).
