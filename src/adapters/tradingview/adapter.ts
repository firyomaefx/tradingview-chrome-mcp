/**
 * TradingView DOM adapter.
 *
 * All page-level interactions go here so selectors are centralized and can
 * be updated without touching tool definitions. Every reader is defensive:
 * it tries multiple selector strategies and falls back to URL parsing.
 */
import type { LocatorLike, PageLike } from "../../browser/driver-types.js";
import { logger } from "../../logging/logger.js";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { paths } from "../../logging/logger.js";
import { getLastObservedError } from "../../browser/extension-driver.js";

export interface ChartState {
  url: string;
  symbol: string | null;
  timeframe: string | null;
  isLoggedIn: boolean;
  pineEditorOpen: boolean;
  pineEditorReady: boolean;
  dialogs: string[];
  pageReady: boolean;
  diagnostics: {
    chromeReachable: boolean;
    tradingViewTabFound: boolean;
    pageDomReady: boolean;
  };
}

export interface PineRead {
  scriptName: string | null;
  source: string | null;
  editorHasUnsavedChanges: boolean;
}

export interface CompileResult {
  hasErrors: boolean;
  errors: string[];
  hasWarnings: boolean;
  warnings: string[];
  success: boolean;
}

export interface ChartMetadata {
  visibleIndicators: string[];
  strategies: string[];
  overlays: string[];
  paneCount: number;
  symbol: string | null;
  timeframe: string | null;
}

export interface StrategyTesterSummary {
  visible: boolean;
  netProfit: string | null;
  totalTrades: string | null;
  winRate: string | null;
  raw: Record<string, string | null>;
}

const TV_ROOT = "https://www.tradingview.com";

function isChartUrl(url: string): boolean {
  return /tradingview\.com\/chart\//i.test(url);
}

async function textOf(page: PageLike, selectors: string[], timeout = 1500): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const seen = await el.isVisible({ timeout }).catch(() => false);
      if (seen) {
        const t = (await el.innerText().catch(() => ""))?.trim();
        if (t) return t;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export function parseSymbolFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const fromQuery = u.searchParams.get("symbol") ?? u.searchParams.get("tvchartsymbol");
    if (fromQuery) return fromQuery;
    const fromHash = u.hash.match(/symbol=([^&]+)/i);
    if (fromHash) return decodeURIComponent(fromHash[1]!);
    return null;
  } catch {
    return null;
  }
}

/** Map TradingView URL interval codes to the canonical timeframe strings. */
const URL_INTERVAL_MAP: Record<string, string> = {
  "1": "1", "5": "5", "15": "15", "30": "30", "45": "45",
  "60": "60", "120": "120", "180": "180", "240": "240", "1D": "D", "D": "D",
  "1W": "W", "W": "W", "1M": "M", "M": "M",
};

export function parseTimeframeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const iv = u.searchParams.get("interval") ?? u.hash.match(/interval=([^&]+)/i)?.[1];
    if (!iv) return null;
    const key = decodeURIComponent(iv);
    if (URL_INTERVAL_MAP[key]) return URL_INTERVAL_MAP[key];
    // Numeric minutes pass through.
    return /^\d+$/.test(key) ? key : key;
  } catch {
    return null;
  }
}

export async function readChartState(page: PageLike): Promise<ChartState> {
  const url = await page.url();

  // Symbol: header symbol button, with URL fallback.
  const symbolText = await textOf(page, [
    'button[aria-label="Change symbol"]',
    '[data-qa-id="header-toolbar-symbol-search"]',
    '[class*="header-toolbar"] button[aria-label*="ymbol"]',
    'button[aria-label*="Symbol search"]',
    'div.symbol-edit-widget button',
  ]);
  let symbol: string | null = symbolText ?? parseSymbolFromUrl(url);

  // Timeframe: header timeframe button.
  const tfText = await textOf(page, [
    'button[aria-label="Change interval"]',
    '[data-qa-id="timeframe-select"]',
    'button[aria-label*="imeframe"]',
    'button[aria-label*="Interval"]',
    '[class*="header-toolbar"] button[data-name="menu-regular-button"]',
  ]);
  const timeframe = tfText ?? parseTimeframeFromUrl(url);

  const isLoggedIn = await page
    .locator('a[href*="/u/"], [data-qa-id="user-menu"], [class*="signin"]')
    .first()
    .isVisible({ timeout: 800 })
    .then(() => true)
    .catch(() => false);

  const pineEditorOpen = await page
    .locator('button[data-name="pine-dialog-button"][aria-expanded="true"], [class*="pine-editor"], .monaco-editor')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  const pineEditorReady = pineEditorOpen && (await hasMonacoEditor(page));

  const dialogs = await readDialogs(page);

  const pageReady = await page
    .locator('canvas, [data-qa-id="chart-pane"]')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);

  return {
    url,
    symbol,
    timeframe,
    isLoggedIn,
    pineEditorOpen,
    pineEditorReady,
    dialogs,
    pageReady,
    diagnostics: {
      chromeReachable: true,
      tradingViewTabFound: /https:\/\/(www\.)?tradingview\.com\//i.test(url),
      pageDomReady: pageReady,
    },
  };
}

async function readDialogs(page: PageLike): Promise<string[]> {
  // Only report real dialogs: visible [role="dialog"] or TradingView's
  // data-name="*-dialog" containers. Exclude watchlist-details scroll wraps
  // and other persistent panels that matched the old broad selectors.
  const found: string[] = [];
  const candidates = [
    '[role="dialog"]',
    '[data-name$="-dialog"]',
    '[data-name="pine-dialog"]',
    '[class*="modal"][class*="dialog"]',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < count && i < 8; i++) {
      const el = loc.nth(i);
      const visible = await el.isVisible({ timeout: 300 }).catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width < 120 || box.height < 80) continue;
      const t = (await el.innerText().catch(() => "")).trim();
      if (t.length === 0) continue;
      const key = t.slice(0, 120);
      if (!found.includes(key)) found.push(key);
    }
    if (found.length) break;
  }
  return found;
}

export async function hasMonacoEditor(page: PageLike): Promise<boolean> {
  return page
    .locator('.monaco-editor, [class*="code-editor"], textarea[class*="editor"]')
    .first()
    .isVisible({ timeout: 1000 })
    .catch(() => false);
}

