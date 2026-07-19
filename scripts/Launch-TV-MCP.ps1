# Launch-TV-MCP.ps1 - One-click launcher for tradingview-chrome-mcp.
#
# Goals:
#   1. Ensure Chrome is running with --remote-debugging-port=9222.
#   2. Start the MCP server + dashboard in the background.
#   3. Open the dashboard in the default browser.
#   4. Optionally create a Windows desktop shortcut for future 1-click runs.
#
# Usage:
#   Double-click Launch-TV-MCP.cmd, or run:
#     pwsh scripts/Launch-TV-MCP.ps1
#
# Safety defaults:
#   - Uses a temporary Chrome profile for isolation unless TV_ALLOW_REAL_PROFILE=1.
#   - NEVER stores cookies, passwords, or tokens.
#   - Only kills existing Chrome processes if TV_ALLOW_CHROME_KILL=1 is set.
[CmdletBinding()]
param(
  [string]$ProjectDir = "$PSScriptRoot\..",
  [switch]$CreateShortcut,
  [switch]$NoDashboard
)
$ErrorActionPreference = "Stop"

# --- Configuration ---
$DebugPort = 9222
$DashboardPort = 3939
$DefaultTvUrl = "https://www.tradingview.com/chart/"
$AllowKill = $env:TV_ALLOW_CHROME_KILL -eq "1"
$AllowLaunch = $true

# --- Helpers ---
function Find-Chrome {
  $candidates = @(
    $env:TV_CHROME_PATH,
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ }
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Test-DebugPortOpen {
  try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 2 -UseBasicParsing
    return $true
  } catch {
    return $false
  }
}

function Get-ChromeProcesses {
  return Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object {
    # Ignore crashpad / helper processes that don't own windows.
    $_.MainWindowHandle -ne 0 -or $_.CommandLine -match "chrome.exe"
  }
}

function Stop-ConflictingChrome {
  if (-not $AllowKill) {
    Write-Host ""
    Write-Host "Chrome is already running without a debug port." -ForegroundColor Yellow
    Write-Host "Close all Chrome windows and rerun, or set TV_ALLOW_CHROME_KILL=1 to allow this launcher to close Chrome automatically." -ForegroundColor Yellow
    return $false
  }
  Write-Host ""
  Write-Host "WARNING: TV_ALLOW_CHROME_KILL=1 is set." -ForegroundColor Red
  Write-Host "This will FORCE CLOSE all Google Chrome processes, including any work you have open in other windows or profiles." -ForegroundColor Yellow
  Write-Host "Unsaved work in Chrome (tabs, forms, downloads) may be lost." -ForegroundColor Yellow
  $confirm = Read-Host "Type 'yes' to continue and close Chrome, or anything else to cancel"
  if ($confirm -ne "yes") {
    Write-Host "Cancelled by user. Close Chrome manually and rerun." -ForegroundColor Yellow
    return $false
  }
  Write-Host "Closing existing Chrome processes in 5 seconds..." -ForegroundColor Magenta
  for ($i = 5; $i -gt 0; $i--) {
    Write-Host "  $i..."
    Start-Sleep -Seconds 1
  }
  $procs = Get-ChromeProcesses
  if ($procs) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
  }
  # Make sure no lock on the profile lingers.
  Get-Process -Name chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  return $true
}

