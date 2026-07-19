#!/usr/bin/env node
/**
 * Smoke test for the Chrome extension WebSocket driver.
 *
 * Starts the extension server, rejects a bad token, accepts a good token,
 * and performs one JSON-RPC round-trip by pretending to be the extension.
 */

import { createConnection } from "node:net";
import { createHash, randomBytes } from "node:crypto";

process.env.TV_EXTENSION_WS_PORT = "19223";
process.env.TV_EXTENSION_TOKEN = "smoke-test-token";

const { startExtensionServer, ExtensionDriver } = await import("../dist/browser/extension-driver.js");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function maskData(mask, data) {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ mask[i % 4];
  }
  return out;
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const frame = Buffer.alloc(2 + 4 + payload.length);
  frame[0] = 0x81; // FIN + text opcode
  frame[1] = 0x80 | payload.length; // masked + length
  mask.copy(frame, 2);
  maskData(mask, payload).copy(frame, 6);
  return frame;
}

function decodeFrames(buffer, onText) {
  let i = 0;
  while (i + 2 <= buffer.length) {
    const byte1 = buffer[i];
    const byte2 = buffer[i + 1];
    const fin = (byte1 & 0x80) === 0x80;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let len = byte2 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (i + 4 > buffer.length) return buffer;
      len = buffer.readUInt16BE(i + 2);
      headerLen += 2;
    } else if (len === 127) {
      if (i + 10 > buffer.length) return buffer;
      len = buffer.readUInt32BE(i + 2) * 0x100000000 + buffer.readUInt32BE(i + 6);
      headerLen += 8;
    }
    if (masked) headerLen += 4;
    if (i + headerLen + len > buffer.length) return buffer;
    let payload = buffer.subarray(i + headerLen, i + headerLen + len);
    if (masked) {
      const mask = buffer.subarray(i + headerLen - 4, i + headerLen);
      payload = maskData(mask, payload);
    }
    i += headerLen + len;
    if (!fin) continue;
    if (opcode === 0x08) return buffer.subarray(0, 0);
    if (opcode === 0x01 || opcode === 0x02) {
      onText(payload.toString(opcode === 0x01 ? "utf8" : "latin1"));
    }
  }
  return buffer.subarray(i);
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const accept = createHash("sha1").update(key + WS_MAGIC).digest("base64");
    const socket = createConnection({ port: 19223, host: "127.0.0.1" }, () => {
      socket.write(
        `GET /?token=${token} HTTP/1.1\r\n` +
          `Host: 127.0.0.1\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let buffer = Buffer.alloc(0);
    let resolved = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw WebSocket handshake timed out"));
    }, 3000);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!resolved) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const headers = buffer.subarray(0, headerEnd).toString("utf8");
        buffer = buffer.subarray(headerEnd + 4);
        clearTimeout(timer);
        resolved = true;
        if (!headers.includes("101 Switching Protocols") || !headers.includes(accept)) {
          socket.destroy();
          return reject(new Error(`handshake failed: ${headers.split("\r\n")[0]}`));
        }
        resolve(socket);
      } else {
        buffer = decodeFrames(buffer, (text) => {
          try {
            const msg = JSON.parse(text);
            if (msg.id) {
              // Act like the extension and respond to every server request.
              const reply = {
                jsonrpc: "2.0",
                id: msg.id,
                result: [{ tabId: 1, url: "https://www.tradingview.com/chart/", title: "Chart" }],
              };
              socket.write(encodeTextFrame(JSON.stringify(reply)));
            }
          } catch (e) {
            console.error("failed to decode server frame:", e.message);
          }
        });
      }
    });

    socket.on("error", reject);
    socket.on("close", () => {
      if (!resolved) reject(new Error("socket closed before handshake"));
    });
  });
}

async function expectBadTokenRejected() {
  try {
    await connect("wrong-token");
    throw new Error("bad-token connection should have been rejected");
  } catch (e) {
    if (!/403|Forbidden|handshake failed/i.test(String(e))) throw e;
    console.log("OK: bad token rejected");
  }
}

async function runRoundTrip() {
  const socket = await connect(process.env.TV_EXTENSION_TOKEN);
  // Wait for server to register the socket.
  await new Promise((r) => setTimeout(r, 50));

  const driver = new ExtensionDriver();
  const tabs = await driver.listTabs();
  if (!Array.isArray(tabs) || tabs.length !== 1 || tabs[0].tabId !== 1) {
    throw new Error(`unexpected listTabs result: ${JSON.stringify(tabs)}`);
  }
  console.log("OK: JSON-RPC round-trip via extension driver");
  socket.destroy();
}

let serverStarted = false;

try {
  await startExtensionServer();
  serverStarted = true;
  console.log("OK: extension WebSocket server started on port", process.env.TV_EXTENSION_WS_PORT);

  await expectBadTokenRejected();
  await runRoundTrip();

  console.log("\nAll extension driver smoke checks passed.");
  process.exit(0);
} catch (e) {
  console.error("FAIL:", e);
  process.exit(1);
}
