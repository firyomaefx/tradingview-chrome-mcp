# Test Plan (v0.2)

## Automated
- `tests/unit/policy.test.ts` - policy gate, domain allowlist, destructive-approval, emergency stop, URL symbol/timeframe parsing.
- `tests/unit/schemas.test.ts` - zod validation for symbols, timeframes, Pine `//@version`, script names.
- `tests/unit/selectors.test.ts` - selector regression against a tiny inline HTML fixture mirroring the real TradingView DOM. Run with `npm test`.
- `scripts/smoke.mjs` / `smoke2.mjs` / `smoke3.mjs` / `smoke-dashboard.mjs` - MCP STDIO + dashboard smoke.
- `scripts/live-destructive.mjs` - live destructive verification against the active TradingView tab.

## Live-verified matrix (2026-07-18)
| Scenario | Result |
|---|---|
| Connect to existing Chrome | PASS (connected:true, 2 tabs) |
| Find TradingView tab | PASS |
| Read symbol + timeframe | PASS (timeframe via URL fallback) |
| Change symbol AAPL + revert | PASS (changed:true, restored) |
| Change timeframe 15 + revert | PASS (changed:true, restored) |
| Open Pine Editor | PASS (eval-click bypasses overlay) |
| Create Pine v6 source | PASS (content set, compile success) |
| Read compile errors | PASS (no errors) |
| Save script | PASS (saved:true) |
| Add to chart | PASS (added:true) |
| Screenshot at every step | PASS |
| Emergency stop | PASS (unit-tested) |
| Audit log | PASS (logs/audit.jsonl) |

## Failure matrix (must produce an action log + recovery)
| Scenario | Expected |
|---|---|
| Chrome disconnected | browser_status connected:false; tools DENIED; no crash; auto-reconnect via launcher |
| TradingView tab missing | tv_* DENIED with clear message; browser_* still work |
| User logged out | tv_status.isLoggedIn:false |
| Multiple TradingView tabs | getTradingViewTab prefers /chart/ URL, else first |
| Wrong symbol after change | tv_status re-reads actual symbol |
| Pine Editor closed | tv_open_pine_editor opens it (eval-click) |
| Existing unsaved script | tv_read_pine_source returns the buffer |
| Pine syntax error | tv_pine_compile_errors.hasErrors:true with messages |
| Indicator already added | tv_pine_add_to_chart idempotent at the UI level |
| Unexpected popup | tv_status.dialogs lists it; tv_dismiss_dialogs closes close-able ones |
| Slow network | selectors time out gracefully; no infinite waits |
| Browser restart | getBrowser re-connects via CDP on next call |
| Emergency stop armed | all tools DENIED until approved emergency_clear |

## Test data policy
- Dedicated TradingView test layout / paper trading only.
- Never test against a real brokerage connection.

## Acceptance (v0.2 MVP+)
All 12 original MVP criteria verified, plus live destructive path (change symbol/timeframe, Pine create/compile/save/add-to-chart) end-to-end against a real session.
