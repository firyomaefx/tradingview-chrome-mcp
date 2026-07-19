/**
 * TradingView-specific commands injected into the MAIN world.
 *
 * These functions rely on `window.monaco`, the DOM, and TradingView's
 * stable data-name attributes. They are invoked by the extension background
 * script and return plain JSON-serializable objects.
 */
(function () {
  "use strict";

  window.__tvMcp = window.__tvMcp || {};

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getText(el) {
    return (el?.innerText ?? el?.textContent ?? "").trim();
  }

  function queryPlaywright(selector) {
    // Reuse the parser from commands.js if present.
    if (window.__tvMcp?.__queryPlaywright) {
      return window.__tvMcp.__queryPlaywright(selector);
    }
    return Array.from(document.querySelectorAll(selector));
  }

  function clickSelector(selector) {
    const el = queryPlaywright(selector)[0];
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === "function") el.click();
    return true;
  }

  async function waitForMonaco(maxWaitMs = 10_000) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (window.monaco?.editor?.getModels()?.length > 0) return true;
      if (document.querySelector(".monaco-editor textarea")) return true;
      await wait(250);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Pine editor
  // -------------------------------------------------------------------------

  window.__tvMcp.openPineEditor = async function () {
    if (document.querySelector(".monaco-editor")) return { opened: false, alreadyOpen: true };
    const openers = [
      'button[data-name="pine-dialog-button"]',
      'button[aria-label="Pine"]',
      'button[data-name="Pine Editor"]',
    ];
    for (const sel of openers) {
      if (clickSelector(sel)) {
        await wait(500);
        if (await waitForMonaco(8_000)) return { opened: true, alreadyOpen: false };
      }
    }
    return { opened: false, alreadyOpen: false, note: "Could not open Pine editor" };
  };

  window.__tvMcp.readPineSource = function () {
    if (window.monaco?.editor?.getModels) {
      const models = window.monaco.editor.getModels();
      const pine = models.find((m) => (m?.getValue?.() ?? "").includes("//@version"));
      const source = pine?.getValue?.() ?? models[0]?.getValue?.() ?? null;
      if (source) return { source, scriptName: null, editorHasUnsavedChanges: false };
    }
    const lines = Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"));
    if (lines.length) {
      return {
        source: lines.map((l) => l.innerText).join("\n"),
        scriptName: null,
        editorHasUnsavedChanges: false,
      };
    }
    const ta = document.querySelector(".monaco-editor textarea.inputarea");
    if (ta) return { source: ta.value, scriptName: null, editorHasUnsavedChanges: false };
    return { source: null, scriptName: null, editorHasUnsavedChanges: false };
  };

  window.__tvMcp.setPineSource = async function ({ source }) {
    if (!(await waitForMonaco(8_000))) {
      throw new Error("Monaco editor not ready");
    }

    // Approach A: Monaco model API.
    if (window.monaco?.editor?.getModels) {
      const models = window.monaco.editor.getModels();
      const pine =
        models.find((m) => (m?.getValue?.() ?? "").includes("//@version")) ?? models[0];
      if (pine?.setValue) {
        pine.setValue(source);
        return { injected: true, method: "monaco" };
      }
    }

    // Approach B: focus textarea, select all, then clipboard paste simulation.
    const ta = document.querySelector(".monaco-editor textarea.inputarea");
    if (ta) {
      ta.focus();
      ta.select();
      try {
        await navigator.clipboard.writeText(source);
        document.execCommand("paste");
        return { injected: true, method: "clipboard-paste" };
      } catch (e) {
        // Fallback: execCommand insertText.
        document.execCommand("insertText", false, source);
        return { injected: true, method: "execCommand" };
      }
    }

    throw new Error("Could not inject Pine source");
  };

  window.__tvMcp.clickSave = async function ({ name }) {
    // Strategy 1: title-button menu -> Save script.
    const titleBtn = document.querySelector('[data-qa-id="pine-script-title-button"]');
    if (titleBtn) {
      titleBtn.click();
      await wait(500);
      const items = Array.from(document.querySelectorAll('button, [role="menuitem"]'));
      const save = items.find((b) => /save script/i.test(getText(b)));
      if (save) {
        save.click();
        await wait(800);
      }
    }
    // Strategy 2: save icon.
    clickSelector('[data-qa-id="pine-script-save-button"]');
    await wait(800);
    // Strategy 3: Ctrl+S.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );
    await wait(300);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key: "s", ctrlKey: true, bubbles: true })
    );
    return { saved: true };
  };

  window.__tvMcp.addScriptToChart = async function () {
    await wait(300);
    const candidates = [
      '[data-qa-id="add-script-to-chart"]',
      'button[data-name="pine-editor-add-to-chart"]',
      '[data-qa-id="pine-editor-add-to-chart"]',
    ];
    for (const sel of candidates) {
      if (clickSelector(sel)) {
        await wait(1_200);
        return { added: true };
      }
    }
    // Fallback by text.
    const buttons = Array.from(document.querySelectorAll("button"));
    const addBtn = buttons.find((b) => /add to chart/i.test(getText(b)));
    if (addBtn) {
      addBtn.click();
      await wait(1_200);
      return { added: true };
    }
    return { added: false };
  };

  window.__tvMcp.readCompileErrors = function () {
    const errors = [];
    const warnings = [];
    const errorPanels = [
      '[class*="pine-editor"] [class*="error"]',
      '[data-name="pine-editor-errors"]',
      '[class*="code-error"]',
      '[class*="errors-list"]',
    ];
    for (const sel of errorPanels) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = getText(el);
      if (!text) continue;
      for (const line of text.split(/\n+/)) {
        const l = line.trim();
        if (!l) continue;
        if (/warning/i.test(l)) warnings.push(l);
        else errors.push(l);
      }
    }
    // Monaco markers.
    try {
      const model = window.monaco?.editor?.getModels?.()[0];
      if (model?.getMarkers) {
        for (const m of model.getMarkers()) {
          if (m.severity >= 8) errors.push(m.message);
          else if (m.severity >= 4) warnings.push(m.message);
        }
      }
    } catch {}
    return { hasErrors: errors.length > 0, errors, hasWarnings: warnings.length > 0, warnings, success: errors.length === 0 };
  };

  // -------------------------------------------------------------------------
  // Chart state
  // -------------------------------------------------------------------------

  window.__tvMcp.readChartState = function () {
    const url = location.href;
    const symbolBtn =
      document.querySelector('button[aria-label="Change symbol"]') ||
      document.querySelector('[data-qa-id="header-toolbar-symbol-search"]');
    const symbol = getText(symbolBtn) || null;

    const tfBtn =
      document.querySelector('button[aria-label="Change interval"]') ||
      document.querySelector('[data-qa-id="timeframe-select"]');
    const timeframe = getText(tfBtn) || null;

    const pineEditorOpen = !!document.querySelector(".monaco-editor");
    const pineEditorReady = pineEditorOpen && !!document.querySelector(".monaco-editor textarea");

    const isLoggedIn = !!document.querySelector('a[href*="/u/"], [data-qa-id="user-menu"]');

    return {
      url,
      symbol,
      timeframe,
      isLoggedIn,
      pineEditorOpen,
      pineEditorReady,
      dialogs: window.__tvMcp.readDialogs(),
      pageReady: !!document.querySelector('canvas, [data-qa-id="chart-pane"]'),
      diagnostics: {
        chromeReachable: true,
        tradingViewTabFound: /tradingview\.com\/chart\//i.test(url),
        pageDomReady: true,
      },
    };
  };

  window.__tvMcp.readDialogs = function () {
    const found = [];
    const sels = ['[role="dialog"]', '[data-name$="-dialog"]', '[data-name="pine-dialog"]'];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 80) continue;
        const t = getText(el).slice(0, 120);
        if (t && !found.includes(t)) found.push(t);
      }
    }
    return found;
  };

  window.__tvMcp.dismissDialogs = function () {
    const dismissed = [];
    const closeSels = [
      'button[aria-label*="Close"]',
      'button[aria-label*="close"]',
      '[class*="dialog"] [class*="close"]',
      '[class*="modal"] [class*="close"]',
      '[data-name*="close"]',
    ];
    for (const sel of closeSels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el)) continue;
        el.click();
        dismissed.push(getText(el.closest('[role="dialog"], [class*="modal"]')).slice(0, 120));
      }
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { dismissed, remaining: window.__tvMcp.readDialogs() };
  };

  window.__tvMcp.readChartMetadata = function () {
    const indicators = [];
    const strategies = [];
    const overlays = [];
    for (const root of document.querySelectorAll('[class*="legend"], [class*="chart-legend"], [data-name="legend"]')) {
      for (const el of root.querySelectorAll("*")) {
        const t = getText(el);
        if (!t || t.length > 80 || indicators.includes(t)) continue;
        if (/strategy/i.test(t)) strategies.push(t);
        else if (/overlay|moving average|ema|sma|bollinger|macd|rsi/i.test(t)) overlays.push(t);
        else indicators.push(t);
      }
    }
    const paneCount = Math.max(1, document.querySelectorAll('[class*="chart-pane"], [class*="pane"]').length);
    return { visibleIndicators: indicators, strategies, overlays, paneCount };
  };

  window.__tvMcp.changeSymbol = async function ({ symbol }) {
    const openers = [
      'button[aria-label="Change symbol"]',
      '[data-qa-id="header-toolbar-symbol-search"]',
      'button[aria-label*="Symbol search"]',
    ];
    for (const sel of openers) {
      if (clickSelector(sel)) {
        await wait(700);
        const inputs = Array.from(document.querySelectorAll("input"));
        const input = inputs.find((i) => /symbol|search/i.test(i.placeholder ?? ""));
        if (input) {
          input.focus();
          input.value = symbol;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await wait(500);
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
          await wait(1_000);
          return { changed: true };
        }
      }
    }
    return { changed: false };
  };

  window.__tvMcp.changeTimeframe = async function ({ tf }) {
    const openers = [
      'button[aria-label="Change interval"]',
      '[data-qa-id="timeframe-select"]',
    ];
    for (const sel of openers) {
      if (clickSelector(sel)) {
        await wait(500);
        const items = Array.from(document.querySelectorAll('button, [role="menuitem"], [data-name*="interval"]'));
        const label = tf === "D" ? "1D" : tf === "W" ? "1W" : tf === "M" ? "1M" : `${tf}m`;
        const item = items.find((b) => getText(b) === label || getText(b) === tf || getText(b) === `${tf}m`);
        if (item) {
          item.click();
          await wait(600);
          return { changed: true };
        }
        const inputs = Array.from(document.querySelectorAll("input"));
        const input = inputs.find((i) => /interval|timeframe/i.test(i.placeholder ?? ""));
        if (input) {
          input.value = tf;
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          await wait(600);
          return { changed: true };
        }
      }
    }
    return { changed: false };
  };

  // -------------------------------------------------------------------------
  // Indicator / legend helpers
  // -------------------------------------------------------------------------

  function readLegendItems() {
    const out = [];
    for (const root of document.querySelectorAll('[class*="chart-legend"], [class*="legend"], [data-name="legend"]')) {
      for (const el of root.querySelectorAll("*")) {
        const t = getText(el);
        if (!t || t.length > 80 || out.some((x) => x.name === t)) continue;
        const row = el.closest('[class*="legendItem"], [class*="source"], [data-name*="legend"]');
        const hidden = row
          ? !!Array.from(row.querySelectorAll("*")).find((n) =
              /hidden|invisible|closed/i.test(n.title ?? n.ariaLabel ?? n.className ?? "")
            )
          : false;
        out.push({ name: t, visible: !hidden });
      }
    }
    return out.slice(0, 100);
  }

  window.__tvMcp.readLegendIndicators = function () {
    return readLegendItems();
  };

  window.__tvMcp.indicatorAction = function ({ nameOrIndex, action }) {
    const items = readLegendItems();
    const targetName = typeof nameOrIndex === "number" ? items[nameOrIndex]?.name : nameOrIndex;
    if (!targetName) throw new Error(`indicator "${nameOrIndex}" not found`);
    for (const root of document.querySelectorAll('[class*="chart-legend"], [class*="legend"], [data-name="legend"]')) {
      for (const el of root.querySelectorAll("*")) {
        const t = getText(el);
        if (!t.toLowerCase().includes(targetName.toLowerCase())) continue;
        const row = el.closest('[class*="legendItem"], [class*="source"], [data-name*="legend"]');
        if (!row) continue;
        const buttons = Array.from(row.querySelectorAll("button, [role='button'], [class*='button']"));
        const re =
          action === "remove"
            ? /remove|delete|close|trash/i
            : action === "settings"
            ? /settings|gear|cog/i
            : /eye|visibility|show|hide/i;
        const target = buttons.find((b) =
          re.test((b.title ?? "") + " " + (b.ariaLabel ?? "") + " " + (b.className ?? ""))
        );
        if (target) {
          target.click();
          return { ok: true };
        }
      }
    }
    return { ok: false };
  };

  window.__tvMcp.addIndicator = async function ({ name }) {
    const opener = document.querySelector(
      'button[aria-label="Indicators"], [data-qa-id="open-indicators-dialog"], button[data-name="open-indicators-dialog"]'
    );
    if (!opener) return { added: false, note: "Indicators opener not found" };
    opener.click();
    await wait(800);
    const inputs = Array.from(document.querySelectorAll("input"));
    const input = inputs.find((i) => /search/i.test(i.placeholder ?? ""));
    if (input) {
      input.focus();
      input.value = name;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(600);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    await wait(800);
    const items = Array.from(document.querySelectorAll('[data-name="indicator-item"], [class*="indicator-item"]'));
    if (items[0]) {
      items[0].click();
      await wait(800);
      return { added: true };
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { added: false };
  };

  // -------------------------------------------------------------------------
  // Layout helpers
  // -------------------------------------------------------------------------

  function findMenuItem(labels) {
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], [class*="menu"] *'));
    return items.find((b) => labels.some((l) => getText(b).toLowerCase() === l.toLowerCase())
    );
  }

  window.__tvMcp.layoutMenuAction = async function ({ action, name }) {
    const opener = document.querySelector(
      '[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button'
    );
    if (!opener) return { ok: false, note: "layout menu opener not found" };
    opener.click();
    await wait(700);

    const labelsByAction = {
      save: ["Save layout as...", "Save As", "Save layout", "Save"],
      duplicate: ["Duplicate layout", "Make a copy", "Duplicate"],
      rename: ["Rename layout", "Rename...", "Rename"],
      reset: ["Reset chart layout", "Reset layout", "Reset"],
    };
    const item = findMenuItem(labelsByAction[action]);
    if (!item) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return { ok: false, note: "menu item not found" };
    }
    item.click();
    await wait(500);
    if (name) {
      const inputs = Array.from(document.querySelectorAll("input"));
      const input = inputs.find((i) => /name/i.test(i.placeholder ?? ""));
      if (input) {
        input.value = name;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await wait(800);
      }
    }
    return { ok: true };
  };

  window.__tvMcp.listLayouts = async function () {
    const opener = document.querySelector(
      '[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button'
    );
    if (!opener) return { names: [], active: null };
    opener.click();
    await wait(600);
    const names = Array.from(
      document.querySelectorAll('[class*="layout"] [class*="title"], [class*="layouts-list"] [class*="title"]')
    )
      .map(getText)
      .filter(Boolean)
      .slice(0, 50);
    const activeEl = document.querySelector('[class*="layout"][class*="active"], [class*="layout"][aria-selected="true"]');
    const active = activeEl ? getText(activeEl) : null;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { names, active };
  };

  window.__tvMcp.switchLayout = async function ({ name }) {
    const opener = document.querySelector(
      '[data-qa-id="chart-layouts"], button[aria-label*="ayout"], [class*="layout"] button'
    );
    if (!opener) return { switched: false };
    opener.click();
    await wait(600);
    const items = Array.from(document.querySelectorAll('button, [role="menuitem"], [class*="layouts-list"] *'));
    const item = items.find((b) => getText(b) === name);
    if (item) {
      item.click();
      await wait(1_000);
      return { switched: true };
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { switched: false };
  };

  // -------------------------------------------------------------------------
  // Watchlist / alerts (best-effort)
  // -------------------------------------------------------------------------

  window.__tvMcp.readWatchlist = function () {
    const root = document.querySelector('[class*="watchlist"], [data-name*="watchlist"]');
    if (!root) return { visible: false, symbols: [] };
    const symbols = Array.from(root.querySelectorAll('[class*="symbol"], [class*="ticker"]'))
      .map(getText)
      .filter(Boolean)
      .slice(0, 200);
    return { visible: true, symbols };
  };

  window.__tvMcp.addSymbolToWatchlist = async function ({ symbol }) {
    const star = document.querySelector('[class*="header-toolbar"] [class*="star"], button[aria-label*="watchlist"]');
    if (star) {
      star.click();
      await wait(600);
      return { added: true };
    }
    return { added: false };
  };

  window.__tvMcp.createAlert = async function ({ message }) {
    const opener = document.querySelector(
      '[data-qa-id="alert"], button[aria-label*="Alert"], [class*="header-toolbar"] [class*="alert"]'
    );
    if (!opener) return { created: false };
    opener.click();
    await wait(800);
    const inputs = Array.from(document.querySelectorAll("input, textarea"));
    const input = inputs.find((i) => /message/i.test(i.placeholder ?? ""));
    if (input) {
      input.value = message;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const buttons = Array.from(document.querySelectorAll("button"));
    const submit = buttons.find((b) => /create|submit/i.test(getText(b)));
    if (submit) {
      submit.click();
      await wait(600);
      return { created: true };
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return { created: false };
  };

  // -------------------------------------------------------------------------
  // Proactive error observer
  // -------------------------------------------------------------------------

  (function observeErrors() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!node.querySelectorAll) continue;
          const errorEls = node.querySelectorAll(
            '[class*="error"], [class*="code-error"], [data-name*="error"]'
          );
          if (errorEls.length) {
            window.__tvMcp.__lastErrorMutation = Date.now();
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  })();
})();
