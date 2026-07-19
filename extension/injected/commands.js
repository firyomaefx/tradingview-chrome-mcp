/**
 * Generic DOM command runner injected into TradingView's MAIN world.
 *
 * The extension background script calls these functions via
 * `chrome.scripting.executeScript({ world: "MAIN" })` so they run in
 * TradingView's own JavaScript context, giving us access to `window.monaco`
 * and real DOM events.
 */
(function () {
  "use strict";

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parsePseudoFilters(selector) {
    const filters = [];
    let remaining = selector;

    // :has-text("...") / :has-text('...')
    remaining = remaining.replace(
      /:has-text\((["'])(.*?)\1\)/g,
      (_, __, text) => {
        filters.push({ type: "hasText", text });
        return "";
      }
    );

    // :text-is("...") / :text-is('...')
    remaining = remaining.replace(
      /:text-is\((["'])(.*?)\1\)/g,
      (_, __, text) => {
        filters.push({ type: "textIs", text });
        return "";
      }
    );

    // :first / :nth(n)
    remaining = remaining.replace(/:first\b/g, () => {
      filters.push({ type: "first" });
      return "";
    });
    remaining = remaining.replace(/:nth\((\d+)\)/g, (_, n) => {
      filters.push({ type: "nth", index: parseInt(n, 10) });
      return "";
    });

    return { selector: remaining.trim(), filters };
  }

  function getText(el) {
    return (el.innerText ?? el.textContent ?? "").trim();
  }

  function queryPlaywright(selector) {
    const { selector: css, filters } = parsePseudoFilters(selector);
    let nodes = [];
    if (!css || css === "*") {
      nodes = Array.from(document.querySelectorAll("*"));
    } else {
      try {
        nodes = Array.from(document.querySelectorAll(css));
      } catch (e) {
        console.error("[tv-mcp] invalid selector:", css, e);
        return [];
      }
    }

    for (const f of filters) {
      if (f.type === "hasText") {
        nodes = nodes.filter((n) => getText(n).includes(f.text));
      } else if (f.type === "textIs") {
        nodes = nodes.filter((n) => getText(n) === f.text);
      } else if (f.type === "first") {
        nodes = nodes.slice(0, 1);
      } else if (f.type === "nth") {
        nodes = nodes.slice(f.index, f.index + 1);
      }
    }
    return nodes;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function boundingBoxOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function waitForSelector(selector, state, timeoutMs) {
    const deadline = Date.now() + (timeoutMs ?? 10_000);
    return new Promise((resolve, reject) => {
      function check() {
        const nodes = queryPlaywright(selector);
        const anyVisible = nodes.some(isVisible);
        if (state === "hidden" && nodes.length === 0) return resolve(true);
        if (state === "attached" && nodes.length > 0) return resolve(true);
        if (state === "visible" && anyVisible) return resolve(true);
        if (state === "detached" && nodes.length === 0) return resolve(true);
        if (Date.now() > deadline) {
          return reject(new Error(`waitFor(${selector}, ${state}) timed out`));
        }
        setTimeout(check, 100);
      }
      check();
    });
  }

  function dispatchInput(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // -------------------------------------------------------------------------
  // Commands exposed on window.__tvMcp
  // -------------------------------------------------------------------------

  window.__tvMcp = window.__tvMcp || {};
  window.__tvMcp.__queryPlaywright = queryPlaywright;

  window.__tvMcp.query = function ({ selector, property, timeout }) {
    let nodes = queryPlaywright(selector);
    if (timeout) {
      const deadline = Date.now() + timeout;
      while (nodes.length === 0 && Date.now() < deadline) {
        nodes = queryPlaywright(selector);
        if (nodes.length) break;
      }
    }
    const results = nodes.slice(0, 20).map((el) => {
      const base = {
        tagName: el.tagName,
        visible: isVisible(el),
        disabled: !!el.disabled,
      };
      if (property === "innerText" || property === "text") base.text = getText(el);
      if (property === "innerHTML") base.html = el.innerHTML;
      if (property === "boundingBox") base.boundingBox = boundingBoxOf(el);
      if (property === "checked" || property === undefined) {
        base.checked = el.tagName === "INPUT" && el.type === "checkbox" ? el.checked : undefined;
      }
      return base;
    });
    return { matches: nodes.length, results };
  };

  window.__tvMcp.click = function ({ selector, force }) {
    const nodes = queryPlaywright(selector);
    if (!nodes.length) throw new Error(`No element matches ${selector}`);
    const el = nodes[0];
    el.scrollIntoView({ block: "center", inline: "center" });
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    el.dispatchEvent(clickEvent);
    if (force || !clickEvent.defaultPrevented) {
      if (typeof el.click === "function") el.click();
    }
    return { clicked: true };
  };

  window.__tvMcp.fill = function ({ selector, value }) {
    const nodes = queryPlaywright(selector);
    if (!nodes.length) throw new Error(`No input matches ${selector}`);
    const el = nodes[0];
    dispatchInput(el, String(value));
    return { filled: true };
  };

  window.__tvMcp.type = async function ({ selector, value, delay }) {
    const nodes = queryPlaywright(selector);
    if (!nodes.length) throw new Error(`No input matches ${selector}`);
    const el = nodes[0];
    el.focus();
    el.select?.();
    const chars = String(value).split("");
    for (const ch of chars) {
      dispatchInput(el, (el.value ?? "") + ch);
      if (delay && delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return { typed: true };
  };

  window.__tvMcp.focus = function ({ selector }) {
    const nodes = queryPlaywright(selector);
    if (!nodes.length) throw new Error(`No element matches ${selector}`);
    nodes[0].focus();
    return { focused: true };
  };

  window.__tvMcp.insertText = function ({ text }) {
    const target = document.activeElement || document.body;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      target.value += text;
      dispatchInput(target, target.value);
    } else {
      document.execCommand("insertText", false, text);
    }
    return { inserted: true };
  };

  window.__tvMcp.press = function ({ selector, key }) {
    const target = selector ? queryPlaywright(selector)[0] : document.activeElement || document.body;
    if (!target) throw new Error(`No element matches ${selector}`);
    target.focus();
    const lower = key.toLowerCase();
    const modifiers = {
      ctrlKey: lower.includes("ctrl"),
      metaKey: lower.includes("meta") || lower.includes("command"),
      altKey: lower.includes("alt"),
      shiftKey: lower.includes("shift"),
    };
    const mainKey = key
      .replace(/control|ctrl/gi, "")
      .replace(/meta|command/gi, "")
      .replace(/alt/gi, "")
      .replace(/shift/gi, "")
      .replace(/[+\s]/g, "")
      .replace(/^(.+)$/i, (m) => m) || key;

    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: mainKey,
        code: mainKey,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      })
    );
    if (mainKey.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.altKey) {
      target.dispatchEvent(
        new InputEvent("beforeinput", {
          data: mainKey,
          inputType: "insertText",
          bubbles: true,
          cancelable: true,
        })
      );
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        target.value += mainKey;
      }
      target.dispatchEvent(
        new InputEvent("input", {
          data: mainKey,
          inputType: "insertText",
          bubbles: true,
          cancelable: true,
        })
      );
    }
    target.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: mainKey,
        code: mainKey,
        bubbles: true,
        cancelable: true,
        ...modifiers,
      })
    );
    return { pressed: true };
  };

  window.__tvMcp.select = function ({ selector, value }) {
    const nodes = queryPlaywright(selector);
    if (!nodes.length) throw new Error(`No select matches ${selector}`);
    const el = nodes[0];
    el.value = String(value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { selected: true };
  };

  window.__tvMcp.goto = function ({ url }) {
    location.href = url;
    return { navigated: true };
  };

  window.__tvMcp.eval = function ({ fn, arg }) {
    const f = new Function("arg", `return (${fn})(arg);`);
    return { result: f(arg) };
  };

  window.__tvMcp.evalOnSelector = function ({ selector, fn }) {
    const el = queryPlaywright(selector)[0];
    if (!el) throw new Error(`No element matches ${selector}`);
    const f = new Function("el", `return (${fn})(el);`);
    return { result: f(el) };
  };

  window.__tvMcp.waitFor = function ({ selector, state, timeout }) {
    return waitForSelector(selector, state, timeout).then(() => ({ waited: true }));
  };

  window.__tvMcp.getTabInfo = function () {
    return {
      url: location.href,
      title: document.title,
      tabId: null, // background fills this in
    };
  };

  window.__tvMcp.mouseMove = function ({ x, y, steps }) {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(
      new MouseEvent("mousemove", {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    return { moved: true };
  };

  window.__tvMcp.mouseClick = function ({ x, y }) {
    const el = document.elementFromPoint(x, y) || document.body;
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    el.dispatchEvent(
      new MouseEvent("click", {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
    );
    return { clicked: true };
  };

  window.__tvMcp.listTabs = function () {
    // Background overrides this; placeholder here for protocol completeness.
    return [];
  };
})();
