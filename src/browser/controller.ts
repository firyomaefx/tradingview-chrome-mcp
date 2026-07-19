/**
 * Browser controller.
 *
 * Selects between two browser drivers:
 *   - `playwright` (default): attaches to Chrome via CDP or launches a temp Chrome.
 *   - `extension`: accepts a connection from the Chrome extension over a local
 *     WebSocket and routes DOM commands through `executeScript({ world: "MAIN" })`.
 *
 * Both drivers expose the same PageLike interface, so the rest of the server
 * (tools, adapter, autofix) is driver-agnostic.
 */
import { chromium } from "playwright";
import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "../logging/logger.js";
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
import { ExtensionDriver, startExtensionServer } from "./extension-driver.js";
import { config } from "../config.js";

export interface TabInfo extends TabInfoLike {
  /** Backwards-compatible Playwright context; undefined for extension driver. */
  context?: import("playwright").BrowserContext;
  /** Backwards-compatible Playwright browser; undefined for extension driver. */
  browser?: import("playwright").Browser;
}

/** Backwards-compatible alias used by older code. */
export type TradingViewTab = TabInfo;

const CDP_URL = process.env.TV_CDP_URL ?? "http://127.0.0.1:9222";
const CDP_PORT = 9222;
const LAUNCH_TIMEOUT_MS = 30_000;
const DEFAULT_TV_URL = process.env.TV_DEFAULT_TRADINGVIEW_URL ?? "https://www.tradingview.com/chart/";

let selectedDriver: BrowserDriver | null = null;
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

export function isTradingViewUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "tradingview.com" || u.hostname === "www.tradingview.com";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Playwright Page/Locator wrappers
// ---------------------------------------------------------------------------

class PlaywrightLocator implements LocatorLike {
  private locator: import("playwright").Locator;

  constructor(locator: import("playwright").Locator) {
    this.locator = locator;
  }

  first(): LocatorLike {
    return new PlaywrightLocator(this.locator.first());
  }

  nth(index: number): LocatorLike {
    return new PlaywrightLocator(this.locator.nth(index));
  }

  count(): Promise<number> {
    return this.locator.count();
  }

  isVisible(options?: VisibleOptions): Promise<boolean> {
    return this.locator.isVisible({ timeout: options?.timeout }).catch(() => false);
  }

  innerText(options?: { timeout?: number }): Promise<string> {
    return this.locator.innerText({ timeout: options?.timeout }).catch(() => "");
  }

  innerHTML(options?: { timeout?: number }): Promise<string> {
    return this.locator.innerHTML({ timeout: options?.timeout }).catch(() => "");
  }

  click(options?: ClickOptions): Promise<void> {
    return this.locator.click({ timeout: options?.timeout, force: options?.force }).catch(() => {});
  }

  fill(value: string, options?: FillOptions): Promise<void> {
    return this.locator.fill(value, { timeout: options?.timeout }).catch(() => {});
  }

  type(value: string, options?: { timeout?: number; delay?: number }): Promise<void> {
    return this.locator.type(value, { timeout: options?.timeout, delay: options?.delay }).catch(() => {});
  }

  press(key: string): Promise<void> {
    return this.locator.press(key).catch(() => {});
  }

  focus(): Promise<void> {
    return this.locator.focus().catch(() => {});
  }

  waitFor(options?: WaitForOptions): Promise<void> {
    return this.locator.waitFor({ state: options?.state, timeout: options?.timeout }).catch(() => {});
  }

  boundingBox(): Promise<BoundingBox | null> {
    return this.locator.boundingBox().catch(() => null);
  }

  evaluate<T, A = unknown>(pageFunction: string | ((element: Element, arg: A) => T), arg?: A): Promise<T> {
    if (typeof pageFunction === "function") {
      return this.locator.evaluate(pageFunction as any, arg).catch(() => null as T) as Promise<T>;
    }
    const fn = new Function(`return (${pageFunction})`)() as any;
    return this.locator.evaluate(fn, arg).catch(() => null as T) as Promise<T>;
  }

