/**
 * Small hashing helpers used by the audit chain and Pine Script versioning.
 */
import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Compute a stable checksum for a Pine Script source string. */
export function pineChecksum(source: string): string {
  // Normalize line endings so a CRLF/LF difference does not create a new version.
  const normalized = source.replace(/\r\n/g, "\n");
  return sha256Hex(normalized);
}