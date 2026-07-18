/**
 * In-memory approval queue and runtime status shared between the MCP server
 * (STDIO) and the dashboard (Express). Both live in the same process when
 * started via the server entrypoint, so a simple module-scoped store is fine.
 */

export interface PendingApproval {
  id: string;
  message: string;
  tool: string;
  createdAt: number;
  resolvedAt?: number;
  decision?: "approve" | "deny";
}

const pending = new Map<string, PendingApproval>();
const history: PendingApproval[] = [];
const waiters = new Map<string, (d: boolean) => void>();

let nextId = 1;

export function createApproval(tool: string, message: string): PendingApproval {
  const id = `apr-${nextId++}`;
  const a: PendingApproval = { id, tool, message, createdAt: Date.now() };
  pending.set(id, a);
  return a;
}

export function listPending(): PendingApproval[] {
  return Array.from(pending.values());
}

export function listHistory(limit = 100): PendingApproval[] {
  return history.slice(-limit);
}

export function resolveApproval(id: string, decision: "approve" | "deny"): boolean {
  const a = pending.get(id);
  if (!a) return false;
  a.decision = decision;
  a.resolvedAt = Date.now();
  pending.delete(id);
  history.push(a);
  const w = waiters.get(id);
  if (w) {
    waiters.delete(id);
    w(decision === "approve");
  }
  return true;
}

export async function awaitApproval(id: string, timeoutMs: number): Promise<boolean> {
  // Returns true if approved, false if denied or timed out.
  return new Promise((resolve) => {
    const a = pending.get(id);
    if (a && a.decision) {
      resolve(a.decision === "approve");
      return;
    }
    const timer = setTimeout(() => {
      waiters.delete(id);
      if (pending.has(id)) pending.delete(id);
      history.push({ id, tool: a?.tool ?? "?", message: a?.message ?? "", createdAt: a?.createdAt ?? Date.now(), resolvedAt: Date.now(), decision: "deny" });
      resolve(false);
    }, timeoutMs);
    waiters.set(id, (d) => {
      clearTimeout(timer);
      resolve(d);
    });
  });
}

export function cancelAllPending(): void {
  for (const [id, w] of waiters) {
    w(false);
    waiters.delete(id);
  }
  pending.clear();
}
