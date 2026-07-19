/**
 * Local control panel (dashboard). Express server bound to 127.0.0.1 only.
 * Provides status, pending approvals, action history (audit), screenshots,
 * and the emergency-stop button. No trading logic lives here.
 *
 * All /api/* endpoints require a bearer token. Set TV_DASHBOARD_TOKEN to a
 * strong secret; if unset, a random token is generated and logged once at
 * startup. This prevents other local users or malicious pages from approving
 * actions or triggering the emergency stop.
 */
import express from "express";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { logger } from "../logging/logger.js";
import { paths, audit } from "../logging/logger.js";
import { isEmergencyStopped, triggerEmergencyStop, clearEmergencyStop } from "../permissions/policy.js";
import { listPending, listHistory, resolveApproval } from "../permissions/approvals.js";
import { getBrowser, listTabs, findTradingViewTabs } from "../browser/controller.js";
import * as tv from "../adapters/tradingview/adapter.js";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function getDashboardToken(): string {
  if (process.env.TV_DASHBOARD_TOKEN) return process.env.TV_DASHBOARD_TOKEN;
  const token = generateToken();
  process.env.TV_DASHBOARD_TOKEN = token;
  return token;
}

const DASHBOARD_TOKEN = getDashboardToken();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${DASHBOARD_TOKEN}`;
  if (auth !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TradingView Chrome MCP - Control Panel</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background:#0f1115; color:#e6e9ef; }
  header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:#161922; border-bottom:1px solid #232733; }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  .pill { font-size:12px; padding:3px 8px; border-radius:999px; background:#1f2430; border:1px solid #2c3140; }
  .pill.ok { color:#7ee787; } .pill.bad { color:#ff7b72; } .pill.warn { color:#f2cc60; }
  main { max-width:1100px; margin:0 auto; padding:16px; display:grid; gap:16px; }
  section { background:#161922; border:1px solid #232733; border-radius:10px; padding:12px 14px; }
  h2 { font-size:13px; margin:0 0 8px; text-transform:uppercase; letter-spacing:.04em; color:#9aa3b2; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; }
  .kv { display:flex; flex-direction:column; gap:2px; }
  .kv .k { font-size:11px; color:#7d8696; text-transform:uppercase; letter-spacing:.04em; }
  .kv .v { font-size:14px; font-weight:500; word-break:break-all; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:5px 6px; border-bottom:1px solid #232733; vertical-align:top; }
  th { color:#9aa3b2; font-weight:500; }
  .btn { cursor:pointer; border:1px solid #2c3140; background:#1f2430; color:#e6e9ef; border-radius:6px; padding:5px 10px; font-size:12px; }
  .btn.danger { background:#3a0d12; border-color:#5a1419; color:#ff9a9c; }
  .btn.ok { background:#0d2818; border-color:#143a23; color:#7ee787; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .muted { color:#7d8696; }
  a { color:#79c0ff; }
  img { max-width:100%; border-radius:6px; border:1px solid #232733; }
  .dialog { background:#1f2430; border:1px solid #2c3140; padding:8px 10px; border-radius:6px; margin-bottom:6px; }
</style>
</head>
<body>
<header>
  <h1>TradingView Chrome MCP</h1>
  <span id="connPill" class="pill">checking...</span>
  <span id="tvPill" class="pill">TV: ?</span>
  <span id="esPill" class="pill ok">ES: armed</span>
  <div style="margin-left:auto" class="row">
    <button id="refreshBtn" class="btn">Refresh</button>
    <button id="esBtn" class="btn danger">Emergency Stop</button>
  </div>
</header>
<main>
  <section>
    <h2>Status</h2>
    <div id="status" class="grid">loading...</div>
  </section>
  <section>
    <h2>Pending approvals</h2>
    <div id="pending"><span class="muted">none</span></div>
  </section>
  <section>
    <h2>Latest action history</h2>
    <table id="history"><thead><tr><th>Time</th><th>Tool</th><th>Result</th><th>Tab</th><th>Duration</th><th>Err</th></tr></thead><tbody></tbody></table>
  </section>
  <section>
    <h2>Screenshots</h2>
    <div id="shots" class="row"><span class="muted">none</span></div>
  </section>
</main>
<script>
const TOKEN = "__DASHBOARD_TOKEN__";
async function api(p){ const r=await fetch(p, {headers: {'Authorization': 'Bearer ' + TOKEN}}); return r.json(); }
function $(id){return document.getElementById(id);}
async function refresh(){
  try {
    const s = await api('/api/status');
    $('connPill').textContent = s.connected ? 'Chrome: connected' : 'Chrome: off';
    $('connPill').className = 'pill ' + (s.connected ? 'ok' : 'bad');
    $('tvPill').textContent = 'TV: ' + (s.tvTab ? (s.chart?.symbol ?? '?') + ' ' + (s.chart?.timeframe ?? '') : 'no tab');
    $('tvPill').className = 'pill ' + (s.tvTab ? 'ok' : 'warn');
    $('esPill').textContent = 'ES: ' + (s.emergencyStop ? 'STOPPED' : 'armed');
    $('esPill').className = 'pill ' + (s.emergencyStop ? 'bad' : 'ok');
    let html = '';
    const k = (label, val) => '<div class="kv"><span class="k">'+label+'</span><span class="v">'+(val==null||val===undefined?'-':String(val))+'</span></div>';
    html += k('Connected', s.connected);
    html += k('Tabs', s.tabCount);
    html += k('TV tab', s.tvTab ? 'yes' : 'no');
    html += k('Symbol', s.chart?.symbol);
    html += k('Timeframe', s.chart?.timeframe);
    html += k('Logged in', s.chart?.isLoggedIn);
    html += k('Pine editor', s.chart?.pineEditorOpen);
    html += k('Pine ready', s.chart?.pineEditorReady);
    html += k('Page ready', s.chart?.pageReady);
    html += k('Dialogs', (s.chart?.dialogs||[]).join('; '));
    $('status').innerHTML = html;

    const pend = await api('/api/pending');
    $('pending').innerHTML = pend.length ? pend.map(p => '<div class="dialog"><b>'+p.tool+'</b> - '+p.message+' <button class="btn ok" onclick="dec(\''+p.id+'\',\'approve\')">Approve</button> <button class="btn danger" onclick="dec(\''+p.id+'\',\'deny\')">Deny</button></div>').join('') : '<span class="muted">none</span>';

    const h = await api('/api/history?limit=30');
    $('history').querySelector('tbody').innerHTML = h.map(x => '<tr><td>'+new Date(x.ts).toLocaleTimeString()+'</td><td>'+x.tool+'</td><td>'+x.result+'</td><td>'+(x.tabUrl||'').slice(0,40)+'</td><td>'+(x.durationMs!=null?x.durationMs+'ms':'')+'</td><td>'+(x.error||'')+'</td></tr>').join('');

    const shots = await api('/api/screenshots?limit=6');
    $('shots').innerHTML = shots.length ? shots.map(s => '<a href="/api/screenshot?file='+encodeURIComponent(s)+'" target="_blank"><img src="/api/screenshot?file='+encodeURIComponent(s)+'" style="max-height:160px" /></a>').join(' ') : '<span class="muted">none</span>';
  } catch (e) { $('status').textContent = 'refresh failed: '+e; }
}
window.dec = async (id, d) => { await fetch('/api/pending/'+id+'/'+d, {method:'POST', headers: {'Authorization': 'Bearer ' + TOKEN}}); refresh(); };
$('refreshBtn').onclick = refresh;
$('esBtn').onclick = async () => { await fetch('/api/emergency_stop', {method:'POST', headers: {'Authorization': 'Bearer ' + TOKEN}}); refresh(); };
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

export async function startDashboard(port: number): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  logger.info({ tokenSource: process.env.TV_DASHBOARD_TOKEN ? "env" : "generated" }, "dashboard token configured");

  app.get("/", (_req, res) => res.type("html").send(HTML_TEMPLATE.replace("__DASHBOARD_TOKEN__", DASHBOARD_TOKEN)));

  // All dashboard API endpoints require the bearer token.
  app.use("/api", requireAuth);

  app.get("/api/status", async (_req, res) => {
    let connected = false;
    let tabCount = 0;
    let tvTab: { url: string; title: string } | null = null;
    let chart = null;
    try {
      await getBrowser();
      connected = true;
      const tabs = await listTabs();
      tabCount = tabs.length;
      const tvTabs = await findTradingViewTabs();
      if (tvTabs.length) {
        tvTab = { url: tvTabs[0]!.url, title: tvTabs[0]!.title };
        chart = await tv.readChartState(tvTabs[0]!.page).catch(() => null);
      }
    } catch {
      /* not connected */
    }
    res.json({ connected, tabCount, tvTab, chart, emergencyStop: isEmergencyStopped() });
  });

  app.get("/api/pending", (_req, res) => res.json(listPending()));
  app.post("/api/pending/:id/approve", (req, res) => {
    const ok = resolveApproval(req.params.id!, "approve");
    res.json({ ok });
  });
  app.post("/api/pending/:id/deny", (req, res) => {
    const ok = resolveApproval(req.params.id!, "deny");
    res.json({ ok });
  });

  app.get("/api/history", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 10_000);
    const lines: import("../logging/logger.js").AuditEntry[] = [];
    try {
      const raw = await readFile(paths.auditPath, "utf8");
      for (const line of raw.trim().split(/\n+/).slice(-limit)) {
        try { lines.push(JSON.parse(line)); } catch { /* skip */ }
      }
    } catch { /* no audit file yet */ }
    res.json(lines);
  });

  app.post("/api/emergency_stop", (_req, res) => {
    triggerEmergencyStop();
    audit({ ts: new Date().toISOString(), tool: "emergency_stop", result: "ok" });
    res.json({ ok: true, emergencyStop: true });
  });
  app.post("/api/emergency_clear", (_req, res) => {
    clearEmergencyStop();
    res.json({ ok: true, emergencyStop: false });
  });

  app.get("/api/screenshots", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 1_000);
    const dir = join(paths.projectRoot, "screenshots");
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).slice(-limit).reverse();
      res.json(files);
    } catch {
      res.json([]);
    }
  });
  app.get("/api/screenshot", async (req, res) => {
    const file = String(req.query.file ?? "");
    if (!/^[A-Za-z0-9_.\- ]+\.png$/.test(file)) return res.status(400).send("bad filename");
    const full = join(paths.projectRoot, "screenshots", file);
    if (!existsSync(full)) return res.status(404).send("not found");
    res.type("png").send(await readFile(full));
  });

  await new Promise<void>((resolve) => {
    app.listen(port, "127.0.0.1", () => {
      logger.info({ url: `http://127.0.0.1:${port}` }, "dashboard listening");
      resolve();
    });
  });
  return app;
}
