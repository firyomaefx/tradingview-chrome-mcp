/**
 * Page-like abstraction used by the TradingView adapter.
 *
 * The adapter historically depended on Playwright's Page/Locator API. To
 * support both the Playwright/CDP driver and the Chrome-extension driver,
 * we declare a minimal, stable subset of those APIs here. Both drivers
 * return implementations of these interfaces.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  path?: string;
  fullPage?: boolean;
  type?: "png" | "jpeg";
}

export interface GotoOptions {
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  timeout?: number;
}

export interface VisibleOptions {
  timeout?: number;
}

export interface ClickOptions {
  timeout?: number;
  force?: boolean;
}

export interface FillOptions {
  timeout?: number;
}

export interface TypeOptions {
  timeout?: number;
  delay?: number;
}

export interface WaitForOptions {
  state?: "attached" | "detached" | "visible" | "hidden";
  timeout?: number;
}

export interface MouseMoveOptions {
  steps?: number;
}

export interface LocatorLike {
  first(): LocatorLike;
  nth(index: number): LocatorLike;
  count(): Promise<number>;
  isVisible(options?: VisibleOptions): Promise<boolean>;
  innerText(options?: { timeout?: number }): Promise<string>;
  innerHTML(options?: { timeout?: number }): Promise<string>;
  click(options?: ClickOptions): Promise<void>;
  fill(value: string, options?: FillOptions): Promise<void>;
  type(value: string, options?: TypeOptions): Promise<void>;
  press(key: string): Promise<void>;
  focus(): Promise<void>;
  waitFor(options?: WaitForOptions): Promise<void>;
  boundingBox(): Promise<BoundingBox | null>;
  evaluate<T, A = unknown>(pageFunction: string | ((element: Element, arg: A) => T), arg?: A): Promise<T>;
  isChecked(): Promise<boolean>;
  selectOption(value: string | string[] | { value?: string; label?: string }): Promise<void>;
}

export interface KeyboardLike {
  press(key: string): Promise<void>;
  insertText(text: string): Promise<void>;
}

export interface MouseLike {
  move(x: number, y: number, options?: MouseMoveOptions): Promise<void>;
  click(x: number, y: number): Promise<void>;
}

export interface DownloadLike {
  saveAs(path: string): Promise<void>;
}

export interface PageLike {
  url(): Promise<string>;
  title(): Promise<string>;
  evaluate<T, A = unknown>(pageFunction: string | ((arg: A) => T), arg?: A): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  goto(url: string, options?: GotoOptions): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  locator(selector: string): LocatorLike;
  keyboard: KeyboardLike;
  mouse: MouseLike;
  waitForEvent(event: "download", options?: { timeout?: number }): Promise<DownloadLike>;
}

export interface TabInfoLike {
  page: PageLike;
  url: string;
  title: string;
  tabId: number;
}

export interface BrowserDriver {
  readonly name: string;
  /**
   * Return the active TradingView tab, or null if none is reachable.
   * Implementations should create/return cached state as appropriate.
   */
  getTradingViewTab(): Promise<TabInfoLike | null>;
  /**
   * List all open tabs that the driver can see.
   */
  listTabs(): Promise<Array<{ tabId: number; url: string; title: string }>>;
  /**
   * List only TradingView tabs.
   */
  findTradingViewTabs(): Promise<TabInfoLike[]>;
  /**
   * Optional screenshot capability. Returns null if unsupported.
   */
  screenshot?(options?: { fullPage?: boolean }): Promise<Uint8Array | null>;
  /**
   * Tear down the driver.
   */
  dispose?(): Promise<void>;
}
