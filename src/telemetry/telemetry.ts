/**
 * Privacy-first usage telemetry.
 *
 * Only parameters matching the configured allow-list are persisted. By default
 * this is limited to `symbol`, `ticker`, and `timeframe` for cache/rate-limit
 * observability. Pine source, indicator configs, screenshots paths, and all
 * other user data are dropped before reaching Supabase.
 */
import { supabase } from "./supabase.js";
import { config } from "../config.js";

export interface TelemetryPayload {
  user_id: string;
  tool_name: string;
  parameters: Record<string, unknown> | null;
  duration_ms: number;
  success: boolean;
  error_message?: string;
}

/**
 * Strict allow-list redaction. Returns null if no allowed keys are present.
 * Keys are normalized to lowercase for consistent cache-key analytics.
 *
 * Reads the allow-list from config at call time so tests and runtime flag
 * changes can influence behavior without reloading the module.
 */
export function redactParameters(
  _toolName: string,
  params: Record<string, unknown>
): Record<string, unknown> | null {
  if (!config.telemetryEnabled) return null;

  const allowedKeys = new Set(
    config.telemetryAllowedKeys.map((k) => k.toLowerCase())
  );

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (allowedKeys.has(key.toLowerCase())) {
      safe[key.toLowerCase()] = value;
    }
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Non-blocking usage logger. Fire-and-forget: never await in the hot path.
 * Failures are caught and logged to stderr only.
 */
export function logUsage(payload: TelemetryPayload): void {
  if (!supabase) return;

  Promise.resolve(
    supabase.from("mcp_usage_logs").insert({
      user_id: payload.user_id,
      tool_name: payload.tool_name,
      parameters: payload.parameters,
      duration_ms: payload.duration_ms,
      success: payload.success,
      error_message: payload.error_message ?? null,
      created_at: new Date().toISOString(),
    })
  )
    .then(({ error }) => {
      if (error) {
        console.error("[telemetry] failed to log usage:", error.message);
      }
    })
    .catch((err: unknown) => {
      console.error("[telemetry] unexpected error:", err);
    });
}
