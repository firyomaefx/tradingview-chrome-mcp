/**
 * Browser integration smoke test.
 *
 * This test launches the local MCP server as a child process over STDIO,
 * connects the official MCP client, and exercises the basic chart-reading flow
 * against a real browser. It uses a non-TradingView fallback URL
 * (`about:blank`) by default so CI does not require a TradingView account.
 * Set TEST_TRADINGVIEW_URL to point at a real chart for a richer test.
 *
 * Requirements:
 *   - Node.js >= 20.10
 *   - Chrome installed with `--remote-debugging-port=9222` OR a headless launch
 *   - `npm run build` run beforehand
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert";
import { describe, it, before, after } from "node:test";
import { chromium } from "playwright";

const TEST_URL = process.env.TEST_TRADINGVIEW_URL ?? "https://www.tradingview.com/chart/";
const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222);

/** Minimal offline TradingView chart mock so CI can test tv_status without network. */
function mockTradingViewChart(symbol: string, interval: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${symbol} — ${interval}</title>
</head>
<body>
  <header>
    <button aria-label="Change symbol">${symbol}</button>
    <button aria-label="Change interval">${interval}</button>
  </header>
  <main data-qa-id="chart-pane">
    <canvas width="800" height="600" style="display:block"></canvas>
  </main>
  <script>document.body.classList.add("chart-page");</script>
</body>
</html>`;
}

describe("browser smoke", { concurrency: false, timeout: 120_000 }, () => {
  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;
  let browserHandle: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let routeContext: import("playwright").BrowserContext | null = null;

  before(async () => {
    // 1. Ensure a browser with the debug port is available.
    let browser;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
    } catch {
      browser = await chromium.launch({
        headless: true,
        args: [`--remote-debugging-port=${CHROME_DEBUG_PORT}`],
      });
      browserHandle = browser;
    }

    // 2. Open an offline TradingView mock chart so the MCP server finds a TV tab.
    const context = browser.contexts()[0] ?? (await browser.newContext());
    routeContext = context;
    const TEST_SYMBOL = "NASDAQ:AAPL";
    const TEST_INTERVAL = "60";
    await context.route("https://www.tradingview.com/chart/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: mockTradingViewChart(TEST_SYMBOL, TEST_INTERVAL),
      })
    );
    const pages = context.pages();
    const targetPage =
      pages.find((p) => p.url().startsWith(TEST_URL)) ?? (await context.newPage());
    if (!targetPage.url().startsWith(TEST_URL)) {
      await targetPage.goto(`${TEST_URL}?symbol=${encodeURIComponent(TEST_SYMBOL)}&interval=${TEST_INTERVAL}`, {
        waitUntil: "domcontentloaded",
      });
    }

    // 3. Launch the local MCP server via STDIO transport.
    transport = new StdioClientTransport({
      command: "node",
      args: ["dist/server/index.js"],
      env: {
        ...process.env,
        TV_DEFAULT_TRADINGVIEW_URL: TEST_URL,
        TV_DASHBOARD_PORT: "0",
        TV_ALLOW_CHROME_LAUNCH: "0",
      },
    });

    client = new Client({ name: "smoke-test-client", version: "0.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    // Force cleanup with a hard timeout so a hanging MCP server or browser
    // does not keep the test process alive.
    const cleanup = [] as Array<Promise<unknown>>;

    if (client) {
      cleanup.push(
        Promise.race([
          client.close().catch(() => {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error("client close timeout")), 3_000)),
        ]).catch(() => {})
      );
      client = null;
    }

    if (transport) {
      cleanup.push(
        Promise.race([
          transport.close().catch(() => {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error("transport close timeout")), 3_000)),
        ]).catch(() => {})
      );
      transport = null;
    }

    if (browserHandle) {
      cleanup.push(
        Promise.race([
          browserHandle.close().catch(() => {}),
          new Promise((_, reject) => setTimeout(() => reject(new Error("browser close timeout")), 5_000)),
        ]).catch(() => {})
      );
      browserHandle = null;
    }

    await Promise.all(cleanup);
  });

  it("lists tools and reads chart status", async () => {
    assert(client, "client not initialized");

    const toolsResult = await client.listTools();
    assert.ok(toolsResult.tools.length > 0, "server should expose tools");
    assert.ok(
      toolsResult.tools.some((t) => t.name === "tv_status"),
      "server should expose tv_status"
    );

    const statusResult = await client.callTool({
      name: "tv_status",
      arguments: {},
    });
    assert.ok(!statusResult.isError, "tv_status should not error");
    const content = statusResult.content as Array<{ type: string; text: string }>;
    assert.ok(content.some((c) => c.type === "text"), "tv_status should return text content");
    const text = content.find((c) => c.type === "text")?.text ?? "";
    if (text.startsWith("ERROR:") || text.startsWith("BLOCKED:") || text.startsWith("DENIED:")) {
      assert.fail(`tv_status returned failure: ${text}`);
    }
    const data = JSON.parse(text);
    assert.ok(data.pageReady, "page should be reported ready");
    assert.ok(data.diagnostics, "status should include diagnostics");
  });
});
