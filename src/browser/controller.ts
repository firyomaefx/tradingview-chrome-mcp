/**
 * Browser controller.
 *
 * Priority:
 *   1. Attach to the user's existing Chrome session via CDP.
 *   2. If no debug endpoint is reachable, launch the user's real Chrome with
 *      --remote-debugging-port=9222 using their existing user-data-dir.
 *   3. Use Playwright over CDP for all interaction (no separate profile).
 *
 * Never launches a temp profile unless explicitly requested via
 * TV_ALLOW_TEMP_PROFILE=1.
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logging/logger.js";

export interface TabInfo {
  page: import("playwright").Page;
  context: import("playwright").BrowserContext;
  browser: import("playwright").Browser;
  url: string;
  title: string;
  tabId: number;
}

const CDP_URL = process.env.TV_CDP_URL ?? "http://127.0.0.1:9222";
const CDP_PORT = 9222;
const LAUNCH_TIMEOUT_MS = 30_000;

let cachedBrowser: import("playwright").Browser | null = null;
let launchedProc: ChildProcess | null = null;

function chromeExecutable(): string | null {
  const candidates = [
    process.env.TV_CHROME_PATH,
    join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["LocalAppData"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function chromeUserDataDir(): string {
  return (
    process.env.TV_CHROME_USER_DATA ??
    join(process.env["LocalAppData"] ?? "C:\\Users\\Public", "Google", "Chrome", "User Data")
  );
}

async function tryConnectCDP(): Promise<import("playwright").Browser | null> {
  try {
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5_000 });
    logger.info({ cdp: CDP_URL }, "Connected to existing Chrome over CDP");
    return browser;
  } catch (err) {
    logger.debug({ err: String(err) }, "CDP connect failed; will try to launch Chrome");
    return null;
  }
}

async function launchChromeWithDebugPort(): Promise<import("playwright").Browser | null> {
  if (process.env.TV_ALLOW_TEMP_PROFILE === "1") return null;
  const exe = chromeExecutable();
  if (!exe) {
    logger.warn("No Chrome executable found; set TV_CHROME_PATH or start Chrome with --remote-debugging-port=9222");
    return null;
  }
  const udd = chromeUserDataDir();
  logger.info({ exe, udd }, "Launching user's Chrome with remote debugging on port 9222");
  launchedProc = spawn(
    exe,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${udd}`,
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { detached: false, stdio: "ignore" }
  );
  launchedProc.unref();

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const browser = await tryConnectCDP();
    if (browser) return browser;
  }
  logger.error("Chrome was launched but the CDP endpoint never became reachable");
  return null;
}

export async function getBrowser(): Promise<import("playwright").Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  const existing = await tryConnectCDP();
  if (existing) {
    cachedBrowser = existing;
    return existing;
  }
  // Only auto-launch the user Chrome if explicitly enabled. By default we
  // require the user to start Chrome with --remote-debugging-port=9222 so we
  // never silently re-launch a profile that is already in use (which would
  // focus the existing process without enabling the debug port).
  if (process.env.TV_ALLOW_CHROME_LAUNCH === "1") {
    const launched = await launchChromeWithDebugPort();
    if (launched) {
      cachedBrowser = launched;
      return launched;
    }
  }
  throw new Error(
    "Could not connect to Chrome. Start Chrome with --remote-debugging-port=9222 (close other Chrome windows first), or set TV_ALLOW_CHROME_LAUNCH=1 and TV_CHROME_PATH."
  );
}

export async function closeBrowser(): Promise<void> {
  if (cachedBrowser) {
    try {
      await cachedBrowser.close();
    } catch {
      /* ignore */
    }
    cachedBrowser = null;
  }
  if (launchedProc && !launchedProc.killed) {
    try {
      launchedProc.kill();
    } catch {
      /* ignore */
    }
    launchedProc = null;
  }
}

export async function listTabs(): Promise<TabInfo[]> {
  const browser = await getBrowser();
  const contexts = browser.contexts();
  const tabs: TabInfo[] = [];
  let id = 1;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      tabs.push({ page, context: ctx, browser, url, title, tabId: id++ });
    }
  }
  return tabs;
}

export interface TradingViewTab extends TabInfo {
  isTradingView: true;
}

export function isTradingViewUrl(url: string): boolean {
  return /https:\/\/(www\.)?tradingview\.com\//i.test(url);
}

export async function findTradingViewTabs(): Promise<TradingViewTab[]> {
  const tabs = await listTabs();
  return tabs.filter((t) => isTradingViewUrl(t.url)).map((t) => ({ ...t, isTradingView: true as const }));
}

export async function getTradingViewTab(preferred?: { tabId?: number; titleContains?: string }): Promise<TradingViewTab> {
  const tvTabs = await findTradingViewTabs();
  if (tvTabs.length === 0) {
    throw new Error("No open TradingView tab found. Open https://www.tradingview.com/chart/ in Chrome first.");
  }
  let chosen: TradingViewTab | undefined;
  if (preferred?.tabId) {
    const t = tvTabs.find((x) => x.tabId === preferred.tabId);
    if (t) chosen = t;
  }
  if (preferred?.titleContains) {
    const q = preferred.titleContains.toLowerCase();
    const t = tvTabs.find((x) => x.title.toLowerCase().includes(q));
    if (t) chosen = t;
  }
  // Prefer chart tabs, then first available.
  const chartTab = tvTabs.find((t) => /tradingview\.com\/chart\//i.test(t.url));
  const final: TradingViewTab = chosen ?? chartTab ?? tvTabs[0]!;
  // Bring the tab to the front so the chart legend and toolbar render
  // (TradingView lazily renders these only when the tab is active).
  await final.page.bringToFront().catch(() => {});
  await final.page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  return final;
}

