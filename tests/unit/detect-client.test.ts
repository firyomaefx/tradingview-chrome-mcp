/**
 * Unit tests for the MCP client detection module.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyExecutable, detectClientFromEnv } from "../../src/detect/client.js";

describe("detect client from executable/command line", () => {
  it("classifies Claude Desktop on Windows", () => {
    const result = classifyExecutable(
      "C:\\Users\\User\\AppData\\Local\\AnthropicClaude\\Claude.exe",
      "C:\\Users\\User\\AppData\\Local\\AnthropicClaude\\Claude.exe"
    );
    assert.ok(result);
    assert.equal(result?.kind, "claude-desktop");
    assert.equal(result?.confidence, "high");
  });

  it("classifies Claude Code CLI", () => {
    const result = classifyExecutable(
      "/usr/local/bin/claude",
      "claude mcp run node dist/server/index.js"
    );
    assert.ok(result);
    assert.equal(result?.kind, "claude-code");
  });

  it("classifies Codex CLI", () => {
    const result = classifyExecutable(
      "/usr/local/bin/codex",
      "codex mcp add tradingview-chrome-mcp node dist/server/index.js"
    );
    assert.ok(result);
    assert.equal(result?.kind, "codex");
  });

  it("classifies ChatGPT Desktop", () => {
    const result = classifyExecutable(
      "C:\\Program Files\\ChatGPT\\ChatGPT.exe",
      "C:\\Program Files\\ChatGPT\\ChatGPT.exe"
    );
    assert.ok(result);
    assert.equal(result?.kind, "chatgpt");
  });

  it("classifies Cursor", () => {
    const result = classifyExecutable(
      "C:\\Users\\User\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
      "Cursor.exe"
    );
    assert.ok(result);
    assert.equal(result?.kind, "cursor");
  });

  it("classifies VS Code when no stronger match", () => {
    const result = classifyExecutable(
      "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "Code.exe --extensionDevelopmentPath=..."
    );
    assert.ok(result);
    assert.equal(result?.kind, "vscode");
  });

  it("returns null for unknown executables", () => {
    const result = classifyExecutable("C:\\Windows\\System32\\cmd.exe", "cmd.exe /c echo hello");
    assert.equal(result, null);
  });
});

describe("detect client from env", () => {
  it("detects Claude Code from env", () => {
    const original = process.env.CLAUDE_CODE;
    process.env.CLAUDE_CODE = "1";
    try {
      const result = detectClientFromEnv();
      assert.equal(result.kind, "claude-code");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_CODE;
      else process.env.CLAUDE_CODE = original;
    }
  });

  it("detects Codex from env", () => {
    const original = process.env.CODEX_MCP;
    process.env.CODEX_MCP = "1";
    try {
      const result = detectClientFromEnv();
      assert.equal(result.kind, "codex");
    } finally {
      if (original === undefined) delete process.env.CODEX_MCP;
      else process.env.CODEX_MCP = original;
    }
  });
});

describe("detectMcpClient", () => {
  it("returns a result without throwing", async () => {
    const { detectMcpClient } = await import("../../src/detect/client.js");
    const client = await detectMcpClient();
    assert.ok(typeof client.name === "string");
    assert.ok(typeof client.kind === "string");
    assert.ok(["high", "medium", "low"].includes(client.confidence));
  });
});