function Start-ChromeWithDebug {
  $exe = Find-Chrome
  if (-not $exe) {
    throw "Google Chrome not found. Set TV_CHROME_PATH or install Chrome."
  }
  $allowRealProfile = $env:TV_ALLOW_REAL_PROFILE -eq "1"
  if ($allowRealProfile) {
    $udd = if ($env:TV_CHROME_USER_DATA) { $env:TV_CHROME_USER_DATA } else { "$env:LocalAppData\Google\Chrome\User Data" }
    Write-Host "WARNING: TV_ALLOW_REAL_PROFILE=1 - reusing your real Chrome profile (cookies, extensions, logins)." -ForegroundColor Red
    Write-Host "Launching Chrome with remote debugging on port $DebugPort using real profile..." -ForegroundColor Cyan
  } else {
    $udd = Join-Path $env:TEMP ("tv-mcp-chrome-" + [System.Guid]::NewGuid().ToString("n").Substring(0, 12))
    Write-Host "Launching Chrome with remote debugging on port $DebugPort using isolated temp profile..." -ForegroundColor Cyan
  }
  $args = @(
    "--remote-debugging-port=$DebugPort",
    "--user-data-dir=`"$udd`"",
    "--no-first-run",
    "--no-default-browser-check"
  )
  if ($allowRealProfile) {
    $args += "--remote-allow-origins=*"
  }
  $args += $DefaultTvUrl
  Start-Process -FilePath $exe -ArgumentList $args -WindowStyle Normal
  # Wait for the debug endpoint.
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    if (Test-DebugPortOpen) { return }
    Start-Sleep -Milliseconds 800
  }
  throw "Chrome did not open the debug port within 30 seconds."
}

function Start-McpServer {
  param([string]$ServerDir)
  $bin = Join-Path $ServerDir "dist\server\index.js"
  if (-not (Test-Path $bin)) {
    throw "MCP server not found at $bin. Run 'npm run build' first."
  }
  Write-Host "Starting MCP server + dashboard..." -ForegroundColor Cyan
  if (-not $env:TV_DASHBOARD_TOKEN) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $env:TV_DASHBOARD_TOKEN = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  }
  Write-Host "Dashboard token: $env:TV_DASHBOARD_TOKEN" -ForegroundColor Yellow
  Write-Host "(Set TV_DASHBOARD_TOKEN to reuse a fixed token across launches.)" -ForegroundColor Gray
  $env:TV_CDP_URL = "http://127.0.0.1:$DebugPort"
  $env:TV_DASHBOARD_PORT = "$DashboardPort"
  $env:TV_LOG_LEVEL = "info"
  $env:TV_APPROVAL_TIMEOUT_MS = "120000"
  $env:TV_ALLOW_CHROME_LAUNCH = "1"
  $env:TV_DEFAULT_TRADINGVIEW_URL = $DefaultTvUrl
  Start-Process -FilePath "node" -ArgumentList "`"$bin`"" -WindowStyle Hidden -WorkingDirectory $ServerDir
}

function New-DesktopShortcut {
  param([string]$ServerDir)
  $cmd = Join-Path $ServerDir "Launch-TV-MCP.cmd"
  if (-not (Test-Path $cmd)) {
    Write-Warning "Launch-TV-MCP.cmd not found at $cmd; skipping shortcut creation."
    return
  }
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut("$desktop\TradingView MCP.lnk")
  $lnk.TargetPath = $cmd
  $lnk.WorkingDirectory = $ServerDir
  $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
  $lnk.Description = "Launch TradingView Chrome MCP server"
  $lnk.Save()
  Write-Host "Desktop shortcut created: $desktop\TradingView MCP.lnk" -ForegroundColor Green
}

function Wait-Dashboard {
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$DashboardPort/api/status" -TimeoutSec 2 -UseBasicParsing
      if ($r.connected -ne $null) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# --- Main flow ---
$ProjectDir = (Resolve-Path $ProjectDir).Path
Write-Host "TradingView Chrome MCP Launcher" -ForegroundColor Cyan
Write-Host "Project: $ProjectDir" -ForegroundColor Gray

# 1. Ensure debug port.
if (-not (Test-DebugPortOpen)) {
  $procs = Get-ChromeProcesses
  if ($procs) {
    $ok = Stop-ConflictingChrome
    if (-not $ok) { exit 1 }
  }
  Start-ChromeWithDebug
} else {
  Write-Host "Chrome debug port already open on http://127.0.0.1:$DebugPort" -ForegroundColor Green
}

# 2. Start server.
Start-McpServer -ServerDir $ProjectDir

# 3. Wait for dashboard and optionally open it.
Write-Host "Waiting for dashboard on http://127.0.0.1:$DashboardPort ..." -ForegroundColor Cyan
$up = Wait-Dashboard
if ($up) {
  Write-Host "Dashboard is up." -ForegroundColor Green
  if (-not $NoDashboard) {
    Start-Process "http://127.0.0.1:$DashboardPort"
  }
} else {
  Write-Warning "Dashboard did not respond within 20 seconds; check logs/ for errors."
}

# 4. Optional shortcut.
if ($CreateShortcut) {
  New-DesktopShortcut -ServerDir $ProjectDir
}

Write-Host ""
Write-Host "Done. The MCP server is running in the background." -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:$DashboardPort" -ForegroundColor Gray
if ($CreateShortcut) {
  Write-Host "Use the desktop shortcut next time for a single-click launch." -ForegroundColor Gray
} else {
  Write-Host "Tip: rerun with -CreateShortcut to add a desktop shortcut." -ForegroundColor Gray
}
