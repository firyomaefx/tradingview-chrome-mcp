import { test } from "node:test";
import assert from "node:assert/strict";
import { sSymbol, sTimeframe, sPineSource, sScriptName } from "../../src/validation/schemas.js";

test("sSymbol accepts exchange tickers", () => {
  assert.equal(sSymbol.safeParse("NASDAQ:AAPL").success, true);
  assert.equal(sSymbol.safeParse("BINANCE:BTCUSDT").success, true);
  assert.equal(sSymbol.safeParse("aapl").success, false);
  assert.equal(sSymbol.safeParse("AAPL;rm -rf /").success, false);
});

test("sTimeframe accepts known values", () => {
  assert.equal(sTimeframe.safeParse("D").success, true);
  assert.equal(sTimeframe.safeParse("5").success, true);
  assert.equal(sTimeframe.safeParse("3").success, false);
});

test("sPineSource requires version directive", () => {
  assert.equal(sPineSource.safeParse("//@version=6\nindicator(\"x\")").success, true);
  assert.equal(sPineSource.safeParse("indicator(\"x\")").success, false);
});

test("sScriptName rejects weird chars", () => {
  assert.equal(sScriptName.safeParse("FCPO Overlap").success, true);
  assert.equal(sScriptName.safeParse("../etc/passwd").success, false);
});
