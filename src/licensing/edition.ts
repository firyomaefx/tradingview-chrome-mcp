/**
 * Product editions and feature gating.
 *
 *   free  — local SQLite, autonomous Pine loop (capped), mandatory
 *           operational telemetry sync, no live trading.
 *   pro   — higher loop limits, strategy tester extraction, multi-device
 *           activation, priority sync. Still no live trading.
 *   team  — shared workspace (interface reserved for a later phase).
 *   owner — administration dashboard (interface reserved for a later phase).
 *
 * Live trading and broker order execution are disabled in every edition for the
 * initial release. The gating here is the single source of truth that the tool
 * registry consults before exposing or running a capability.
 */
export type Edition = "free" | "pro" | "team" | "owner";

export interface EditionLimits {
  edition: Edition;
  label: string;
  maxAutofixAttempts: number;
  maxTasksPerDay: number;
  strategyTester: boolean;
  multiDevice: boolean;
  ownerDashboard: boolean;
  cloudSync: boolean; // operational telemetry sync (mandatory for free + pro)
  liveTrading: boolean; // always false in the initial release
  prioritySync: boolean;
}

export const EDITION_LIMITS: Record<Edition, EditionLimits> = {
  free: {
    edition: "free",
    label: "Free",
    maxAutofixAttempts: 5,
    maxTasksPerDay: 20,
    strategyTester: false,
    multiDevice: false,
    ownerDashboard: false,
    cloudSync: true,
    liveTrading: false,
    prioritySync: false,
  },
  pro: {
    edition: "pro",
    label: "Pro",
    maxAutofixAttempts: 12,
    maxTasksPerDay: 200,
    strategyTester: true,
    multiDevice: true,
    ownerDashboard: false,
    cloudSync: true,
    liveTrading: false,
    prioritySync: true,
  },
  team: {
    edition: "team",
    label: "Team",
    maxAutofixAttempts: 12,
    maxTasksPerDay: 1000,
    strategyTester: true,
    multiDevice: true,
    ownerDashboard: false,
    cloudSync: true,
    liveTrading: false,
    prioritySync: true,
  },
  owner: {
    edition: "owner",
    label: "Owner",
    maxAutofixAttempts: 12,
    maxTasksPerDay: Number.MAX_SAFE_INTEGER,
    strategyTester: true,
    multiDevice: true,
    ownerDashboard: true,
    cloudSync: true,
    liveTrading: false,
    prioritySync: true,
  },
};

export type FeatureKey =
  | "strategyTester"
  | "multiDevice"
  | "ownerDashboard"
  | "cloudSync"
  | "liveTrading"
  | "prioritySync";

export function isFeatureEnabled(edition: Edition, feature: FeatureKey): boolean {
  return EDITION_LIMITS[edition][feature] === true;
}

export function isEditionHigherOrEqual(a: Edition, b: Edition): boolean {
  const order: Edition[] = ["free", "pro", "team", "owner"];
  return order.indexOf(a) >= order.indexOf(b);
}

export function parseEdition(value: string | undefined | null): Edition {
  const v = (value ?? "free").toLowerCase();
  if (v === "pro" || v === "team" || v === "owner") return v;
  return "free";
}