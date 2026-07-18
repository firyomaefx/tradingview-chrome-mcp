// Smoke test: spawn the built MCP server over STDIO, send initialize + tools/list.
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
      if (msg.id === 1) {
        console.log("INIT OK:", msg.result?.serverInfo);
        send({ jsonrpc:"2.0", id:2, method:"tools/list", params:{} });
      } else if (msg.id === 2) {
        console.log("TOOLS COUNT:", msg.result?.tools?.length);
        console.log("TOOL NAMES:", msg.result?.tools?.map(t=>t.name).join(", "));
        proc.kill();
        process.exit(0);
      }
    } catch (e) { console.log("non-JSON line:", line.slice(0,80)); }
  }
});

function send(o){ proc.stdin.write(JSON.stringify(o)+"\n"); }
await sleep(500);
send({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"smoke", version:"1" } } });
await sleep(2000);
send({ jsonrpc:"2.0", method:"notifications/initialized", params:{} });
await sleep(1500);
proc.kill();
console.log("TIMEOUT - no tools/list response. Buffer tail:", buf.slice(-200));
process.exit(1);
