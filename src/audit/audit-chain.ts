/**
 * Hash-chained append-only audit log.
 *
 * Each entry stores `prev_hash` and `hash`, where
 *   hash = sha256(prev_hash || seq || payload_redacted_json)
 *
 * This makes tampering detectable: changing any row breaks the chain for every
 * subsequent row. `verifyAuditChain()` recomputes the chain from genesis and
 * reports the first broken sequence number, if any.
 *
 * Payloads must already be redacted (see src/logging/logger.ts redact()).
 * The chain is the authoritative local audit; the flat JSONL log in
 * logs/audit.jsonl is kept as a redundant human-readable mirror.
 */
import { sha256Hex } from "../db/checksum.js";
import { getDb } from "../db/database.js";
import { logger } from "../logging/logger.js";

export const GENESIS_HASH = sha256Hex("tradingview-chrome-mcp:audit:genesis");

export interface AuditChainEntry {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
  category: string;
  action: string;
  payloadRedactedJson: string;
}

interface LastRow {
  seq: number;
  hash: string;
}

function lastRow(db = getDb()): LastRow | undefined {
  return db
    .prepare("SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1")
    .get() as LastRow | undefined;
}

/**
 * Append a redacted payload to the chain. Returns the new sequence number, or
 * -1 if the append failed (the caller continues; an audit failure must never
 * break the tool that triggered it).
 */
export function appendAudit(
  category: string,
  action: string,
  payload: unknown,
): number {
  try {
    const db = getDb();
    const payloadJson = JSON.stringify(payload ?? {});
    const last = lastRow(db);
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const hash = sha256Hex(`${prevHash}|${seq}|${payloadJson}`);
    db.prepare(
      "INSERT INTO audit_log (seq, ts, prev_hash, hash, category, action, payload_redacted_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(seq, new Date().toISOString(), prevHash, hash, category, action, payloadJson);
    return seq;
  } catch (e) {
    logger.error({ err: (e as Error).message }, "audit chain append failed");
    return -1;
  }
}

export interface ChainVerification {
  ok: boolean;
  verifiedCount: number;
  brokenAt: number | null;
  reason: string | null;
}

/**
 * Recompute the chain from genesis and return the first broken sequence number.
 */
export function verifyAuditChain(): ChainVerification {
  const db = getDb();
  const rows = db
    .prepare("SELECT seq, prev_hash, hash, payload_redacted_json FROM audit_log ORDER BY seq ASC")
    .all() as {
    seq: number;
    prev_hash: string;
    hash: string;
    payload_redacted_json: string;
  }[];

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        ok: false,
        verifiedCount: row.seq - 1,
        brokenAt: row.seq,
        reason: `prev_hash mismatch at seq ${row.seq}`,
      };
    }
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        verifiedCount: row.seq - 1,
        brokenAt: row.seq,
        reason: `sequence gap at seq ${row.seq} (expected ${expectedSeq})`,
      };
    }
    const recomputed = sha256Hex(`${row.prev_hash}|${row.seq}|${row.payload_redacted_json}`);
    if (recomputed !== row.hash) {
      return {
        ok: false,
        verifiedCount: row.seq - 1,
        brokenAt: row.seq,
        reason: `hash mismatch at seq ${row.seq}`,
      };
    }
    expectedPrev = row.hash;
    expectedSeq++;
  }
  return { ok: true, verifiedCount: rows.length, brokenAt: null, reason: null };
}

export function readAuditChain(limit = 100): AuditChainEntry[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT seq, ts, prev_hash AS prevHash, hash, category, action, payload_redacted_json AS payloadRedactedJson FROM audit_log ORDER BY seq DESC LIMIT ?",
    )
    .all(limit) as unknown as AuditChainEntry[];
}