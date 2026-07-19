/**
 * Chrome-extension browser driver.
 *
 * The MCP server opens a local WebSocket server. The Chrome extension's
 * service worker connects to it and acts as a proxy into the active
 * TradingView tab via `chrome.scripting.executeScript({ world: "MAIN" })`.
 *
 * This driver implements the PageLike interface by sending JSON-RPC commands
 * to the extension and awaiting the response.
 */

import { createServer, type Server, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { logger } from "../logging/logger.js";

function randomBytes(n: number): Buffer {
  return Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
}

import type {
  BoundingBox,
  BrowserDriver,
  ClickOptions,
  DownloadLike,
  FillOptions,
  GotoOptions,
  KeyboardLike,
  LocatorLike,
  MouseLike,
  PageLike,
  ScreenshotOptions,
  TabInfoLike,
  VisibleOptions,
  WaitForOptions,
} from "./driver-types.js";

const WS_PORT = Number(process.env.TV_EXTENSION_WS_PORT ?? 9223);
const WS_TOKEN = process.env.TV_EXTENSION_TOKEN ?? "tradingview-chrome-mcp";

let cachedTab: ExtensionTab | null = null;
let wsServer: Server | null = null;
let activeSocket: Socket | null = null;

function maskData(mask: Uint8Array, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i]! ^ mask[i % 4]!;
  }
  return out as Buffer;
}

function encodeWsFrame(opcode: number, payload: Uint8Array, mask = false): Buffer {
  let len = payload.length;
  let extra = 0;
  if (len < 126) {
    extra = 0;
  } else if (len < 65536) {
    extra = 2;
    len = 126;
  } else {
    extra = 8;
    len = 127;
  }
  const frame = Buffer.alloc(2 + extra + (mask ? 4 : 0) + payload.length);
  frame[0] = 0x80 | opcode;
  frame[1] = (mask ? 0x80 : 0) | len;
  let offset = 2;
  if (len === 126) {
    frame.writeUInt16BE(payload.length, offset);
    offset += 2;
  } else if (len === 127) {
    frame.writeUInt32BE(0, offset);
    frame.writeUInt32BE(payload.length, offset + 4);
    offset += 8;
  }
  if (mask) {
    const m = randomBytes(4);
    m.copy(frame, offset);
    offset += 4;
    maskData(m, payload).copy(frame, offset);
  } else {
    Buffer.from(payload).copy(frame, offset);
  }
  return frame;
}

function decodeWsFrames(
  buffer: Buffer,
  onText: (text: string) => void,
  onClose: () => void
): Buffer {
  let i = 0;
  while (i + 2 <= buffer.length) {
    const byte1 = buffer[i]!;
    const byte2 = buffer[i + 1]!;
    const fin = (byte1 & 0x80) === 0x80;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) === 0x80;
    let len = byte2 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (i + 4 > buffer.length) break;
      len = buffer.readUInt16BE(i + 2);
      headerLen += 2;
    } else if (len === 127) {
      if (i + 10 > buffer.length) break;
      const hi = buffer.readUInt32BE(i + 2);
      const lo = buffer.readUInt32BE(i + 6);
      len = hi * 0x100000000 + lo;
      headerLen += 8;
    }
    if (masked) headerLen += 4;
    if (i + headerLen + len > buffer.length) break;
    let payload = buffer.subarray(i + headerLen, i + headerLen + len);
    if (masked) {
      const mask = buffer.subarray(i + headerLen - 4, i + headerLen);
      payload = maskData(mask, payload);
    }
    i += headerLen + len;
    if (!fin) {
      // Fragmented frames are not expected from the extension.
      continue;
    }
    if (opcode === 0x08) {
      onClose();
      return buffer.subarray(0, 0) as Buffer;
    }
    if (opcode === 0x01 || opcode === 0x02) {
      onText(payload.toString(opcode === 0x01 ? "utf8" : "latin1"));
    }
  }
  return buffer.subarray(i) as Buffer;
}

