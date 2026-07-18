/**
 * Tests for the hosted tool registry mock backend.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allTools, runTool } from "../lib/tools/registry";

const ctx = { requestApproval: async () => true };

describe("hosted tool registry", () => {
  it("exposes the same tool names as the local project", () => {
    const tools = allTools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("tv_status"));
    assert.ok(names.includes("tv_chart_metadata"));
    assert.ok(names.includes("tv_change_symbol"));
    assert.ok(names.includes("tv_change_timeframe"));
    assert.ok(names.includes("ping"));
    assert.ok(names.includes("emergency_stop"));
  });

  it("returns mock quote data from tv_chart_metadata", async () => {
    await runTool("tv_change_symbol", { symbol: "NASDAQ:AAPL" }, ctx);
    const result = await runTool("tv_chart_metadata", {}, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.data);
    const data = result.data as Record<string, unknown>;
    assert.equal(data.symbol, "NASDAQ:AAPL");
    assert.ok(data.quote);
  });

  it("browser-only tools return unavailable in hosted mode", async () => {
    const result = await runTool("tv_screenshot", { name: "test" }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("not available"));
  });

  it("rejects unknown tools", async () => {
    const result = await runTool("nonexistent_tool", {}, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.denied);
  });
});
