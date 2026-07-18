/**
 * Detect the LLM / MCP client that connected to the hosted SSE endpoint.
 *
 * Unlike the local server, we cannot walk the parent process tree on Vercel.
 * Instead we inspect HTTP headers (User-Agent and custom X-* headers) and fall
 * back to an explicit `client` query parameter supplied by the user.
 *
 * This is a best-effort classifier. Some clients may send identifiable
 * signatures; others will require the caller to append `?client=...`.
 */

export interface DetectedClient {
  name: string;
  clientId: string;
  confidence: "high" | "medium" | "low";
  source: "header" | "query" | "default";
}

const KNOWN_CLIENTS: {
  test: (userAgent: string, headers: Headers) => boolean;
  name: string;
  clientId: string;
  confidence: "high" | "medium";
}[] = [
  // Anthropic clients
  {
    test: (ua) => /\bClaude\b/i.test(ua) || /\bAnthropic\b/i.test(ua),
    name: "Claude Desktop",
    clientId: "claude-desktop",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bclaude\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Claude Desktop",
    clientId: "claude-desktop",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bclaude[-_]?code\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Claude Code",
    clientId: "claude-code",
    confidence: "high",
  },

  // Anthropic / OpenAI Codex CLI
  {
    test: (ua) => /\bCodex\b/i.test(ua),
    name: "Anthropic Codex CLI",
    clientId: "codex",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bcodex\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Anthropic Codex CLI",
    clientId: "codex",
    confidence: "high",
  },

  // OpenAI ChatGPT desktop / wrappers
  {
    test: (ua) => /\bChatGPT\b/i.test(ua),
    name: "ChatGPT Desktop",
    clientId: "chatgpt",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bchatgpt\b/i.test(headers.get("x-client-name") ?? ""),
    name: "ChatGPT Desktop",
    clientId: "chatgpt",
    confidence: "high",
  },

  // Cursor
  {
    test: (ua) => /\bCursor\b/i.test(ua),
    name: "Cursor",
    clientId: "cursor",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bcursor\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Cursor",
    clientId: "cursor",
    confidence: "high",
  },

  // Windsurf
  {
    test: (ua) => /\bWindsurf\b/i.test(ua),
    name: "Windsurf",
    clientId: "windsurf",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bwindsurf\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Windsurf",
    clientId: "windsurf",
    confidence: "high",
  },

  // OpenCode
  {
    test: (ua) => /\bOpenCode\b/i.test(ua),
    name: "OpenCode",
    clientId: "opencode",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bopencode\b/i.test(headers.get("x-client-name") ?? ""),
    name: "OpenCode",
    clientId: "opencode",
    confidence: "high",
  },

  // Manus
  {
    test: (ua) => /\bManus\b/i.test(ua),
    name: "Manus",
    clientId: "manus",
    confidence: "high",
  },
  {
    test: (_ua, headers) =>
      /\bmanus\b/i.test(headers.get("x-client-name") ?? ""),
    name: "Manus",
    clientId: "manus",
    confidence: "high",
  },

  // Generic OpenAI-ish wrappers (low confidence)
  {
    test: (ua) => /\bOpenAI\b/i.test(ua),
    name: "OpenAI-compatible client",
    clientId: "openai-generic",
    confidence: "medium",
  },
];

function normalizeClientId(raw: string | null): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  if (!id || id.length > 64) return null;
  // Allow alphanumerics, dash, underscore only.
  if (!/^[a-z0-9_-]+$/.test(id)) return null;
  return id;
}

export function detectRemoteClient(
  userAgent: string,
  headers: Headers,
  clientQuery: string | null
): DetectedClient {
  // 1. Header / User-Agent inspection.
  const ua = userAgent ?? "";
  for (const client of KNOWN_CLIENTS) {
    if (client.test(ua, headers)) {
      return {
        name: client.name,
        clientId: client.clientId,
        confidence: client.confidence,
        source: "header",
      };
    }
  }

  // 2. Query parameter fallback.
  const queryId = normalizeClientId(clientQuery);
  if (queryId) {
    return {
      name: `Remote client (${queryId})`,
      clientId: queryId,
      confidence: "medium",
      source: "query",
    };
  }

  // 3. Default fallback.
  return {
    name: "Remote SSE MCP client",
    clientId: "unknown",
    confidence: "low",
    source: "default",
  };
}
