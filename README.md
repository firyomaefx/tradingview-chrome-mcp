# TradingView Chrome MCP — Standalone Windows `.exe`

[![CI](https://github.com/firyomaefx/tradingview-chrome-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/firyomaefx/tradingview-chrome-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Let your AI assistant remote-control your TradingView tab in Chrome — with a single portable Windows executable.**

This is a local MCP server that sits between Claude, Codex CLI, ChatGPT Desktop, Cursor, or any MCP host and your existing TradingView tab. It reads charts, writes Pine Script v6, fixes compile errors automatically, manages watchlists, sets alerts, and takes screenshots — all from plain English commands. No API keys, no TradingView credentials, and the AI never trades on your behalf.

- 🖥️ **Windows-first portable `.exe`** — single file, no Node.js installer, no registry changes.
- 🔌 **Two browser drivers** — Playwright/CDP (default) or a loaded Chrome extension.
- 🧠 **Autonomous Pine Script repair loop** — write → compile → detect error → LLM patch → add-to-chart → verify.
- 🔒 **Approval-gated writes** — symbol changes, saves, and layout switches wait for your dashboard OK.
- 🌐 **Self-contained local dashboard** — control, audit log, screenshots, and emergency stop at `http://127.0.0.1:3939`.

---

## Download the standalone Windows app

Go to the [latest release](https://github.com/firyomaefx/tradingview-chrome-mcp/releases/latest) and download **`tradingview-chrome-mcp.exe`**.

Put it anywhere — desktop, USB drive, or project folder — and double-click it.

First launch unpacks the embedded Node.js runtime and dependencies to:

```text
%LOCALAPPDATA%\tradingview-chrome-mcp
```

Subsequent launches reuse that cache and start in seconds. All logs, backups, screenshots, and exports are written there, so the `.exe` itself is 100% portable.

---

## Quick start (Windows)

### 1. Run the `.exe`

```powershell
# Default dashboard opens at http://127.0.0.1:3939
.\tradingview-chrome-mcp.exe
```

The launcher will:

1. Detect or start Chrome.
2. Open the local dashboard.
3. Start the MCP server over STDIO (and an optional HTTP transport if enabled).

### 2. Register with your AI host

#### Claude Desktop / Claude Code

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tradingview-chrome-mcp": {
      "command": "C:\\Users\\%USERNAME%\\AppData\\Local\\tradingview-chrome-mcp\\tradingview-chrome-mcp.exe",
      "env": {
        "TV_DASHBOARD_PORT": "3939",
        "TV_LOG_LEVEL": "info",
        "TV_APPROVAL_TIMEOUT_MS": "120000"
      }
    }
  }
}
```

#### Codex CLI

If you used the PowerShell installer, Codex is registered automatically. Otherwise:

```powershell
codex mcp add tradingview-chrome-mcp "C:\Users\%USERNAME%\AppData\Local\tradingview-chrome-mcp\tradingview-chrome-mcp.exe"
```

#### ChatGPT Desktop / Cursor / Windsurf

Point the host at the `.exe` as an STDIO MCP server with the same environment variables.

### 3. Ask the AI to trade for you (in words, not money)

```text
Read my TradingView chart and tell me the current symbol and timeframe.
```

```text
Create a Pine Script v6 EMA crossover indicator called "EMA Cross" and add it to the chart.
```

```text
Fix all Pine Script compile errors and keep trying until the indicator loads.
```

---

## Installation options

| Method | Best for | Build step | One-click launcher |
|---|---|---|---|
| **Portable `.exe`** *(recommended)* | Windows users who want a single file | No | Double-click |
| **PowerShell installer** | Windows users who want Start-menu shortcuts | No | `irm ... \| iex` |
| **Build from source** | Developers or macOS/Linux | `npm install && npm run build` | `Launch-TV-MCP.ps1` |
| **Vercel-hosted SSE fork** | Teams needing a remote market-data MCP | Next.js build | No |

Full install details: [`INSTALL.md`](INSTALL.md) · Tool reference: [`TOOL_REFERENCE.md`](TOOL_REFERENCE.md)

---

## Chrome extension driver (optional)

The `.exe` defaults to Playwright over Chrome DevTools Protocol. If you prefer to drive an already-running Chrome instance without `--remote-debugging-port`, use the Chrome extension driver:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder from this repo.
3. Run the `.exe` with:

```powershell
$env:TV_BROWSER_DRIVER = "extension"
$env:TV_EXTENSION_WS_PORT = "9223"
$env:TV_EXTENSION_TOKEN = "tradingview-chrome-mcp"
.\tradingview-chrome-mcp.exe
```

The extension connects to the `.exe` over a local WebSocket, injects MAIN-world scripts into the TradingView tab, and exposes all 48 tools. This is the path that enables the autonomous Pine Script repair loop to catch red compile-error toasts the instant they appear.

---

## Features

| Feature | What it means |
|---|---|
| **Portable `.exe`** | One file; nothing written outside `%LOCALAPPDATA%\tradingview-chrome-mcp`. |
| **Chrome profile reuse** | Optional `TV_ALLOW_REAL_PROFILE=1` keeps you logged into TradingView. |
| **Approval gate** | Writes wait for your OK in the local dashboard. |
| **Emergency stop** | One button disables every tool instantly. |
| **Local audit log** | Every action is written to `logs/audit.jsonl`. |
| **No credential extraction** | Cookies, tokens, and passwords are never read. |
| **Pine Script v6** | Create, patch, save, compile, rename, attach, back up, and restore scripts. |
| **Autonomous repair loop** | `tv_pine_autofix` runs read → compile → LLM patch → save → add-to-chart → verify. |
| **Error toast observer** | The Chrome extension catches red compilation errors as soon as they appear. |
| **Alerts & watchlists** | Read, add, sync, and delete symbols and price alerts. |
| **Layouts & indicators** | Save, duplicate, rename, reset, switch layouts; add/remove/hide/show/update indicators. |
| **Screenshots & data export** | Capture the chart or export visible metadata. |

---

## Tool categories

The server exposes **48 tools** grouped by job:

- **Diagnostics** — `ping`, `mcp_client_info`
- **Chart control** — `tv_status`, `tv_read_chart`, `tv_chart_metadata`, `tv_change_symbol`, `tv_change_timeframe`, `tv_ensure_chart`
- **Pine Script** — `tv_open_pine_editor`, `tv_read_pine_source`, `tv_pine_create`, `tv_pine_patch`, `tv_pine_save`, `tv_pine_add_to_chart`, `tv_pine_compile_errors`, `tv_rename_script`, `tv_pine_backup`, `tv_pine_list_backups`, `tv_pine_restore`, `tv_pine_autofix`
- **Watchlists** — `tv_watchlist_read`, `tv_watchlist_add_symbol`, `tv_watchlist_sync`
- **Alerts** — `tv_alert_create`, `tv_alert_list`, `tv_alert_delete`
- **Layouts** — `tv_layout_list`, `tv_layout_switch`, `tv_layout_save`, `tv_layout_duplicate`, `tv_layout_rename`, `tv_layout_reset`, `tv_layout_export`
- **Indicators** — `tv_indicator_add`, `tv_indicator_remove`, `tv_indicator_hide`, `tv_indicator_show`, `tv_indicator_settings`
- **Verification** — `tv_chart_verify`
- **Utilities** — `tv_screenshot`, `tv_dismiss_dialogs`, `tv_read_strategy_tester`, `tv_chart_data_export`, `browser_status`, `browser_list_tabs`
- **Safety** — `emergency_stop`, `emergency_clear`

---

## Configuration

Set environment variables before launching the `.exe`:

| Variable | Default | Purpose |
|---|---|---|
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | Chart URL to open when no tab exists. |
| `TV_ALLOW_CHROME_LAUNCH` | `0` | Set to `1` to let the launcher start Chrome if none is found. |
| `TV_ALLOW_CHROME_KILL` | `0` | Set to `1` to let the launcher close conflicting Chrome instances. |
| `TV_ALLOW_REAL_PROFILE` | `0` | Set to `1` to reuse your real Chrome profile. |
| `TV_DASHBOARD_PORT` | `3939` | Local dashboard port. |
| `TV_DASHBOARD_TOKEN` | random | Bearer token required by dashboard `/api/*`. |
| `TV_MCP_HTTP_PORT` | `3940` | Optional Streamable HTTP transport; set `0` to disable. |
| `TV_BROWSER_DRIVER` | `playwright` | `playwright` or `extension`. |
| `TV_EXTENSION_WS_PORT` | `9223` | WebSocket port for extension mode. |
| `TV_EXTENSION_TOKEN` | `tradingview-chrome-mcp` | Shared secret between `.exe` and extension. |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | How long writes wait for your approval. |
| `TV_DATA_DIR` | `%LOCALAPPDATA%\tradingview-chrome-mcp` | Logs, backups, screenshots, exports. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | Enables autonomous `tv_pine_autofix` patching. |
| `TV_AUTOFIX_MODEL` | `gpt-4o` / `claude-3-5-sonnet-20241022` | LLM used by the repair loop. |

Example: open directly on XAUUSD

```powershell
$env:TV_DEFAULT_TRADINGVIEW_URL = "https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD"
.\tradingview-chrome-mcp.exe
```

---

## How the autonomous Pine Script loop works

```
AI writes Pine Script
        │
        ▼
┌───────────────────────┐
│  MCP .exe (Windows)   │
│  STDIO / HTTP bridge  │
└───────────┬───────────┘
            │ JSON-RPC over WebSocket (extension driver)
            ▼
┌───────────────────────┐
│ Chrome extension       │
│ service worker         │
└───────────┬───────────┘
            │ chrome.scripting.executeScript({ world: "MAIN" })
            ▼
┌───────────────────────┐
│ TradingView tab        │
│ Monaco editor          │
└───────────┬───────────┘
            │ compile error toast appears
            ▼
┌───────────────────────┐
│ error_observer.js      │
│ MutationObserver       │
└───────────┬───────────┘
            │ PINE_SCRIPT_ERROR_DETECTED
            ▼
┌───────────────────────┐
│ MCP .exe receives error│
└───────────┬───────────┘
            │ error text passed to AI
            ▼
AI patches code and retries
```

---

## Building the `.exe` from source

On a Windows machine with Node.js 22+:

```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git
cd tradingview-chrome-mcp
npm install
npm run build:exe
```

Output: `tradingview-chrome-mcp.exe` (~150 MB). It embeds Node.js, the compiled server, and all runtime dependencies via [`caxa`](https://github.com/leafac/caxa).

---

## Architecture

```
┌─────────────────┐      STDIO / HTTP       ┌──────────────────────┐
│  MCP host       │  ───────────────────────▶  │  tradingview-chrome  │
│  (Claude, Codex,│                           │  -mcp.exe             │
│  ChatGPT, etc.) │                           │                      │
└─────────────────┘                           │  ┌───────────────┐   │
                                              │  │ Tool registry │   │
                                              │  │ Policy +      │   │
                                              │  │ approvals     │   │
                                              │  └───────┬───────┘   │
                                              │          │           │
                                              │  ┌───────▼───────┐   │
                                              │  │ Browser driver│   │
                                              │  │ (Playwright   │   │
                                              │  │  or extension)│   │
                                              │  └───────┬───────┘   │
                                              └──────────┼───────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │  Google Chrome      │
                                              │  TradingView tab    │
                                              └─────────────────────┘
```

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for diagrams, invariants, and transport details.

---

## Security & privacy

- **No credential storage.** Cookies, tokens, and passwords are never read or transmitted.
- **Temporary Chrome profile by default.** Isolated unless you opt into `TV_ALLOW_REAL_PROFILE=1`.
- **Dashboard bearer token.** All dashboard API calls require `Authorization: Bearer <TV_DASHBOARD_TOKEN>`.
- **Local-only audit logs.** Every action is written to `logs/audit.jsonl` with sensitive inputs redacted.
- **Approval-gated writes.** Destructive tools require explicit dashboard approval.
- **Emergency stop.** Instantly disables all tool execution.
- **Domain allowlist.** Browser tools only run on `tradingview.com` / `www.tradingview.com`.
- **No remote telemetry in local mode.** The Vercel-hosted fork is separate and opt-in.

---

## Project layout

```
tradingview-chrome-mcp/
├── src/                    # Local MCP server
│   ├── server/             # STDIO + HTTP transports
│   ├── tools/              # Tool registry (48 tools)
│   ├── adapters/           # TradingView DOM automation
│   ├── browser/            # Playwright + extension drivers
│   ├── dashboard/          # Local Express control panel
│   ├── permissions/        # Policy + approval queue
│   ├── detect/             # MCP host client detection
│   ├── telemetry/          # Privacy-first telemetry helpers
│   └── config.ts           # Centralized config
├── extension/              # Optional Chrome extension (MV3)
├── scripts/                # Launchers, installer, helpers
├── vercel-hosted/          # Separate Vercel SSE fork
├── tests/                  # Unit + integration tests
└── docs/                   # README, INSTALL, HOSTED, etc.
```

---

## Development status

- Version: `0.2.0`
- Default branch: `main`
- Local tests: 41 passing
- CI: `.github/workflows/ci.yml` runs Windows and Ubuntu jobs on every push.

---

## License

MIT. See [`LICENSE`](LICENSE).
