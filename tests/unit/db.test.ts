/**
 * Tests for the local SQLite source of truth, hash-chained audit log,
 * sync queue, and licensing persistence.
 *
 * The database is isolated to a per-run temp directory via TV_DATA_DIR, set
 * before the db modules are first used. Modules are imported dynamically so the
 * env is in place before any handle is opened.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDataDir = mkdtempSync(join(tmpdir(), "tvmcp-db-"));
process.env.TV_DATA_DIR = tmpDataDir;

// Lazily loaded after TV_DATA_DIR is set.
let dbMod: typeof import("../../src/db/database.js");
let reposMod: typeof import("../../src/db/repositories.js");
let auditMod: typeof import("../../src/audit/audit-chain.js");
let syncMod: typeof import("../../src/sync/sync-manager.js");
let licMod: typeof import("../../src/licensing/licensing.js");
let db: import("node:sqlite").DatabaseSync;

before(async () => {
  dbMod = await import("../../src/db/database.js");
  reposMod = await import("../../src/db/repositories.js");
  auditMod = await import("../../src/audit/audit-chain.js");
  syncMod = await import("../../src/sync/sync-manager.js");
  licMod = await import("../../src/licensing/licensing.js");
  // Clear any singleton opened by another test file before redirecting to tmp.
  dbMod.closeDb();
  db = dbMod.getDb();
});

after(() => {
  dbMod.closeDb();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("applied the initial migration", () => {
    const row = db.prepare("SELECT count(*) AS c FROM schema_migrations").get() as { c: number };
    assert.ok(row.c >= 1);
  });

  it("created the core tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = new Set(tables.map((t) => t.name));
    for (const t of [
      "device", "licence", "feature_flags", "settings", "interaction_log",
      "audit_log", "tasks", "pine_scripts", "pine_versions", "compile_errors",
      "fixes", "screenshots", "backups", "strategy_runs", "sync_queue",
    ]) {
      assert.ok(names.has(t), `missing table ${t}`);
    }
  });
});

describe("device + licence", () => {
  it("ensures a stable device identity", () => {
    const a = reposMod.ensureDevice(db, "0.0.0-test");
    const b = reposMod.ensureDevice(db, "0.0.0-test");
    assert.equal(a.device_id, b.device_id);
    assert.match(a.device_id, /^[0-9a-f-]{36}$/);
  });

  it("defaults to free edition", () => {
    const s = licMod.getLicenceState();
    assert.equal(s.edition, "free");
    assert.equal(s.status, "active");
    assert.equal(s.limits.liveTrading, false);
  });

  it("activates a valid Pro key and deactivates back to free", () => {
    const key = "TV-PRO-12345678-1234-1234-1234-123456789abc";
    const res = licMod.activateLicence(key);
    assert.equal(res.ok, true);
    assert.equal(res.edition, "pro");
    const s = licMod.getLicenceState();
    assert.equal(s.edition, "pro");
    licMod.deactivateLicence();
    assert.equal(licMod.getLicenceState().edition, "free");
  });

  it("rejects an invalid key", () => {
    const res = licMod.activateLicence("not-a-key");
    assert.equal(res.ok, false);
    assert.equal(res.edition, "free");
  });
});

describe("settings + flags", () => {
  it("round-trips a setting", () => {
    reposMod.setSetting(db, "theme", "dark");
    assert.equal(reposMod.getSetting(db, "theme"), "dark");
  });

  it("round-trips a feature flag", () => {
    reposMod.setFlag(db, "read_only_mode", true, "env");
    assert.equal(reposMod.getFlag(db, "read_only_mode"), true);
  });
});

describe("tasks + pine versions", () => {
  it("creates a task and updates it", () => {
    const id = reposMod.createTask(db, "fix my macd", { edition: "free", maxAttempts: 5 });
    assert.ok(id > 0);
    reposMod.updateTask(db, id, { status: "completed", success: 1, finished_at: "now" });
    const t = reposMod.getTask(db, id);
    assert.equal(t?.status, "completed");
    assert.equal(t?.success, 1);
  });

  it("finds or creates a script idempotently", () => {
    const a = reposMod.findOrCreateScript(db, "MACD");
    const b = reposMod.findOrCreateScript(db, "MACD");
    assert.equal(a, b);
  });

  it("creates versions with stable checksums and incrementing numbers", () => {
    const sid = reposMod.findOrCreateScript(db, "RSI");
    const v1 = reposMod.createVersion(db, { scriptId: sid, source: "//@version=6\n1\n" });
    const v2 = reposMod.createVersion(db, { scriptId: sid, source: "//@version=6\n2\n" });
    assert.equal(v1.versionNo, 1);
    assert.equal(v2.versionNo, 2);
    assert.notEqual(v1.checksum, v2.checksum);
    assert.equal(v1.checksum, reposMod.createVersion(db, { scriptId: null, source: "//@version=6\n1\n" }).checksum);
    reposMod.setScriptCurrentVersion(db, sid, v2.id);
    assert.equal(reposMod.getVersion(db, v2.id)?.checksum, v2.checksum);
  });
});

describe("loop persistence rows", () => {
  it("inserts compile errors, fixes, screenshots, backups, strategy runs", () => {
    const tid = reposMod.createTask(db, "loop", { edition: "free", maxAttempts: 3 });
    const sid = reposMod.findOrCreateScript(db, "LOOP");
    const v = reposMod.createVersion(db, { scriptId: sid, source: "x" });
    assert.ok(reposMod.insertCompileErrors(db, { taskId: tid, versionId: v.id, attempt: 1, errors: ["e"], warnings: ["w"], success: false }) > 0);
    assert.ok(reposMod.insertFix(db, { taskId: tid, versionIdBefore: v.id, versionIdAfter: v.id, attempt: 1, patchKind: "llm" }) > 0);
    assert.ok(reposMod.insertScreenshot(db, tid, "/tmp/s.png", "autofix-success") > 0);
    assert.ok(reposMod.insertBackup(db, sid, v.id, "/tmp/b.pine", v.checksum) > 0);
    assert.ok(reposMod.insertStrategyRun(db, sid, "{}", null) > 0);
  });
});

describe("sync queue", () => {
  it("enqueue + claim + complete", () => {
    const id = reposMod.enqueueSync(db, "task.summary", "{}", 1);
    assert.ok(id > 0);
    const claimed = reposMod.claimNextSync(db);
    assert.ok(claimed);
    assert.equal(claimed?.status, "in_flight");
    reposMod.markSyncOk(db, claimed!.id);
    assert.equal(reposMod.countPendingSync(db), 0);
  });

  it("claimNextSync returns undefined when nothing is due", () => {
    assert.equal(reposMod.claimNextSync(db), undefined);
  });

  it("markSyncFailed schedules a retry and increments attempts", () => {
    const id = reposMod.enqueueSync(db, "task.summary", "{}");
    const claimed = reposMod.claimNextSync(db);
    assert.ok(claimed);
    reposMod.markSyncFailed(db, claimed!.id, "boom", 1000);
    const row = db.prepare("SELECT attempts, status FROM sync_queue WHERE id = ?").get(id) as { attempts: number; status: string };
    assert.equal(row.attempts, 1);
    assert.equal(row.status, "pending");
  });
});

describe("sync manager", () => {
  it("rejects non-allowlisted entities", () => {
    const id = syncMod.enqueueForSync("passwords", { x: 1 });
    assert.equal(id, -1);
  });

  it("enqueues allowlisted entities and redacts payloads", () => {
    const id = syncMod.enqueueForSync("task.summary", { goal: "g", api_key: "sk-leak" });
    assert.ok(id > 0);
    const row = db.prepare("SELECT payload_redacted_json FROM sync_queue WHERE id = ?").get(id) as { payload_redacted_json: string };
    const parsed = JSON.parse(row.payload_redacted_json) as Record<string, unknown>;
    assert.equal(parsed.api_key, "[redacted]");
    assert.equal(parsed.goal, "g");
  });

  it("reports configured=false without Supabase env", () => {
    assert.equal(syncMod.isSyncConfigured(), false);
  });

  it("drainSyncQueue leaves rows pending when no backend is configured", async () => {
    const before = reposMod.countPendingSync(db);
    const drained = await syncMod.drainSyncQueue(5);
    assert.equal(drained, 0);
    assert.equal(reposMod.countPendingSync(db), before);
  });
});

describe("audit chain", () => {
  it("appends sequential, hash-chained entries", () => {
    const s1 = auditMod.appendAudit("pine", "a", { n: 1 });
    const s2 = auditMod.appendAudit("pine", "b", { n: 2 });
    assert.equal(s1, 1);
    assert.equal(s2, 2);
    const v = auditMod.verifyAuditChain();
    assert.equal(v.ok, true);
    assert.equal(v.verifiedCount, 2);
  });

  it("readAuditChain returns latest-first", () => {
    const entries = auditMod.readAuditChain(10);
    assert.ok(entries.length >= 2);
    assert.equal(entries[0]?.action, "b");
  });

  it("detects tampering", () => {
    // Mutate the first entry's payload to break its hash.
    db.exec("UPDATE audit_log SET payload_redacted_json = 'tampered' WHERE seq = 1");
    const v = auditMod.verifyAuditChain();
    assert.equal(v.ok, false);
    assert.equal(v.brokenAt, 1);
    assert.match(v.reason ?? "", /hash mismatch/);
  });
});