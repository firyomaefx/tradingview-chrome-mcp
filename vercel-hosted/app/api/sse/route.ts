import { type NextRequest } from "next/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types";
import { createMcpServer, type ToolRegistry } from "@/lib/server/mcp-server";
import { validateKey, type ApiKey } from "@/lib/auth/api-keys";
import { createSession, deleteSession } from "@/lib/sessions/store";
import { createHostedRegistry, clearSessionState, type ToolDef } from "@/lib/tools/registry";
import { detectRemoteClient, type DetectedClient } from "@/lib/detect/client";
import { checkRateLimit } from "@/lib/rate-limit/limiter";
import { sseQueryParams } from "@/lib/validation/schemas";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

interface Session {
  transport: AppRouterSSETransport;
  key: string;
  client: DetectedClient;
}

// Global session registry. In production, sessions are also persisted to Redis
// by createSession/deleteSession so multiple regions/invocations can find them.
const sessions = new Map<string, Session>();

class AppRouterSSETransport {
  // Structural match for the MCP Transport interface without importing the type.
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat?: NodeJS.Timeout;

  constructor(controller: ReadableStreamDefaultController<Uint8Array>, key: string, client: DetectedClient) {
    this.sessionId = crypto.randomUUID();
    this.controller = controller;
    sessions.set(this.sessionId, { transport: this, key, client });
    createSession(this.sessionId, key).catch((err) => {
      console.error("[sse] failed to persist session:", err);
    });
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    const payload = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    try {
      this.controller.enqueue(encoder.encode(payload));
    } catch (e) {
      this.onerror?.(e as Error);
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    try {
      this.controller.close();
    } catch {}
    sessions.delete(this.sessionId);
    clearSessionState(this.sessionId);
    deleteSession(this.sessionId).catch(() => {});
    this.onclose?.();
  }

  handlePostMessage(raw: unknown): void {
    this.onmessage?.(raw as JSONRPCMessage);
  }
}

function buildRegistry(apiKey: ApiKey, sessionId: string, client: DetectedClient): ToolRegistry {
  const registry = createHostedRegistry(sessionId);
  const tools: ToolDef[] = apiKey.allowed_tools
    ? registry.getAllTools().filter((t) => apiKey.allowed_tools!.includes(t.name))
    : registry.getAllTools();

  return {
    getAllTools: () => tools,
    runTool: async (name, args, ctx) => {
      const result = await registry.runTool(name, args, { ...ctx, detectedClient: client });
      return result;
    },
  };
}

function requestApproval(message: string): Promise<boolean> {
  // Hosted/serverless mode has no interactive dashboard. Either auto-approve
  // (when explicitly configured) or deny destructive actions by default.
  if (config.approvalAutoDestructive) {
    console.log("[approval] auto-approved:", message);
    return Promise.resolve(true);
  }
  console.log("[approval] denied (approvalAutoDestructive=false):", message);
  return Promise.resolve(false);
}

export async function GET(req: NextRequest) {
  // Reject oversized URLs early; NextRequest url is capped by the platform but
  // explicit guard keeps the parser safe from huge query strings.
  if ((req.url?.length ?? 0) > 8_192) {
    return new Response("Bad request: URL too long", { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const queryParse = sseQueryParams.safeParse({
    key: searchParams.get("key"),
    client: searchParams.get("client") ?? undefined,
  });
  if (!queryParse.success) {
    return new Response(`Bad request: ${queryParse.error.issues.map((i) => i.message).join(", ")}`, { status: 400 });
  }
  const { key, client: clientParam } = queryParse.data;

  const apiKey = await validateKey(key);
  if (!apiKey) {
    return new Response("Unauthorized: invalid key", { status: 401 });
  }

  // Rate limit per API key before performing any expensive work.
  const limit = await checkRateLimit(apiKey);
  if (!limit.allowed) {
    return new Response(
      `Rate limit exceeded. Try again after ${limit.resetAt.toISOString()}.`,
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(limit.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": limit.resetAt.toISOString(),
        },
      }
    );
  }

  // Detect the connecting LLM / MCP client from headers or query param.
  const client = detectRemoteClient(
    req.headers.get("user-agent") ?? "",
    req.headers,
    clientParam
  );
  console.log("[sse] detected client:", client.clientId, client.source, client.confidence);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const transport = new AppRouterSSETransport(controller, key, client);
      const registry = buildRegistry(apiKey, transport.sessionId, client);
      const server = createMcpServer(registry, {
        userId: apiKey.label ?? apiKey.id,
        requestApproval,
        clientId: client.clientId,
        detectedClient: client,
      });

      server.connect(transport).catch((err) => {
        console.error("[sse] server connect error:", err);
        transport.close().catch(() => {});
      });

      controller.enqueue(
        encoder.encode(
          `event: endpoint\ndata: /api/messages?sessionId=${transport.sessionId}&key=${encodeURIComponent(key)}\n\n`
        )
      );

      transport.heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          transport.close().catch(() => {});
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        transport.close().catch(() => {});
      });
    },
    cancel() {
      // Cleanup handled by abort listener.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-RateLimit-Limit": String(limit.limit),
      "X-RateLimit-Remaining": String(limit.remaining),
      "X-RateLimit-Reset": limit.resetAt.toISOString(),
    },
  });
}

// Helper used by /api/messages to resolve the client for a session.
export function getSessionClient(sessionId: string): DetectedClient | undefined {
  return sessions.get(sessionId)?.client;
}
