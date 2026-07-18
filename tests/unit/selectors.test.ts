// Selector regression test: a tiny, hand-written HTML fixture that mirrors the
// real TradingView DOM patterns discovered during the live verification run.
// Guards against accidental selector renames that would silently break reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const FIXTURE = `<!doctype html><html><body>
  <div class="chart">
    <div class="legend">
      <button aria-label="Change symbol">Crude Palm Oil Futures</button>
      <button aria-label="Change interval">5</button>
      <button data-qa-id="legend-flag-action" aria-label="Flag symbol"></button>
    </div>
    <div class="header-toolbar">
      <button data-name="open-indicators-dialog" aria-label="Indicators, metrics, and strategies">Indicators</button>
      <button aria-label="Create alert">Alert</button>
      <button data-name="advanced-view-button" aria-label="Advanced view"></button>
    </div>
    <button data-name="pine-dialog-button" aria-label="Pine"></button>
    <div class="dialog" data-name="pine-dialog" aria-hidden="false">
      <button data-qa-id="pine-script-title-button">Untitled script</button>
      <button data-qa-id="add-script-to-chart"></button>
      <button data-qa-id="pine-script-save-button" aria-label="Save"></button>
      <button data-qa-id="publish-script">Publish script</button>
      <div class="monaco-editor pine-editor-monaco"><textarea class="inputarea monaco-mouse-cursor-text"></textarea></div>
    </div>
    <div class="menu" role="menu">
      <button aria-label="Rename...">Rename...</button>
      <button>Save script</button>
    </div>
    <input placeholder="Symbol, ISIN, or CUSIP" />
    <div class="watchlist"><div class="symbol">AAPL</div></div>
  </div>
</body></html>`;

const { document } = parseHTML(FIXTURE);

function firstVisibleText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return (el.textContent || "").trim();
  }
  return null;
}
function exists(selectors) {
  return selectors.some((s) => document.querySelector(s) !== null);
}

test("symbol selector resolves the legend symbol button", () => {
  const s = firstVisibleText([
    'button[aria-label="Change symbol"]',
    '[data-qa-id="header-toolbar-symbol-search"]',
  ]);
  assert.equal(s, "Crude Palm Oil Futures");
});

test("interval selector resolves the legend interval button", () => {
  const t = firstVisibleText([
    'button[aria-label="Change interval"]',
    '[data-qa-id="timeframe-select"]',
  ]);
  assert.equal(t, "5");
});

test("pine editor opener resolves the pine-dialog-button", () => {
  assert.ok(exists([
    'button[data-name="pine-dialog-button"]',
    'button[aria-label="Pine"]',
  ]));
});

test("pine save + add-to-chart selectors resolve", () => {
  assert.ok(exists(['[data-qa-id="pine-script-save-button"]']));
  assert.ok(exists(['[data-qa-id="add-script-to-chart"]']));
  assert.ok(exists(['[data-qa-id="pine-script-title-button"]']));
});

test("symbol search input selector resolves", () => {
  assert.ok(exists(['input[placeholder="Symbol, ISIN, or CUSIP"]']));
});

test("indicators and alert buttons resolve", () => {
  assert.ok(exists(['button[data-name="open-indicators-dialog"]']));
  assert.ok(exists(['button[aria-label="Create alert"]']));
});

test("watchlist symbol selector resolves", () => {
  assert.ok(exists(['[class*="watchlist"] [class*="symbol"]']));
});

test("monaco editor presence selector resolves", () => {
  assert.ok(exists(['.monaco-editor', 'textarea[class*="inputarea"]']));
});

test("pine rename menu selector resolves", () => {
  assert.ok(exists([
    '[data-qa-id="pine-script-title-button"]',
    '[aria-label="Rename..."]',
    'button:has-text("Rename")',
  ]));
  assert.equal(document.querySelector('[data-qa-id="pine-script-title-button"]')?.textContent?.trim(), "Untitled script");
});
