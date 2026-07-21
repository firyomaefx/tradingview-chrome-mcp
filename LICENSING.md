# Licensing

TradingView Chrome MCP ships in four editions: **Free**, **Pro**, **Team**, and
**Owner**. See [FREE_VS_PRO.md](FREE_VS_PRO.md) for the feature/limit matrix.

## Editions at a glance

| Edition | Activation | Notes |
|---|---|---|
| Free | None (default) | Local SQLite, autonomous Pine loop (capped), mandatory operational sync. No live trading. |
| Pro | `TV-PRO-<uuid>` key | Higher loop caps, strategy tester, multi-device, priority sync. No live trading. |
| Team | `TV-TEAM-<uuid>` key | Shared workspace (interface reserved for a later phase). |
| Owner | `TV-OWNER-<uuid>` key | Administration dashboard (interface reserved for a later phase). |

## How activation works (this phase)

The current build uses **offline activation**: a key matching
`TV-(PRO|TEAM|OWNER)-<uuid>` activates the matching edition locally and records
the device id in the `licence` table. Activate from your AI host:

```
activate_licence  { "key": "TV-PRO-12345678-1234-1234-1234-123456789abc" }
```

or call the tool via the MCP server. Check state with `licence_status`. Drop
back to Free by calling `deactivateLicence()` (exposed programmatically; a tool
wrapper will follow).

The licence key is **never synchronized** — only the edition, status, device
id, and activation timestamp are pushed to the owner dashboard via the
`licence.status` sync entity.

## Online activation (later phase)

`src/licensing/licensing.ts` exposes a `DeviceActivationClient` interface and
`setDeviceActivationClient(...)`. A later phase wires this to a Supabase Edge
Function that validates the key, binds it to the device, and returns an
expiry. Call sites (`activateLicenceOnline`) are already in place, so swapping
the offline verifier for the online one requires no changes to tools.

## Where the licence lives

- The `licence` row in `<TV_DATA_DIR>/data/tradingview-mcp.db` is the runtime
  source of truth.
- The licence **key** is a product entitlement, not a user secret, but it is
  treated as sensitive: it is redacted out of any sync payload and never
  written to logs.
- API keys and credentials (OpenAI/Anthropic, broker) are handled per
  [PRIVACY.md](PRIVACY.md) and are unrelated to the licence key.

## Feature gating

The tool registry consults `EDITION_LIMITS` (`src/licensing/edition.ts`) before
exposing or running gated capabilities. `isFeatureEnabled(edition, feature)` is
the single source of truth. Live trading is `false` in **every** edition for
the initial release.