class WsTransport {
  private socket: Socket;
  private buffer: Uint8Array = Buffer.alloc(0);
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private onMessage?: (msg: Record<string, unknown>) => void;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer as Buffer, chunk as Buffer]);
      this.buffer = decodeWsFrames(
        this.buffer as Buffer,
        (text) => {
          try {
            const msg = JSON.parse(text) as Record<string, unknown>;
            const id = msg.id as string | undefined;
            if (id && this.pending.has(id)) {
              const p = this.pending.get(id)!;
              this.pending.delete(id);
              if (msg.error) {
                p.reject(new Error(String(msg.error)));
              } else {
                p.resolve(msg.result ?? null);
              }
            } else if (msg.type === "ping" || msg.method === "ping") {
              // Extension keep-alive ping; ignore.
            } else if (this.onMessage) {
              this.onMessage(msg);
            }
          } catch (e) {
            logger.warn({ err: String(e), text: text.slice(0, 200) }, "extension ws message parse failed");
          }
        },
        () => {
          socket.destroy();
        }
      );
    });
    socket.on("close", () => {
      for (const [, p] of this.pending) {
        p.reject(new Error("Extension WebSocket disconnected"));
      }
      this.pending.clear();
    });
  }

  send(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomBytes(8).toString("hex");
      const payload = Buffer.from(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        "utf8"
      );
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Extension command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      this.socket.write(encodeWsFrame(0x01, payload, false));
    });
  }

  setOnMessage(handler: (msg: Record<string, unknown>) => void): void {
    this.onMessage = handler;
  }
}

let transport: WsTransport | null = null;
let lastObservedError: Record<string, unknown> | null = null;

async function send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  if (!transport) throw new Error("Extension not connected");
  return transport.send(method, params, timeoutMs);
}

function assertConnected(): void {
  if (!transport) throw new Error("No Chrome extension connected. Install the extension and ensure TradingView is open.");
}

class ExtensionLocator implements LocatorLike {
  private page: ExtensionPage;
  private selector: string;

  constructor(page: ExtensionPage, selector: string) {
    this.page = page;
    this.selector = selector;
  }

  first(): LocatorLike {
    return new ExtensionLocator(this.page, `${this.selector}:first`);
  }

  nth(index: number): LocatorLike {
    return new ExtensionLocator(this.page, `${this.selector}:nth(${index})`);
  }

  async count(): Promise<number> {
    const res = (await send("query", { selector: this.selector })) as { matches: number };
    return res?.matches ?? 0;
  }

  async isVisible(options?: VisibleOptions): Promise<boolean> {
    const res = (await send("query", { selector: this.selector, timeout: options?.timeout })) as { matches: number };
    return (res?.matches ?? 0) > 0;
  }

  async innerText(): Promise<string> {
    const res = (await send("query", { selector: this.selector, property: "innerText" })) as {
      matches: number;
      results: Array<{ text?: string }>;
    };
    return res?.results?.[0]?.text ?? "";
  }

  async innerHTML(): Promise<string> {
    const res = (await send("query", { selector: this.selector, property: "innerHTML" })) as {
      results: Array<{ html?: string }>;
    };
    return res?.results?.[0]?.html ?? "";
  }

  async click(options?: ClickOptions): Promise<void> {
    await send("click", { selector: this.selector, force: options?.force });
  }

  async fill(value: string, options?: FillOptions): Promise<void> {
    await send("fill", { selector: this.selector, value });
  }

  async type(value: string, options?: { timeout?: number; delay?: number }): Promise<void> {
    await send("type", { selector: this.selector, value, delay: options?.delay });
  }

  async press(key: string): Promise<void> {
    await send("press", { selector: this.selector, key });
  }

  async focus(): Promise<void> {
    await send("focus", { selector: this.selector });
  }

  async waitFor(options?: WaitForOptions): Promise<void> {
    await send("waitFor", { selector: this.selector, state: options?.state ?? "attached", timeout: options?.timeout });
  }

