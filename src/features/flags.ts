/**
 * Runtime feature flags.
 *
 * Flags are read from the `mcp_feature_flags` Supabase table when telemetry is
 * enabled, otherwise they are read once from environment variables. This lets
 * you disable tools, telemetry, or destructive operations without redeploying.
 */
import { supabase } from "../telemetry/supabase.js";
import { config } from "../config.js";

export interface FeatureFlags {
  disableTelemetry: boolean;
  readOnlyMode: boolean;
  disableDestructiveTools: boolean;
  allowedToolBackends: Set<string>;
}

const DEFAULT_FLAGS: FeatureFlags = {
  disableTelemetry: false,
  readOnlyMode: false,
  disableDestructiveTools: false,
  allowedToolBackends: new Set(["browser", "market-data-api", "mock"]),
};

async function loadFromSupabase(): Promise<Partial<FeatureFlags>> {
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("mcp_feature_flags")
    .select("key, value");

  if (error || !data) return {};

  const flags: Partial<FeatureFlags> = {};
  const raw: Record<string, boolean> = {};
  for (const row of data) {
    if (typeof row.value === "boolean") raw[row.key] = row.value;
  }

  if (raw.disable_telemetry !== undefined) flags.disableTelemetry = raw.disable_telemetry;
  if (raw.read_only_mode !== undefined) flags.readOnlyMode = raw.read_only_mode;
  if (raw.disable_destructive_tools !== undefined) flags.disableDestructiveTools = raw.disable_destructive_tools;

  return flags;
}

function loadFromEnv(): Partial<FeatureFlags> {
  const flags: Partial<FeatureFlags> = {};
  if (process.env.FLAG_DISABLE_TELEMETRY === "1") flags.disableTelemetry = true;
  if (process.env.FLAG_READ_ONLY_MODE === "1") flags.readOnlyMode = true;
  if (process.env.FLAG_DISABLE_DESTRUCTIVE_TOOLS === "1") flags.disableDestructiveTools = true;
  return flags;
}

/**
 * Load current feature flags. In production this should be cached for a short
 * TTL (e.g. 10-30s) to avoid hitting Supabase on every request.
 */
export async function loadFeatureFlags(): Promise<FeatureFlags> {
  const overrides = config.telemetryEnabled
    ? await loadFromSupabase()
    : loadFromEnv();

  return {
    ...DEFAULT_FLAGS,
    ...overrides,
  };
}
