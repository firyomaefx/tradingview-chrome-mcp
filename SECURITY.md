# Security

## Threat model

The server drives the user's own Chrome against the user's own TradingView account, on the user's own machine. The main risks are: acting on the wrong page, performing destructive TradingView actions without consent, leaking credentials into logs, and a runaway action chain.

## Controls

### Domain allowlist
Only `tradingview.com` and `www.tradingview.com` are permitted by default. Set in `src/permissions/policy.ts` (`ALLOWED_DOMAINS`). Non-allowlisted URLs produce an immediate `deny`. To permit subdomains, the matcher already accepts any host ending in a listed domain.

### Destructive-action approval
Tools in `DESTRUCTIVE_TOOLS` require an explicit dashboard approval. The tool creates a pending approval, waits up to `TV_APPROVAL_TIMEOUT_MS`, and denies on timeout. `TV_AUTO_APPROVE_DESTRUCTIVE=1` bypasses approval - use only in development with a paper-trading account.

### Emergency stop
`emergency_stop` arms a global flag that denies every tool. `emergency_clear` itself requires approval so it cannot be triggered by a confused model.

### Rate limiting and chain cap
At most 120 actions per rolling 60s window, and a max action-chain depth of 25. Both are tunable in `POLICY_LIMITS`.

### Credential handling
- The browser controller never reads or stores cookies, tokens, or passwords.
- Every value logged, stored locally, or enqueued for sync is passed through
  `redact()`, which masks sensitive **keys** (`password`, `token`, `cookie`,
  `authorization`, `api_key`/`apikey`, `openai_api_key`, `anthropic_api_key`,
  `secret`, `session`, `refresh_token`, `access_token`, `webhook`/`webhook_secret`/`webhook_url`,
  `auth_code`, `otp`, `mfa`, `card`, `pan`, `cvv`, `cvc`, `payment`, `bank`,
  `iban`, `bic`, `swift`, `account_number`, `routing`, `private_key`,
  `passphrase`, `broker`, `broker_login`, `broker_account`, `credential`/`credentials`)
  and sensitive **value patterns** (OpenAI `sk-…`, Anthropic `sk-ant-…`, JWTs,
  `Bearer …`, credit-card-like number groups).
- No session data leaves the machine. The dashboard binds to `127.0.0.1` only.

### Hash-chained audit log
Every meaningful action is appended to a hash-chained audit log
(`src/audit/audit-chain.ts`, table `audit_log`): each row stores
`prev_hash` and `hash = sha256(prev_hash || seq || payload)`. Tampering with any
row breaks the chain for every subsequent row. `audit_verify` recomputes the
chain from genesis and reports the first broken sequence number.

### Local source of truth & sync queue
A SQLite database (`<TV_DATA_DIR>/data/tradingview-mcp.db`) is the local source
of truth (device, licence, tasks, Pine versions + checksums + backups, compile
errors, fixes, audit, sync queue). Operational data is enqueued for cloud sync
through an **entity allowlist** (`telemetry.usage`, `licence.status`,
`audit.summary`, `task.summary`); secrets have no allow-list entity and are
additionally redacted, so they cannot be enqueued. See
[TELEMETRY.md](TELEMETRY.md) and [PRIVACY.md](PRIVACY.md).

### Licensing & feature gating
Edition (Free/Pro/Team/Owner) is read from the local `licence` row and gates
capabilities via `EDITION_LIMITS`. Live trading is `false` in every edition.
See [LICENSING.md](LICENSING.md).

### Screenshot and log storage
Screenshots and audit logs are stored locally under `./screenshots` and `./logs`. They are git-ignored. The dashboard only serves screenshots whose filenames match `^[A-Za-z0-9_.\- ]+\.png$`, so path traversal is blocked.

### Input validation
All tool inputs are validated with zod schemas (`src/validation/schemas.ts`). Pine source must contain a `//@version` directive; symbols must match the exchange-ticker regex; filenames must be safe ASCII. This blocks shell-style injection and path traversal.

### No live trading
No order-placement tool exists. The MVP is read + Pine editing + chart configuration only. Paper-trading via the Strategy Tester is read-only.

### What we do NOT do
- We do not store TradingView passwords, browser cookies, or session tokens.
- We do not store or synchronize API keys, webhook secrets, auth codes,
  payment/bank details, private encryption keys, or broker credentials.
- We do not transmit session tokens.
- We do not enable live-trade execution (disabled in every edition).
- We do not synchronize the licence key (only edition/status/device/activation).

## Recommended deployment posture

- Run as a normal user, not Administrator.
- Keep `TV_AUTO_APPROVE_DESTRUCTIVE` unset.
- Keep the dashboard on `127.0.0.1` and do not expose port 3939.
- Review `logs/audit.jsonl` regularly; rotate or clear it as needed.
- Revoke access by stopping the server; the emergency-stop button halts instantly.

## Reporting a problem

If the server misbehaves: press the Emergency Stop button on the dashboard (or call `emergency_stop`), then close Chrome. Inspect `logs/audit.jsonl` for the last actions and `logs/*.log` for stack traces.
