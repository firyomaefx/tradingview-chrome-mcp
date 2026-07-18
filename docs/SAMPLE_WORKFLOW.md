# Sample Pine Script Workflow

This is the end-to-end workflow Codex uses to create, save, and add a Pine Script v6 indicator via the MCP server. Run it against a paper-trading / test layout.

## Prerequisites
- Chrome running with `--remote-debugging-port=9222` (run `scripts/start-chrome.ps1`).
- A TradingView chart tab open and logged in.
- The MCP server registered with Codex and running.

## Steps (as Codex tool calls)

1. Confirm the session:
   - `ping`
   - `browser_status`
   - `tv_status`  - expect `pineEditorOpen: true` (or call `tv_open_pine_editor`).

2. Read the current state as evidence:
   - `tv_screenshot { name: "before" }`
   - `tv_read_pine_source`  - capture the existing buffer.

3. Create the new indicator (replaces the editor buffer, does NOT save):
   - `tv_pine_create { name: "FCPO Test SMA", source: <see tests/fixtures/sample.pine> }`

4. Check for compile errors before saving:
   - `tv_pine_compile_errors`  - expect `success: true, hasErrors: false`.

5. Save (destructive, requires dashboard approval):
   - `tv_pine_save { scriptName: "FCPO Test SMA" }`
   - Approve on the dashboard at `http://127.0.0.1:3939`.

6. Add to chart (destructive, requires dashboard approval):
   - `tv_pine_add_to_chart { scriptName: "FCPO Test SMA" }`
   - Approve on the dashboard.

7. Capture evidence:
   - `tv_screenshot { name: "after" }`
   - `tv_status`  - confirm symbol/timeframe unchanged.

8. If the script is a strategy, read the tester:
   - `tv_read_strategy_tester`

## Recovery on failure
- If `tv_pine_compile_errors.hasErrors` is true, read the messages, patch the source with `tv_pine_patch`, and re-check.
- If a tool returns `BLOCKED`, resolve the approval on the dashboard and retry.
- If anything looks wrong, call `emergency_stop` immediately.
