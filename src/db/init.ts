/**
 * One-time database initialization: open, migrate, register/refresh the local
 * device identity. Called once at server startup. Safe to call repeatedly.
 */
import { getDb } from "./database.js";
import { runMigrations } from "./migrations.js";
import { ensureDevice } from "./repositories.js";
import { logger } from "../logging/logger.js";

let initialized = false;

export function initDatabase(appVersion: string): void {
  if (initialized) return;
  const db = getDb();
  const { applied, total } = runMigrations(db);
  ensureDevice(db, appVersion);
  initialized = true;
  logger.info({ applied, total, appVersion }, "database initialized");
}

export function isDatabaseInitialized(): boolean {
  return initialized;
}