# Free vs Pro (vs Team / Owner)

| Capability | Free | Pro | Team | Owner |
|---|:--:|:--:|:--:|:--:|
| Local SQLite source of truth | ✅ | ✅ | ✅ | ✅ |
| 48 browser/TradingView tools | ✅ | ✅ | ✅ | ✅ |
| Autonomous Pine Script repair loop | ✅ (≤5 attempts) | ✅ (≤12) | ✅ (≤12) | ✅ (≤12) |
| Hash-chained audit log | ✅ | ✅ | ✅ | ✅ |
| Mandatory operational sync | ✅ | ✅ (priority) | ✅ (priority) | ✅ (priority) |
| Backups before every edit | ✅ | ✅ | ✅ | ✅ |
| Runtime chart verification | ✅ | ✅ | ✅ | ✅ |
| Strategy tester extraction | ❌ | ✅ | ✅ | ✅ |
| Multi-device activation | ❌ | ✅ | ✅ | ✅ |
| Shared team workspace | ❌ | ❌ | ✅* | ✅* |
| Owner administration dashboard | ❌ | ❌ | ❌ | ✅* |
| Tasks per day | 20 | 200 | 1000 | unlimited |
| **Live trading / broker orders** | ❌ | ❌ | ❌ | ❌ |

\* Interface reserved — implemented in a later phase.

## Notes

- **Live trading is disabled in every edition** for the initial release. Browser
  automation is restricted to `tradingview.com` / `www.tradingview.com`.
- **Operational sync is mandatory** for Free and Pro (and Team/Owner). It
  carries only allow-listed, redacted operational data — never Pine source,
  never secrets. See [TELEMETRY.md](TELEMETRY.md).
- The **autofix attempt cap** is enforced from `EDITION_LIMITS`, so a Pro key
  raises the cap from 5 to 12 automatically.
- See [LICENSING.md](LICENSING.md) for activation instructions.