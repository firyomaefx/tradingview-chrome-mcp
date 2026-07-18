/**
 * Hosted MCP server factory.
 *
 * Creates a per-client MCP server bound to a specific user/API key. All tool
 * executions are wrapped with privacy-first telemetry using the configured
 * allow-list.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { redactParameters, logUsage } from "@/lib/telemetry/telemetry";
import { loadFeatureFlags } from "@/lib/features/flags";
import type { ToolDef, ToolContext, ToolResult } from "@/lib/tools/registry";

export interface ServerContext {
  userId: string;
  requestApproval: (message: string) => Promise<boolean>;
  clientId?: string;
  detectedClient?: import("@/lib/detect/client").DetectedClient;
}

export interface ToolRegistry {
  getAllTools: () => ToolDef[];
  runTool: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function createMcpServer(registry: ToolRegistry, context: ServerContext) {
  const server = new Server(
    { name: "tradingview-chrome-mcp-hosted", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: registry.getAllTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: {
          destructiveHint: t.destructive,
          readOnlyHint: !t.destructive && !["emergency_stop"].includes(t.name),
          idempotentHint: ["ping", "tv_status", "tv_read_chart", "browser_status", "mcp_client_info"].includes(t.name),
        },
      })),
    };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};

      if (typeof name !== "string") {
        return {
          content: [{ type: "text", text: "Missing tool name" }],
          isError: true,
        };
      }

      const flags = await loadFeatureFlags();

      const def = registry.getAllTools().find((t) => t.name === name);
      if (def) {
        if (flags.readOnlyMode && def.destructive) {
          return {
            content: [{ type: "text", text: "BLOCKED: server is in read-only mode" }],
            isError: true,
          };
        }
        if (flags.disableDestructiveTools && def.destructive) {
          return {
            content: [{ type: "text", text: "BLOCKED: destructive tools are disabled" }],
            isError: true,
          };
        }
      }

      const start = Date.now();
      let success = false;
      let errorMessage: string | undefined;

      try {
        const result = await registry.runTool(name, args, {
          requestApproval: context.requestApproval,
          detectedClient: context.detectedClient,
        });

        success = result.ok && !result.denied && !result.blocked;

        if (result.denied) {
          errorMessage = result.error;
          return {
            content: [{ type: "text", text: `DENIED: ${result.error}` }],
            isError: true,
          };
        }
        if (result.blocked) {
          errorMessage = result.error;
          return {
            content: [{ type: "text", text: `BLOCKED: ${result.error}` }],
            isError: true,
          };
        }
        if (!result.ok) {
          errorMessage = result.error ?? "unknown";
          return {
            content: [{ type: "text", text: `ERROR: ${errorMessage}` }],
            isError: true,
          };
        }

        const text = JSON.stringify(result.data ?? { ok: true }, null, 2);
        const content: { type: "text"; text: string }[] = [{ type: "text", text }];
        if (result.screenshot) {
          content.push({ type: "text", text: `Screenshot: ${result.screenshot}` });
        }
        return { content };
      } catch (e) {
        const err = (e as Error).message ?? String(e);
        errorMessage = err;
        return {
          content: [{ type: "text", text: `ERROR: ${err}` }],
          isError: true,
        };
      } finally {
        const duration = Date.now() - start;
        logUsage({
          user_id: context.userId,
          tool_name: name,
          parameters: redactParameters(name, args),
          client_id: context.clientId,
          duration_ms: duration,
          success,
          error_message: errorMessage,
        });
      }
    }
  );

  return server;
}
