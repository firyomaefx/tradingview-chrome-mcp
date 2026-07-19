/**
 * MCP server entrypoint.
 *
 * - Starts an MCP server over STDIO.
 * - Also starts a local Express dashboard on http://127.0.0.1:3939 for
 *   status, action history, screenshots, approvals, and the emergency-stop
 *   button.
 * - Tool input is validated with the zod schemas; tool execution flows
 *   through the policy guard and the approval queue.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { logger } from "../logging/logger.js";
import { audit } from "../logging/logger.js";
import { allTools, runTool } from "../tools/registry.js";
import { createApproval, cancelAllPending, awaitApproval } from "../permissions/approvals.js";
import { startDashboard } from "../dashboard/server.js";
import { startHttpTransportIfEnabled } from "./http.js";
import { createMcpServer, type ToolRegistry } from "./mcp-server.js";
import { getBrowserDriver } from "../browser/controller.js";

const APPROVAL_TIMEOUT_MS = Number(process.env.TV_APPROVAL_TIMEOUT_MS ?? 120_000);
const AUTO_APPROVE = process.env.TV_AUTO_APPROVE_DESTRUCTIVE === "1";
const DASHBOARD_PORT = Number(process.env.TV_DASHBOARD_PORT ?? 3939);
const HTTP_MCP_PORT = Number(process.env.TV_MCP_HTTP_PORT ?? 3940);

async function requestApproval(message: string): Promise<boolean> {
  if (AUTO_APPROVE) return true;
  const a = createApproval("(destructive)", message);
  logger.info({ approval: a.id, message }, "awaiting approval");
  return awaitApproval(a.id, APPROVAL_TIMEOUT_MS);
}

const registry: ToolRegistry = {
  getAllTools: allTools,
  runTool,
};

const server = createMcpServer(registry, { userId: "local", requestApproval });

async function main(): Promise<void> {
  // Warm up the selected browser driver so the extension WebSocket server
  // (when TV_BROWSER_DRIVER=extension) is listening before any tool call.
  await getBrowserDriver().catch((e) => {
    logger.warn({ err: String(e) }, "Browser driver warmup failed (continuing)");
  });

  // Start the dashboard in the same process so approvals work in-memory.
  await startDashboard(DASHBOARD_PORT).catch((e) => {
    logger.warn({ err: String(e) }, "Dashboard failed to start (continuing without it)");
  });

  // Optional Streamable HTTP transport alongside STDIO.
  const httpTransport = await startHttpTransportIfEnabled(server, HTTP_MCP_PORT).catch((e) => {
    logger.warn({ err: String(e) }, "HTTP MCP transport failed to start (continuing)");
    return undefined;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  audit({ ts: new Date().toISOString(), tool: "server_start", result: "ok" });
  logger.info({ dashboardPort: DASHBOARD_PORT, httpMcpPort: httpTransport ? HTTP_MCP_PORT : null }, "tradingview-chrome-mcp started");

  const shutdown = async (sig: string) => {
    logger.info({ sig }, "shutting down");
    cancelAllPending();
    if (httpTransport) {
      await httpTransport.dispose?.().catch(() => {});
    }
    audit({ ts: new Date().toISOString(), tool: "server_stop", result: "ok" });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.error({ err: String(e) }, "fatal startup error");
  process.exit(1);
});

export { server };