  isChecked(): Promise<boolean> {
    return this.locator.isChecked().catch(() => false);
  }

  selectOption(value: string | string[] | { value?: string; label?: string }): Promise<void> {
    return this.locator.selectOption(value as any).then(() => {}).catch(() => {});
  }
}

class PlaywrightKeyboard implements KeyboardLike {
  private keyboard: import("playwright").Keyboard;
  constructor(keyboard: import("playwright").Keyboard) {
    this.keyboard = keyboard;
  }
  press(key: string): Promise<void> {
    return this.keyboard.press(key).catch(() => {});
  }
  insertText(text: string): Promise<void> {
    return this.keyboard.insertText(text).catch(() => {});
  }
}

class PlaywrightMouse implements MouseLike {
  private mouse: import("playwright").Mouse;
  constructor(mouse: import("playwright").Mouse) {
    this.mouse = mouse;
  }
  move(x: number, y: number, options?: { steps?: number }): Promise<void> {
    return this.mouse.move(x, y, { steps: options?.steps }).catch(() => {});
  }
  click(x: number, y: number): Promise<void> {
    return this.mouse.click(x, y).catch(() => {});
  }
}

class PlaywrightPage implements PageLike {
  private page: import("playwright").Page;
  keyboard: KeyboardLike;
  mouse: MouseLike;

  constructor(page: import("playwright").Page) {
    this.page = page;
    this.keyboard = new PlaywrightKeyboard(page.keyboard);
    this.mouse = new PlaywrightMouse(page.mouse);
  }

  url(): Promise<string> {
    return Promise.resolve(this.page.url());
  }

  title(): Promise<string> {
    return this.page.title().catch(() => "");
  }

  evaluate<T, A = unknown>(pageFunction: string | ((arg: A) => T), arg?: A): Promise<T> {
    if (typeof pageFunction === "function") {
      return this.page.evaluate(pageFunction as any, arg).catch(() => null as T) as Promise<T>;
    }
    const fn = new Function(`return (${pageFunction})`)() as any;
    return this.page.evaluate(fn, arg).catch(() => null as T) as Promise<T>;
  }

  waitForTimeout(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }

  goto(url: string, options?: GotoOptions): Promise<void> {
    return this.page
      .goto(url, { waitUntil: options?.waitUntil ?? "domcontentloaded", timeout: options?.timeout })
      .then(() => {});
  }

  screenshot(options?: ScreenshotOptions): Promise<Uint8Array> {
    return this.page.screenshot({
      path: options?.path,
      fullPage: options?.fullPage,
      type: options?.type,
    }) as Promise<Uint8Array>;
  }

  locator(selector: string): LocatorLike {
    return new PlaywrightLocator(this.page.locator(selector));
  }

  waitForEvent(event: "download", options?: { timeout?: number }): Promise<DownloadLike> {
    return this.page.waitForEvent(event, { timeout: options?.timeout }) as Promise<DownloadLike>;
  }
}

// ---------------------------------------------------------------------------
// Playwright driver
// ---------------------------------------------------------------------------

class PlaywrightDriver implements BrowserDriver {
  readonly name = "playwright";
  private cachedBrowser: import("playwright").Browser | null = null;

  async getBrowser(): Promise<import("playwright").Browser | null> {
    if (this.cachedBrowser) {
      try {
        await this.cachedBrowser.contexts()[0]?.pages()[0]?.evaluate(() => true);
        return this.cachedBrowser;
      } catch {
        this.cachedBrowser = null;
      }
    }
    this.cachedBrowser = await this.tryConnectCDP();
    if (!this.cachedBrowser) {
      this.cachedBrowser = await this.launchChromeWithDebugPort();
    }
    return this.cachedBrowser;
  }

