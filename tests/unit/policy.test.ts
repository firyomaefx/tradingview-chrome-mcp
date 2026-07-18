import { test } from "node:test";
import assert from "node:assert/strict";
import * as policy from "../../src/permissions/policy.js";
import { isTradingViewUrl } from "../../src/browser/controller.js";
import { parseSymbolFromUrl } from "../../src/adapters/tradingview/adapter.js";

test("policy: emergency stop denies everything", () => {
  policy.triggerEmergencyStop();
  const d = policy.evaluate({ tool: "ping", url: undefined });
  assert.equal(d.allowed, false);
  assert.equal(d.severity, "deny");
  policy.clearEmergencyStop();
});

test("policy: non-tab tools (url undefined) pass domain gate", () => {
  policy.clearEmergencyStop();
  const d = policy.evaluate({ tool: "ping", url: undefined });
  assert.equal(d.allowed, true);
});

test("policy: tradingview.com url allowed", () => {
  policy.clearEmergencyStop();
  const d = policy.evaluate({ tool: "tv_status", url: "https://www.tradingview.com/chart/?symbol=AAPL" });
  assert.equal(d.allowed, true);
});

test("policy: non-allowed domain denied", () => {
  policy.clearEmergencyStop();
  const d = policy.evaluate({ tool: "tv_status", url: "https://evil.example.com/x" });
  assert.equal(d.allowed, false);
  assert.equal(d.severity, "deny");
});

test("policy: destructive without approval blocked", () => {
  policy.clearEmergencyStop();
  const d = policy.evaluate({ tool: "tv_pine_save", url: "https://www.tradingview.com/chart/", destructive: true, approvalApproved: false });
  assert.equal(d.allowed, false);
  assert.equal(d.severity, "block");
});

test("policy: destructive with approval allowed", () => {
  policy.clearEmergencyStop();
  const d = policy.evaluate({ tool: "tv_pine_save", url: "https://www.tradingview.com/chart/", destructive: true, approvalApproved: true });
  assert.equal(d.allowed, true);
});

test("isTradingViewUrl matches chart urls", () => {
  assert.equal(isTradingViewUrl("https://www.tradingview.com/chart/?symbol=AAPL"), true);
  assert.equal(isTradingViewUrl("https://tradingview.com/chart/X/"), true);
  assert.equal(isTradingViewUrl("https://example.com/chart/"), false);
});

test("parseSymbolFromUrl decodes query and hash", () => {
  assert.equal(parseSymbolFromUrl("https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL"), "NASDAQ:AAPL");
  assert.equal(parseSymbolFromUrl("https://www.tradingview.com/chart/?tvchartsymbol=BINANCE%3ABTCUSDT"), "BINANCE:BTCUSDT");
  assert.equal(parseSymbolFromUrl("https://www.tradingview.com/chart/#symbol=EURUSD"), "EURUSD");
  assert.equal(parseSymbolFromUrl("https://www.tradingview.com/chart/"), null);
});


import { parseTimeframeFromUrl } from "../../src/adapters/tradingview/adapter.js";

test("parseTimeframeFromUrl decodes interval query and hash", () => {
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/?symbol=AAPL&interval=5"), "5");
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/?symbol=AAPL&interval=60"), "60");
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/?symbol=AAPL&interval=1D"), "D");
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/?symbol=AAPL&interval=D"), "D");
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/#interval=W"), "W");
  assert.equal(parseTimeframeFromUrl("https://www.tradingview.com/chart/?symbol=AAPL"), null);
});
