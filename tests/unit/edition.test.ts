/**
 * Tests for edition limits and feature gating (pure logic, no database).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EDITION_LIMITS,
  isFeatureEnabled,
  isEditionHigherOrEqual,
  parseEdition,
  type Edition,
} from "../../src/licensing/edition.js";

describe("edition limits", () => {
  it("free has the lowest caps and no strategy tester / owner dashboard", () => {
    const f = EDITION_LIMITS.free;
    assert.equal(f.liveTrading, false);
    assert.equal(f.strategyTester, false);
    assert.equal(f.ownerDashboard, false);
    assert.equal(f.multiDevice, false);
    assert.equal(f.cloudSync, true); // mandatory operational sync
    assert.ok(f.maxAutofixAttempts < EDITION_LIMITS.pro.maxAutofixAttempts);
  });

  it("live trading is disabled in every edition for the initial release", () => {
    for (const ed of ["free", "pro", "team", "owner"] as Edition[]) {
      assert.equal(EDITION_LIMITS[ed].liveTrading, false, `${ed} must not allow live trading`);
    }
  });

  it("pro unlocks strategy tester and multi-device but still no live trading", () => {
    const p = EDITION_LIMITS.pro;
    assert.equal(p.strategyTester, true);
    assert.equal(p.multiDevice, true);
    assert.equal(p.liveTrading, false);
  });

  it("owner unlocks the owner dashboard", () => {
    assert.equal(EDITION_LIMITS.owner.ownerDashboard, true);
    assert.equal(EDITION_LIMITS.pro.ownerDashboard, false);
  });
});

describe("feature gating", () => {
  it("isFeatureEnabled reflects the limits table", () => {
    assert.equal(isFeatureEnabled("free", "strategyTester"), false);
    assert.equal(isFeatureEnabled("pro", "strategyTester"), true);
    assert.equal(isFeatureEnabled("pro", "liveTrading"), false);
    assert.equal(isFeatureEnabled("owner", "ownerDashboard"), true);
  });

  it("isEditionHigherOrEqual orders free < pro < team < owner", () => {
    assert.equal(isEditionHigherOrEqual("pro", "free"), true);
    assert.equal(isEditionHigherOrEqual("free", "pro"), false);
    assert.equal(isEditionHigherOrEqual("owner", "pro"), true);
    assert.equal(isEditionHigherOrEqual("pro", "pro"), true);
  });

  it("parseEdition falls back to free for unknown values", () => {
    assert.equal(parseEdition("free"), "free");
    assert.equal(parseEdition("PRO"), "pro");
    assert.equal(parseEdition("nonsense"), "free");
    assert.equal(parseEdition(undefined), "free");
  });
});