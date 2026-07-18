// Content script: reports the active TradingView tab's symbol/timeframe to
// the background page so the popup and dashboard can show it.
(() => {
  function snapshot() {
    const sym = document.querySelector('button[aria-label="Change symbol"]')?.innerText?.trim() ?? null;
    const tf = document.querySelector('button[aria-label="Change interval"]')?.innerText?.trim() ?? null;
    return { symbol: sym, timeframe: tf, url: location.href };
  }
  chrome.runtime.sendMessage({ type: "tv-snapshot", data: snapshot() }).catch(() => {});
  // Throttled re-report on URL changes.
  let last = "";
  setInterval(() => {
    const s = JSON.stringify(snapshot());
    if (s !== last) { last = s; chrome.runtime.sendMessage({ type: "tv-snapshot", data: snapshot() }).catch(() => {}); }
  }, 5000);
})();
