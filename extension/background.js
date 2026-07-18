// Background service worker: identifies the active TradingView tab, pings the
// local MCP dashboard for connection status, and badges the TV tab.
const DASHBOARD = "http://127.0.0.1:3939/api/status";

async function getDashboardStatus() {
  try {
    const res = await fetch(DASHBOARD, { cache: "no-store" });
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { connected: false, error: String(e) };
  }
}

function badge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function refresh() {
  const tabs = await chrome.tabs.query({ url: "https://www.tradingview.com/*" });
  const status = await getDashboardStatus();
  if (status.connected) badge(status.emergencyStop ? "STOP" : "ON", status.emergencyStop ? "#d22" : "#2a8");
  else badge("OFF", "#888");

  // Store latest snapshot for the popup.
  await chrome.storage.local.set({
    snapshot: {
      ts: Date.now(),
      connected: status.connected,
      emergencyStop: status.emergencyStop,
      tabCount: status.tabCount,
      tvTab: status.tvTab,
      chart: status.chart,
      tvTabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
    },
  });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === "refresh") refresh(); });
chrome.alarms.create("refresh", { periodInMinutes: 0.1 }); // ~6s

chrome.runtime.onInstalled.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (tab.url && tab.url.startsWith("https://www.tradingview.com/") && info.status === "complete") refresh();
});
