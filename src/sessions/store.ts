/**
 * Session store abstraction for serverless SSE sessions.
 *
 * Vercel functions are stateless and may run across regions, so an in-memory
 * Map is insufficient. This module prefers Redis (Upstash / Vercel KV) and
 * falls back to an in-memory store only for local single-instance development.
 */
import { Redis } from "@upstash/redis";
import { config } from "../config.js";

export interface Session {
  key: string;
  createdAt: string;
}

let redis: Redis | null = null;

if (config.redisUrl && config.redisToken) {
  redis = new Redis({ url: config.redisUrl, token: config.redisToken });
}

// In-memory fallback. Do not use in production across multiple regions.
const memoryStore = new Map<string, Session>();

const TTL_SECONDS = 300;
const PREFIX = "mcp:session:";

export async function createSession(sessionId: string, key: string): Promise<void> {
  const session: Session = { key, createdAt: new Date().toISOString() };

  if (redis) {
    await redis.set(`${PREFIX}${sessionId}`, session, { ex: TTL_SECONDS });
    return;
  }

  memoryStore.set(sessionId, session);
}

export async function getSession(sessionId: string): Promise<Session | null> {
  if (redis) {
    return redis.get<Session>(`${PREFIX}${sessionId}`);
  }

  return memoryStore.get(sessionId) ?? null;
}

export async function refreshSession(sessionId: string): Promise<void> {
  if (!redis) return;
  await redis.expire(`${PREFIX}${sessionId}`, TTL_SECONDS);
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (redis) {
    await redis.del(`${PREFIX}${sessionId}`);
    return;
  }
  memoryStore.delete(sessionId);
}
