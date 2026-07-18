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
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../logging/logger.js";
import { audit } from "../logging/logger.js";
import { allTools, runTool } from "../tools/registry.js";
import { isEmergencyStopped } from "../permissions/policy.js";
import { createApproval, listPending, listHistory, resolveApproval, cancelAllPending, awaitApproval } from "../permissions/approvals.js";
import { startDashboard } from "../dashboard/server.js";
import { startHttpTransportIfEnabled } from "./http.js";

const APPROVAL_TIMEOUT_MS = Number(process.env.TV_APPROVAL_TIMEOUT_MS ?? 120_000);
const AUTO_APPROVE = process.env.TV_AUTO_APPROVE_DESTRUCTIVE === "1";
const DASHBOARD_PORT = Number(process.env.TV_DASHBOARD_PORT ?? 3939);
const HTTP_MCP_PORT = Number(process.env.TV_MCP_HTTP_PORT ?? 3940);

interface CallToolRequest {
  params: { name: string; arguments?: Record<string, unknown> | undefined };
}

const server = new Server(
  { name: "tradingview-chrome-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      // Hint: tools marked destructive require dashboard approval.
      annotations: {
        destructiveHint: t.destructive,
        readOnlyHint: !t.destructive && !["emergency_stop"].includes(t.name),
        idempotentHint: ["ping", "tv_status", "browser_status"].includes(t.name),
      },
    })),
  };
});

async function requestApproval(message: string): Promise<boolean> {
  if (AUTO_APPROVE) return true;
  // Find which tool is calling by inspecting the most-recent tool name passed in.
  const a = createApproval("(destructive)", message);
  logger.info({ approval: a.id, message }, "awaiting approval");
  return awaitApproval(a.id, APPROVAL_TIMEOUT_MS);
}

server.setRequestHandler(CallToolRequestSchema, async (req: CallToolRequest) => {
  const name = req.params?.name;
  const args = req.params?.arguments ?? {};
  if (typeof name !== "string") {
    return { content: [{ type: "text", text: "Missing tool name" }], isError: true };
  }
  const result = await runTool(name, args, { requestApproval });
  if (result.denied) {
    return { content: [{ type: "text", text: `DENIED: ${result.error}` }], isError: true };
  }
  if (result.blocked) {
    return { content: [{ type: "text", text: `BLOCKED: ${result.error}` }], isError: true };
  }
  if (!result.ok) {
    return { content: [{ type: "text", text: `ERROR: ${result.error ?? "unknown"}` }], isError: true };
  }
  const text = JSON.stringify(result.data ?? { ok: true }, null, 2);
  const content: import("@modelcontextprotocol/sdk/types.js").ContentBlock[] = [
    { type: "text", text },
  ];
  if (result.screenshot) {
    content.push({ type: "text", text: `Screenshot: ${result.screenshot}` });
  }
  return { content };
});

async function main(): Promise<void> {
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
