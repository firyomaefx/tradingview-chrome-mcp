/**
 * Simple sliding-window rate limiter for the Vercel-hosted routes.
 *
 * Uses Upstash Redis when configured, otherwise falls back to an in-memory Map.
 * The key is always the API key so abusing one key cannot exhaust another.
 * Per-key limits from Supabase are honored; otherwise a global default is used.
 */
import { Redis } from "@upstash/redis";
import { config } from "@/lib/config";
import type { ApiKey } from "@/lib/auth/api-keys";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

const WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? "60", 10);

let redis: Redis | null = null;
if (config.redisUrl && config.redisToken) {
  redis = new Redis({ url: config.redisUrl, token: config.redisToken });
}

const memoryStore = new Map<string, { count: number; resetAt: number }>();

function sanitizeKey(key: string): string {
  // Only allow safe characters in the rate-limit key to avoid injection into Redis.
  return key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

function maxRequests(apiKey?: ApiKey): number {
  if (apiKey?.rate_limit_per_minute != null && apiKey.rate_limit_per_minute > 0) {
    return apiKey.rate_limit_per_minute;
  }
  return DEFAULT_MAX_REQUESTS;
}

export async function checkRateLimit(apiKeyOrKey: string | ApiKey): Promise<RateLimitResult> {
  const keyText = typeof apiKeyOrKey === "string" ? apiKeyOrKey : apiKeyOrKey.id;
  const apiKey = typeof apiKeyOrKey === "string" ? undefined : apiKeyOrKey;
  const key = `mcp:ratelimit:${sanitizeKey(keyText)}`;
  const limit = maxRequests(apiKey);
  const now = Date.now();
  const windowStart = Math.floor(now / 1_000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  const resetAt = new Date((windowStart + WINDOW_SECONDS) * 1_000);

  if (redis) {
    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, WINDOW_SECONDS);
      }
      const ttl = await redis.ttl(key);
      const remaining = Math.max(0, limit - current);
      return {
        allowed: current <= limit,
        remaining,
        resetAt: new Date(now + Math.max(0, ttl) * 1_000),
        limit,
      };
    } catch (err) {
      console.error("[rate-limit] redis error:", err);
      // Fail open: do not block legitimate users because Redis is down.
      return { allowed: true, remaining: limit, resetAt, limit };
    }
  }

  // In-memory fallback for local single-instance testing.
  const bucket = memoryStore.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: resetAt.getTime() });
    return { allowed: true, remaining: limit - 1, resetAt, limit };
  }

  bucket.count++;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed: bucket.count <= limit,
    remaining,
    resetAt: new Date(bucket.resetAt),
    limit,
  };
}
