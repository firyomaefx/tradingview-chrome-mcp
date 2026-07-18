/**
 * Unit tests for the reusable MCP server factory and telemetry wrapper.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/server/mcp-server.js";
import { redactParameters } from "../../src/telemetry/telemetry.js";
import { config } from "../../src/config.js";
import type { ToolDef, ToolContext, ToolResult } from "../../src/tools/registry.js";

describe("mcp-server factory", () => {
  it("lists tools from the injected registry", async () => {
    const registry = {
      getAllTools: (): ToolDef[] => [
        {
          name: "ping",
          description: "Health check",
          inputSchema: { type: "object", additionalProperties: false, properties: {} },
          destructive: false,
          async run() {
            return { ok: true, data: { version: "0.2.0" } };
          },
        },
      ],
      runTool: async (_name: string, _args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
        return { ok: true, data: { pong: true } };
      },
    };

    const server = createMcpServer(registry, {
      userId: "test-user",
      requestApproval: async () => true,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.listTools();
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "ping");
  });

  it("wraps tool calls with the injected registry", async () => {
    let runCount = 0;
    const registry = {
      getAllTools: (): ToolDef[] => [
        {
          name: "tv_change_symbol",
          description: "Change symbol",
          inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
          destructive: true,
          async run(args) {
            runCount++;
            return { ok: true, data: { symbol: String(args.symbol) } };
          },
        },
      ],
      runTool: async (name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
        const def = registry.getAllTools().find((t) => t.name === name);
        if (!def) return { ok: false, error: "not found" };
        if (def.destructive) {
          const approved = await ctx.requestApproval("approve?");
          if (!approved) return { ok: false, error: "denied", denied: true };
        }
        return def.run(args, ctx);
      },
    };

    const server = createMcpServer(registry, {
      userId: "telemetry-test",
      requestApproval: async () => true,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "tv_change_symbol", arguments: { symbol: "NASDAQ:AAPL" } });
    assert.ok(result);
    assert.equal(runCount, 1);
  });
});

describe("telemetry redaction", () => {
  it("keeps only symbol, ticker, and timeframe when telemetry is enabled", () => {
    const originalEnabled = config.telemetryEnabled;
    const originalAllowed = config.telemetryAllowedKeys.slice();
    config.telemetryEnabled = true;
    config.telemetryAllowedKeys = ["symbol", "ticker", "timeframe"];
    try {
      const input = {
        symbol: "XAUUSD",
        timeframe: "5",
        strategy: "secret_breakout",
        indicator_config: { ema: [9, 21] },
        api_key: "should_not_appear",
      };
      const out = redactParameters("tv_change_symbol", input);
      assert.deepEqual(out, { symbol: "XAUUSD", timeframe: "5" });
    } finally {
      config.telemetryEnabled = originalEnabled;
      config.telemetryAllowedKeys = originalAllowed;
    }
  });

  it("returns null when telemetry is disabled", () => {
    const originalEnabled = config.telemetryEnabled;
    config.telemetryEnabled = false;
    try {
      const out = redactParameters("tv_change_symbol", { symbol: "XAUUSD" });
      assert.equal(out, null);
    } finally {
      config.telemetryEnabled = originalEnabled;
    }
  });

  it("returns null when no allowed keys are present", () => {
    const originalEnabled = config.telemetryEnabled;
    config.telemetryEnabled = true;
    try {
      const out = redactParameters("tv_pine_create", { source: "//@version=6\nplot(close)" });
      assert.equal(out, null);
    } finally {
      config.telemetryEnabled = originalEnabled;
    }
  });
});