export async function openPineEditor(page: PageLike): Promise<{ opened: boolean; alreadyOpen: boolean }> {
  // Clear any stray menus/overlays left by previous interactions.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  const state = await readChartState(page);
  if (state.pineEditorOpen) return { opened: false, alreadyOpen: true };

  const candidates = [
    'button[data-name="pine-dialog-button"]',
    'button[aria-label="Pine"]',
    'button[data-name="Pine Editor"]',
    '[data-qa-id="bottom-panel-pine-editor"]',
    'button:has-text("Pine Editor")',
    'a:has-text("Pine Editor")',
  ];
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const sel of candidates) {
      try {
        // Eval-click first: it bypasses TradingView's overlay interception
        // (a stray slider/menu overlay otherwise swallows pointer clicks).
        await page.evaluate((s) => {
          const el = document.querySelector(s) as HTMLElement | null;
          el?.click();
        }, sel).catch(() => {});
        await page.waitForTimeout(500);
        let openedNow = await page
          .locator('[data-name="pine-dialog"], .monaco-editor')
          .first()
          .isVisible({ timeout: 1500 })
          .catch(() => false);
        if (!openedNow) {
          // Fall back to a forced Playwright click.
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
            await el.click({ timeout: 2000, force: true }).catch(() => {});
            await page.waitForTimeout(500);
            openedNow = await page
              .locator('[data-name="pine-dialog"], .monaco-editor')
              .first()
              .isVisible({ timeout: 1500 })
              .catch(() => false);
          }
        }
        if (openedNow) {
          await page.locator(".monaco-editor textarea.inputarea").first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
          return { opened: true, alreadyOpen: false };
        }
      } catch {
        /* next */
      }
    }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }
  // Fallback: open via the chart menu.
  try {
    await page.goto("https://www.tradingview.com/chart/", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(800);
  } catch {
    /* ignore */
  }
  throw new Error("Could not open Pine Editor. Open it manually in TradingView first, then retry.");
}

export async function readPineSource(page: PageLike): Promise<PineRead> {
  if (!(await hasMonacoEditor(page))) {
    return { scriptName: null, source: null, editorHasUnsavedChanges: false };
  }
  // TradingView's Pine editor uses Monaco. Try the Monaco model API first;
  // fall back to the rendered .view-lines text when the global monaco is
  // not the same instance TradingView bundled.
  const source = await page.evaluate(() => {
    const w = window as unknown as {
      monaco?: { editor?: { getModels?: () => Array<{ getValue?: () => string }> } };
    };
    if (w.monaco?.editor?.getModels) {
      for (const m of w.monaco.editor.getModels()) {
        const v = m?.getValue?.() ?? "";
        if (v && v.includes("//@version")) return v;
      }
      const first = w.monaco.editor.getModels()[0];
      const v0 = first?.getValue?.() ?? "";
      if (v0) return v0;
    }
    // DOM fallback: join rendered line elements.
    const lines = Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"));
    if (lines.length) {
      return lines.map((l) => (l as HTMLElement).innerText ?? "").join("\n");
    }
    const ta = document.querySelector(".monaco-editor textarea.inputarea") as HTMLTextAreaElement | null;
    return ta?.value ?? null;
  });

  const scriptName = await textOf(page, [
    '[data-qa-id="pine-editor-script-name"]',
    '[class*="pine-editor"] [class*="script-name"]',
    '[aria-label*="cript name"]',
  ]);

  const editorHasUnsavedChanges = await page
    .locator('[class*="unsaved"], [data-name*="unsaved"]')
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);

  return { scriptName, source, editorHasUnsavedChanges };
}

export async function setPineSource(page: PageLike, source: string): Promise<void> {
  // Wait for the editor's textarea to be ready (it may lag the dialog open).
  const editorTa = page.locator(".monaco-editor textarea.inputarea").first();
  await editorTa.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  // Wait for the monaco container to be visible (it can lag the dialog open).
  await page.locator(".monaco-editor").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  if (!(await hasMonacoEditor(page))) {
    throw new Error("Pine editor not ready; call tv_open_pine_editor first.");
  }
  // Try the Monaco model API first (works when the global monaco is exposed).
  const setViaApi = await page.evaluate((src) => {
    const w = window as unknown as {
      monaco?: { editor?: { getModels?: () => Array<{ setValue?: (s: string) => void; getValue?: () => string }> } };
    };
    if (w.monaco?.editor?.getModels) {
      const models = w.monaco.editor.getModels();
      const pineModel = models.find((m) => (m?.getValue?.() ?? "").includes("//@version")) ?? models[0];
      if (pineModel?.setValue) {
        pineModel.setValue(src);
        return true;
      }
    }
    return false;
  }, source);
  if (setViaApi) return;
  // Keyboard fallback: focus the editor textarea, select all, then insert.
  const ta = page.locator(".monaco-editor textarea.inputarea").first();
  await ta.focus().catch(() => {});
  await page.keyboard.press("Control+a").catch(() => {});
  await page.waitForTimeout(100);
  await page.keyboard.insertText(source).catch(async () => {
    // Last resort: char-by-char typing.
    await ta.type(source, { delay: 0 }).catch(() => {});
  });
}

