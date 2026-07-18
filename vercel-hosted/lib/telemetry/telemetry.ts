/**
 * Privacy-first usage telemetry for the hosted fork.
 */
import { supabase } from "@/lib/telemetry/supabase";
import { config } from "@/lib/config";

export interface TelemetryPayload {
  user_id: string;
  tool_name: string;
  parameters: Record<string, unknown> | null;
  duration_ms: number;
  success: boolean;
  error_message?: string;
  client_id?: string;
}

export function redactParameters(
  _toolName: string,
  params: Record<string, unknown>
): Record<string, unknown> | null {
  if (!config.telemetryEnabled) return null;

  const allowedKeys = new Set(config.telemetryAllowedKeys.map((k) => k.toLowerCase()));
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (allowedKeys.has(key.toLowerCase())) {
      safe[key.toLowerCase()] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

export function logUsage(payload: TelemetryPayload): void {
  if (!supabase) return;

  Promise.resolve(
    supabase.from("mcp_usage_logs").insert({
      user_id: payload.user_id,
      tool_name: payload.tool_name,
      parameters: payload.parameters,
      client_id: payload.client_id ?? null,
      duration_ms: payload.duration_ms,
      success: payload.success,
      error_message: payload.error_message ?? null,
      created_at: new Date().toISOString(),
    })
  )
    .then(({ error }) => {
      if (error) console.error("[telemetry] failed to log usage:", error.message);
    })
    .catch((err: unknown) => console.error("[telemetry] unexpected error:", err));
}
