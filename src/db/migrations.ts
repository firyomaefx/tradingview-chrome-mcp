/**
 * Migration runner.
 *
 * Migrations are applied in order inside a single transaction. Each migration
 * is recorded in `schema_migrations` so the database is only migrated forward
 * and never double-applied. There is no automatic down-migration — rollback is
 * handled by the backup-and-restore policy documented in PRODUCTION_CHECKLIST.md.
 */
import type { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations/001-initial.js";
import { logger } from "../logging/logger.js";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Apply all pending migrations. Safe to call on every startup.
 */
export function runMigrations(db: DatabaseSync): { applied: number; total: number } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as { id: number }[];
  const appliedIds = new Set(appliedRows.map((r) => r.id));

  let count = 0;
  for (const m of MIGRATIONS) {
    if (appliedIds.has(m.id)) continue;
    const tx = db.prepare("BEGIN");
    tx.run();
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
      db.prepare("COMMIT").run();
      count++;
      logger.info({ migration: m.name, id: m.id }, "applied migration");
    } catch (e) {
      db.prepare("ROLLBACK").run();
      const err = (e as Error).message ?? String(e);
      logger.error({ migration: m.name, err }, "migration failed");
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${err}`);
    }
  }
  return { applied: count, total: MIGRATIONS.length };
}