export async function clickSave(page: PageLike, name?: string): Promise<{ saved: boolean; dialog: string | null }> {
  // Strategy 1: title-button menu -> "Save script" (bypasses overlay interception via eval click).
  try {
    await page.evaluate(() => {
      const t = document.querySelector('[data-qa-id="pine-script-title-button"]') as HTMLElement | null;
      t?.click();
    }).catch(() => {});
    await page.waitForTimeout(500);
    const item = page.locator('[aria-label="Save script"], button:has-text("Save script")').first();
    if (await item.isVisible({ timeout: 800 }).catch(() => false)) {
      await item.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      // If a save-as / name dialog appears, fill the name and confirm.
      const nameInput = page.locator('input[type="text"]').first();
      if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        if (name) await nameInput.fill(name, { timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(300);
        await page
          .locator('button:has-text("Save"), button:has-text("Create"), button:has-text("OK")')
          .first()
          .click({ timeout: 2000 })
          .catch(() => {});
        await page.waitForTimeout(800);
      }
      return { saved: true, dialog: (await readDialogs(page))[0] ?? null };
    }
    await page.keyboard.press("Escape").catch(() => {});
  } catch {
    /* next */
  }
  // Strategy 2: the save icon button (force + eval fallback).
  const saveBtn = page.locator('[data-qa-id="pine-script-save-button"], button[data-name="pine-editor-save"]').first();
  if (await saveBtn.isVisible({ timeout: 600 }).catch(() => false)) {
    await saveBtn.click({ timeout: 2000, force: true }).catch(() => {});
    await page.evaluate(() => {
      const b = document.querySelector('[data-qa-id="pine-script-save-button"]') as HTMLElement | null;
      b?.click();
    }).catch(() => {});
    await page.waitForTimeout(800);
    return { saved: true, dialog: (await readDialogs(page))[0] ?? null };
  }
  // Strategy 3: Ctrl+S.
  try {
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(800);
    return { saved: true, dialog: (await readDialogs(page))[0] ?? null };
  } catch {
    return { saved: false, dialog: null };
  }
}

export async function renameScript(page: PageLike, name: string): Promise<{ renamed: boolean; oldName: string | null; newName: string | null; dialog: string | null }> {
  // Ensure the Pine editor is open and the title menu is reachable.
  const state = await readChartState(page);
  if (!state.pineEditorOpen) {
    await openPineEditor(page);
  }

  const oldName = await textOf(page, [
    '[data-qa-id="pine-script-title-button"]',
    '[class*="pine-editor"] [class*="script-name"]',
    '[aria-label*="cript name"]',
  ]);

  // Open the title-button menu using eval-click to bypass overlay interception.
  await page.evaluate(() => {
    const t = document.querySelector('[data-qa-id="pine-script-title-button"]') as HTMLElement | null;
    t?.click();
  }).catch(() => {});
  await page.waitForTimeout(500);

  const renameSelectors = [
    '[aria-label="Rename…"]',
    '[aria-label="Rename..."]',
    'button:has-text("Rename")',
    '[class*="pine-editor"] [class*="rename"]',
  ];
  let clickedRename = false;
  for (const sel of renameSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      clickedRename = true;
      break;
    }
  }
  if (!clickedRename) {
    // Fallback eval-click on any visible "Rename" item.
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[class*="menu"] button, [role="menuitem"]'));
      const rename = items.find((b) => /rename/i.test((b as HTMLElement).innerText ?? ""));
      (rename as HTMLElement | undefined)?.click();
    }).catch(() => {});
  }
  await page.waitForTimeout(700);

  // Fill the rename input if one appeared.
  const nameInput = page.locator('input[placeholder*="ame"], [class*="rename"] input[type="text"], input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 1200 }).catch(() => false)) {
    await nameInput.fill(name, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
    // Confirm with Enter first, then button fallback.
    await nameInput.press("Enter").catch(() => {});
    await page.waitForTimeout(600);
    const confirm = page.locator('button:has-text("Save"), button:has-text("Rename"), button:has-text("OK")').first();
    if (await confirm.isVisible({ timeout: 600 }).catch(() => false)) {
      await confirm.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const dialog = (await readDialogs(page))[0] ?? null;
  const newName = await textOf(page, [
    '[data-qa-id="pine-script-title-button"]',
    '[class*="pine-editor"] [class*="script-name"]',
  ]);
  const renamed = newName === name || (!!oldName && newName !== oldName && newName !== null);
  return { renamed, oldName, newName, dialog };
}

export async function readCompileErrors(page: PageLike): Promise<CompileResult> {
  // Pine errors are surfaced in the editor's bottom error panel.
  const raw = await textOf(page, [
    '[class*="pine-editor"] [class*="error"]',
    '[data-name="pine-editor-errors"]',
    '[class*="code-error"]',
    '[class*="errors-list"]',
  ], 1000);

  const errors: string[] = [];
  const warnings: string[] = [];
  if (raw) {
    for (const line of raw.split(/\n+/)) {
      const l = line.trim();
      if (!l) continue;
      if (/warning/i.test(l)) warnings.push(l);
      else errors.push(l);
    }
  }
  // Also pull error markers from Monaco if available.
  const mon = await page.evaluate(() => {
    const w = window as unknown as {
      monaco?: { editor?: { getModels?: () => Array<{ getMarkers?: () => Array<{ message: string; severity: number }> }> } };
    };
    const m = w.monaco?.editor?.getModels?.()?.[0];
    if (!m?.getMarkers) return [];
    return m.getMarkers().map((x) => ({ message: x.message, severity: x.severity }));
  }).catch(() => []);
  for (const x of mon as Array<{ message: string; severity: number }>) {
    if (x.severity >= 8) errors.push(x.message);
    else if (x.severity >= 4) warnings.push(x.message);
  }

  // If the extension's MutationObserver already caught a recent toast/error,
  // include it so the repair loop reacts instantly to errors that disappear
  // before a tool polls for them.
  const observed = getLastObservedError();
  const observedText = observed?.error ? String(observed.error).trim() : "";
  if (observedText && !errors.includes(observedText) && !warnings.includes(observedText)) {
    if (/warning/i.test(observedText)) warnings.push(observedText);
    else errors.push(observedText);
  }

  const success = errors.length === 0;
  return {
    hasErrors: errors.length > 0,
    errors,
    hasWarnings: warnings.length > 0,
    warnings,
    success,
  };
}

export async function addScriptToChart(page: PageLike): Promise<{ added: boolean; dialog: string | null }> {
  const candidates = [
    '[data-qa-id="add-script-to-chart"]',
    'button[data-name="pine-editor-add-to-chart"]',
    '[data-qa-id="pine-editor-add-to-chart"]',
    'button:has-text("Add to chart")',
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const sel of candidates) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click({ timeout: 2500, force: true }).catch(() => {});
          // Eval-click fallback bypasses overlay interception.
          await page.evaluate((s) => {
            const b = document.querySelector(s) as HTMLElement | null;
            b?.click();
          }, sel).catch(() => {});
          await page.waitForTimeout(1200);
          return { added: true, dialog: (await readDialogs(page))[0] ?? null };
        }
      } catch {
        /* next */
      }
    }
    if (attempt < 2) await page.waitForTimeout(400);
  }
  return { added: false, dialog: null };
}

export async function changeSymbol(page: PageLike, symbol: string): Promise<{ changed: boolean }> {
  const openers = [
    'button[aria-label="Change symbol"]',
    '[data-qa-id="header-toolbar-symbol-search"]',
    'button[aria-label*="Symbol search"]',
    'div.symbol-edit-widget',
  ];
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    for (const sel of openers) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
          await el.click({ timeout: 2500 });
          opened = true;
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!opened) await page.waitForTimeout(400);
  }
  if (!opened) return { changed: false };

  const searchInput = page.locator('input[placeholder="Symbol, ISIN, or CUSIP"], input[placeholder*="ymbol"], input[type="text"]').first();
  await searchInput.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  await searchInput.click({ timeout: 1500 }).catch(() => {});
  await searchInput.fill(symbol, { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(700);
  await searchInput.press("Enter").catch(() => {});
  await page.waitForTimeout(1000);
  return { changed: true };
}

export async function changeTimeframe(page: PageLike, tf: string): Promise<{ changed: boolean }> {
  const openers = [
    'button[aria-label="Change interval"]',
    '[data-qa-id="timeframe-select"]',
    'button[aria-label*="imeframe"]',
    'button[aria-label*="Interval"]',
  ];
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    for (const sel of openers) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
          await el.click({ timeout: 2500 });
          opened = true;
          break;
        }
      } catch {
        /* next */
      }
    }
    if (!opened) await page.waitForTimeout(400);
  }
  if (!opened) return { changed: false };
  await page.waitForTimeout(500);
  const tfLabel = tf === "D" ? "1D" : tf === "W" ? "1W" : tf === "M" ? "1M" : tf + "m";
  const itemSels = [
    `[role="menuitem"]:has-text("${tf}")`,
    `button:has-text("${tfLabel}")`,
    `button:has-text("${tf}m")`,
    `[data-name*="interval"]:has-text("${tf}")`,
  ];
  for (const sel of itemSels) {
    try {
      const item = page.locator(sel).first();
      if (await item.isVisible({ timeout: 800 }).catch(() => false)) {
        await item.click({ timeout: 2000 });
        await page.waitForTimeout(600);
        return { changed: true };
      }
    } catch {
      /* next */
    }
  }
  const tfInput = page.locator('input[placeholder*="nterval"], input[placeholder*="imeframe"], input[type="text"]').first();
  if (await tfInput.isVisible({ timeout: 800 }).catch(() => false)) {
    await tfInput.fill(tf).catch(() => {});
    await page.waitForTimeout(400);
    await tfInput.press("Enter").catch(() => {});
    await page.waitForTimeout(600);
    return { changed: true };
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { changed: false };
}

