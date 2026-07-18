import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

export const supabase: SupabaseClient | null =
  config.telemetryEnabled && config.supabaseUrl && config.supabaseServiceRoleKey
    ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;
