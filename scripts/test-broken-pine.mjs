#!/usr/bin/env node
/**
 * End-to-end manual test script for the extension driver autonomous loop.
 *
 * This script runs the MCP server STDIO interface, waits for a tools/list
 * handshake, then prints the exact prompt you should paste into Claude/Codex.
 *
 * It expects:
 *   1. Chrome is open with the unpacked extension loaded.
 *   2. A TradingView chart tab is active on https://www.tradingview.com/chart/
 *   3. TV_BROWSER_DRIVER=extension is set.
 */

process.env.TV_BROWSER_DRIVER = "extension";
process.env.TV_EXTENSION_WS_PORT = "9223";
process.env.TV_EXTENSION_TOKEN = "tradingview-chrome-mcp";
process.env.TV_DASHBOARD_PORT = "3949";
process.env.TV_LOG_LEVEL = "info";

const { spawn } = await import("node:child_process");

const server = spawn("node", ["dist/server/index.js"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let buffer = "";

function send(msg) {
  server.stdin.write(JSON.stringify(msg) + "\n");
}

server.stdout.on("data", (data) => {
  buffer += data.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1 && msg.result?.tools) {
        console.log("\n✅ MCP server is alive. Tools listed:", msg.result.tools.length);
        console.log("\n--- COPY-PASTE THIS PROMPT INTO CLAUDE/CODEX ---\n");
        console.log(
          "Use the tv_pine_autofix tool to create a Pine Script v6 indicator called " +
            "'Broken EMA Test' with this intentionally broken source:\n\n" +
            "//@version=6\n" +
            "indicator('Broken EMA Test', shorttitle='BEMAT', overlay=true)\n" +
            "length = input.int(14, minval=0)\n" +
            "src = close\n" +
            "emaValue = ta.ema(src, length)\n" +
            "plot(emaValues, color=color.red)\n" +
            "// note the typo: emaValues is undefined\n\n" +
            "Add it to the chart, read any compile errors, fix them automatically, " +
            "and verify the indicator appears.\n"
        );
        console.log("\n--- END PROMPT ---\n");
        // Keep server running for the user to interact with.
      }
    } catch {}
  }
});

// STDIO MCP handshake.
send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "manual-e2e-test", version: "0.1.0" } } });
send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

console.log("MCP server started with extension driver. Waiting for tools/list response...");
console.log("Press Ctrl+C to stop when done.");