  async boundingBox(): Promise<BoundingBox | null> {
    const res = (await send("query", { selector: this.selector, property: "boundingBox" })) as {
      results: Array<BoundingBox | null>;
    };
    return res?.results?.[0] ?? null;
  }

  async evaluate<T, A = unknown>(pageFunction: string | ((element: Element, arg: A) => T), arg?: A): Promise<T> {
    const fn = typeof pageFunction === "function" ? pageFunction.toString() : pageFunction;
    const res = (await send("evalOnSelector", { selector: this.selector, fn, arg })) as { result: T };
    return res?.result as T;
  }

  async isChecked(): Promise<boolean> {
    const res = (await send("query", { selector: this.selector, property: "checked" })) as {
      results: Array<{ checked?: boolean }>;
    };
    return res?.results?.[0]?.checked ?? false;
  }

  async selectOption(value: string | string[] | { value?: string; label?: string }): Promise<void> {
    const v = Array.isArray(value) ? value[0] : typeof value === "object" ? value.value ?? value.label : value;
    await send("select", { selector: this.selector, value: v });
  }
}

class ExtensionKeyboard implements KeyboardLike {
  async press(key: string): Promise<void> {
    await send("press", { key });
  }

  async insertText(text: string): Promise<void> {
    await send("insertText", { text });
  }
}

class ExtensionMouse implements MouseLike {
  async move(x: number, y: number, options?: { steps?: number }): Promise<void> {
    await send("mouseMove", { x, y, steps: options?.steps ?? 1 });
  }

  async click(x: number, y: number): Promise<void> {
    await send("mouseClick", { x, y });
  }
}

class ExtensionPage implements PageLike {
  private cachedUrl: string;
  keyboard = new ExtensionKeyboard();
  mouse = new ExtensionMouse();

  constructor(url: string) {
    this.cachedUrl = url;
  }

  async url(): Promise<string> {
    const res = (await send("getTabInfo")) as { url?: string };
    if (res?.url) this.cachedUrl = res.url;
    return this.cachedUrl;
  }

  async title(): Promise<string> {
    const res = (await send("getTabInfo")) as { title?: string };
    return res?.title ?? "";
  }

  async evaluate<T, A = unknown>(pageFunction: string | ((arg: A) => T), arg?: A): Promise<T> {
    const fn = typeof pageFunction === "function" ? pageFunction.toString() : pageFunction;
    const res = (await send("eval", { fn, arg })) as { result: T };
    return res?.result as T;
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async goto(url: string): Promise<void> {
    await send("goto", { url });
    this.cachedUrl = url;
  }

  async screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    const res = (await send("screenshot", { fullPage: options?.fullPage ?? false })) as { data?: string };
    const data = res?.data;
    if (!data) throw new Error("Extension screenshot returned no data");
    return new Uint8Array(Buffer.from(data, "base64"));
  }

  locator(selector: string): LocatorLike {
    return new ExtensionLocator(this, selector);
  }

  async waitForEvent(event: "download", options?: { timeout?: number }): Promise<DownloadLike> {
    throw new Error(`waitForEvent(${event}) is not supported by the extension driver`);
  }
}

class ExtensionTab implements TabInfoLike {
  page: ExtensionPage;
  url: string;
  title: string;
  tabId: number;

  constructor(url: string, title: string, tabId: number) {
    this.page = new ExtensionPage(url);
    this.url = url;
    this.title = title;
    this.tabId = tabId;
  }

  async refresh(): Promise<void> {
    const info = (await send("getTabInfo")) as { url?: string; title?: string; tabId?: number };
    if (info?.url) {
      this.url = info.url;
      this.page = new ExtensionPage(info.url);
    }
    if (info?.title) this.title = info.title;
    if (info?.tabId !== undefined) this.tabId = info.tabId;
  }
}

function isTradingViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "tradingview.com" || u.hostname === "www.tradingview.com";
  } catch {
    return false;
  }
}