  private async tryConnectCDP(): Promise<import("playwright").Browser | null> {
    try {
      const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5_000 });
      logger.info({ cdp: CDP_URL }, "Connected to existing Chrome over CDP");
      return browser;
    } catch (err) {
      logger.debug({ err: String(err) }, "CDP connect failed; will try to launch Chrome");
      return null;
    }
  }

  private async launchChromeWithDebugPort(): Promise<import("playwright").Browser | null> {
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
    if (allowRealProfile) args.push("--remote-allow-origins=*");

    launchedProc = spawn(exe, [...args, DEFAULT_TV_URL], { detached: false, stdio: "ignore" });
    launchedProc.unref();

    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      const browser = await this.tryConnectCDP();
      if (browser) {
        const firstPage = browser.contexts()[0]?.pages()[0];
        if (firstPage) await this.navigateToDefaultUrl(firstPage);
        return browser;
      }
    }
    logger.error("Chrome was launched but the CDP endpoint never became reachable");
    return null;
  }

  private async navigateToDefaultUrl(page: import("playwright").Page): Promise<void> {
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

  async getTradingViewTab(): Promise<TabInfo | null> {
    const browser = await this.getBrowser();
    if (!browser) return null;
    const pages = browser.contexts().flatMap((c) => c.pages());
    let idx = 0;
    for (const page of pages) {
      idx++;
      const url = page.url();
      if (isTradingViewUrl(url)) {
        return {
          page: new PlaywrightPage(page),
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

  async listTabs(): Promise<Array<{ url: string; title: string; tabId: number }>> {
    const browser = await this.getBrowser();
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

  async findTradingViewTabs(): Promise<TabInfo[]> {
    const browser = await this.getBrowser();
    if (!browser) return [];
    let idx = 0;
    return browser
      .contexts()
      .flatMap((c) => c.pages())
      .filter((page) => isTradingViewUrl(page.url()))
      .map((page) => ({
        page: new PlaywrightPage(page),
        context: page.context(),
        browser,
        url: page.url(),
        title: page.url(),
        tabId: ++idx,
      }));
  }

  async dispose(): Promise<void> {
    if (this.cachedBrowser) {
      await this.cachedBrowser.close().catch(() => {});
      this.cachedBrowser = null;
    }
    if (launchedProc && !launchedProc.killed) {
      launchedProc.kill();
      launchedProc = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------

export async function getBrowserDriver(): Promise<BrowserDriver> {
  if (selectedDriver) return selectedDriver;

  if (config.browserDriver === "extension") {
    await startExtensionServer();
    selectedDriver = new ExtensionDriver();
    logger.info({ driver: "extension" }, "using extension browser driver");
    return selectedDriver;
  }

  selectedDriver = new PlaywrightDriver();
  logger.info({ driver: "playwright" }, "using playwright browser driver");
  return selectedDriver;
}

export async function getTradingViewTab(): Promise<TabInfo | null> {
  const driver = await getBrowserDriver();
  const tab = await driver.getTradingViewTab();
  if (!tab) return null;
  return {
    page: tab.page,
    url: tab.url,
    title: tab.title,
    tabId: tab.tabId,
  };
}

export async function findTradingViewTabs(): Promise<TabInfo[]> {
  const driver = await getBrowserDriver();
  const tabs = await driver.findTradingViewTabs();
  return tabs.map((t) => ({
    page: t.page,
    url: t.url,
    title: t.title,
    tabId: t.tabId,
  }));
}

export async function listTabs(): Promise<Array<{ url: string; title: string; tabId: number }>> {
  const driver = await getBrowserDriver();
  return driver.listTabs();
}

export function isChromeLaunchedByUs(): boolean {
  return launchedProc !== null && !launchedProc.killed;
}

export async function getBrowser(): Promise<import("playwright").Browser | null> {
  const driver = await getBrowserDriver();
  if (driver instanceof PlaywrightDriver) {
    return driver.getBrowser();
  }
  return null;
}
