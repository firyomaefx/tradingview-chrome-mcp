import { type NextRequest } from "next/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types";
import { validateKey } from "@/lib/auth/api-keys";
import { getSession, refreshSession } from "@/lib/sessions/store";
import { getSessionClient } from "@/app/api/sse/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// In-memory fallback registry for this function instance. The Redis session
// store is authoritative; this map is only a local cache to avoid Redis reads
// when the same instance handles both SSE and POST.
declare global {
  // eslint-disable-next-line no-var
  var __mcpSessionTransports: Map<
    string,
    { handlePostMessage(raw: unknown): void }
  > | undefined;
}

const localTransports = globalThis.__mcpSessionTransports ?? new Map();
globalThis.__mcpSessionTransports = localTransports;

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const sessionId = searchParams.get("sessionId");

  if (!key) {
    return new Response("Unauthorized: missing key", { status: 401 });
  }

  const apiKey = await validateKey(key);
  if (!apiKey) {
    return new Response("Unauthorized: invalid key", { status: 401 });
  }

  if (!sessionId) {
    return new Response("Bad request: missing sessionId", { status: 400 });
  }

  // Fast path: transport is in this function instance.
  let transport = localTransports.get(sessionId);

  // Slow path: look up session in Redis and fail if missing/expired.
  if (!transport) {
    const session = await getSession(sessionId);
    if (!session || session.key !== key) {
      return new Response("Session not found", { status: 404 });
    }
    // The transport lives in the SSE function instance; this POST cannot reach it
    // directly across regions. Return 409 Conflict so the client reconnects.
    return new Response(
      "Session transport is not available on this instance; please reconnect via /api/sse",
      { status: 409 }
    );
  }

  // Best-effort remote client detection for this request. Usually the client
  // identity is established during SSE connection and is unchanged; this path
  // catches standalone POST probes or clients that re-send identifying headers.
  const fallbackClient = {
    clientId: searchParams.get("client") ?? "unknown",
    source: searchParams.has("client") ? "query" : "default",
    confidence: searchParams.has("client") ? "medium" : "low",
    name: searchParams.has("client")
      ? `Remote client (${searchParams.get("client")})`
      : "Remote SSE MCP client",
  } as const;
  const client = getSessionClient(sessionId) ?? fallbackClient;

  if (client.source !== "default") {
    console.log("[messages] client identity:", client.clientId, client.source, client.confidence);
  }

  const body = (await req.json()) as JSONRPCMessage;
  transport.handlePostMessage(body);
  await refreshSession(sessionId);

  return new Response("Accepted", { status: 202 });
}
