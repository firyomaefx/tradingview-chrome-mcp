/**
 * Supabase client for telemetry. Initialized only when telemetry is enabled.
 * Uses the service-role key server-side; never expose this to the client.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabase: SupabaseClient | null =
  config.telemetryEnabled && config.supabaseUrl && config.supabaseServiceRoleKey
    ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;
