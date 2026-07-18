/**
 * API-key authentication.
 *
 * Supports two modes:
 * 1. Static keys from MCP_API_KEYS env var (simple, no external deps).
 * 2. Supabase-backed keys from `mcp_api_keys` table (rotatable, per-key limits).
 *
 * Static keys are checked first to avoid unnecessary Supabase round-trips.
 */
import { supabase } from "../telemetry/supabase.js";
import { config } from "../config.js";

export interface ApiKey {
  id: string;
  label: string | null;
  rate_limit_per_minute: number | null;
  allowed_tools: string[] | null;
  is_active: boolean;
}

async function sha256(plaintext: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validate an API key and return its metadata if valid.
 * Returns null if invalid or inactive.
 */
export async function validateKey(plaintext: string): Promise<ApiKey | null> {
  // Fast path: static env keys.
  if (config.mcpApiKeys?.includes(plaintext)) {
    return {
      id: "static",
      label: "static-env-key",
      rate_limit_per_minute: null,
      allowed_tools: null,
      is_active: true,
    };
  }

  // Database path: hash the key and query Supabase.
  if (!supabase) return null;

  const hash = await sha256(plaintext);
  const { data, error } = await supabase
    .from("mcp_api_keys")
    .select("id, label, rate_limit_per_minute, allowed_tools, is_active")
    .eq("key_hash", hash)
    .eq("is_active", true)
    .single();

  if (error || !data) return null;
  return data as ApiKey;
}
