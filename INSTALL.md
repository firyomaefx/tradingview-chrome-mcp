# Install

The recommended way to run **TradingView Chrome MCP** on Windows is the portable `.exe`. No Node.js, no installer, no registry changes.

---

## Option A: Portable Windows `.exe` (recommended)

1. Download `tradingview-chrome-mcp.exe` from the [latest release](https://github.com/firyomaefx/tradingview-chrome-mcp/releases/latest).
2. Put it anywhere (desktop, USB drive, project folder).
3. Double-click it, or run from PowerShell:

```powershell
# Default dashboard on http://127.0.0.1:3939
.\tradingview-chrome-mcp.exe

# Use custom ports
$env:TV_DASHBOARD_PORT = "3941"
$env:TV_MCP_HTTP_PORT = "0"   # disable optional HTTP transport; STDIO still works
.\tradingview-chrome-mcp.exe
```

First launch unpacks the embedded Node.js runtime and dependencies to `%LOCALAPPDATA%\tradingview-chrome-mcp`. Subsequent launches reuse the cache and start in seconds. All logs, backups, screenshots, and exports are written there.

### Register with your AI host

#### Claude Desktop

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

```powershell
codex mcp add tradingview-chrome-mcp "C:\Users\%USERNAME%\AppData\Local\tradingview-chrome-mcp\tradingview-chrome-mcp.exe"
```

---

## Option B: one-line PowerShell installer

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

What it does:

1. Downloads the latest release into `%LOCALAPPDATA%\tradingview-chrome-mcp`.
2. Creates Start-menu and desktop shortcuts.
3. Registers the server with Codex if the Codex CLI is installed.
4. On launch, detects or starts Chrome and opens the dashboard.

Requirements: Windows 10/11, Node.js >= 20.10.

---

## Option C: install from source

For developers, contributors, or non-Windows platforms.

```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git
cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

Manual Codex registration:

```powershell
codex mcp add tradingview-chrome-mcp node "C:\Users\%USERNAME%\Documents\Tradingview\dist\server\index.js"
```

---

## Option D: Vercel-hosted SSE server

For a serverless remote market-data MCP, see [`vercel-hosted/`](vercel-hosted/) and [`HOSTED.md`](HOSTED.md).

---

## Optional Chrome extension driver

The `.exe` defaults to Playwright over Chrome DevTools Protocol. To drive an already-running Chrome via the extension:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Run:

```powershell
$env:TV_BROWSER_DRIVER = "extension"
$env:TV_EXTENSION_WS_PORT = "9223"
$env:TV_EXTENSION_TOKEN = "tradingview-chrome-mcp"
.\tradingview-chrome-mcp.exe
```

The extension auto-connects to the `.exe`, injects MAIN-world scripts into the TradingView tab, and exposes all 48 tools.

| Variable | Default | Purpose |
|---|---|---|
| `TV_BROWSER_DRIVER` | `playwright` | Browser driver: `playwright` or `extension`. |
| `TV_EXTENSION_WS_PORT` | `9223` | WebSocket port the `.exe` listens on. |
| `TV_EXTENSION_TOKEN` | `tradingview-chrome-mcp` | Shared secret between `.exe` and extension. |

---

## Launcher configuration

| Variable | Default | Purpose |
|---|---|---|
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | Landing URL when no chart tab is found. |
| `TV_ALLOW_CHROME_LAUNCH` | `0` | Set to `1` to let the launcher start Chrome if none is found. |
| `TV_ALLOW_CHROME_KILL` | `0` | Set to `1` to close conflicting Chrome windows. Requires typed confirmation. |
| `TV_DASHBOARD_PORT` | `3939` | Local dashboard port. |
| `TV_MCP_HTTP_PORT` | `3940` | Optional Streamable HTTP MCP port. Set `0` to disable. |
| `TV_HTTP_BIND` | `127.0.0.1` | Set to `0.0.0.0` to allow LAN access. |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | Dashboard approval timeout in milliseconds. |
| `TV_LOG_LEVEL` | `info` | Runtime log level. |
| `TV_AUTO_APPROVE_DESTRUCTIVE` | `0` | Set to `1` to auto-approve destructive tools. **Not recommended.** |

---

## Health check

```powershell
# Standalone install:
& "$env:LOCALAPPDATA\tradingview-chrome-mcp\scripts\health.cmd"

# From source:
node dist/dashboard/health.js
```

---

## Troubleshooting

- **`codex` is not recognized**: install it with `npm install -g @anthropic-ai/codex-cli`, or register the `.exe` path manually.
- **"No TradingView tab available"**: open `https://www.tradingview.com/chart/` in Chrome and re-run the launcher.
- **"EADDRINUSE"**: another process is using port `3939` or `3940`. Change `TV_DASHBOARD_PORT` or `TV_MCP_HTTP_PORT`.
- **Approvals not appearing**: ensure the dashboard opened at `http://127.0.0.1:3939`.

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) for more.
