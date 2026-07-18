# install-cli.ps1 - Standalone installer. Downloads the latest GitHub release,
# installs to %LOCALAPPDATA%\tradingview-chrome-mcp, and registers with Codex.
# No Node.js or source tree required; the zip contains a built dist + node_modules.
[CmdletBinding()]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\tradingview-chrome-mcp",
  [string]$Repo = "firyomaefx/tradingview-chrome-mcp",
  [string]$Tag = "latest",
  [switch]$NoCodex,
  [switch]$Force
)
$ErrorActionPreference = "Stop"

function Test-NodeAvailable {
  try { $null = Get-Command node -ErrorAction Stop; return $true } catch { return $false }
}
function Get-LatestReleaseTag {
  param([string]$Repo)
  $url = "https://api.github.com/repos/$Repo/releases/latest"
  $headers = @{ Accept = "application/vnd.github+json" }
  $resp = Invoke-RestMethod -Uri $url -Headers $headers -UseBasicParsing
  return $resp.tag_name
}
function Get-ReleaseAssetUrl {
  param([string]$Repo, [string]$Tag, [string]$Pattern)
  $url = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
  if ($Tag -eq "latest") { $url = "https://api.github.com/repos/$Repo/releases/latest" }
  $headers = @{ Accept = "application/vnd.github+json" }
  $resp = Invoke-RestMethod -Uri $url -Headers $headers -UseBasicParsing
  foreach ($asset in $resp.assets) {
    if ($asset.name -like $Pattern) { return $asset.browser_download_url }
  }
  return $null
}

if (-not (Test-NodeAvailable)) {
  throw "Node.js is not in PATH. Install Node >= 20.10 first (https://nodejs.org)."
}

if (-not $Force -and (Test-Path $InstallDir)) {
  Write-Warning "Install dir already exists: $InstallDir. Use -Force to overwrite."
  exit 1
}

$releaseTag = if ($Tag -eq "latest") { Get-LatestReleaseTag -Repo $Repo } else { $Tag }
Write-Host "Installing tradingview-chrome-mcp release $releaseTag from github.com/$Repo"

$zipUrl = Get-ReleaseAssetUrl -Repo $Repo -Tag $releaseTag -Pattern "*windows*.zip"
if (-not $zipUrl) {
  # Fallback to the source archive if no prebuilt asset exists.
  $zipUrl = Get-ReleaseAssetUrl -Repo $Repo -Tag $releaseTag -Pattern "*.zip"
}
if (-not $zipUrl) {
  throw "No release zip asset found for $Repo $releaseTag"
}

$tmp = Join-Path $env:TEMP "tradingview-chrome-mcp-$releaseTag"
$zipPath = "$tmp.zip"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Write-Host "Downloading $zipUrl ..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
Write-Host "Extracting to $tmp ..."
Expand-Archive -Path $zipPath -DestinationPath $tmp -Force

# Locate the package root inside the extracted archive (top-level or one folder deep).
$src = Get-ChildItem -Path $tmp -Directory | Where-Object { Test-Path "$($_.FullName)\package.json" } | Select-Object -First 1
if (-not $src) { $src = Get-Item $tmp }
if (-not (Test-Path "$($src.FullName)\package.json")) {
  throw "package.json not found inside the downloaded archive"
}

# Install dir.
if (Test-Path $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path "$($src.FullName)\*" -Destination $InstallDir -Recurse -Force

# Verify node_modules/dist.
if (-not (Test-Path "$InstallDir\dist\server\index.js")) {
  throw "dist/server/index.js missing after install; build was not included in the release."
}

# Launcher batch with auto-restart.
$launcher = @"
@echo off
set TV_DASHBOARD_PORT=3939
set TV_LOG_LEVEL=info
set TV_APPROVAL_TIMEOUT_MS=120000
:loop
node "$InstallDir\dist\server\index.js"
echo Server exited, restarting in 3s...
timeout /t 3 /nobreak >nul
goto loop
"@
Set-Content -Encoding ascii -Path "$InstallDir\run.cmd" $launcher

# Ensure Playwright browsers are available for CDP attach (no-op if already cached).
try {
  $npx = (Get-Command npx -ErrorAction SilentlyContinue).Path
  if ($npx) {
    Write-Host "Ensuring Playwright Chromium browser is cached..."
    Start-Process -FilePath $npx -ArgumentList "playwright","install","chromium" -Wait -NoNewWindow -ErrorAction SilentlyContinue | Out-Null
  }
} catch {
  Write-Host "Could not auto-install Playwright Chromium; the server will still work if Chrome is available."
}

# Start-menu shortcut.
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\tradingview-chrome-mcp"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut("$startMenu\tradingview-chrome-mcp.lnk")
$lnk.TargetPath = "$InstallDir\run.cmd"
$lnk.WorkingDirectory = $InstallDir
$lnk.Description = "TradingView Chrome MCP server + dashboard"
$lnk.Save()

# Health check.
$health = @"
node -e "const http=require('http');const r=http.get('http://127.0.0.1:3939/api/status',res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const j=JSON.parse(d);console.log('connected:',j.connected,'tabs:',j.tabCount,'emergencyStop:',j.emergencyStop);process.exit(j.connected?0:1)}catch(e){console.log('bad json');process.exit(1)}})});r.on('error',e=>{console.log('dashboard down:',e.message);process.exit(1)});"
"@
Set-Content -Encoding ascii -Path "$InstallDir\health.cmd" $health

# Codex registration.
if (-not $NoCodex) {
  Write-Host "Registering with Codex..."
  $bin = "$InstallDir\dist\server\index.js"
  codex mcp remove tradingview-chrome-mcp 2>$null | Out-Null
  codex mcp add tradingview-chrome-mcp --env TV_DASHBOARD_PORT=3939 --env TV_LOG_LEVEL=info --env TV_APPROVAL_TIMEOUT_MS=120000 -- node $bin
}

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue

Write-Host "Installed to $InstallDir"
Write-Host "Start menu: tradingview-chrome-mcp"
Write-Host "Dashboard: http://127.0.0.1:3939"
Write-Host "Health check: $InstallDir\health.cmd"
if (-not $NoCodex) { Write-Host "Codex MCP: run 'codex mcp list' to verify." }
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Close all Chrome windows, then run scripts/start-chrome.ps1 (or start Chrome with --remote-debugging-port=9222)."
Write-Host "  2. Log in to TradingView and open a chart."
Write-Host "  3. Double-click the Start-menu shortcut or run $InstallDir\run.cmd."
