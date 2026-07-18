# Install (Windows)

## Quick
```powershell
git clone <repo>; cd tradingview-chrome-mcp
npm install
npm run build
pwsh scripts/register-codex.ps1
pwsh scripts/start-chrome.ps1   # start Chrome with remote debugging, then log in to TradingView
pwsh scripts/run.ps1            # run the server + dashboard; open http://127.0.0.1:3939
```

## Packaged install (Phase 5)
```powershell
pwsh scripts/install.ps1          # builds, copies to %LOCALAPPDATA%, Start-menu shortcut, health check, registers Codex, auto-reconnect launcher
pwsh scripts/uninstall.ps1         # removes shortcut, install dir, Codex registration (source untouched)
```

The install launcher (`run.cmd`) auto-restarts the server 3s after a crash, so a transient Chrome disconnect self-heals.

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
