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

// Keys whose value is never persisted locally and never synchronized.
// Covers the full never-synchronize list: TradingView passwords, browser
// cookies, session tokens, OpenAI/Anthropic API keys, webhook secrets, auth
// codes, payment-card details, bank information, private encryption keys, and
// broker login/account credentials.
const SECRET_KEYS = [
  "password",
  "passwd",
  "token",
  "cookie",
  "authorization",
  "api_key",
  "apikey",
  "api-key",
  "openai_api_key",
  "anthropic_api_key",
  "secret",
  "session",
  "refresh_token",
  "access_token",
  "webhook",
  "webhook_secret",
  "webhook_url",
  "auth_code",
  "authcode",
  "otp",
  "mfa",
  "card",
  "pan",
  "cvv",
  "cvc",
  "expiry",
  "payment",
  "bank",
  "iban",
  "bic",
  "swift",
  "account_number",
  "routing",
  "private_key",
  "privatekey",
  "encryption_key",
  "passphrase",
  "broker",
  "broker_login",
  "broker_account",
  "credential",
  "credentials",
];

// Value-level patterns that are redacted regardless of the key name.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/, // OpenAI-style API keys
  /sk-ant-[A-Za-z0-9_-]{16,}/, // Anthropic-style API keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWTs
  /\b(?:\d[ -]*?){13,19}\b/, // credit-card-like number groups
  /^Bearer\s+\S+/i, // Bearer tokens
];

function redactValue(v: unknown): unknown {
  if (typeof v === "string") {
    for (const re of SECRET_VALUE_PATTERNS) {
      if (re.test(v)) return "[redacted]";
    }
  }
  return v;
}

export function redact(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = k.toLowerCase();
    if (SECRET_KEYS.some((s) => lowerKey.includes(s))) {
      out[k] = "[redacted]";
    } else if (typeof v === "object" && v !== null) {
      out[k] = redact(v);
    } else {
      out[k] = redactValue(v);
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
