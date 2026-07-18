async function load() {
  const { snapshot } = await chrome.storage.local.get("snapshot");
  const s = snapshot || { connected: false, tvTabs: [], chart: {} };
  const srv = document.getElementById("srv");
  if (s.connected) { srv.textContent = "connected"; srv.className = "pill on"; }
  else { srv.textContent = "off"; srv.className = "pill off"; }
  const es = document.getElementById("es");
  es.textContent = s.emergencyStop ? "STOPPED" : "armed";
  es.className = "pill " + (s.emergencyStop ? "stop" : "on");
  document.getElementById("tabs").textContent = s.tabCount ?? "-";
  document.getElementById("sym").textContent = s.chart?.symbol ?? "-";
  document.getElementById("tf").textContent = s.chart?.timeframe ?? "-";
  const list = document.getElementById("tvlist");
  list.innerHTML = "";
  (s.tvTabs || []).forEach((t) => {
    const d = document.createElement("div");
    d.className = "row";
    d.textContent = (t.active ? "* " : "  ") + (t.title || t.url);
    list.appendChild(d);
  });
}
load();
chrome.storage.local.onChanged.addListener((c) => { if (c.snapshot) load(); });
