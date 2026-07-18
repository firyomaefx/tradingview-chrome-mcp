/**
 * API-key authentication for the hosted fork.
 *
 * Supports static env keys and Supabase-backed keys. In production, prefer the
 * Supabase table so keys can be rotated and scoped without redeploying.
 */
import { supabase } from "@/lib/telemetry/supabase";
import { config } from "@/lib/config";

export interface ApiKey {
  id: string;
  label: string | null;
  rate_limit_per_minute: number | null;
  allowed_tools: string[] | null;
  is_active: boolean;
}

async function sha256(plaintext: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateKey(plaintext: string): Promise<ApiKey | null> {
  if (config.mcpApiKeys?.includes(plaintext)) {
    return {
      id: "static",
      label: "static-env-key",
      rate_limit_per_minute: null,
      allowed_tools: null,
      is_active: true,
    };
  }

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
