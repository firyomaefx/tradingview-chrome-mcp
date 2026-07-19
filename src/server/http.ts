/**
 * Optional Streamable HTTP transport for the MCP server.
 *
 * Enabled with TV_MCP_HTTP_PORT (default 3940). Binds to 127.0.0.1 only.
 * The tool registry/adapter are transport-agnostic; this file just wires the
 * existing Server instance to the MCP Streamable HTTP transport so clients
 * can connect over HTTP in addition to STDIO.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { logger } from "../logging/logger.js";

export interface HttpTransportHandle {
  dispose: () => Promise<void>;
}

export async function startHttpTransportIfEnabled(server: Server, port: number): Promise<HttpTransportHandle | undefined> {
  if (!process.env.TV_MCP_HTTP_PORT && !process.env.TV_ENABLE_HTTP_MCP) {
    return undefined;
  }

  const bindHost = "127.0.0.1";
  const isLocalhostOnly = true;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS: restrict to localhost origins when bound to localhost.
    const origin = req.headers.origin ?? "";
    if (isLocalhostOnly && origin && !/^https?:\/\/127\.0\.0\.1(:\d+)?$|^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      res.writeHead(403).end("origin not allowed");
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    // The Streamable HTTP transport expects the raw body to be passed in.
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    await new Promise<void>((resolve) => req.on("end", resolve));
    const raw = Buffer.concat(chunks);
    let parsedBody: unknown = undefined;
    if (raw.length > 0) {
      try { parsedBody = JSON.parse(raw.toString("utf8")); } catch { /* let transport handle parse error */ }
    }

    try {
      await transport.handleRequest(req, res, parsedBody);
    } catch (e) {
      logger.error({ err: String(e) }, "HTTP MCP request failed");
      if (!res.headersSent) {
        res.writeHead(500).end("Internal Server Error");
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, bindHost, () => {
      logger.info({ port, host: bindHost, localhostOnly: isLocalhostOnly }, "MCP HTTP transport listening");
      resolve();
    });
    httpServer.once("error", reject);
  });

  return {
    dispose: () => new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      transport.onclose?.();
    }),
  };
}
