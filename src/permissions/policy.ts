/**
 * Permission policy: domain allowlist, destructive-action gate,
 * rate limit, action-chain cap, request timeouts, emergency stop.
 */
export const ALLOWED_DOMAINS = ["tradingview.com", "www.tradingview.com"] as const;

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: string; severity: "block" | "deny" };

export interface PolicyContext {
  domain?: string;
  url?: string;
  tool: string;
  destructive?: boolean;
  approvalApproved?: boolean;
  chainDepth?: number;
}

const MAX_CHAIN_DEPTH = 25;
const MAX_ACTIONS_PER_MINUTE = 120;

const timestamps: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (timestamps.length) {
    const t0 = timestamps[0];
    if (t0 === undefined) break;
    if (now - t0 > 60_000) timestamps.shift();
    else break;
  }
  if (timestamps.length >= MAX_ACTIONS_PER_MINUTE) return true;
  timestamps.push(now);
  return false;
}

let emergencyStop = false;

export function triggerEmergencyStop(): void {
  emergencyStop = true;
}

export function clearEmergencyStop(): void {
  emergencyStop = false;
}

export function isEmergencyStopped(): boolean {
  return emergencyStop;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isAllowedDomain(url: string | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

export function evaluate(ctx: PolicyContext): Decision {
  if (emergencyStop) {
    return { allowed: false, reason: "Emergency stop is active", severity: "deny" };
  }
  // Domain check applies only to tools that target a specific page (url provided).
  // Global tools (ping, emergency_stop, browser_status) pass url=undefined.
  if (ctx.url !== undefined && !isAllowedDomain(ctx.url)) {
    return {
      allowed: false,
      reason: `Domain not in allowlist: ${ctx.url ?? "(no url)"}`,
      severity: "deny",
    };
  }
  if (ctx.destructive && !ctx.approvalApproved) {
    return {
      allowed: false,
      reason: `Destructive action "${ctx.tool}" requires explicit approval`,
      severity: "block",
    };
  }
  if ((ctx.chainDepth ?? 0) > MAX_CHAIN_DEPTH) {
    return {
      allowed: false,
      reason: `Action chain depth exceeded limit (${MAX_CHAIN_DEPTH})`,
      severity: "block",
    };
  }
  if (rateLimited()) {
    return {
      allowed: false,
      reason: "Rate limit exceeded (>120 actions/min)",
      severity: "block",
    };
  }
  return { allowed: true };
}

export const DESTRUCTIVE_TOOLS = new Set<string>([
  "tv_pine_save",
  "tv_pine_add_to_chart",
  "tv_rename_script",
  "tv_indicator_remove",
  "tv_alert_delete",
  "tv_drawing_remove",
  "tv_layout_switch",
  "tv_layout_delete",
  "tv_chart_data_export",
]);

export const POLICY_LIMITS = { MAX_CHAIN_DEPTH, MAX_ACTIONS_PER_MINUTE };


