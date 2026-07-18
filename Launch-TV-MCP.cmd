@echo off
:: One-click Windows launcher for tradingview-chrome-mcp.
:: This file exists so users can double-click an icon instead of opening a terminal.
:: It forwards to the PowerShell launcher script.
setlocal
cd /d "%~dp0"

:: Prefer pwsh (PowerShell 7+), fall back to powershell (Windows PowerShell 5).
where pwsh >nul 2>nul
if %errorlevel% == 0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "scripts\Launch-TV-MCP.ps1" -CreateShortcut %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\Launch-TV-MCP.ps1" -CreateShortcut %*
)

if %errorlevel% neq 0 (
  echo.
  echo Launcher exited with an error. Press any key to close.
  pause >nul
)
