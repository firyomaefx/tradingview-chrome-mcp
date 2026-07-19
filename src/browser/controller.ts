/**
 * Browser controller.
 *
 * Priority:
 *   1. Attach to the user's existing Chrome session via CDP.
 *   2. If no debug endpoint is reachable and TV_ALLOW_REAL_PROFILE=1, launch the
 *      user's real Chrome with --remote-debugging-port=9222 using their
 *      existing user-data-dir.
 *   3. Otherwise launch a fresh temporary Chrome profile on the debug port.
 *
 * Defaulting to a temp profile keeps the user's real profile, cookies, and
 * extensions isolated. Set TV_ALLOW_REAL_PROFILE=1 to reuse your logged-in
 * profile; this also enables --remote-allow-origins=* because a real-profile
 * launch otherwise cannot reliably accept CDP connections from Playwright.
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Backwards-compatible alias used by older code. */
export type TradingViewTab = TabInfo;

const CDP_URL = process.env.TV_CDP_URL ?? "http://127.0.0.1:9222";
const CDP_PORT = 9222;
const LAUNCH_TIMEOUT_MS = 30_000;
const DEFAULT_TV_URL = process.env.TV_DEFAULT_TRADINGVIEW_URL ?? "https://www.tradingview.com/chart/";

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

function tempUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), "tv-mcp-chrome-"));
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

async function navigateToDefaultUrl(page: import("playwright").Page): Promise<void> {
  try {
    const current = page.url();
    if (!isTradingViewUrl(current) || current === "about:blank") {
      await page.goto(DEFAULT_TV_URL, { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.waitForTimeout(1500);
      logger.info({ url: DEFAULT_TV_URL }, "Navigated Chrome to default TradingView URL");
    }
  } catch (err) {
    logger.warn({ err: String(err), url: DEFAULT_TV_URL }, "Could not navigate to default TradingView URL");
  }
}

export function isTradingViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "tradingview.com" || u.hostname === "www.tradingview.com";
  } catch {
    return false;
  }
}

async function launchChromeWithDebugPort(): Promise<import("playwright").Browser | null> {
  const exe = chromeExecutable();
  if (!exe) {
    logger.warn("No Chrome executable found; set TV_CHROME_PATH or start Chrome with --remote-debugging-port=9222");
    return null;
  }

  const allowRealProfile = process.env.TV_ALLOW_REAL_PROFILE === "1";
  const userDataDir = allowRealProfile ? chromeUserDataDir() : tempUserDataDir();

  if (allowRealProfile) {
    logger.warn(
      "TV_ALLOW_REAL_PROFILE=1: reusing the user's real Chrome profile. " +
        "This exposes cookies, extensions, and login sessions to the MCP server."
    );
  } else {
    logger.info({ userDataDir }, "Launching Chrome with a temporary profile for isolation");
  }

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (allowRealProfile) {
    // Required for Playwright to attach to a real-profile Chrome instance
    // across origin boundaries on some platforms.
    args.push("--remote-allow-origins=*");
  }

  launchedProc = spawn(exe, [...args, DEFAULT_TV_URL], { detached: false, stdio: "ignore" });
  launchedProc.unref();

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const browser = await tryConnectCDP();
    if (browser) {
      try {
        const firstPage = browser.contexts()[0]?.pages()[0];
        if (firstPage) await navigateToDefaultUrl(firstPage);
      } catch {
        /* ignore navigation errors */
      }
      return browser;
    }
  }
  logger.error("Chrome was launched but the CDP endpoint never became reachable");
  return null;
}

export async function getBrowser(): Promise<import("playwright").Browser | null> {
  if (cachedBrowser) {
    try {
      await cachedBrowser.contexts()[0]?.pages()[0]?.evaluate(() => true);
      return cachedBrowser;
    } catch {
      cachedBrowser = null;
    }
  }
  cachedBrowser = await tryConnectCDP();
  if (!cachedBrowser) {
    cachedBrowser = await launchChromeWithDebugPort();
  }
  return cachedBrowser;
}

export async function getTradingViewTab(): Promise<TabInfo | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const pages = browser.contexts().flatMap((c) => c.pages());
  let idx = 0;
  for (const page of pages) {
    idx++;
    const url = page.url();
    if (isTradingViewUrl(url)) {
      return {
        page,
        context: page.context(),
        browser,
        url,
        title: await page.title().catch(() => ""),
        tabId: idx,
      };
    }
  }
  return null;
}

export async function listTabs(): Promise<Array<{ url: string; title: string; tabId: number }>> {
  const browser = await getBrowser();
  if (!browser) return [];
  let idx = 0;
  return browser
    .contexts()
    .flatMap((c) => c.pages())
    .map((page) => ({
      url: page.url(),
      title: page.url(),
      tabId: ++idx,
    }));
}

export async function findTradingViewTabs(): Promise<TabInfo[]> {
  const browser = await getBrowser();
  if (!browser) return [];
  let idx = 0;
  return browser
    .contexts()
    .flatMap((c) => c.pages())
    .filter((page) => isTradingViewUrl(page.url()))
    .map((page) => ({
      page,
      context: page.context(),
      browser,
      url: page.url(),
      title: page.url(),
      tabId: ++idx,
    }));
}

export function isChromeLaunchedByUs(): boolean {
  return launchedProc !== null && !launchedProc.killed;
}
