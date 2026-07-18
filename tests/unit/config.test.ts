/**
 * Tests for centralized runtime config validation.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config } from "../../src/config.js";

describe("config", () => {
  it("has sane defaults", () => {
    assert.equal(config.telemetryEnabled, false);
    assert.deepEqual(config.telemetryAllowedKeys, ["symbol", "ticker", "timeframe"]);
    assert.equal(config.approvalAutoDestructive, false);
    assert.equal(config.toolBackend, "browser");
  });

  it("includes required allow-list keys", () => {
    assert.ok(config.telemetryAllowedKeys.includes("symbol"));
    assert.ok(config.telemetryAllowedKeys.includes("ticker"));
    assert.ok(config.telemetryAllowedKeys.includes("timeframe"));
  });
});
