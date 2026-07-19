#!/usr/bin/env node
/**
 * Quick check: is a Chrome extension connected to the local MCP server?
 *
 * This performs a JSON-RPC round-trip through the extension driver and prints
 * connection status. Run it after loading the unpacked extension in Chrome.
 */

process.env.TV_BROWSER_DRIVER = "extension";
process.env.TV_EXTENSION_WS_PORT = "9223";
process.env.TV_EXTENSION_TOKEN = "tradingview-chrome-mcp";

const { startExtensionServer, ExtensionDriver, isExtensionConnected } = await import("../dist/browser/extension-driver.js");

await startExtensionServer();

// Wait a moment for an existing extension to connect.
await new Promise((r) => setTimeout(r, 800));

if (!isExtensionConnected()) {
  console.log("❌ No Chrome extension connected yet.");
  console.log("   Make sure you loaded extension/ as unpacked in chrome://extensions and that a TradingView tab is open.");
  process.exit(1);
}

const driver = new ExtensionDriver();
const tabs = await driver.listTabs();
console.log("✅ Extension connected. TradingView tabs found:", tabs.length);
for (const t of tabs) {
  console.log(`   tabId=${t.tabId} title=${t.title} url=${t.url}`);
}
process.exit(0);
