import { type NextRequest } from "next/server";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types";
import { validateKey } from "@/lib/auth/api-keys";
import { getSession, refreshSession } from "@/lib/sessions/store";
import { getSessionClient } from "@/app/api/sse/route";
import { checkRateLimit } from "@/lib/rate-limit/limiter";
import { messagesQueryParams } from "@/lib/validation/schemas";

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
  if ((req.url?.length ?? 0) > 8_192) {
    return new Response("Bad request: URL too long", { status: 400 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 2 * 1024 * 1024) {
    return new Response("Bad request: body too large", { status: 413 });
  }

  const { searchParams } = new URL(req.url);
  const queryParse = messagesQueryParams.safeParse({
    key: searchParams.get("key"),
    sessionId: searchParams.get("sessionId"),
    client: searchParams.get("client") ?? undefined,
  });
  if (!queryParse.success) {
    return new Response(`Bad request: ${queryParse.error.issues.map((i) => i.message).join(", ")}`, { status: 400 });
  }
  const { key, sessionId, client: clientParam } = queryParse.data;

  const apiKey = await validateKey(key);
  if (!apiKey) {
    return new Response("Unauthorized: invalid key", { status: 401 });
  }

  // Rate limit per API key before doing anything expensive.
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
  const sessionClient = getSessionClient(sessionId);
  const fallbackClient = clientParam
    ? {
        name: `Remote client (${clientParam})`,
        clientId: clientParam,
        confidence: "medium" as const,
        source: "query" as const,
      }
    : {
        name: "Remote SSE MCP client",
        clientId: "unknown",
        confidence: "low" as const,
        source: "default" as const,
      };
  const client = sessionClient ?? fallbackClient;

  if (client.source !== "default") {
    console.log("[messages] client identity:", client.clientId, client.source, client.confidence);
  }

  let body: JSONRPCMessage;
  try {
    body = (await req.json()) as JSONRPCMessage;
  } catch (e) {
    return new Response(`Bad request: invalid JSON (${(e as Error).message})`, { status: 400 });
  }

  transport.handlePostMessage(body);
  await refreshSession(sessionId);

  return new Response("Accepted", {
    status: 202,
    headers: {
      "X-RateLimit-Limit": String(limit.limit),
      "X-RateLimit-Remaining": String(limit.remaining),
      "X-RateLimit-Reset": limit.resetAt.toISOString(),
    },
  });
}
