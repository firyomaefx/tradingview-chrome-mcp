/**
 * Structured audit + runtime logger.
 *
 * Audit log:  append-only JSONL of every MCP action and its result.
 * Runtime log: rotating pretty logs for debugging.
 *
 * Secrets are never logged; see redact().
 */
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";

const hereDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(hereDir, "..", "..");
// When distributed as a standalone executable the code runs from a temporary
// extraction directory. TV_DATA_DIR lets the user (or the executable bootstrap)
// redirect persistent artifacts (logs, backups, screenshots) to a stable path.
const dataDir = process.env.TV_DATA_DIR ? process.env.TV_DATA_DIR : projectRoot;
const logsDir = join(dataDir, "logs");
const auditPath = join(logsDir, "audit.jsonl");

mkdirSync(logsDir, { recursive: true });

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const levelFromEnv = (process.env.TV_LOG_LEVEL ?? "info") as LogLevel;

export const logger = pino({
  level: levelFromEnv,
  transport: process.stdout.isTTY
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
    : undefined,
});

const SECRET_KEYS = [
  "password",
  "token",
  "cookie",
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "session",
  "refresh_token",
];

export function redact(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = "[redacted]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  args?: unknown;
  result?: "ok" | "error" | "blocked" | "denied";
  error?: string;
  durationMs?: number;
  screenshot?: string;
  tabUrl?: string;
}

export function audit(entry: AuditEntry): void {
  const line = JSON.stringify(redact(entry));
  appendFileSync(auditPath, line + "\n", "utf8");
  logger.debug({ audit: entry.tool, result: entry.result }, "audit entry");
}

export function logFile(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
  }
  return path;
}

export const paths = { logsDir, auditPath, projectRoot: dataDir };
