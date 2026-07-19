/**
 * Content-script error observer for TradingView Pine Script failures.
 *
 * Watches the DOM for dynamically injected error toasts, Pine editor console
 * errors, and add-to-chart failures, then forwards them to the background
 * service worker via chrome.runtime.sendMessage. The background worker pushes
 * the error to the local MCP server over the WebSocket connection so the
 * autonomous repair loop can react instantly.
 */
(function () {
  "use strict";

  // Avoid duplicate injection if the extension is reloaded.
  if (window.__tvMcpErrorObserver) return;
  window.__tvMcpErrorObserver = true;

  const ERROR_SELECTORS = [
    // Generic error toasts / banners
    '.tv-toast--error',
    '[class*="toast"][class*="error"]',
    '[class*="toast"][class*="danger"]',
    '[class*="alert"][class*="error"]',
    '[class*="alert"][class*="danger"]',
    // Pine editor console / errors pane
    '[class*="pine-editor"] [class*="error"]',
    '[class*="pine-editor"] [class*="errors-list"]',
    '[data-name="pine-editor-errors"]',
    '[class*="code-error"]',
    // Dialog / modal error states
    '[role="dialog"] [class*="error"]',
    '[role="alertdialog"]',
  ];

  const IMPLICIT_ERROR_PATTERNS = [
    /compilation failed/i,
    /cannot compile script/i,
    /undeclared identifier/i,
    /add to chart operation failed/i,
    /study not auth/i,
    /script could not be saved/i,
    /pine script error/i,
    /invalid argument/i,
    /mismatched input/i,
    /cannot be used/i,
  ];

  const DEDUPE_WINDOW_MS = 2000;
  let lastErrorText = "";
  let lastErrorTs = 0;
  let debounceTimer = null;

  function transmit(errorText, source) {
    clearTimeout(debounceTimer);
    lastErrorText = errorText;
    lastErrorTs = Date.now();

    try {
      chrome.runtime.sendMessage({
        type: "PINE_SCRIPT_ERROR_DETECTED",
        payload: {
          timestamp: lastErrorTs,
          source,
          error: errorText,
          url: location.href,
        },
      });
    } catch (e) {
      console.warn("[tv-mcp] error observer sendMessage failed", e);
    }

    debounceTimer = setTimeout(() => {
      lastErrorText = "";
      lastErrorTs = 0;
    }, DEDUPE_WINDOW_MS);
  }

  function isDuplicate(text) {
    return text === lastErrorText && Date.now() - lastErrorTs < DEDUPE_WINDOW_MS;
  }

  function normalizeError(text) {
    return text
      .replace(/\s+/g, " ")
      .replace(/ /g, " ")
      .trim()
      .slice(0, 2000);
  }

  function matchesImplicitError(text) {
    return IMPLICIT_ERROR_PATTERNS.some((p) => p.test(text));
  }

  function extractErrorText(node) {
    // Prefer explicit error element text.
    for (const selector of ERROR_SELECTORS) {
      const el = node.matches?.(selector) ? node : node.querySelector?.(selector);
      if (el) {
        const text = normalizeError(el.innerText || el.textContent || "");
        if (text.length > 3) return { text, source: "selector" };
      }
    }

    // Fallback: large blocks of red text.
    const raw = normalizeError(node.innerText || node.textContent || "");
    if (raw.length > 3 && matchesImplicitError(raw)) {
      return { text: raw, source: "implicit" };
    }

    return null;
  }

  function checkNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const extracted = extractErrorText(node);
    if (!extracted || isDuplicate(extracted.text)) return;
    transmit(extracted.text, extracted.source);
  }

  function onMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        checkNode(node);
      }
    }
  }

  function startObserver() {
    const target = document.body || document.documentElement;
    if (!target) return false;
    const observer = new MutationObserver(onMutations);
    observer.observe(target, { childList: true, subtree: true });
    return true;
  }

  if (!startObserver()) {
    document.addEventListener("DOMContentLoaded", () => startObserver(), { once: true });
  }

  // Also re-scan existing DOM once in case the error element was injected
  // before the observer started.
  document.addEventListener("DOMContentLoaded", () => {
    for (const el of document.querySelectorAll(ERROR_SELECTORS.join(", "))) {
      checkNode(el);
    }
  }, { once: true });
})();
