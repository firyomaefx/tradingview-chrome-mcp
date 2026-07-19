/**
 * Flexible MCP server factory.
 *
 * Builds an MCP Server instance with:
 * - Pluggable tool registry (browser, market-data-api, mock).
 * - Per-client attribution via `userId` baked into the request context.
 * - Privacy-first telemetry allow-list logging.
 * - Feature-flag gated tool execution.
 *
 * The local entrypoint passes the Playwright-backed registry; the Vercel-hosted
 * fork passes a registry backed by a market-data API or mock.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { redactParameters, logUsage } from "../telemetry/telemetry.js";

function redactError(message?: string): string | undefined {
  if (!message) return undefined;
  let trimmed = message.slice(0, 200);
  trimmed = trimmed.replace(/https?:\/\/[^\s]+/g, "[url]");
  return trimmed;
}
import { loadFeatureFlags } from "../features/flags.js";
import type { ToolDef, ToolContext, ToolResult } from "../tools/registry.js";

export interface ServerContext {
  userId: string;
  requestApproval: (message: string) => Promise<boolean>;
}

export interface ToolRegistry {
  getAllTools: () => ToolDef[];
  runTool: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function createMcpServer(registry: ToolRegistry, context: ServerContext) {
  const server = new Server(
    { name: "tradingview-chrome-mcp", version: "0.2.0" },
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
          readOnlyHint:
            !t.destructive && !["emergency_stop"].includes(t.name),
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
        const content: { type: "text"; text: string }[] = [
          { type: "text", text },
        ];
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
          duration_ms: duration,
          success,
          error_message: redactError(errorMessage),
        });
      }
    }
  );

  return server;
}
