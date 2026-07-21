# Privacy

TradingView Chrome MCP is **local-first**. Your charts, Pine Script source,
indicators, and strategy parameters stay on your machine. The only network
egress is the optional operational sync to a Supabase backend you configure,
and it carries a strict, redacted, allow-listed subset described in
[TELEMETRY.md](TELEMETRY.md).

## What is stored locally

A SQLite database at `<TV_DATA_DIR>/data/tradingview-mcp.db` is the local source
of truth. It holds:

- Device identity (a random UUID, OS, hostname, app version).
- Licence edition + activation status (see [LICENSING.md](LICENSING.md)).
- The autonomous Pine loop history: tasks, Pine Script versions + SHA-256
  checksums, compile errors, LLM fixes, screenshots, backups.
- A hash-chained audit log of every action (see [SECURITY.md](SECURITY.md)).
- An interaction log of MCP tool calls (args stored **redacted**).
- A sync queue of operational data awaiting cloud sync.

On-disk artifacts (`logs/`, `backups/`, `screenshots/`, `data/`) live under
`TV_DATA_DIR` (the project root in source, or `%LOCALAPPDATA%\tradingview-chrome-mcp`
in the standalone executable).

## What is never stored

These categories are **redacted before they reach local storage** and are
structurally barred from the sync queue:

- TradingView passwords
- Browser cookies and session tokens
- OpenAI / Anthropic API keys
- Webhook secrets and URLs
- Authentication codes / OTP / MFA
- Payment-card details, bank information, IBAN, account/routing numbers
- Private encryption keys and passphrases
- Broker login and account credentials

The redaction layer (`redact()` in `src/logging/logger.ts`) matches both
sensitive **key names** and **value patterns** (OpenAI/Anthropic key formats,
JWTs, `Bearer …`, credit-card-like number groups).

## What is synchronized

Only operational, allow-listed entities are ever enqueued for sync:
`telemetry.usage`, `licence.status`, `audit.summary`, `task.summary`. Each
payload is run through `redact()` before enqueue, and there is **no** allow-list
entity for secrets — they cannot be enqueued at all. See
[TELEMETRY.md](TELEMETRY.md) for the exact fields and how to disable/configure
sync.

## Network binding

All local services bind to `127.0.0.1` only. LAN binding is an explicit opt-in
(`TV_HTTP_BIND=0.0.0.0`) and is not recommended. Chrome debugging is never
exposed publicly.

## User transparency

- The dashboard at `http://127.0.0.1:3939` shows status, pending approvals,
  history, and an emergency stop.
- `licence_status` and `sync_status` tools surface edition, device id, sync
  configuration, and queue depth to the AI host.
- Operational sync is **mandatory** (it is how Free and Pro editions report
  usage/licence state), but it only leaves the device when a backend is
  configured; until then rows remain in the local queue and the user is told via
  `sync_status`.

## Live trading

Live trading and broker order execution are **disabled** in every edition for
the initial release. The browser automation is restricted to approved domains
(`tradingview.com`, `www.tradingview.com`).