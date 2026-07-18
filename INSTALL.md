# Install (Windows)

## One-line standalone installer (no source build)

```powershell
irm https://raw.githubusercontent.com/firyomaefx/tradingview-chrome-mcp/main/scripts/install-cli.ps1 | iex
```

This downloads the latest `tradingview-chrome-mcp-windows.zip` release asset, installs to `%LOCALAPPDATA%\tradingview-chrome-mcp`, creates a Start-menu shortcut, and registers with Codex. Requires Node.js but no `npm install`/`npm run build`.

> The one-liner only works after a release exists. Releases are created automatically by the [GitHub Actions `release.yml`](.github/workflows/release.yml) workflow when a `v*.*.*` tag is pushed.

After install, double-click **`Launch-TV-MCP.cmd`** in `%LOCALAPPDATA%\tradingview-chrome-mcp` for single-click launch.

## Quick (from source)
```powershell
git clone https://github.com/firyomaefx/tradingview-chrome-mcp.git; cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/register-codex.ps1
pwsh scripts/start-chrome.ps1   # start Chrome with remote debugging, then log in to TradingView
pwsh scripts/run.ps1            # run the server + dashboard; open http://127.0.0.1:3939
```

## Packaged install from source (Phase 5)
```powershell
pwsh scripts/install.ps1          # builds, copies to %LOCALAPPDATA%, Start-menu shortcut, health check, registers Codex, auto-reconnect launcher
pwsh scripts/uninstall.ps1         # removes shortcut, install dir, Codex registration (source untouched)
```

The install launcher (`run.cmd`) auto-restarts the server 3s after a crash, so a transient Chrome disconnect self-heals.

## One-click source launcher
If you cloned the repo, double-click **`Launch-TV-MCP.cmd`** in the project root. The first run creates a desktop shortcut; subsequent runs are a single double-click from the desktop.

Set `TV_ALLOW_CHROME_KILL=1` to let the launcher close conflicting Chrome instances, and `TV_DEFAULT_TRADINGVIEW_URL` to land directly on your preferred chart (e.g. `https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD`).

## Streamable HTTP transport (optional)
Set `TV_MCP_HTTP_PORT=3940` (or `TV_ENABLE_HTTP_MCP=1`) to expose the MCP server over Streamable HTTP on `127.0.0.1:3940` alongside STDIO. Useful for HTTP clients or future web dashboards.

## Chrome extension (optional)
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked -> select `extension/`.
4. The toolbar icon shows server status and the active TradingView tab; click it for a popup with symbol/timeframe.

## Health check
```powershell
& "$env:LOCALAPPDATA\tradingview-chrome-mcp\health.cmd"
```
Prints `connected: <bool>`, tab count, emergency-stop state. Exit 0 if the dashboard is up and Chrome is attached.
