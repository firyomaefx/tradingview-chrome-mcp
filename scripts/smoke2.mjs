// Smoke test 2: call ping tool + check dashboard HTTP endpoint.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const proc = spawn("node", ["dist/server/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
proc.stdout.on("data", (d) => { buf += d.toString(); });
proc.stdout.on("data", () => {
  while (true) {
    const idx = buf.indexOf("\n");
    if (idx < 0) break;
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) send({ jsonrpc:"2.0", id:2, method:"tools/list", params:{} });
      else if (msg.id === 2) send({ jsonrpc:"2.0", id:3, method:"tools/call", params:{ name:"ping", arguments:{} } });
      else if (msg.id === 3) {
        console.log("PING RESULT:", JSON.stringify(msg.result?.content));
        proc.kill();
        process.exit(0);
      }
    } catch {}
  }
});
function send(o){ proc.stdin.write(JSON.stringify(o)+"\n"); }
await sleep(500);
send({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"smoke2", version:"1" } } });
await sleep(2500);
// Now hit the dashboard.
try {
  const r = await fetch("http://127.0.0.1:3939/api/status");
  const j = await r.json();
  console.log("DASHBOARD STATUS:", JSON.stringify(j));
} catch (e) { console.log("DASHBOARD ERR:", String(e)); }
proc.kill();
process.exit(0);
