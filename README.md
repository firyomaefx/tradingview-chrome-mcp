# TradingView Chrome MCP

[![CI](https://github.com/firyomaefx/tradingview-chrome-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/firyomaefx/tradingview-chrome-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=20.10](https://img.shields.io/badge/node-%3E%3D20.10-339933?logo=nodedotjs)](package.json)

**Let your AI assistant drive Chrome for TradingView.**

A standalone, local MCP server that connects Claude, Codex CLI, ChatGPT Desktop, Cursor, Windsurf, or any MCP host to your existing TradingView tab in Chrome. Read charts, edit Pine Script v6, run backtests, manage watchlists, set alerts, take screenshots — all without giving anyone your login or letting the AI trade on your behalf.

- 🖥️ **Local-first**: runs on your machine, reuses your logged-in Chrome profile.
- 🔒 **Approval-gated**: destructive actions wait for your OK in the dashboard.
- 🌐 **Self-contained**: STDIO for MCP hosts, optional HTTP transport, built-in control dashboard.
- ☁️ **Optional cloud fork**: a separate Vercel-hosted SSE edition is included for team market-data use.

---

## 🆕 Latest update — just pushed to GitHub

The most recent `main` push closes the remaining gaps against full autonomous Pine Script development and adds a fully portable Windows build:

- **Portable Windows `.exe`** — a single self-contained executable built with `caxa`. No Node.js install, no registry, no system files. Logs and backups are redirected to `%LOCALAPPDATA%\tradingview-chrome-mcp`.
- **Full layout management** — save, duplicate, rename, reset, list, switch, and export chart layouts locally.
- **Indicator management** — add, remove, hide, show, and update indicator/strategy settings from the chart legend.
- **Autonomous Pine repair loop** — `tv_pine_autofix` runs read → compile → LLM patch → save → add-to-chart → verify automatically when `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set.
- **Runtime chart verification** — `tv_chart_verify` checks that the expected indicator, labels, tables, and plots appear after add-to-chart.
- **Automatic Pine Script backups** — every `tv_pine_create`/`tv_pine_patch` snapshots the previous source to `./backups`; restore with `tv_pine_restore`.
- **Tool count is now 48** — diagnostics, chart reading, Pine Script editing, alerts, watchlists, layouts, indicators, screenshots, strategy tester, verification, backups, and safety tools.
- **CI is green on every push.** 41 local unit tests + browser integration smoke test + hosted registry tests pass on both Windows (`ci`) and Ubuntu (`hosted-app`).
- **Docs refreshed.** README, TOOL_REFERENCE, and CONTEXT are updated with the current state.

[See the commit →](https://github.com/firyomaefx/tradingview-chrome-mcp/commit/3bead48)

---

## What you can ask the AI

Because the server controls Chrome through the Chrome DevTools Protocol, plain English commands map directly to TradingView actions:

- *“Read my chart”* → returns the current symbol, timeframe, visible indicators, and strategy state.
- *“Create a Pine Script v6 EMA crossover indicator and add it to the chart”* → opens the editor, writes the script, compiles, saves, and attaches it.
- *“Change symbol to NASDAQ:AAPL and switch to the 15-minute timeframe”* → changes the chart after dashboard approval.
- *“Show me the Strategy Tester results”* → reads backtest performance from the open panel.
- *“Fix all Pine Script compile errors and keep trying until the indicator loads”* → `tv_pine_autofix` compiles, patches via LLM, saves, adds to chart, and verifies.
- *“Add BTCUSD to my watchlist and set an alert when it crosses $70,000”* → syncs the watchlist and creates the alert.
- *“Take a screenshot of the chart”* → captures the current tab.

No API keys, no TradingView credentials, and no live trades.

---

## Quick start — 2 minutes

### Option A: Portable Windows `.exe` (recommended)

No Node.js, no installer, no registry/system changes.

1. Download `tradingview-chrome-mcp.exe` from the [latest release](https://github.com/firyomaefx/tradingview-chrome-mcp/releases/latest).
2. Put it anywhere (desktop, USB drive, project folder).
3. Double-click it, or run from PowerShell / terminal:

```powershell
# Default dashboard on http://127.0.0.1:3939
.\tradingview-chrome-mcp.exe

# Use custom ports
$env:TV_DASHBOARD_PORT = "3941"
$env:TV_MCP_HTTP_PORT = "0"   # disable optional HTTP transport; STDIO still works
.\tradingview-chrome-mcp.exe
```

First launch unpacks the embedded Node.js runtime and dependencies to `%LOCALAPPDATA%\tradingview-chrome-mcp`; subsequent launches reuse the cache and start in seconds. All logs, backups, screenshots, and exports are written there so nothing is lost when you move or delete the `.exe`.

### Option B: One-line PowerShell installer

Copy this into PowerShell and press Enter:

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

Then double-click the **TradingView MCP** shortcut on your desktop.

What happens:
1. Downloads the latest release into `%LOCALAPPDATA%\tradingview-chrome-mcp`.
2. Creates Start-menu + desktop shortcuts.
3. Registers with the Codex CLI if it is installed; otherwise tells you how to do it manually.
4. On launch, detects or starts Chrome with `--remote-debugging-port=9222`.
5. Opens the control dashboard at `http://127.0.0.1:3939`.

### Option C: From source (any OS)

```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git
cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

### Option D: Vercel-hosted market-data fork

For a serverless SSE MCP endpoint with privacy-first telemetry, see [`vercel-hosted/`](vercel-hosted/) and [`HOSTED.md`](HOSTED.md).

---

## Installation options at a glance

| Method | Best for | Build step | One-click launcher |
|---|---|---|---|
| **Portable `.exe`** | Windows users who want a single file | No | Yes — double-click |
| **One-line PowerShell installer** | Windows users who want Start-menu shortcuts | No | Yes |
| **Clone + build from source** | Developers or macOS/Linux | Yes | Yes (`Launch-TV-MCP.ps1`) |
| **Vercel-hosted SSE fork** | Teams needing a remote market-data MCP | Yes (Next.js) | No |

Full details: [`INSTALL.md`](INSTALL.md) · Tool schemas: [`TOOL_REFERENCE.md`](TOOL_REFERENCE.md) · Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) · Cloud edition: [`HOSTED.md`](HOSTED.md)

---

## Feature highlights

| Feature | What it means |
|---|---|
| **Chrome reuse** | Connects to your real Chrome profile; you stay logged into TradingView. |
| **Approval gate** | Symbol changes, Pine saves, layout switches, and other writes wait for dashboard approval. |
| **Emergency stop** | One button in the dashboard disables every tool instantly. |
| **Local audit log** | Every action is written to `logs/audit.jsonl` on your machine. |
| **No credential extraction** | The server never reads cookies, tokens, passwords, or wallet keys. |
| **No remote telemetry (local)** | The local server does not phone home. The hosted fork is opt-in and separate. |
| **MCP host detection** | Knows whether Claude, Codex, ChatGPT, Cursor, etc. launched it. |
| **Temporary Chrome profile by default** | Isolates the MCP session from your real Chrome profile. Set `TV_ALLOW_REAL_PROFILE=1` to opt into profile reuse. |
| **Pine Script v6 ready** | Create, patch, save, compile, rename, and attach scripts. |
| **Alerts & watchlists** | Read, add, sync, and delete symbols and price alerts. |
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

See [`TOOL_REFERENCE.md`](TOOL_REFERENCE.md) for every input schema and return value.

---

## Configuration

Set environment variables before launching to customize behavior:

| Variable | Default | Purpose |
|---|---|---|
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | Chart URL to open when no tab exists. |
| `TV_ALLOW_CHROME_LAUNCH` | `0` | Set to `1` to let the launcher start Chrome if none is found. |
| `TV_ALLOW_CHROME_KILL` | `0` | Set to `1` to let the launcher close conflicting Chrome instances. |
| `TV_ALLOW_REAL_PROFILE` | `0` | Set to `1` to reuse your real Chrome profile (cookies, extensions, logins). Default is an isolated temp profile. |
| `TV_CHROME_USER_DATA` | `%LOCALAPPDATA%\Google\Chrome\User Data` | Real profile path used when `TV_ALLOW_REAL_PROFILE=1`. |
| `TV_DASHBOARD_PORT` | `3939` | Port for the local control dashboard. |
| `TV_DASHBOARD_TOKEN` | random generated | Bearer token required by the dashboard API. Set to reuse across launches. |
| `TV_MCP_HTTP_PORT` | `3940` | Port for the optional Streamable HTTP transport; set `0` to disable. |
| `TV_DATA_DIR` | project root (`.exe` uses `%LOCALAPPDATA%\tradingview-chrome-mcp`) | Directory for logs, backups, screenshots, exports, and browser cache. |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | How long destructive actions wait for your approval. |
| `OPENAI_API_KEY` | — | Enables `tv_pine_autofix` automatic patching via OpenAI. |
| `ANTHROPIC_API_KEY` | — | Enables `tv_pine_autofix` automatic patching via Anthropic. |
| `TV_AUTOFIX_MODEL` | `gpt-4o` / `claude-3-5-sonnet-20241022` | Model used by the autonomous repair loop. |

Example: open directly on XAUUSD

```powershell
$env:TV_DEFAULT_TRADINGVIEW_URL = "https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD"
pwsh scripts/Launch-TV-MCP.ps1
```

---

## Building the portable `.exe`

From a Windows machine with Node.js 22+ and npm:

```powershell
npm install
npm run build:exe
```

This produces `tradingview-chrome-mcp.exe` (~150 MB). It embeds Node.js, the compiled server, and all runtime dependencies using [`caxa`](https://github.com/leafac/caxa), so the binary runs on any Windows PC without a separate Node.js install.

The build excludes tests, source TypeScript, Vercel-hosted code, scripts, documentation, and cached files to keep the archive as small as possible. First launch extracts the payload to `%LOCALAPPDATA%\tradingview-chrome-mcp`; later launches are nearly instant because they reuse the cached extraction.

---

## Architecture in one picture

```
┌─────────────────┐      STDIO / HTTP       ┌──────────────────────┐
│  MCP host       │  ───────────────────────▶  │  tradingview-chrome  │
│  (Claude, Codex,│                           │  -mcp server         │
│  ChatGPT, etc.) │                           │                      │
└─────────────────┘                           │  ┌───────────────┐   │
                                              │  │ Tool registry │   │
                                              │  │ Policy /      │   │
┌─────────────────┐      CDP                  │  │ Approval queue│   │
│  Google Chrome  │  ───────────────────────▶  │  └───────┬───────┘   │
│ (isolated temp  │                           │          │          │
│ profile by df.) │                           │  ┌───────▼───────┐   │
└─────────────────┘                           │  │ Playwright    │   │
                                              │  │ Playwright    │   │
                                              │  │ DOM automation│   │
                                              │  └───────────────┘   │
                                              └──────────────────────┘
                                                         │
                                              ┌──────────▼──────────┐
                                              │ Local dashboard     │
                                              │ http://127.0.0.1:3939
                                              └─────────────────────┘
```

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for component diagrams, invariants, and transport details.

---

## Security & privacy

- **No credential storage.** The server never reads, stores, or transmits cookies, tokens, or passwords.
- **Temporary Chrome profile by default.** Each launch gets an isolated profile unless you set `TV_ALLOW_REAL_PROFILE=1`.
- **Dashboard bearer token.** All dashboard `/api/*` endpoints require `Authorization: Bearer <TV_DASHBOARD_TOKEN>`.
- **Local-only audit logs.** Every action is written to `logs/audit.jsonl`; sensitive inputs are redacted.
- **Approval-gated writes.** Destructive tools require explicit dashboard approval.
- **Emergency stop.** Instantly disables all tool execution.
- **Domain allowlist.** Browser tools only run on `tradingview.com` / `www.tradingview.com`.
- **No remote telemetry in local mode.** The Vercel-hosted fork is separate and opt-in; it only logs parameter allow-list keys (`symbol`, `ticker`, `timeframe`) for cache observability. See [`HOSTED.md`](HOSTED.md#security--privacy).

---

## Project layout

```
tradingview-chrome-mcp/
├── src/                    # Local MCP server
│   ├── server/             # STDIO + HTTP transports
│   ├── tools/              # Tool registry (48 tools)
│   ├── adapters/           # TradingView DOM automation
│   ├── browser/            # Playwright/CDP controller
│   ├── dashboard/          # Local Express control panel
│   ├── permissions/        # Policy + approval queue
│   ├── detect/             # MCP host client detection
│   ├── telemetry/          # Privacy-first telemetry helpers
│   ├── auth/               # API-key helpers (hosted fork)
│   ├── sessions/           # Redis session store (hosted fork)
│   ├── features/           # Runtime feature flags
│   └── config.ts           # Centralized config
├── scripts/                # Launchers, installer, helpers
├── extension/              # Optional Chrome extension
├── vercel-hosted/          # Separate Vercel SSE fork
├── tests/                  # Unit + integration tests
└── docs/                   # README, INSTALL, HOSTED, etc.
```

---

## Development status

- Version: `0.2.0`
- Default branch: `main`
- Local tests: 41 passing
- Hosted tests: 4 passing
- CI: `.github/workflows/ci.yml` runs both Windows and Ubuntu jobs on every push.

---

## License

MIT. See [`LICENSE`](LICENSE).
