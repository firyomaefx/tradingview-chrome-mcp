import assert from "node:assert";
import { describe, it } from "node:test";
import { detectRemoteClient } from "@/lib/detect/client";

function headers(entries?: Record<string, string>): Headers {
  return new Headers(entries ?? {});
}

describe("detectRemoteClient header detection", () => {
  it("detects Claude Desktop from User-Agent", () => {
    const result = detectRemoteClient("Mozilla/5.0 Claude/1.2.3", headers(), null);
    assert.equal(result.clientId, "claude-desktop");
    assert.equal(result.confidence, "high");
    assert.equal(result.source, "header");
    assert.equal(result.name, "Claude Desktop");
  });

  it("detects Claude from X-Client-Name header", () => {
    const result = detectRemoteClient("Mozilla/5.0", headers({ "x-client-name": "Claude" }), null);
    assert.equal(result.clientId, "claude-desktop");
    assert.equal(result.source, "header");
  });

  it("detects Claude Code from X-Client-Name header", () => {
    const result = detectRemoteClient("", headers({ "x-client-name": "claude-code" }), null);
    assert.equal(result.clientId, "claude-code");
    assert.equal(result.name, "Claude Code");
  });

  it("detects Anthropic Codex CLI from User-Agent", () => {
    const result = detectRemoteClient("Mozilla/5.0 Codex/0.1", headers(), null);
    assert.equal(result.clientId, "codex");
    assert.equal(result.confidence, "high");
    assert.equal(result.source, "header");
  });

  it("detects Codex from X-Client-Name header", () => {
    const result = detectRemoteClient("", headers({ "x-client-name": "codex" }), null);
    assert.equal(result.clientId, "codex");
  });

  it("detects ChatGPT Desktop from User-Agent", () => {
    const result = detectRemoteClient("ChatGPT/1.0.0", headers(), null);
    assert.equal(result.clientId, "chatgpt");
    assert.equal(result.source, "header");
  });

  it("detects ChatGPT from X-Client-Name header", () => {
    const result = detectRemoteClient("", headers({ "x-client-name": "chatgpt" }), null);
    assert.equal(result.clientId, "chatgpt");
  });

  it("detects Cursor from User-Agent", () => {
    const result = detectRemoteClient("Cursor/0.45", headers(), null);
    assert.equal(result.clientId, "cursor");
    assert.equal(result.source, "header");
  });

  it("detects Windsurf from User-Agent", () => {
    const result = detectRemoteClient("Windsurf/1.0", headers(), null);
    assert.equal(result.clientId, "windsurf");
  });

  it("detects OpenCode from User-Agent", () => {
    const result = detectRemoteClient("OpenCode/1.0", headers(), null);
    assert.equal(result.clientId, "opencode");
  });

  it("detects Manus from User-Agent", () => {
    const result = detectRemoteClient("Mozilla/5.0 Manus/1.0", headers(), null);
    assert.equal(result.clientId, "manus");
  });

  it("detects generic OpenAI-compatible client", () => {
    const result = detectRemoteClient("OpenAI/1.0 helper", headers(), null);
    assert.equal(result.clientId, "openai-generic");
    assert.equal(result.confidence, "medium");
  });
});

describe("detectRemoteClient query fallback", () => {
  it("uses ?client query param when headers are generic", () => {
    const result = detectRemoteClient("Mozilla/5.0", headers(), "claude");
    assert.equal(result.clientId, "claude");
    assert.equal(result.source, "query");
    assert.equal(result.confidence, "medium");
  });

  it("headers win over query param when both present", () => {
    const result = detectRemoteClient("Cursor/1.0", headers(), "chatgpt");
    assert.equal(result.clientId, "cursor");
    assert.equal(result.source, "header");
  });

  it("lowercases and normalizes query param", () => {
    const result = detectRemoteClient("", headers(), "ChatGPT-Desktop");
    assert.equal(result.clientId, "chatgpt-desktop");
  });

  it("rejects invalid query characters", () => {
    const result = detectRemoteClient("", headers(), "../etc/passwd");
    assert.equal(result.clientId, "unknown");
    assert.equal(result.source, "default");
  });

  it("rejects overly long query values", () => {
    const result = detectRemoteClient("", headers(), "a".repeat(100));
    assert.equal(result.clientId, "unknown");
  });
});

describe("detectRemoteClient default", () => {
  it("returns unknown for blank headers and no query", () => {
    const result = detectRemoteClient("", headers(), null);
    assert.equal(result.clientId, "unknown");
    assert.equal(result.confidence, "low");
    assert.equal(result.source, "default");
    assert.equal(result.name, "Remote SSE MCP client");
  });
});
