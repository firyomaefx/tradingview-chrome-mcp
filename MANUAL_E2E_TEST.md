# Manual End-to-End Test: Extension Driver Autonomous Loop

## Current state (prepared by the assistant)

- The MCP server is running with `TV_BROWSER_DRIVER=extension`.
- Dashboard: http://127.0.0.1:3949
- Extension WebSocket: ws://127.0.0.1:9223?token=tradingview-chrome-mcp
- Chrome was launched to https://www.tradingview.com/chart/

## What you must do in Chrome (cannot be done remotely)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right).
3. Click **Load unpacked**.
4. Select this folder: `C:\Users\Pedot\Documents\Tradingview\extension`
5. Look at the extension toolbar icon — it should show **ON** after a few seconds.

You can verify the connection from PowerShell:

```powershell
node "C:\Users\Pedot\Documents\Tradingview\scripts\check-extension-connection.mjs"
```

## Prompt to paste into Claude / Codex / ChatGPT Desktop

```text
Use the tv_pine_autofix tool to create a Pine Script v6 indicator called "Broken EMA Test" with this intentionally broken source, add it to the chart, read any compile errors, fix them automatically, and verify the indicator appears.

Source:
//@version=6
indicator("Broken EMA Test", shorttitle="BEMAT", overlay=true)
length = input.int(14, minval=0)
src = close
emaValue = ta.ema(src, length)
plot(emaValues, color=color.red)
// note the typo: emaValues is undefined
```

## Expected loop

1. AI calls `tv_pine_create` → MCP sends `setPineSource` to the extension.
2. Extension injects the broken code into the TradingView Monaco editor.
3. AI calls `tv_pine_add_to_chart` → TradingView shows a compile error.
4. `error_observer.js` catches the red error toast and forwards it to `background.js`.
5. `background.js` sends a `tv-error` notification to the MCP server.
6. `tv_pine_compile_errors` / `tv_pine_autofix` merges the observed error.
7. The LLM receives the exact error text, patches `emaValues` → `emaValue`.
8. AI calls `tv_pine_patch` → fixed code is injected and added to the chart.
9. `tv_chart_verify` confirms the indicator loaded.

## Watch it happen

Tail the MCP log:

```powershell
Get-Content -Path "C:\Users\Pedot\Documents\Tradingview\logs\mcp-extension-test.log" -Wait
```

Open the dashboard for approval prompts:

```text
http://127.0.0.1:3949
```

## Stop the server when done

```powershell
$pid = Get-Content "C:\Users\Pedot\Documents\Tradingview\logs\mcp-extension-test.pid"
Stop-Process -Id $pid -Force
```
