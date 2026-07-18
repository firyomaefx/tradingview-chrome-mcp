# install.ps1 - installs tradingview-chrome-mcp as a Windows app with a Start-menu shortcut.
# Runs the server as a background launcher that auto-reconnects to Chrome.
[CmdletBinding()]
param(
  [string]$ProjectDir = "$PSScriptRoot\..",
  [string]$InstallDir = "$env:LOCALAPPDATA\tradingview-chrome-mcp",
  [switch]$RegisterCodex
)
$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path $ProjectDir).Path
Write-Host "Installing tradingview-chrome-mcp from $ProjectDir to $InstallDir"

# 1. Build the project.
Push-Location $ProjectDir
if (-not (Test-Path "package.json")) { throw "package.json not found in $ProjectDir" }
if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
npm run build
Pop-Location

# 2. Copy built app + node_modules to the install dir.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path "$ProjectDir\package.json","$ProjectDir\package-lock.json" -Destination $InstallDir -Force
Copy-Item -Path "$ProjectDir\dist" -Destination $InstallDir -Force -Recurse
if (-not (Test-Path "$InstallDir\node_modules")) {
  Copy-Item -Path "$ProjectDir\node_modules" -Destination $InstallDir -Force -Recurse
}

# 3. Write a launcher batch that auto-reconnects (restarts on crash).
$launcher = @"
@echo off
set TV_DASHBOARD_PORT=3939
set TV_LOG_LEVEL=info
:loop
node "$InstallDir\dist\server\index.js"
echo Server exited, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
"@
Set-Content -Encoding ascii -Path "$InstallDir\run.cmd" $launcher

# 4. Start-menu shortcut.
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\tradingview-chrome-mcp"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut("$startMenu\tradingview-chrome-mcp.lnk")
$lnk.TargetPath = "$InstallDir\run.cmd"
$lnk.WorkingDirectory = $InstallDir
$lnk.Description = "TradingView Chrome MCP server + dashboard"
$lnk.Save()

# 5. Health-check script.
$health = @"
node -e "const http=require('http');const r=http.get('http://127.0.0.1:3939/api/status',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);console.log('connected:',j.connected,'tabs:',j.tabCount,'emergencyStop:',j.emergencyStop);process.exit(j.connected?0:1)}catch(e){console.log('bad json');process.exit(1)}})});r.on('error',e=>{console.log('dashboard down:',e.message);process.exit(1)});"
"@
Set-Content -Encoding ascii -Path "$InstallDir\health.cmd" $health

# 6. Optionally register with Codex.
if ($RegisterCodex -or $true) {
  Write-Host "Registering with Codex (idempotent)..."
  codex mcp remove tradingview-chrome-mcp 2>$null | Out-Null
  codex mcp add tradingview-chrome-mcp --env TV_DASHBOARD_PORT=3939 --env TV_LOG_LEVEL=info --env TV_APPROVAL_TIMEOUT_MS=120000 -- node "$InstallDir\dist\server\index.js"
}

Write-Host "Installed. Start menu: tradingview-chrome-mcp. Dashboard: http://127.0.0.1:3939"
Write-Host "Health check: $InstallDir\health.cmd"
Write-Host "Uninstall via scripts\uninstall.ps1"
