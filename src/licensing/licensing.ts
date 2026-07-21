/**
 * Runtime licence manager.
 *
 * The current edition is read from the local `licence` row (single source of
 * truth at runtime). Free is the default and is active with no key. Pro/Team
 * activation is performed by `activateLicence(key)`.
 *
 * Offline activation (this phase): a key matching `TV-PRO-<uuid>` or
 * `TV-TEAM-<uuid>` activates the matching edition locally and records the
 * device id. Online activation against the licensing Supabase Edge Function is
 * defined by the `DeviceActivationClient` interface and wired in a later phase;
 * until then `activateLicence` uses the offline verifier.
 *
 * The licence key itself is never synchronized (it is not operational data).
 * Only the edition, status, device id, and activation timestamp are pushed to
 * the owner dashboard via the sync queue.
 */
import { getDb } from "../db/database.js";
import { ensureDevice, getLicence, setLicence } from "../db/repositories.js";
import {
  EDITION_LIMITS,
  parseEdition,
  type Edition,
  type EditionLimits,
} from "./edition.js";
import { logger } from "../logging/logger.js";

const APP_VERSION = process.env.TV_APP_VERSION ?? "0.3.2";

export interface LicenceState {
  edition: Edition;
  limits: EditionLimits;
  status: string;
  deviceId: string;
  activatedAt: string | null;
  expiresAt: string | null;
}

export function getLicenceState(): LicenceState {
  const db = getDb();
  const row = getLicence(db);
  const device = ensureDevice(db, APP_VERSION);
  const edition = parseEdition(row.edition);
  return {
    edition,
    limits: EDITION_LIMITS[edition],
    status: row.status,
    deviceId: device.device_id,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
  };
}

export interface ActivationResult {
  ok: boolean;
  edition: Edition;
  error?: string;
}

const KEY_PATTERN = /^TV-(PRO|TEAM|OWNER)-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Activate a licence key. Offline verifier for the initial release; the
 * `DeviceActivationClient` hook lets a later phase swap in online activation
 * without changing call sites.
 */
export function activateLicence(key: string): ActivationResult {
  const trimmed = key.trim();
  const match = KEY_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, edition: "free", error: "Invalid licence key format" };
  }
  const edition = parseEdition(match[1]?.toLowerCase());
  const db = getDb();
  const device = ensureDevice(db, APP_VERSION);
  setLicence(db, {
    edition,
    licence_key: trimmed,
    device_id: device.device_id,
    activated_at: new Date().toISOString(),
    status: "active",
  });
  logger.info({ edition, deviceId: device.device_id }, "licence activated");
  return { ok: true, edition };
}

/** Drop the current licence back to Free. */
export function deactivateLicence(): void {
  const db = getDb();
  setLicence(db, {
    edition: "free",
    licence_key: null,
    device_id: null,
    activated_at: null,
    expires_at: null,
    status: "active",
  });
}

/**
 * Hook for the later-phase online activation client. Until implemented, this
 * stays null and `activateLicence` uses the offline verifier.
 */
export interface DeviceActivationClient {
  activate(deviceId: string, licenceKey: string): Promise<{ ok: boolean; edition: Edition; expiresAt?: string; error?: string }>;
  deactivate(deviceId: string, licenceKey: string): Promise<{ ok: boolean }>;
}

let activationClient: DeviceActivationClient | null = null;

export function setDeviceActivationClient(client: DeviceActivationClient | null): void {
  activationClient = client;
}

export async function activateLicenceOnline(key: string): Promise<ActivationResult> {
  if (!activationClient) {
    return activateLicence(key);
  }
  const db = getDb();
  const device = ensureDevice(db, APP_VERSION);
  try {
    const res = await activationClient.activate(device.device_id, key.trim());
    if (!res.ok) return { ok: false, edition: "free", error: res.error ?? "Activation rejected" };
    setLicence(db, {
      edition: res.edition,
      licence_key: key.trim(),
      device_id: device.device_id,
      activated_at: new Date().toISOString(),
      expires_at: res.expiresAt ?? null,
      status: "active",
    });
    return { ok: true, edition: res.edition };
  } catch (e) {
    return { ok: false, edition: "free", error: (e as Error).message };
  }
}