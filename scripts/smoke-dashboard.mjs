import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const proc = spawn("node", ["dist/server/index.js"], { stdio: ["ignore", "ignore", "inherit"] });
proc.unref();
await sleep(2000);
const ctrl = new AbortController();
const to = setTimeout(() => ctrl.abort(), 4000);
try {
  const r = await fetch("http://127.0.0.1:3939/api/status", { signal: ctrl.signal });
  console.log("status:", r.status, JSON.stringify(await r.json()));
} catch (e) { console.log("status ERR:", String(e)); }
clearTimeout(to);
proc.kill();
process.exit(0);
