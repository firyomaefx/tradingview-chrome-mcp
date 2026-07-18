# package-zip.ps1 - Build a redistributable Windows zip locally.
#
# Mirrors the GitHub Actions release job so you can produce the same artifact
# on your own machine without waiting for CI. The zip contains dist/,
# node_modules (without dev deps), package.json, and package-lock.json.
#
# Usage:
#   pwsh scripts/package-zip.ps1
#   # outputs tradingview-chrome-mcp-windows.zip in the project root
[CmdletBinding()]
param(
  [string]$ProjectDir = "$PSScriptRoot\..",
  [string]$OutputName = "tradingview-chrome-mcp-windows.zip"
)
$ErrorActionPreference = "Stop"

$ProjectDir = (Resolve-Path $ProjectDir).Path
Push-Location $ProjectDir

try {
  Write-Host "Building tradingview-chrome-mcp release zip..." -ForegroundColor Cyan

  if (-not (Test-Path "package.json")) {
    throw "package.json not found in $ProjectDir"
  }

  if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm ci
  }

  Write-Host "Running typecheck..." -ForegroundColor Cyan
  npm run typecheck

  Write-Host "Running tests..." -ForegroundColor Cyan
  npm test

  Write-Host "Building..." -ForegroundColor Cyan
  npm run build

  Write-Host "Running smoke test..." -ForegroundColor Cyan
  node scripts/smoke.mjs

  Write-Host "Stripping dev dependencies..." -ForegroundColor Cyan
  npm prune --omit=dev

  $outPath = Join-Path $ProjectDir $OutputName
  if (Test-Path $outPath) { Remove-Item -LiteralPath $outPath -Force }

  $items = @("dist", "node_modules", "package.json", "package-lock.json")
  Compress-Archive -Path $items -DestinationPath $outPath -Force
  $info = Get-Item $outPath

  Write-Host ""
  Write-Host "Created: $($info.FullName)" -ForegroundColor Green
  Write-Host "Size: $($info.Length) bytes ($([math]::Round($info.Length / 1MB, 2)) MB)" -ForegroundColor Green
} finally {
  Pop-Location
}
