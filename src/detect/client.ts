/**
 * Detect the LLM / MCP client that launched this STDIO server.
 *
 * When the MCP server runs over STDIO, the parent process is the host
 * application (Claude Desktop, Claude Code, Codex, ChatGPT, Cursor, etc.).
 * This module inspects the parent process chain to identify that host.
 *
 * No conversation data, prompts, or secrets are read. Only process metadata
 * (name, command line, executable path) is inspected.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logging/logger.js";

const execAsync = promisify(exec);

export interface DetectedClient {
  name: string;
  kind: "claude-desktop" | "claude-code" | "codex" | "chatgpt" | "cursor" | "windsurf" | "vscode" | "jetbrains" | "generic" | "unknown";
  executable?: string;
  commandLine?: string;
  pid?: number;
  ppid?: number;
  confidence: "high" | "medium" | "low";
}

const KNOWN_CLIENTS: { pattern: RegExp; name: string; kind: DetectedClient["kind"]; confidence: "high" | "medium" }[] = [
  // Anthropic clients
  { pattern: /[\\/]Claude\.exe/i, name: "Claude Desktop", kind: "claude-desktop", confidence: "high" },
  { pattern: /[\\/]Claude[^\\/]*\.app\//i, name: "Claude Desktop", kind: "claude-desktop", confidence: "high" },
  { pattern: /\bclaude\b.*\bmcp\b/i, name: "Claude Code", kind: "claude-code", confidence: "high" },
  { pattern: /\bclaude\b.*code/i, name: "Claude Code", kind: "claude-code", confidence: "medium" },

  // Anthropic / OpenAI Codex CLI
  { pattern: /\bcodex\b.*\bmcp\b/i, name: "Anthropic Codex CLI", kind: "codex", confidence: "high" },
  { pattern: /\bcodex\b/i, name: "Anthropic Codex CLI", kind: "codex", confidence: "medium" },

  // OpenAI ChatGPT desktop
  { pattern: /[\\/]ChatGPT\.exe/i, name: "ChatGPT Desktop", kind: "chatgpt", confidence: "high" },
  { pattern: /ChatGPT.*\.app/i, name: "ChatGPT Desktop", kind: "chatgpt", confidence: "high" },

  // Other popular AI IDEs / clients
  { pattern: /[\\/]Cursor\.exe/i, name: "Cursor", kind: "cursor", confidence: "high" },
  { pattern: /Cursor.*\.app/i, name: "Cursor", kind: "cursor", confidence: "high" },
  { pattern: /[\\/]Windsurf\.exe/i, name: "Windsurf", kind: "windsurf", confidence: "high" },
  { pattern: /windsurf\b/i, name: "Windsurf", kind: "windsurf", confidence: "medium" },

  // Generic VS Code with an MCP extension
  { pattern: /[\\/]Code\.exe/i, name: "VS Code (MCP extension)", kind: "vscode", confidence: "medium" },
  { pattern: /[\\/]Code - Insiders\.exe/i, name: "VS Code Insiders (MCP extension)", kind: "vscode", confidence: "medium" },

  // JetBrains IDEs
  { pattern: /jetbrains\b/i, name: "JetBrains IDE (MCP plugin)", kind: "jetbrains", confidence: "medium" },
];

export function classifyExecutable(executable: string, commandLine: string): DetectedClient | null {
  const text = `${executable} ${commandLine}`;
  for (const client of KNOWN_CLIENTS) {
    if (client.pattern.test(text)) {
      return {
        name: client.name,
        kind: client.kind,
        executable,
        commandLine,
        confidence: client.confidence,
      };
    }
  }
  return null;
}

async function getWindowsProcessInfo(pid: number): Promise<{ name?: string; executable?: string; commandLine?: string; ppid?: number } | null> {
  try {
    // Try PowerShell (more reliable on modern Windows) first, fall back to wmic.
    const psScript = `
      $p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue
      if ($p) {
        $ppid = $p.ParentProcessId
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $ppid" -ErrorAction SilentlyContinue
        [PSCustomObject]@{
          name = $p.Name
          executable = $p.ExecutablePath
          commandLine = $p.CommandLine
          ppid = $ppid
          parentName = $parent.Name
          parentExecutable = $parent.ExecutablePath
          parentCommandLine = $parent.CommandLine
        } | ConvertTo-Json -Compress
      }
    `;
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`, { timeout: 5_000 });
    const parsed = JSON.parse(stdout.trim());
    return {
      name: parsed.name ?? undefined,
      executable: parsed.executable ?? undefined,
      commandLine: parsed.commandLine ?? undefined,
      ppid: parsed.ppid ?? undefined,
    };
  } catch (e) {
    logger.debug({ err: String(e), pid }, "PowerShell process lookup failed");
  }

  try {
    const { stdout } = await execAsync(`wmic process where ProcessId=${pid} get Name,ExecutablePath,CommandLine,ParentProcessId /format:csv`, { timeout: 5_000 });
    const lines = stdout.trim().split(/\r?\n/).filter((l) => l && !l.startsWith("Node"));
    if (lines.length < 2) return null;
    const line = lines[1];
    if (!line) return null;
    const parts = line.split(",");
    if (parts.length < 4) return null;
    // CSV columns vary; take the last four meaningful values.
    return {
      name: parts[parts.length - 4]?.trim() || undefined,
      executable: parts[parts.length - 3]?.trim() || undefined,
      commandLine: parts[parts.length - 2]?.trim() || undefined,
      ppid: Number(parts[parts.length - 1]) || undefined,
    };
  } catch (e) {
    logger.debug({ err: String(e), pid }, "wmic process lookup failed");
    return null;
  }
}

async function getUnixProcessInfo(pid: number): Promise<{ name?: string; executable?: string; commandLine?: string; ppid?: number } | null> {
  try {
    const { stdout } = await execAsync(`ps -p ${pid} -o ppid=,comm=,args= 2>/dev/null`, { timeout: 3_000 });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return null;
    return {
      ppid: Number(match[1]),
      name: match[2],
      executable: match[2],
      commandLine: match[3],
    };
  } catch (e) {
    logger.debug({ err: String(e), pid }, "ps process lookup failed");
    return null;
  }
}

async function getProcessInfo(pid: number): Promise<{ name?: string; executable?: string; commandLine?: string; ppid?: number } | null> {
  if (process.platform === "win32") return getWindowsProcessInfo(pid);
  return getUnixProcessInfo(pid);
}

/**
 * Walk up the process tree looking for a known LLM/MCP host.
 * Returns the most confidently matched ancestor, or the immediate parent if no match.
 */
