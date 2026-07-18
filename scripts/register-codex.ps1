# Register the server with Codex CLI, then list to confirm.
$bin = Join-Path $PSScriptRoot "..\dist\server\index.js"
$bin = (Resolve-Path $bin -ErrorAction SilentlyContinue).Path
if (-not $bin) { Write-Host "Build first: npm run build"; exit 1 }
codex mcp add tradingview-chrome-mcp node $bin
codex mcp list
Write-Host "Dashboard: http://127.0.0.1:3939"
