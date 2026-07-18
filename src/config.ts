/**
 * Centralized, validated runtime configuration.
 *
 * Fail-fast on startup so misconfigurations are caught immediately rather
 * than surfacing as runtime errors inside tool handlers.
 */
import { z } from "zod";

const BackendSchema = z.enum(["browser", "market-data-api", "mock"]);

const ConfigSchema = z.object({
  telemetryEnabled: z.boolean().default(false),
  telemetryAllowedKeys: z.array(z.string()).default(["symbol", "ticker", "timeframe"]),
  toolBackend: BackendSchema.default("browser"),
  mcpApiKeys: z.array(z.string()).optional(),
  approvalAutoDestructive: z.boolean().default(false),
  redisUrl: z.string().optional(),
  redisToken: z.string().optional(),
  supabaseUrl: z.string().optional(),
  supabaseServiceRoleKey: z.string().optional(),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

function parseArray(env?: string): string[] | undefined {
  if (!env) return undefined;
  const arr = env.split(",").map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

export const config = ConfigSchema.parse({
  telemetryEnabled: process.env.TELEMETRY_ENABLED === "1",
  telemetryAllowedKeys: parseArray(process.env.TELEMETRY_ALLOWED_KEYS),
  toolBackend: process.env.TOOL_BACKEND,
  mcpApiKeys: parseArray(process.env.MCP_API_KEYS),
  approvalAutoDestructive: process.env.TV_AUTO_APPROVE_DESTRUCTIVE === "1",
  redisUrl: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  logLevel: process.env.TV_LOG_LEVEL,
});

export type Config = z.infer<typeof ConfigSchema>;
export type ToolBackend = z.infer<typeof BackendSchema>;
