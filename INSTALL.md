# Install

This project can be installed as a **standalone Windows application** (one-line installer), from source for development, or as a **Vercel-hosted SSE server**. Pick the path that matches your use case.

---

## Option A: one-line standalone installer (recommended for Windows)

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

What it does:

1. Downloads the latest `tradingview-chrome-mcp-windows.zip` release asset.
2. Extracts it to `%LOCALAPPDATA%\tradingview-chrome-mcp`.
3. Runs `npm install --production` in that directory.
4. Creates a Start-menu shortcut named **"TradingView MCP"**.
5. Registers the server with Codex (`codex mcp add`) **if the Codex CLI is installed**.
6. Creates a desktop shortcut on first run.

Requirements:

- Node.js >= 20.10
- Windows 10/11
- Codex CLI (optional, for automatic registration)

No `git clone`, no `npm run build`, no manual Codex configuration required.

> **Note:** If `codex` is not found in PATH, the installer prints a warning and manual registration steps instead of failing.

### Launch the standalone app

After install, either:

- Double-click the **"TradingView MCP"** desktop shortcut.
- Click the **TradingView MCP** Start-menu entry.
- Run: `pwsh "$env:LOCALAPPDATA\tradingview-chrome-mcp\scripts\Launch-TV-MCP.ps1"`

The launcher handles everything: Chrome debug-port detection, server startup, dashboard opening, and shortcut creation.

### Upgrade the standalone app

Re-run the one-liner. It will download the latest release and overwrite the install directory, preserving your local `logs/` and `screenshots/` folders.

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

---

## Option B: install from source

For developers, contributors, or non-Windows platforms.

```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git
cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/register-codex.ps1
```

### Launch from source

```powershell
# Double-click this file in the repo root:
# Launch-TV-MCP.cmd

# Or from PowerShell:
pwsh scripts/Launch-TV-MCP.ps1 -CreateShortcut
```

The first run creates a desktop shortcut so subsequent launches are one-click.

### Manual Codex registration

If you prefer not to run `register-codex.ps1`, add this to `C:\Users\%USERNAME%\.codex\config.toml`:

```toml
[mcp_servers.tradingview-chrome-mcp]
command = "node"
args = ["C:\\Users\\%USERNAME%\\Documents\\Tradingview\\dist\\server\\index.js"]
env = { TV_DASHBOARD_PORT = "3939", TV_LOG_LEVEL = "info", TV_APPROVAL_TIMEOUT_MS = "120000" }
startup_timeout_sec = 30
```

Or via the CLI:

```powershell
codex mcp add tradingview-chrome-mcp node "C:\Users\%USERNAME%\Documents\Tradingview\dist\server\index.js"
```

---

## Option C: Vercel-hosted SSE server

Deploy a serverless, SSE-based MCP endpoint with privacy-first telemetry. This fork does **not** control Chrome; it serves market-data tools via a pluggable backend.

See [HOSTED.md](HOSTED.md) for full deployment instructions and environment variables.

```bash
cd vercel-hosted
npm install
cp .env.local.example .env.local
# edit .env.local with your Supabase/Redis/Vercel values
vercel --prod
```

---

## Launcher configuration

The one-click launcher (`Launch-TV-MCP.cmd` / `scripts/Launch-TV-MCP.ps1`) respects these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `TV_DEFAULT_TRADINGVIEW_URL` | `https://www.tradingview.com/chart/` | Landing URL when no chart tab is found. |
| `TV_ALLOW_CHROME_LAUNCH` | `0` | Allow the launcher to start Chrome if no debug port is detected. |
| `TV_ALLOW_CHROME_KILL` | `0` | Allow the launcher to close conflicting Chrome windows. Requires typed confirmation. |
| `TV_DASHBOARD_PORT` | `3939` | Local dashboard port. |
| `TV_MCP_HTTP_PORT` | `3940` | Optional Streamable HTTP MCP port. Set to `0` to disable. |
| `TV_HTTP_BIND` | `127.0.0.1` | Set to `0.0.0.0` to allow LAN access to the HTTP transport. |
| `TV_APPROVAL_TIMEOUT_MS` | `120000` | Dashboard approval timeout in milliseconds. |
| `TV_LOG_LEVEL` | `info` | Runtime log level. |
| `TV_AUTO_APPROVE_DESTRUCTIVE` | `0` | Set to `1` to auto-approve destructive tools. **Not recommended.** |

Example custom landing symbol:

```powershell
$env:TV_DEFAULT_TRADINGVIEW_URL = "https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD"
pwsh "$env:LOCALAPPDATA\tradingview-chrome-mcp\scripts\Launch-TV-MCP.ps1"
```

---

## Optional Streamable HTTP transport

Set `TV_MCP_HTTP_PORT=3940` (or `TV_ENABLE_HTTP_MCP=1`) to expose the MCP server over Streamable HTTP on `127.0.0.1:3940` alongside STDIO. Useful for HTTP clients or local web dashboards.

```powershell
$env:TV_MCP_HTTP_PORT = "3940"
pwsh scripts/Launch-TV-MCP.ps1
```

---

## Optional Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked -> select the `extension/` folder.
4. The toolbar icon shows server status and the active TradingView tab.

---

## Health check

After launch, verify everything is connected:

```powershell
# Standalone install:
& "$env:LOCALAPPDATA\tradingview-chrome-mcp\scripts\health.cmd"

# From source:
node dist/dashboard/health.js
```

Expected output includes `connected: true`, tab count, and emergency-stop state.

---

## Troubleshooting

- **`codex` is not recognized**: the Codex CLI is not installed or not in PATH. Install it with `npm install -g @anthropic-ai/codex-cli`, or register the server manually:
  ```powershell
  codex mcp add tradingview-chrome-mcp --env TV_DASHBOARD_PORT=3939 --env TV_LOG_LEVEL=info --env TV_APPROVAL_TIMEOUT_MS=120000 -- node "$env:LOCALAPPDATA\tradingview-chrome-mcp\dist\server\index.js"
  ```
- **"No TradingView tab available"**: open `https://www.tradingview.com/chart/` in Chrome and re-run the launcher.
- **"EADDRINUSE"**: another process is using port `3939` or `3940`. Change `TV_DASHBOARD_PORT` or `TV_MCP_HTTP_PORT`.
- **Approvals not appearing**: ensure the dashboard opened at `http://127.0.0.1:3939`.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for more.
