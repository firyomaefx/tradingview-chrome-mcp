/**
 * Local SQLite database — the source of truth for the Free/Pro/Team/Owner
 * editions.
 *
 * Uses Node's built-in `node:sqlite` (stable in Node 24+) so there is no native
 * dependency to compile or ship — the database ships inside the standalone
 * Windows executable together with the embedded Node runtime.
 *
 * The database file lives under `TV_DATA_DIR` (the same stable path the
 * executable bootstrap uses for logs, backups, and screenshots) so artifacts
 * survive across caxa re-extractions. The path is resolved lazily on first
 * open so tests (and the executable bootstrap) can set `TV_DATA_DIR` after
 * module load. The database is bound to a single local file and is never
 * exposed on the network.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logging/logger.js";
import { runMigrations } from "./migrations.js";

const hereDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(hereDir, "..", "..");

let dbInstance: DatabaseSync | null = null;
let resolvedDbPath: string | null = null;

function resolveDataDir(): string {
  return process.env.TV_DATA_DIR ? process.env.TV_DATA_DIR : projectRoot;
}

/**
 * Open (or return the cached) local database handle. The first call resolves
 * `TV_DATA_DIR`, creates the data directory, opens the file, and applies
 * pragmatic hardening (WAL, foreign keys, busy timeout). Migrations are run by
 * `initDatabase()`, not here, so a bare `getDb()` is safe from tool handlers.
 */
export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dataDir = resolveDataDir();
  const dbDir = join(dataDir, "data");
  const dbPath = join(dbDir, "tradingview-mcp.db");
  mkdirSync(dbDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");

  dbInstance = db;
  resolvedDbPath = dbPath;
  // Ensure schema on every fresh open so tool handlers and tests always see a
  // ready database. Idempotent — only pending migrations are applied.
  runMigrations(db);
  logger.info({ dbPath }, "local sqlite database opened");
  return db;
}

/** Close the database and clear the cached handle. Used by tests and shutdown. */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    resolvedDbPath = null;
  }
}

export function getDbPath(): string | null {
  return resolvedDbPath;
}

export const projectDataRoot = projectRoot;