export async function readChartMetadata(page: PageLike): Promise<ChartMetadata> {
  const state = await readChartState(page);
  const result = await page.evaluate(() => {
    const indicators: string[] = [];
    const strategies: string[] = [];
    const overlays: string[] = [];
    let paneCount = 1;

    // Legend indicator labels.
    document.querySelectorAll('[class*="legend"], [class*="chart-legend"]').forEach((root) => {
      root.querySelectorAll('[class*="item"], [class*="indicator"], [class*="title"]').forEach((el) => {
        const t = (el as HTMLElement).innerText?.trim() ?? "";
        if (!t) return;
        if (/strategy/i.test(t)) strategies.push(t);
        else if (/overlay|moving average|ema|sma|bollinger|macd|rsi/i.test(t)) overlays.push(t);
        else indicators.push(t);
      });
    });

    // Pane separators are a rough proxy for sub-pane count.
    paneCount = Math.max(1, document.querySelectorAll('[class*="chart-pane"], [class*="pane"]').length);

    return { indicators, strategies, overlays, paneCount };
  }).catch(() => ({ indicators: [], strategies: [], overlays: [], paneCount: 1 }));

  return {
    visibleIndicators: result.indicators,
    strategies: result.strategies,
    overlays: result.overlays,
    paneCount: result.paneCount,
    symbol: state.symbol,
    timeframe: state.timeframe,
  };
}

