import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const proc = spawn("node", ["dist/server/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
proc.stdout.on("data", (d) => { buf += d.toString(); });
proc.stdout.on("data", () => {
  while (true) {
    const idx = buf.indexOf("\n");
    if (idx < 0) break;
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) send({ jsonrpc:"2.0", id:2, method:"tools/list", params:{} });
      else if (msg.id === 2) send({ jsonrpc:"2.0", id:3, method:"tools/call", params:{ name:"tv_status", arguments:{} } });
      else if (msg.id === 3) { console.log("TV_STATUS:", summarize(msg.result?.content)); send({ jsonrpc:"2.0", id:4, method:"tools/call", params:{ name:"tv_read_pine_source", arguments:{} } }); }
      else if (msg.id === 4) { console.log("PINE_SOURCE:", summarize(msg.result?.content)); send({ jsonrpc:"2.0", id:5, method:"tools/call", params:{ name:"tv_screenshot", arguments:{ name:"mvp-smoke" } } }); }
      else if (msg.id === 5) { console.log("SCREENSHOT:", summarize(msg.result?.content)); proc.kill(); process.exit(0); }
    } catch {}
  }
});
function summarize(c){ if(!c) return "(none)"; return c.map(x=>x.type==="text"? x.text.slice(0,300): JSON.stringify(x)).join(" || ").slice(0,500); }
function send(o){ proc.stdin.write(JSON.stringify(o)+"\n"); }
await sleep(400);
send({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"smoke3", version:"1" } } });
await sleep(15000);
proc.kill(); console.log("TIMEOUT"); process.exit(1);