export async function detectMcpClient(): Promise<DetectedClient> {
  const chain: { pid: number; info: Awaited<ReturnType<typeof getProcessInfo>> }[] = [];
  let pid = process.ppid;
  let depth = 0;
  const maxDepth = 6;

  while (pid && pid !== 0 && depth < maxDepth) {
    const info = await getProcessInfo(pid);
    if (!info) break;
    chain.push({ pid, info });

    if (info.executable && info.commandLine != null) {
      const classified = classifyExecutable(info.executable, info.commandLine);
      if (classified) {
        classified.pid = pid;
        classified.ppid = info.ppid;
        return classified;
      }
    }

    pid = info.ppid ?? 0;
    depth++;
  }

  // No known client found; return the immediate parent as "unknown" for observability.
  const immediate = chain[0];
  if (immediate?.info) {
    return {
      name: immediate.info.name || "Unknown process",
      kind: "unknown",
      pid: immediate.pid,
      ppid: immediate.info.ppid,
      executable: immediate.info.executable,
      commandLine: immediate.info.commandLine,
      confidence: "low",
    };
  }

  return {
    name: "Unknown",
    kind: "unknown",
    confidence: "low",
  };
}

/**
 * Lightweight synchronous check for the most common Windows clients.
 * Uses environment variable hints set by some clients.
 */
export function detectClientFromEnv(): Partial<DetectedClient> {
  const env = process.env;

  if (env.CLAUDE_CODE) return { name: "Claude Code", kind: "claude-code", confidence: "high" };
  if (env.CODEX_MCP || env.CODEX_SESSION) return { name: "Anthropic Codex CLI", kind: "codex", confidence: "high" };

  return {};
}
