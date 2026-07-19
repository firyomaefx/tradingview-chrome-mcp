/**
 * Extension service worker: WebSocket client for the local MCP server.
 *
 * Receives JSON-RPC commands from tradingview-chrome-mcp and executes them on
 * the active TradingView tab via chrome.scripting.executeScript({ world: "MAIN" }).
 */
const WS_PORT = 9223;
const DEFAULT_WS_TOKEN = "tradingview-chrome-mcp";
// Placeholder is replaced if the user packages the extension with a custom token;
// otherwise we fall back to the default local-only token.
const WS_TOKEN = "__TV_EXTENSION_TOKEN__".startsWith("__")
  ? DEFAULT_WS_TOKEN
  : "__TV_EXTENSION_TOKEN__";

let ws = null;
let reconnectTimer = null;
let injectedTabs = new Set();
let lastSnapshot = null;
let lastObservedError = null;

function getWsUrl() {
  const token = WS_TOKEN.startsWith("__") ? null : WS_TOKEN;
  return `ws://127.0.0.1:${WS_PORT}?token=${token ?? ""}`;
}

async function getTradingViewTabs() {
  return chrome.tabs.query({ url: "https://www.tradingview.com/*" });
}

async function ensureInjected(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["injected/commands.js", "injected/pine-injector.js"],
    });
    injectedTabs.add(tabId);
  } catch (e) {
    console.error("[tv-mcp] injection failed", e);
  }
}

async function runMainWorldCommand(tabId, method, params) {
  await ensureInjected(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (method, params) => {
      if (!window.__tvMcp || typeof window.__tvMcp[method] !== "function") {
        throw new Error(`Unknown command: ${method}`);
      }
      const out = window.__tvMcp[method](params);
      // Unwrap Promises returned by injected functions.
      return Promise.resolve(out).then((result) => ({
        __tvMcpResult: true,
        result,
      }));
    },
    args: [method, params ?? {}],
  });
  const frameResult = results?.[0]?.result;
  if (frameResult?.__tvMcpResult) {
    return frameResult.result;
  }
  // Some commands return plain values; handle gracefully.
  return frameResult;
}

async function getActiveTvTab() {
  const tabs = await chrome.tabs.query({
    url: "https://www.tradingview.com/*",
    active: true,
    currentWindow: true,
  });
  if (tabs.length) return tabs[0];
  const all = await getTradingViewTabs();
  return all[0] ?? null;
}

async function handleCommand(method, params) {
  if (method === "getTabInfo") {
    const tab = await getActiveTvTab();
    if (!tab) throw new Error("No TradingView tab found");
    const pageInfo = tab.id ? await runMainWorldCommand(tab.id, "getTabInfo", params) : {};
    return {
      ...pageInfo,
      url: tab.url,
      title: tab.title,
      tabId: tab.id,
      windowId: tab.windowId,
    };
  }

  if (method === "listTabs") {
    const tabs = await getTradingViewTabs();
    return tabs.map((t) => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }));
  }

  if (method === "getLastObservedError") {
    return lastObservedError ?? null;
  }

  if (method === "screenshot") {
    const tab = await getActiveTvTab();
    if (!tab || tab.id === undefined) throw new Error("No TradingView tab found");
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return { data: dataUrl.replace(/^data:image\/png;base64,/, "") };
  }

  const tab = await getActiveTvTab();
  if (!tab || tab.id === undefined) throw new Error("No TradingView tab found");
  return runMainWorldCommand(tab.id, method, params);
}

function connect() {
  if (ws) return;
  const url = getWsUrl();
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn("[tv-mcp] WebSocket create failed", e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.info("[tv-mcp] connected to MCP server");
    badge("ON", "#2a8");
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Keep-alive pings from either direction are ignored.
    if (msg.type === "ping" || msg.method === "ping") return;

    // Legacy action-style messages from alternative MCP transports.
    if (msg.action === "UPDATE_PINE_SCRIPT") {
      const tab = await getActiveTvTab();
      if (tab?.id) {
        try {
          await runMainWorldCommand(tab.id, "setPineSource", { source: msg.payload?.code ?? "" });
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ jsonrpc: "2.0", method: "tv-notify", params: { note: "Pine source updated via action message" } }));
          }
        } catch (e) {
          console.warn("[tv-mcp] UPDATE_PINE_SCRIPT failed", e);
        }
      }
      return;
    }

    const { id, method, params } = msg;
    if (!id) return; // notifications ignored for now
    try {
      const result = await handleCommand(method, params ?? {});
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: e.message ?? String(e) }));
    }
  };

  ws.onclose = () => {
    ws = null;
    badge("OFF", "#888");
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.warn("[tv-mcp] WebSocket error", e);
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3_000);
}

function badge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ---------------------------------------------------------------------------
// Snapshot reporting (keeps popup useful)
// ---------------------------------------------------------------------------

async function takeSnapshot() {
  const tabs = await getTradingViewTabs();
  const active = tabs.find((t) => t.active);
  let chart = null;
  if (active?.id) {
    try {
      await ensureInjected(active.id);
      const res = await chrome.scripting.executeScript({
        target: { tabId: active.id },
        world: "MAIN",
        func: () => {
          const sym = document.querySelector('button[aria-label="Change symbol"]')?.innerText?.trim() ?? null;
          const tf = document.querySelector('button[aria-label="Change interval"]')?.innerText?.trim() ?? null;
          return { symbol: sym, timeframe: tf, url: location.href };
        },
      });
      chart = res?.[0]?.result ?? null;
    } catch {}
  }
  lastSnapshot = {
    ts: Date.now(),
    connected: !!ws,
    tabCount: tabs.length,
    tvTab: active ? { id: active.id, title: active.title, url: active.url } : null,
    chart,
    tvTabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
  };
  await chrome.storage.local.set({ snapshot: lastSnapshot });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "snapshot") takeSnapshot();
  if (a.name === "reconnect") connect();
  if (a.name === "ping") {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
    }
    connect();
  }
});
chrome.alarms.create("snapshot", { periodInMinutes: 0.1 });
chrome.alarms.create("reconnect", { periodInMinutes: 0.5 });
chrome.alarms.create("ping", { periodInMinutes: 0.33 }); // ~20s keep-alive

chrome.runtime.onInstalled.addListener(() => {
  connect();
  takeSnapshot();
});
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (tab.url?.startsWith("https://www.tradingview.com/") && info.status === "complete") {
    injectedTabs.delete(id);
    takeSnapshot();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "tv-snapshot") {
    lastSnapshot = { ...lastSnapshot, chart: message.data, ts: Date.now() };
    return false;
  }

  if (message?.type === "PINE_SCRIPT_ERROR_DETECTED") {
    const payload = message.payload;
    lastObservedError = payload;
    console.warn("[tv-mcp] observed Pine error", payload.error.slice(0, 200));
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "tv-error",
          params: { ...payload, tabId: sender.tab?.id },
        })
      );
    }
    sendResponse({ received: true });
    return true;
  }

  if (message?.type === "GET_LAST_ERROR") {
    sendResponse(lastObservedError);
    return true;
  }

  return false;
});

connect();
takeSnapshot();
