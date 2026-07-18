# Register the server with Codex CLI, then list to confirm.
function Test-CodexAvailable {
  try { $null = Get-Command codex -ErrorAction Stop; return $true } catch { return $false }
}

if (-not (Test-CodexAvailable)) {
  Write-Warning "Codex CLI ('codex') was not found in PATH."
  Write-Host "Install the Codex CLI first: https://docs.anthropic.com/en/docs/codex/installation"
  Write-Host "Then re-run this script, or register manually:"
  $bin = Join-Path $PSScriptRoot "..\dist\server\index.js"
  Write-Host "  codex mcp add tradingview-chrome-mcp node $bin"
  exit 1
}

$bin = Join-Path $PSScriptRoot "..\dist\server\index.js"
$bin = (Resolve-Path $bin -ErrorAction SilentlyContinue).Path
if (-not $bin) { Write-Host "Build first: npm run build"; exit 1 }
codex mcp remove tradingview-chrome-mcp 2>$null | Out-Null
codex mcp add tradingview-chrome-mcp node $bin
codex mcp list
Write-Host "Dashboard: http://127.0.0.1:3939"
