# uninstall.ps1 - removes the installed app, shortcut, and Codex registration.
[CmdletBinding()]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\tradingview-chrome-mcp"
)
$ErrorActionPreference = "SilentlyContinue"
Write-Host "Unregistering from Codex..."
codex mcp remove tradingview-chrome-mcp 2>$null | Out-Null
Write-Host "Removing Start-menu shortcut..."
Remove-Item -LiteralPath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\tradingview-chrome-mcp" -Recurse -Force
Write-Host "Removing install dir $InstallDir ..."
if (Test-Path $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
Write-Host "Uninstalled. Source code in $PSScriptRoot\.. is untouched."
