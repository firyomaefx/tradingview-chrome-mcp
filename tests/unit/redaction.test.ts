/**
 * Tests for the hardened redaction layer.
 *
 * The never-synchronize list (passwords, cookies, session tokens, OpenAI /
 * Anthropic API keys, webhook secrets, auth codes, payment-card details, bank
 * information, private encryption keys, broker credentials) must be redacted
 * before local storage and before cloud sync. These tests pin that behavior.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redact } from "../../src/logging/logger.js";

describe("redact key-based secrets", () => {
  it("redacts all never-synchronize keys", () => {
    const out = redact({
      password: "x",
      cookie: "sid=1",
      authorization: "Bearer abc",
      api_key: "sk-xx",
      openai_api_key: "sk-xx",
      anthropic_api_key: "sk-ant-xx",
      webhook_secret: "whsec",
      webhook_url: "https://hook",
      auth_code: "123456",
      otp: "123456",
      card: "4111",
      pan: "4111111111111111",
      cvv: "123",
      bank: "x",
      iban: "GB00",
      account_number: "0001234",
      routing: "123",
      private_key: "-----BEGIN",
      passphrase: "secret",
      broker_login: "u",
      broker_account: "a",
      credentials: "c",
      session: "s",
      refresh_token: "r",
    }) as Record<string, string>;

    for (const k of Object.keys(out)) {
      assert.equal(out[k], "[redacted]", `${k} must be redacted`);
    }
  });

  it("preserves non-secret keys", () => {
    const out = redact({ symbol: "EURUSD", timeframe: "15", ticker: "AAPL" }) as Record<string, unknown>;
    assert.equal(out.symbol, "EURUSD");
    assert.equal(out.timeframe, "15");
  });
});

describe("redact value-based patterns", () => {
  it("redacts OpenAI-style keys regardless of key name", () => {
    const out = redact({ note: "sk-" + "a".repeat(40) }) as Record<string, string>;
    assert.equal(out.note, "[redacted]");
  });

  it("redacts Anthropic-style keys", () => {
    const out = redact({ model: "sk-ant-" + "a".repeat(40) }) as Record<string, string>;
    assert.equal(out.model, "[redacted]");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = redact({ header: jwt }) as Record<string, string>;
    assert.equal(out.header, "[redacted]");
  });

  it("redacts Bearer tokens", () => {
    const out = redact({ header: "Bearer abcdef123456" }) as Record<string, string>;
    assert.equal(out.header, "[redacted]");
  });

  it("redacts credit-card-like number groups", () => {
    const out = redact({ memo: "4111 1111 1111 1111" }) as Record<string, string>;
    assert.equal(out.memo, "[redacted]");
  });

  it("does not redact ordinary 4-digit timeframes", () => {
    const out = redact({ timeframe: "15", price: "1234.5" }) as Record<string, unknown>;
    assert.equal(out.timeframe, "15");
    assert.equal(out.price, "1234.5");
  });
});

describe("redact recursion", () => {
  it("redacts nested secrets", () => {
    const out = redact({ outer: { inner: { token: "t", name: "ok" } } }) as {
      outer: { inner: { token: string; name: string } };
    };
    assert.equal(out.outer.inner.token, "[redacted]");
    assert.equal(out.outer.inner.name, "ok");
  });

  it("redacts secrets inside arrays of objects", () => {
    const out = redact([{ api_key: "k" }, { ok: true }]) as Array<Record<string, unknown>>;
    assert.equal(out[0]?.api_key, "[redacted]");
    assert.equal(out[1]?.ok, true);
  });
});