export async function startExtensionServer(): Promise<void> {
  if (wsServer) return;
  wsServer = createServer((socket) => {
    let buffer = Buffer.alloc(0);

    function reject(status: string, message: string): void {
      socket.write(`HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\nContent-Length: ${message.length}\r\nConnection: close\r\n\r\n${message}`);
      socket.destroySoon();
    }

    function onHandshakeData(chunk: Buffer): void {
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      socket.off("data", onHandshakeData);
      const headers = buffer.subarray(0, headerEnd).toString("utf8");
      const key = headers.match(/Sec-WebSocket-Key:\s*(\S+)/i)?.[1];
      if (!key) return reject("400 Bad Request", "Missing Sec-WebSocket-Key");
      const url = headers.match(/GET\s+(\S+)\s+HTTP/i)?.[1] ?? "";
      const token = new URL(url, "http://127.0.0.1").searchParams.get("token");
      if (token !== WS_TOKEN) {
        return reject("403 Forbidden", "Invalid extension token");
      }
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      activeSocket = socket;
      transport = new WsTransport(socket);
      logger.info({ tokenSource: "env" }, "extension connected");
      transport.setOnMessage((msg) => {
        if (msg.method === "tv-state") {
          // Proactive state updates from the extension.
          logger.debug({ state: msg.params }, "extension tv-state update");
        } else if (msg.method === "tv-error") {
          lastObservedError = (msg.params as Record<string, unknown>) ?? null;
          logger.info({ error: String(lastObservedError?.error ?? "").slice(0, 200) }, "extension observed Pine error");
        }
      });
    }

    socket.on("data", onHandshakeData);

    socket.on("close", () => {
      if (activeSocket === socket) {
        activeSocket = null;
        transport = null;
        cachedTab = null;
      }
    });

    socket.on("error", (err) => {
      logger.warn({ err: String(err) }, "extension socket error");
    });
  });

  await new Promise<void>((resolve, reject) => {
    wsServer!.once("error", reject);
    wsServer!.listen(WS_PORT, "127.0.0.1", () => {
      wsServer!.off("error", reject);
      logger.info({ port: WS_PORT }, "extension WebSocket server listening");
      resolve();
    });
  });
}

export function getExtensionWsUrl(): string {
  return `ws://127.0.0.1:${WS_PORT}?token=${WS_TOKEN}`;
}

export async function getExtensionTab(): Promise<TabInfoLike | null> {
  assertConnected();
  if (cachedTab) {
    await cachedTab.refresh().catch(() => {});
    if (isTradingViewUrl(cachedTab.url)) return cachedTab;
  }
  const info = (await send("getTabInfo")) as { url?: string; title?: string; tabId?: number };
  if (!info?.url || !isTradingViewUrl(info.url)) return null;
  cachedTab = new ExtensionTab(info.url, info.title ?? "TradingView", info.tabId ?? 1);
  return cachedTab;
}

export async function listExtensionTabs(): Promise<Array<{ tabId: number; url: string; title: string }>> {
  if (!transport) return [];
  const tabs = (await send("listTabs").catch(() => [])) as Array<{ tabId: number; url: string; title: string }>;
  return tabs.filter((t) => isTradingViewUrl(t.url));
}

export function getLastObservedError(): Record<string, unknown> | null {
  return lastObservedError;
}

export function isExtensionConnected(): boolean {
  return transport !== null;
}

export class ExtensionDriver implements BrowserDriver {
  readonly name = "extension";

  async getTradingViewTab(): Promise<TabInfoLike | null> {
    return getExtensionTab();
  }

  async listTabs(): Promise<Array<{ tabId: number; url: string; title: string }>> {
    return listExtensionTabs();
  }

  async findTradingViewTabs(): Promise<TabInfoLike[]> {
    const tabs = (await send("listTabs").catch(() => [])) as Array<{ tabId: number; url: string; title: string }>;
    return tabs
      .filter((t) => isTradingViewUrl(t.url))
      .map((t) => new ExtensionTab(t.url, t.title, t.tabId));
  }

  async dispose(): Promise<void> {
    wsServer?.close();
    wsServer = null;
    transport = null;
    activeSocket = null;
    cachedTab = null;
  }
}