export async function readStrategyTester(page: PageLike): Promise<StrategyTesterSummary> {
  // Strategy Tester panel appears after running a strategy script.
  const stVisible = await page
    .locator('[data-name="strategy-tester"], [class*="strategy-tester"]')
    .first()
    .isVisible({ timeout: 800 })
    .catch(() => false);

  if (!stVisible) {
    return { visible: false, netProfit: null, totalTrades: null, winRate: null, raw: {} };
  }

  const raw = await page.evaluate(() => {
    const out: Record<string, string | null> = {};
    const rows = document.querySelectorAll('[class*="strategy-tester"] [class*="row"], [data-name*="strategy-tester"] tr');
    rows.forEach((r) => {
      const cells = Array.from(r.querySelectorAll("td, [class*='value']"));
      const text = cells.map((c) => (c as HTMLElement).innerText?.trim() ?? "");
      if (text.length >= 2) {
        out[text[0]!] = text.slice(1).join(" ");
      }
    });
    // Common labeled values.
    const labels = ["Net Profit", "Total Trades", "Win Rate", "Percent Profitable", "Profit Factor", "Max Drawdown"];
    for (const l of labels) {
      const node = Array.from(document.querySelectorAll("*")).find((e) => (e as HTMLElement).innerText?.trim() === l);
      if (node) {
        const v = (node.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? null;
        if (v) out[l] = v;
      }
    }
    return out;
  }).catch(() => ({} as Record<string, string | null>));

  return {
    visible: true,
    netProfit: raw["Net Profit"] ?? null,
    totalTrades: raw["Total Trades"] ?? null,
    winRate: raw["Win Rate"] ?? raw["Percent Profitable"] ?? null,
    raw,
  };
}

export async function captureScreenshot(page: PageLike, name?: string, fullPage = false): Promise<string> {
  const safeName =
    name && /^[A-Za-z0-9_.\- ]+$/.test(name) ? name.replace(/\s+/g, "_").slice(0, 80) : "screenshot";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${safeName}-${ts}.png`;
  const dir = join(paths.projectRoot, "screenshots");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  await page.screenshot({ path, fullPage, type: "png" });
  logger.info({ screenshot: path }, "captured screenshot");
  return path;
}



/**
 * Dismiss known TradingView upsell/notice dialogs. Returns the list of
 * dialog texts that were closed. Non-destructive: only clicks close/X
 * buttons; never clicks primary CTA buttons that could change account state.
 */
export async function dismissDialogs(page: PageLike): Promise<{ dismissed: string[]; remaining: string[] }> {
  const dismissed: string[] = [];
  const closeSelectors = [
    // Generic close buttons inside dialogs.
    'button[aria-label*="Close"]',
    'button[aria-label*="close"]',
    '[class*="dialog"] [class*="close"]',
    '[class*="modal"] [class*="close"]',
    'button[class*="close"]',
    // TradingView-specific close icons.
    '[data-name*="close"]',
    '[class*="tv-dialog"] button[class*="close"]',
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    let clickedAny = false;
    for (const sel of closeSelectors) {
      const loc = page.locator(sel);
      const count = await loc.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const el = loc.nth(i);
        const visible = await el.isVisible({ timeout: 400 }).catch(() => false);
        if (!visible) continue;
        const text = (await el.evaluate((n) => (n.closest('[role="dialog"],[class*="modal"],[class*="popup"]') as HTMLElement | null)?.innerText?.trim().slice(0, 120) ?? "").catch(() => "")) || sel;
        try {
          await el.click({ timeout: 1500 });
          dismissed.push(text);
          clickedAny = true;
          await page.waitForTimeout(250);
        } catch {
          /* try next */
        }
      }
    }
    // Escape key as a last resort for any remaining overlay.
    if (clickedAny) { await page.waitForTimeout(300); continue; }
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    if (attempt === 0 && clickedAny === false) break;
  }
  const remaining = await readDialogs(page);
  return { dismissed, remaining };
}

/**
 * Layouts: list the saved chart layouts from the layouts menu.
 */
export async function listLayouts(page: PageLike): Promise<{ names: string[]; active: string | null }> {
  // Open the layouts menu via the header button.
  const opener = page.locator('[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button').first();
  const opened = await opener.isVisible({ timeout: 800 }).catch(() => false);
  if (!opened) return { names: [], active: null };
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  const names = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="layout"] [class*="title"], [data-name*="layout"] [class*="name"], [class*="layouts-list"] [class*="title"]'))
      .map((e) => (e as HTMLElement).innerText?.trim() ?? "")
      .filter((s) => s.length > 0)
      .slice(0, 50);
  }).catch(() => []);
  const active = await page.locator('[class*="layout"][class*="active"], [class*="layout"][aria-selected="true"]').first().innerText({ timeout: 600 }).catch(() => null as string | null);
  // Close the menu.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  return { names: names as string[], active };
}

/**
 * Switch to a saved layout by name.
 */
export async function switchLayout(page: PageLike, name: string): Promise<{ switched: boolean }> {
  const opener = page.locator('[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return { switched: false };
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  const item = page.locator(`[class*="layouts-list"] :text-is("${name}"), [data-name*="layout"] :text-is("${name}")`).first();
  if (await item.isVisible({ timeout: 1500 }).catch(() => false)) {
    await item.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return { switched: true };
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { switched: false };
}

/**
 * Alerts: create a basic alert on the current symbol via the alert dialog.
 * Only supports the simple "price crosses" style; complex condition editors
 * are out of scope for this version.
 */
export async function createAlert(page: PageLike, message: string): Promise<{ created: boolean; dialog: string | null }> {
  const opener = page.locator('[data-qa-id="alert"], button[aria-label*="Alert"], [class*="header-toolbar"] [class*="alert"]').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return { created: false, dialog: null };
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  const msgInput = page.locator('textarea[placeholder*="message"], input[placeholder*="message"], [class*="alert"] textarea, [class*="alert"] input[type="text"]').first();
  if (await msgInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await msgInput.fill(message, { timeout: 2000 }).catch(() => {});
  }
  const createBtn = page.locator('button:has-text("Create"), [class*="alert"] button:has-text("Submit"), button[data-name*="submit"]').first();
  if (await createBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await createBtn.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
    return { created: true, dialog: (await readDialogs(page))[0] ?? null };
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { created: false, dialog: null };
}

export async function listAlerts(page: PageLike): Promise<{ alerts: string[] }> {
  const opener = page.locator('[data-qa-id="alert"], button[aria-label*="Alert"], [class*="header-toolbar"] [class*="alert"]').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return { alerts: [] };
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  const alerts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="alert-list"] [class*="title"], [class*="alerts"] [class*="message"], [data-name*="alert"] [class*="title"]'))
      .map((e) => (e as HTMLElement).innerText?.trim() ?? "")
      .filter((s) => s.length > 0).slice(0, 50);
  }).catch(() => []);
  await page.keyboard.press("Escape").catch(() => {});
  return { alerts: alerts as string[] };
}

export async function deleteAlert(page: PageLike, index: number): Promise<{ deleted: boolean }> {
  const opener = page.locator('[data-qa-id="alert"], button[aria-label*="Alert"], [class*="header-toolbar"] [class*="alert"]').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return { deleted: false };
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(600);
  const del = page.locator(`[class*="alert-list"] [class*="remove"]:nth-of-type(${index + 1}), [data-name*="alert"]:nth-of-type(${index + 1}) [class*="delete"]`).first();
  if (await del.isVisible({ timeout: 1500 }).catch(() => false)) {
    await del.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape").catch(() => {});
    return { deleted: true };
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { deleted: false };
}

/**
 * Watchlists: read the active watchlist symbols if the watchlist panel is visible.
 */
export async function readWatchlist(page: PageLike): Promise<{ visible: boolean; symbols: string[] }> {
  const visible = await page.locator('[class*="watchlist"], [data-name*="watchlist"]').first().isVisible({ timeout: 800 }).catch(() => false);
  if (!visible) return { visible: false, symbols: [] };
  const symbols = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="watchlist"] [class*="symbol"], [data-name*="watchlist"] [class*="ticker"]'))
      .map((e) => (e as HTMLElement).innerText?.trim() ?? "")
      .filter((s) => s.length > 0).slice(0, 200);
  }).catch(() => []);
  return { visible: true, symbols: symbols as string[] };
}

export async function syncWatchlist(page: PageLike, symbol: string, addIfMissing = true): Promise<{ synced: boolean; added: boolean; symbols: string[] }> {
  const current = await readWatchlist(page);
  if (!current.visible) return { synced: false, added: false, symbols: [] };
  if (current.symbols.includes(symbol)) {
    return { synced: true, added: false, symbols: current.symbols };
  }
  if (!addIfMissing) {
    return { synced: true, added: false, symbols: current.symbols };
  }
  // Open symbol search, type the symbol, and add to active watchlist.
  const added = await addSymbolToWatchlistInternal(page, symbol);
  const after = await readWatchlist(page);
  return { synced: true, added, symbols: after.symbols };
}

async function addSymbolToWatchlistInternal(page: PageLike, symbol: string): Promise<boolean> {
  // Strategy 1: header star button for active symbol.
  const star = page.locator('[class*="header-toolbar"] [class*="star"], button[aria-label*="watchlist"], [class*="symbol"] [class*="star"]').first();
  if (await star.isVisible({ timeout: 800 }).catch(() => false)) {
    const active = await star.evaluate((el) => el.getAttribute("aria-pressed") === "true" || el.classList.contains("active")).catch(() => false);
    if (!active) {
      await star.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
    return true;
  }
  // Strategy 2: symbol search "add to watchlist" context menu.
  const openers = [
    'button[aria-label="Change symbol"]',
    '[data-qa-id="header-toolbar-symbol-search"]',
    'button[aria-label*="Symbol search"]',
    'div.symbol-edit-widget',
  ];
  for (const sel of openers) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(500);
  const searchInput = page.locator('input[placeholder="Symbol, ISIN, or CUSIP"], input[placeholder*="ymbol"], input[type="text"]').first();
  if (await searchInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    await searchInput.fill(symbol, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(700);
    // Try to find a "+"/watchlist add icon in the search results.
    const addBtn = page.locator('[class*="symbol-search"] [class*="add"], [class*="symbol-search"] [class*="star"], button[aria-label*="Add to watchlist"]').first();
    if (await addBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await addBtn.click({ timeout: 2000 }).catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      return true;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

export async function addSymbolToWatchlist(page: PageLike, symbol: string): Promise<{ added: boolean }> {
  // Right-click the chart background -> Add to watchlist is unreliable; use the
  // symbol search "add to watchlist" star when available.
  const added = await addSymbolToWatchlistInternal(page, symbol);
  return { added };
}

/**
 * Chart data export: click the Export menu and pick CSV. Returns the path of
 * the most recent CSV downloaded to the project ./exports dir.
 */
export async function exportChartData(page: PageLike): Promise<{ triggered: boolean; path: string | null }> {
  // Configure a download listener first.
  const exportsDir = join(paths.projectRoot, "exports");
  mkdirSync(exportsDir, { recursive: true });
  const opener = page.locator('button[aria-label*="Export"], [data-qa-id="export"], [class*="header-toolbar"] button:has-text("Export")').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return { triggered: false, path: null };
  let savedPath: string | null = null;
  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400);
  const csvItem = page.locator('[role="menuitem"]:has-text("Export chart data"), button:has-text("chart data"), [class*="export"] :text-is("CSV")').first();
  if (await csvItem.isVisible({ timeout: 1500 }).catch(() => false)) {
    await csvItem.click({ timeout: 2000 }).catch(() => {});
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    return { triggered: false, path: null };
  }
  const dl = await downloadPromise;
  if (dl) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const fn = `chart-data-${ts}.csv`;
    savedPath = join(exportsDir, fn);
    await dl.saveAs(savedPath).catch(() => { savedPath = null; });
  }
  return { triggered: true, path: savedPath };
}

/**
 * Drawings (experimental): add a horizontal line at the last close via the
 * drawing toolbar. TradingView drawings are canvas-based; this uses the
 * left-toolbar drawing menu and is best-effort.
 */
export async function addHorizontalLine(page: PageLike): Promise<{ added: boolean }> {
  const tool = page.locator('[class*="left-toolbar"] button[aria-label*="Trend Line"], [data-name*="trend-line"], button[aria-label*="Line"]').first();
  if (!(await tool.isVisible({ timeout: 800 }).catch(() => false))) return { added: false };
  await tool.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400);
  // Click twice on the chart pane to draw a line.
  const pane = page.locator('canvas, [data-qa-id="chart-pane"]').first();
  const box = await pane.boundingBox().catch(() => null);
  if (!box) return { added: false };
  const x = box.x + box.width / 2;
  const y1 = box.y + box.height * 0.3;
  const y2 = box.y + box.height * 0.7;
  await page.mouse.move(x, y1).catch(() => {});
  await page.mouse.click(x, y1).catch(() => {});
  await page.mouse.move(x, y2, { steps: 5 }).catch(() => {});
  await page.mouse.click(x, y2).catch(() => {});
  await page.waitForTimeout(300);
  // Deselect the drawing tool.
  await page.keyboard.press("Escape").catch(() => {});
  return { added: true };
}


/**
 * Create a fresh chart layout by name via the layout menu's "New layout"
 * action. Best-effort; falls back to returning created:false if the menu
 * item is not found, in which case the caller should operate on the
 * current chart instead.
 */
export async function createLayout(page: PageLike, name: string): Promise<{ created: boolean; note: string }> {
  const opener = page.locator('[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) {
    return { created: false, note: "layout menu opener not found" };
  }
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(700);
  // Try a "New layout" / "+" menu item.
  const candidates = [
    '[role="menuitem"]:has-text("New layout")',
    'button:has-text("New layout")',
    '[class*="layout"] [class*="new"]',
    'button[aria-label*="New layout"]',
    '[class*="layouts"] [class*="add"]',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1200);
      // If a name prompt appears, fill it.
      const nameInput = page.locator('input[placeholder*="ame"], [class*="layout"] input[type="text"]').first();
      if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await nameInput.fill(name, { timeout: 1500 }).catch(() => {});
        await nameInput.press("Enter").catch(() => {});
        await page.waitForTimeout(800);
      }
      return { created: true, note: "new layout opened" };
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  return { created: false, note: "no New layout menu item found" };
}

// ---------------------------------------------------------------------------
// Layout management helpers
// ---------------------------------------------------------------------------

async function openLayoutMenu(page: PageLike): Promise<boolean> {
  const opener = page.locator('[data-qa-id="chart-layouts"], button[aria-label*="ayout"], button[aria-label*="Layout"]').first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return false;
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(700);
  return true;
}

async function findMenuItem(
  page: PageLike,
  labels: string[]
): Promise<LocatorLike | null> {
  for (const label of labels) {
    const loc = page
      .locator(
        `[role="menuitem"]:has-text("${label}"), button:has-text("${label}"), [class*="menu"] button:has-text("${label}"), [class*="menu"] [class*="item"]:has-text("${label}")`
      )
      .first();
    if (await loc.isVisible({ timeout: 600 }).catch(() => false)) return loc;
  }
  return null;
}

async function dismissIfNamePrompt(page: PageLike, name: string): Promise<void> {
  const nameInput = page.locator('input[placeholder*="ame"], [class*="layout"] input[type="text"], [role="dialog"] input[type="text"]').first();
  if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInput.fill(name, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
    await nameInput.press("Enter").catch(() => {});
    await page.waitForTimeout(800);
  }
}

/**
 * Save the current chart layout. If `name` is provided, performs "Save layout as".
 */
export async function saveLayout(
  page: PageLike,
  name?: string
): Promise<{ saved: boolean; name: string | null; note: string; dialog: string | null }> {
  const activeName = await textOf(page, [
    '[data-qa-id="chart-layouts"]',
    'button[aria-label*="ayout"]',
    '[class*="layout"] button',
  ]);
  if (!(await openLayoutMenu(page))) {
    return { saved: false, name: null, note: "layout menu opener not found", dialog: null };
  }
  const labels = name
    ? ["Save layout as...", "Save As", "Save layout"]
    : ["Save layout", "Save"];
  const item = await findMenuItem(page, labels);
  if (!item) {
    await page.keyboard.press("Escape").catch(() => {});
    return { saved: false, name: null, note: "save menu item not found", dialog: null };
  }
  await item.click({ timeout: 2000 }).catch(() => {});
  if (name) await dismissIfNamePrompt(page, name);
  await page.waitForTimeout(800);
  return { saved: true, name: name ?? activeName, note: "save action triggered", dialog: (await readDialogs(page))[0] ?? null };
}

/**
 * Duplicate the active chart layout.
 */
export async function duplicateLayout(
  page: PageLike,
  name?: string
): Promise<{ duplicated: boolean; newName: string | null; note: string; dialog: string | null }> {
  if (!(await openLayoutMenu(page))) {
    return { duplicated: false, newName: null, note: "layout menu opener not found", dialog: null };
  }
  const item = await findMenuItem(page, ["Duplicate layout", "Make a copy", "Duplicate"]);
  if (!item) {
    await page.keyboard.press("Escape").catch(() => {});
    return { duplicated: false, newName: null, note: "duplicate menu item not found", dialog: null };
  }
  await item.click({ timeout: 2000 }).catch(() => {});
  if (name) await dismissIfNamePrompt(page, name);
  await page.waitForTimeout(800);
  const dialog = (await readDialogs(page))[0] ?? null;
  const newName = name ?? (await textOf(page, ['[data-qa-id="chart-layouts"]'])) ?? null;
  return { duplicated: true, newName, note: "duplicate action triggered", dialog };
}

/**
 * Rename the active chart layout.
 */
export async function renameLayout(
  page: PageLike,
  name: string
): Promise<{ renamed: boolean; oldName: string | null; newName: string | null; note: string; dialog: string | null }> {
  const oldName = await textOf(page, ['[data-qa-id="chart-layouts"]']);
  if (!(await openLayoutMenu(page))) {
    return { renamed: false, oldName, newName: null, note: "layout menu opener not found", dialog: null };
  }
  const item = await findMenuItem(page, ["Rename layout", "Rename...", "Rename"]);
  if (!item) {
    await page.keyboard.press("Escape").catch(() => {});
    return { renamed: false, oldName, newName: null, note: "rename menu item not found", dialog: null };
  }
  await item.click({ timeout: 2000 }).catch(() => {});
  await dismissIfNamePrompt(page, name);
  await page.waitForTimeout(800);
  const newName = (await textOf(page, ['[data-qa-id="chart-layouts"]'])) ?? name;
  return { renamed: newName === name, oldName, newName, note: "rename action triggered", dialog: (await readDialogs(page))[0] ?? null };
}

/**
 * Reset the active chart layout to its default/empty state.
 */
export async function resetLayout(page: PageLike): Promise<{ reset: boolean; note: string; dialog: string | null }> {
  if (!(await openLayoutMenu(page))) {
    return { reset: false, note: "layout menu opener not found", dialog: null };
  }
  const item = await findMenuItem(page, ["Reset chart layout", "Reset layout", "Reset"]);
  if (!item) {
    await page.keyboard.press("Escape").catch(() => {});
    return { reset: false, note: "reset menu item not found", dialog: null };
  }
  await item.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { reset: true, note: "reset action triggered", dialog: (await readDialogs(page))[0] ?? null };
}

/**
 * Export a local snapshot of the current layout: a screenshot plus JSON metadata.
 * TradingView's cloud layout export is not exposed via the DOM; this captures
 * the visible chart state to ./layouts for offline backup.
 */
export async function exportLayout(
  page: PageLike,
  name?: string
): Promise<{ exported: boolean; path: string | null; note: string }> {
  const dir = join(paths.projectRoot, "layouts");
  mkdirSync(dir, { recursive: true });
  const state = await readChartState(page);
  const safeName = name
    ? name.replace(/[^A-Za-z0-9_.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 40)
    : "layout";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(dir, `${safeName}-${ts}`);
  const screenshotPath = await captureScreenshot(page, `layout-${safeName}`, false);
  const metaPath = `${base}.json`;
  const metadata = {
    exportedAt: new Date().toISOString(),
    url: state.url,
    symbol: state.symbol,
    timeframe: state.timeframe,
    isLoggedIn: state.isLoggedIn,
    screenshotPath,
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf8");
  return { exported: true, path: metaPath, note: `metadata written; screenshot: ${screenshotPath}` };
}

// ---------------------------------------------------------------------------
// Indicator management
// ---------------------------------------------------------------------------

async function openIndicatorDialog(page: PageLike): Promise<boolean> {
  const opener = page
    .locator(
      'button[aria-label="Indicators"], [data-qa-id="open-indicators-dialog"], button[data-name="open-indicators-dialog"], [class*="header-toolbar"] button:has-text("Indicators")'
    )
    .first();
  if (!(await opener.isVisible({ timeout: 800 }).catch(() => false))) return false;
  await opener.click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(800);
  return true;
}

/**
 * Add an indicator/strategy to the chart by name (e.g. "RSI", "MACD").
 */
export async function addIndicator(
  page: PageLike,
  name: string
): Promise<{ added: boolean; dialog: string | null; note: string }> {
  if (!(await openIndicatorDialog(page))) {
    return { added: false, dialog: null, note: "Indicators dialog opener not found" };
  }
  const search = page
    .locator(
      'input[placeholder*="Search"], [data-qa-id="indicators-search-input"], [class*="indicators"] input[type="text"]'
    )
    .first();
  if (await search.isVisible({ timeout: 1500 }).catch(() => false)) {
    await search.fill(name, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(600);
    await search.press("Enter").catch(() => {});
  }
  // Try to click the first visible result item.
  const result = page.locator('[data-name="indicator-item"], [class*="indicator-item"], [class*="tv-dialog"] [class*="title"]').first();
  if (await result.isVisible({ timeout: 1500 }).catch(() => false)) {
    await result.click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape").catch(() => {});
  return { added: true, dialog: (await readDialogs(page))[0] ?? null, note: "indicator add action triggered" };
}

interface LegendIndicator {
  name: string;
  visible: boolean;
}

async function readLegendIndicators(page: PageLike): Promise<LegendIndicator[]> {
  return page
    .evaluate(() => {
      const out: LegendIndicator[] = [];
      const roots = document.querySelectorAll('[class*="chart-legend"], [class*="legend"], [data-name="legend"], .chart-gui-wrapper .legend');
      roots.forEach((root) => {
        root.querySelectorAll("*").forEach((el) => {
          const t = (el as HTMLElement).innerText?.trim() ?? "";
          if (!t || t.length > 80) return;
          // Skip UI chrome labels and duplicates.
          if (out.some((x) => x.name === t)) return;
          // Visibility is inferred from the presence of a visible eye/close icon.
          const row = el.closest('[class*="legendItem"], [class*="source"], [data-name*="legend"], [class*="legend"]');
          const hasClosedEye = row
            ? !!Array.from(row.querySelectorAll("*")).find(
                (n) =>
                  /hidden|invisible|closed/i.test((n as HTMLElement).title ?? (n as HTMLElement).ariaLabel ?? "") ||
                  (n as HTMLElement).className?.includes("closed")
              )
            : false;
          out.push({ name: t, visible: !hasClosedEye });
        });
      });
      return out.slice(0, 100);
    })
    .catch(() => []);
}

async function clickLegendAction(
  page: PageLike,
  nameOrIndex: string | number,
  action: "remove" | "hide" | "show" | "settings"
): Promise<{ ok: boolean; note: string }> {
  const indicators = await readLegendIndicators(page);
  const targetName = typeof nameOrIndex === "number" ? indicators[nameOrIndex]?.name : nameOrIndex;
  if (!targetName) return { ok: false, note: `indicator "${nameOrIndex}" not found in legend` };

  const result = await page.evaluate(
    ({ targetName, action }) => {
      const roots = Array.from(
        document.querySelectorAll('[class*="chart-legend"], [class*="legend"], [data-name="legend"], .chart-gui-wrapper .legend')
      );
      for (const root of roots) {
        const items = Array.from<Element>(root.querySelectorAll("*")).filter((el) =>
          (el as HTMLElement).innerText?.toLowerCase().includes(targetName.toLowerCase())
        );
        for (const el of items) {
          const row = el.closest('[class*="legendItem"], [class*="source"], [data-name*="legend"]');
          if (!row) continue;
          const buttons = Array.from<Element>(row.querySelectorAll("button, [role=\"button\"], [class*=\"button\"]"));
          const actionRe =
            action === "remove"
              ? /remove|delete|close|trash/i
              : action === "settings"
              ? /settings|gear|cog/i
              : /eye|visibility|show|hide/i;
          const target = buttons.find((b) =>
            actionRe.test(
              (b as HTMLElement).title +
                " " +
                ((b as HTMLElement).ariaLabel ?? "") +
                " " +
                (b as HTMLElement).className
            )
          ) as HTMLElement | undefined;
          if (target) {
            target.click();
            return true;
          }
        }
      }
      return false;
    },
    { targetName, action }
  );
  await page.waitForTimeout(600);
  return result
    ? { ok: true, note: `${action} action triggered for "${targetName}"` }
    : { ok: false, note: `no ${action} control found for "${targetName}"` };
}

/**
 * Remove an indicator from the chart by exact legend name or zero-based index.
 */
export async function removeIndicator(
  page: PageLike,
  nameOrIndex: string | number
): Promise<{ removed: boolean; note: string }> {
  const res = await clickLegendAction(page, nameOrIndex, "remove");
  return { removed: res.ok, note: res.note };
}

/**
 * Hide an indicator by legend name or index.
 */
export async function hideIndicator(
  page: PageLike,
  nameOrIndex: string | number
): Promise<{ hidden: boolean; note: string }> {
  const res = await clickLegendAction(page, nameOrIndex, "hide");
  return { hidden: res.ok, note: res.note };
}

/**
 * Show a previously hidden indicator.
 */
export async function showIndicator(
  page: PageLike,
  nameOrIndex: string | number
): Promise<{ shown: boolean; note: string }> {
  const res = await clickLegendAction(page, nameOrIndex, "show");
  return { shown: res.ok, note: res.note };
}

/**
 * Update indicator/strategy settings by legend name or index.
 * `settings` is a map of input labels/placeholders to values.
 */
export async function setIndicatorSettings(
  page: PageLike,
  nameOrIndex: string | number,
  settings: Record<string, number | string | boolean>
): Promise<{ updated: boolean; note: string }> {
  const openRes = await clickLegendAction(page, nameOrIndex, "settings");
  if (!openRes.ok) return { updated: false, note: openRes.note };
  await page.waitForTimeout(800);

  // Fill visible inputs that match setting keys by label/placeholder.
  for (const [key, value] of Object.entries(settings)) {
    const input = page
      .locator(
        `label:has-text("${key}") + input, label:has-text("${key}") + select, input[placeholder*="${key}"], input[aria-label*="${key}"]`
      )
      .first();
    if (await input.isVisible({ timeout: 600 }).catch(() => false)) {
      const tag = await input.evaluate((el) => (el as HTMLInputElement).tagName.toLowerCase()).catch(() => "input");
      if (tag === "select") {
        await input.selectOption(String(value)).catch(() => {});
      } else {
        const type = await input.evaluate((el) => (el as HTMLInputElement).type).catch(() => "text");
        if (type === "checkbox") {
          const checked = await input.isChecked().catch(() => false);
          if (checked !== Boolean(value)) await input.click().catch(() => {});
        } else {
          await input.fill(String(value), { timeout: 1500 }).catch(() => {});
        }
      }
    }
  }

  // Confirm with OK / Save / Apply.
  const confirm = page
    .locator('button:has-text("OK"), button:has-text("Save"), button:has-text("Apply"), button[aria-label*="Save"]')
    .first();
  if (await confirm.isVisible({ timeout: 800 }).catch(() => false)) {
    await confirm.click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape").catch(() => {});
  return { updated: true, note: "settings dialog handled" };
}

// ---------------------------------------------------------------------------
// Chart verification
// ---------------------------------------------------------------------------

export interface ChartVerificationOptions {
  expectedIndicatorName?: string;
  expectedPlots?: number;
  expectedLabels?: number;
  expectedTables?: number;
  maxWaitMs?: number;
}

export interface ChartVerificationResult {
  verified: boolean;
  foundIndicators: string[];
  foundPlots: number;
  foundLabels: number;
  foundTables: number;
  errors: string[];
}

/**
 * Best-effort runtime verification that an indicator is on the chart and that
 * expected visual objects (plots, labels, tables) are present. Uses the legend
 * text and a DOM heuristic; not all object types are reliably enumerable on
 * TradingView's canvas-driven UI.
 */
export async function verifyChart(
  page: PageLike,
  options: ChartVerificationOptions = {}
): Promise<ChartVerificationResult> {
  const { expectedIndicatorName, expectedPlots, expectedLabels, expectedTables, maxWaitMs = 3000 } = options;
  const deadline = Date.now() + maxWaitMs;
  let result: ChartVerificationResult = {
    verified: false,
    foundIndicators: [],
    foundPlots: 0,
    foundLabels: 0,
    foundTables: 0,
    errors: [],
  };

  while (Date.now() < deadline) {
    const indicators = await readLegendIndicators(page);
    result.foundIndicators = indicators.map((i) => i.name);
    const dialogs = await readDialogs(page);

    const counts = await page.evaluate(() => {
      const chart = document.querySelector('[data-qa-id="chart-pane"], [class*="chart-container"], .chart-gui-wrapper');
      const scope = chart ?? document.body;
      const labels = Array.from(scope.querySelectorAll("*")).filter(
        (el) =>
          (el as HTMLElement).className?.toLowerCase().includes("label") &&
          (el as HTMLElement).offsetWidth > 0
      ).length;
      const tables = Array.from(scope.querySelectorAll("*")).filter(
        (el) =>
          (el as HTMLElement).className?.toLowerCase().includes("table") &&
          (el as HTMLElement).offsetWidth > 0
      ).length;
      return { labels, tables };
    }).catch(() => ({ labels: 0, tables: 0 }));
    result.foundLabels = counts.labels;
    result.foundTables = counts.tables;
    result.foundPlots = 0; // Canvas plots are not directly enumerable.

    const errors: string[] = [];
    if (dialogs.length) errors.push(...dialogs.map((d) => `dialog: ${d}`));
    if (expectedIndicatorName && !result.foundIndicators.some((n) => n.toLowerCase().includes(expectedIndicatorName.toLowerCase()))) {
      errors.push(`expected indicator "${expectedIndicatorName}" not found in legend`);
    }
    if (expectedLabels !== undefined && result.foundLabels < expectedLabels) {
      errors.push(`expected at least ${expectedLabels} labels, found ${result.foundLabels}`);
    }
    if (expectedTables !== undefined && result.foundTables < expectedTables) {
      errors.push(`expected at least ${expectedTables} tables, found ${result.foundTables}`);
    }
    if (expectedPlots !== undefined && expectedPlots > 0) {
      errors.push(`canvas plot count cannot be verified automatically (expected ${expectedPlots})`);
    }
    result.errors = errors;
    result.verified = errors.length === 0;

    if (result.verified) break;
    await page.waitForTimeout(500);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pine Script backup / restore
// ---------------------------------------------------------------------------

const BACKUPS_DIR = join(paths.projectRoot, "backups");

function ensureBackupsDir(): void {
  mkdirSync(BACKUPS_DIR, { recursive: true });
}

function sanitizeBackupName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.\- ]+/g, "").replace(/\s+/g, "_").slice(0, 60);
}

/**
 * Save the current Pine editor source to ./backups with an ISO timestamp.
 */
export async function backupPineSource(
  page: PageLike,
  label?: string
): Promise<{ backedUp: boolean; path: string | null; note: string }> {
  const read = await readPineSource(page);
  if (!read.source) return { backedUp: false, path: null, note: "Pine editor is empty or closed" };
  ensureBackupsDir();
  const scriptName = sanitizeBackupName(read.scriptName ?? label ?? "untitled");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = label ? `-${sanitizeBackupName(label)}` : "";
  const filename = `${scriptName}-${ts}${suffix}.pine`;
  const path = join(BACKUPS_DIR, filename);
  writeFileSync(path, read.source, "utf8");
  return { backedUp: true, path, note: `source backed up (${read.source.length} chars)` };
}

export interface BackupEntry {
  name: string;
  path: string;
  mtime: string;
  size: number;
}

/**
 * List available Pine source backups from ./backups, newest first.
 */
export function listBackups(): BackupEntry[] {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".pine"))
    .map((f) => {
      const path = join(BACKUPS_DIR, f);
      const stat = statSync(path);
      return { name: f, path, mtime: stat.mtime.toISOString(), size: stat.size };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/**
 * Restore a backup into the Pine editor. If `backupName` is omitted, restores
 * the most recent backup. Does NOT save to TradingView; call tv_pine_save after.
 */
export async function restorePineSource(
  page: PageLike,
  backupName?: string
): Promise<{ restored: boolean; source: string | null; note: string }> {
  const backups = listBackups();
  if (!backups.length) return { restored: false, source: null, note: "no backups found" };
  const entry = backupName
    ? backups.find((b) => b.name === backupName || b.path.endsWith(backupName))
    : backups[0];
  if (!entry) return { restored: false, source: null, note: `backup "${backupName}" not found` };
  const source = readFileSync(entry.path, "utf8");
  if (!(await hasMonacoEditor(page))) {
    await openPineEditor(page);
  }
  await setPineSource(page, source);
  return { restored: true, source, note: `restored from ${entry.name}` };
}
