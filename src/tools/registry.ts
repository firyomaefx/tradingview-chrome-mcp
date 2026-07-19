/**
 * Tool registry. Each tool declares its JSON schema input, handler, and
 * whether it is destructive (requires approval). All handlers receive the
 * validated args and a shared ToolContext.
 */
import type { Page } from "playwright";
import { logger } from "../logging/logger.js";
import { audit } from "../logging/logger.js";
import * as policy from "../permissions/policy.js";
import { getTradingViewTab, getBrowser, listTabs, type TradingViewTab } from "../browser/controller.js";
import * as tv from "../adapters/tradingview/adapter.js";
import { detectMcpClient, type DetectedClient } from "../detect/client.js";
import { runAutofix } from "../llm/autofix.js";

export interface ToolContext {
  requestApproval: (message: string) => Promise<boolean>;
}

let cachedClient: DetectedClient | null = null;

async function getDetectedClient(): Promise<DetectedClient> {
  if (!cachedClient) {
    cachedClient = await detectMcpClient();
  }
  return cachedClient;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema
  destructive: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  screenshot?: string;
  tabUrl?: string;
  blocked?: boolean;
  denied?: boolean;
}

let activeTab: TradingViewTab | null = null;

async function tab(): Promise<TradingViewTab> {
  if (activeTab) {
    try {
      const url = activeTab.page.url();
      if (url && /tradingview\.com\//i.test(url)) return activeTab;
    } catch {
      activeTab = null;
    }
  }
  const t = await getTradingViewTab();
  if (!t) throw new Error("No TradingView tab found");
  activeTab = t;
  return activeTab;
}

function page(): Promise<Page> {
  return tab().then((t) => t.page);
}

function denied(msg: string): ToolResult {
  return { ok: false, error: msg, denied: true };
}
function blocked(msg: string): ToolResult {
  return { ok: false, error: msg, blocked: true };
}

async function guard(def: ToolDef, args: Record<string, unknown>, url?: string): Promise<ToolResult | null> {
  const decision = policy.evaluate({
    tool: def.name,
    url,
    destructive: def.destructive,
    approvalApproved: false,
    chainDepth: 0,
  });
  if (!decision.allowed) {
    if (decision.severity === "deny") return denied(decision.reason);
    if (def.destructive) {
      // Re-evaluate after potential approval (handled by server).
      return blocked(decision.reason);
    }
    return blocked(decision.reason);
  }
  return null;
}

function schemaFromProperties(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function emptySchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties: {} };
}

const tools: ToolDef[] = [
  {
    name: "ping",
    description: "Health check. Returns server version, emergency-stop state, and the detected MCP host client.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const client = await getDetectedClient();
      return {
        ok: true,
        data: {
          name: "tradingview-chrome-mcp",
          version: "0.2.0",
          emergencyStop: policy.isEmergencyStopped(),
          allowedDomains: policy.ALLOWED_DOMAINS,
          detectedClient: client,
        },
      };
    },
  },
  {
    name: "mcp_client_info",
    description: "Detect and report the LLM/MCP host client that launched this server (Claude, Codex, ChatGPT, Cursor, etc.). Read-only.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const client = await getDetectedClient();
      return { ok: true, data: client };
    },
  },
  {
    name: "emergency_stop",
    description: "Immediately disable all tools. Use to halt a runaway action chain.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      policy.triggerEmergencyStop();
      audit({ ts: new Date().toISOString(), tool: "emergency_stop", result: "ok" });
      return { ok: true, data: { emergencyStop: true } };
    },
  },
  {
    name: "emergency_clear",
    description: "Re-enable tools after an emergency stop. Use only once the user has confirmed safety.",
    destructive: false,
    inputSchema: emptySchema(),
    async run(_a, ctx) {
      const ok = await ctx.requestApproval("Clear emergency stop and re-enable tools?");
      if (!ok) return blocked("Clearing emergency stop requires approval");
      policy.clearEmergencyStop();
      audit({ ts: new Date().toISOString(), tool: "emergency_clear", result: "ok" });
      return { ok: true, data: { emergencyStop: false } };
    },
  },
  {
    name: "browser_status",
    description: "Report Chrome connection status and the number of open tabs.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      try {
        const browser = await getBrowser();
        const tabs = await listTabs();
        return {
          ok: true,
          data: {
            connected: true,
            tabCount: tabs.length,
            tabs: tabs.map((t) => ({ tabId: t.tabId, title: t.title.slice(0, 80), url: t.url.slice(0, 120) })),
          },
        };
      } catch (e) {
        return { ok: false, error: String((e as Error).message ?? e) };
      }
    },
  },
  {
    name: "browser_list_tabs",
    description: "List all open Chrome tabs.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const tabs = await listTabs();
      return {
        ok: true,
        data: tabs.map((t) => ({ tabId: t.tabId, title: t.title, url: t.url })),
      };
    },
  },
  {
    name: "tv_status",
    description: "Read the current TradingView chart state: symbol, timeframe, login, Pine editor open, dialogs, diagnostics, and detected MCP host client.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const state = await tv.readChartState(t.page);
      const client = await getDetectedClient();
      return { ok: true, data: { ...state, detectedClient: client }, tabUrl: t.url };
    },
  },
  {
    name: "tv_read_chart",
    description: "Alias for tv_status. Returns the current symbol, timeframe, page readiness, diagnostics, and detected MCP host client.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const state = await tv.readChartState(t.page);
      const client = await getDetectedClient();
      return { ok: true, data: { ...state, detectedClient: client }, tabUrl: t.url };
    },
  },
  {
    name: "tv_screenshot",
    description: "Capture a PNG screenshot of the active TradingView tab. Returns the local file path.",
    destructive: false,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Filename prefix." },
      fullPage: { type: "boolean", description: "Capture the full scrollable page (default false)." },
    }),
    async run(args) {
      const t = await tab();
      const name = typeof args.name === "string" ? args.name : undefined;
      const fullPage = args.fullPage === true;
      const path = await tv.captureScreenshot(t.page, name, fullPage);
      return { ok: true, data: { path }, screenshot: path, tabUrl: t.url };
    },
  },
  {
    name: "tv_open_pine_editor",
    description: "Open the Pine Editor panel on the chart. Idempotent: returns alreadyOpen=true if already open.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.openPineEditor(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_read_pine_source",
    description: "Read the current Pine Script source from the open editor. Returns null if editor is closed.",
    destructive: false,
    inputSchema: schemaFromProperties({
      scriptName: { type: "string", description: "Optional script name filter (not enforced)." },
    }),
    async run() {
      const t = await tab();
      const res = await tv.readPineSource(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_create",
    description: "Replace the Pine editor contents with a new v6 indicator source. Does NOT save. Call tv_pine_save afterwards.",
    destructive: false,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Script name (informational)." },
      source: { type: "string", description: "Full Pine Script source including //@version=6." },
      overwrite: { type: "boolean", description: "Allow overwriting unsaved changes (default false)." },
    }, ["name", "source"]),
    async run(args) {
      const source = String(args.source ?? "");
      const t = await tab();
      if (!(await tv.hasMonacoEditor(t.page)).valueOf()) await tv.openPineEditor(t.page);
      const backup = await tv.backupPineSource(t.page, "before-create");
      await tv.setPineSource(t.page, source);
      return { ok: true, data: { replaced: true, length: source.length, backup }, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_patch",
    description: "Patch the Pine editor with a full replacement source (semantic patch = overwrite editor buffer). Call tv_pine_save afterwards.",
    destructive: false,
    inputSchema: schemaFromProperties({
      scriptName: { type: "string" },
      source: { type: "string", description: "Full replacement Pine Script v6 source." },
    }, ["scriptName", "source"]),
    async run(args) {
      const source = String(args.source ?? "");
      const t = await tab();
      if (!(await tv.hasMonacoEditor(t.page)).valueOf()) await tv.openPineEditor(t.page);
      const backup = await tv.backupPineSource(t.page, "before-patch");
      await tv.setPineSource(t.page, source);
      return { ok: true, data: { patched: true, length: source.length, backup }, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_compile_errors",
    description: "Read compile errors/warnings from the Pine editor. Call after tv_pine_save or before tv_pine_add_to_chart.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.readCompileErrors(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_save",
    description: "Click the Pine editor Save button. DESTRUCTIVE: persists the script to the user's TradingView account.",
    destructive: true,
    inputSchema: schemaFromProperties({
      scriptName: { type: "string", description: "Optional; informational only." },
    }),
    async run(args, ctx) {
      const approved = await ctx.requestApproval(
        `Save Pine script${args.scriptName ? ` "${args.scriptName}"` : ""} to your TradingView account?`
      );
      if (!approved) return blocked("Save cancelled by user");
      const t = await tab();
      const res = await tv.clickSave(t.page, typeof args.scriptName === 'string' ? args.scriptName : undefined);
      audit({ ts: new Date().toISOString(), tool: "tv_pine_save", args, result: res.saved ? "ok" : "error", tabUrl: t.url });
      return { ok: res.saved, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_add_to_chart",
    description: "Click 'Add to chart' on the current Pine script. DESTRUCTIVE: changes the active chart.",
    destructive: true,
    inputSchema: schemaFromProperties({
      scriptName: { type: "string" },
    }),
    async run(_a, ctx) {
      const approved = await ctx.requestApproval("Add the current Pine script to the active chart?");
      if (!approved) return blocked("Add-to-chart cancelled by user");
      const t = await tab();
      const res = await tv.addScriptToChart(t.page);
      audit({ ts: new Date().toISOString(), tool: "tv_pine_add_to_chart", result: res.added ? "ok" : "error", tabUrl: t.url });
      return { ok: res.added, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_rename_script",
    description: "Rename the current Pine script via the editor title menu (Rename...). DESTRUCTIVE: changes the saved script name.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "New script name (1-80 chars, alphanumeric, spaces, dashes, underscores)." },
    }, ["name"]),
    async run(args, ctx) {
      const name = String(args.name ?? "");
      const approved = await ctx.requestApproval(`Rename current Pine script to "${name}"?`);
      if (!approved) return blocked("Rename cancelled by user");
      const t = await tab();
      const res = await tv.renameScript(t.page, name);
      audit({ ts: new Date().toISOString(), tool: "tv_rename_script", args: { name }, result: res.renamed ? "ok" : "error", tabUrl: t.url });
      return { ok: res.renamed, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_change_symbol",
    description: "Change the active chart symbol. DESTRUCTIVE: modifies the user's chart.",
    destructive: true,
    inputSchema: schemaFromProperties({
      symbol: { type: "string", description: "Exchange-style ticker, e.g. NASDAQ:AAPL" },
    }, ["symbol"]),
    async run(args, ctx) {
      const symbol = String(args.symbol ?? "");
      const approved = await ctx.requestApproval(`Change chart symbol to ${symbol}?`);
      if (!approved) return blocked("Symbol change cancelled by user");
      const t = await tab();
      const res = await tv.changeSymbol(t.page, symbol);
      audit({ ts: new Date().toISOString(), tool: "tv_change_symbol", args: { symbol }, result: res.changed ? "ok" : "error", tabUrl: t.url });
      return { ok: res.changed, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_change_timeframe",
    description: "Change the active chart timeframe. DESTRUCTIVE: modifies the user's chart.",
    destructive: true,
    inputSchema: schemaFromProperties({
      timeframe: { type: "string", description: "One of: 1,5,15,30,60,240,D,W,M" },
    }, ["timeframe"]),
    async run(args, ctx) {
      const tf = String(args.timeframe ?? "");
      const approved = await ctx.requestApproval(`Change chart timeframe to ${tf}?`);
      if (!approved) return blocked("Timeframe change cancelled by user");
      const t = await tab();
      const res = await tv.changeTimeframe(t.page, tf);
      audit({ ts: new Date().toISOString(), tool: "tv_change_timeframe", args: { timeframe: tf }, result: res.changed ? "ok" : "error", tabUrl: t.url });
      return { ok: res.changed, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_read_strategy_tester",
    description: "Read the Strategy Tester summary if visible. Returns visible:false if the panel is not open.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.readStrategyTester(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_dismiss_dialogs",
    description: "Close known TradingView upsell/notice dialogs (close/X buttons only; never clicks primary CTAs). Non-destructive.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.dismissDialogs(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_list",
    description: "Open the layouts menu and list saved chart layout names. Best-effort selector.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.listLayouts(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_switch",
    description: "Switch to a saved chart layout by exact name. DESTRUCTIVE: changes the active layout.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Exact layout name to switch to." },
    }, ["name"]),
    async run(args, ctx) {
      const name = String(args.name ?? "");
      const approved = await ctx.requestApproval(`Switch chart layout to "${name}"?`);
      if (!approved) return blocked("Layout switch cancelled by user");
      const t = await tab();
      const res = await tv.switchLayout(t.page, name);
      audit({ ts: new Date().toISOString(), tool: "tv_layout_switch", args: { name }, result: res.switched ? "ok" : "error", tabUrl: t.url });
      return { ok: res.switched, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_alert_create",
    description: "Create a basic alert on the current symbol with the given message. DESTRUCTIVE: creates a real alert on your account.",
    destructive: true,
    inputSchema: schemaFromProperties({
      message: { type: "string", description: "Alert message text." },
    }, ["message"]),
    async run(args, ctx) {
      const message = String(args.message ?? "");
      const approved = await ctx.requestApproval(`Create alert on the active symbol with message "${message.slice(0, 60)}"?`);
      if (!approved) return blocked("Alert creation cancelled by user");
      const t = await tab();
      const res = await tv.createAlert(t.page, message);
      audit({ ts: new Date().toISOString(), tool: "tv_alert_create", args: { message }, result: res.created ? "ok" : "error", tabUrl: t.url });
      return { ok: res.created, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_alert_list",
    description: "Open the alerts panel and list existing alert messages. Best-effort.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.listAlerts(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_alert_delete",
    description: "Delete the alert at the given zero-based index in the alerts panel. DESTRUCTIVE.",
    destructive: true,
    inputSchema: schemaFromProperties({
      index: { type: "integer", description: "Zero-based index of the alert to delete." },
    }, ["index"]),
    async run(args, ctx) {
      const index = Number(args.index ?? 0);
      const approved = await ctx.requestApproval(`Delete alert at index ${index}?`);
      if (!approved) return blocked("Alert deletion cancelled by user");
      const t = await tab();
      const res = await tv.deleteAlert(t.page, index);
      audit({ ts: new Date().toISOString(), tool: "tv_alert_delete", args: { index }, result: res.deleted ? "ok" : "error", tabUrl: t.url });
      return { ok: res.deleted, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_watchlist_read",
    description: "Read the symbols in the active watchlist panel if visible.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.readWatchlist(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_watchlist_add_symbol",
    description: "Add the current chart symbol to the watchlist via the star button. DESTRUCTIVE: modifies your watchlist.",
    destructive: true,
    inputSchema: schemaFromProperties({
      symbol: { type: "string", description: "Symbol to add (informational; adds the active chart symbol)." },
    }, ["symbol"]),
    async run(args, ctx) {
      const approved = await ctx.requestApproval(`Add ${args.symbol} to the watchlist?`);
      if (!approved) return blocked("Watchlist add cancelled by user");
      const t = await tab();
      const res = await tv.addSymbolToWatchlist(t.page, String(args.symbol));
      audit({ ts: new Date().toISOString(), tool: "tv_watchlist_add_symbol", args, result: res.added ? "ok" : "error", tabUrl: t.url });
      return { ok: res.added, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_watchlist_sync",
    description: "Read the active watchlist and optionally add the current/requested symbol if missing. DESTRUCTIVE when it adds a symbol.",
    destructive: true,
    inputSchema: schemaFromProperties({
      symbol: { type: "string", description: "Symbol to ensure is in the watchlist (defaults to active chart symbol if omitted)." },
      addIfMissing: { type: "boolean", description: "Add the symbol if it is not already in the watchlist (default true)." },
    }),
    async run(args, ctx) {
      const t = await tab();
      const state = await tv.readChartState(t.page);
      const symbol = typeof args.symbol === "string" ? args.symbol : (state.symbol ?? "");
      if (!symbol) return { ok: false, error: "No symbol provided and no active chart symbol found" };
      const addIfMissing = args.addIfMissing !== false;
      if (addIfMissing) {
        const approved = await ctx.requestApproval(`Sync watchlist: add ${symbol} if missing?`);
        if (!approved) return blocked("Watchlist sync cancelled by user");
      }
      const res = await tv.syncWatchlist(t.page, symbol, addIfMissing);
      audit({ ts: new Date().toISOString(), tool: "tv_watchlist_sync", args: { symbol, addIfMissing }, result: res.synced ? "ok" : "error", tabUrl: t.url });
      return { ok: res.synced, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_chart_metadata",
    description: "Read visible chart metadata: symbol, timeframe, indicators, strategies, overlays, and pane count. Read-only.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const res = await tv.readChartMetadata(t.page);
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_ensure_chart",
    description: "Ensure a usable TradingView chart tab is open. If none exists, opens the Pine Editor and navigates to TV_DEFAULT_TRADINGVIEW_URL. Non-destructive navigation only.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const t = await tab();
      const state = await tv.readChartState(t.page);
      const navigated = !state.diagnostics.tradingViewTabFound;
      if (navigated) {
        await tv.openPineEditor(t.page);
      }
      return { ok: true, data: { url: t.url, navigated, state }, tabUrl: t.url };
    },
  },
  {
    name: "tv_chart_data_export",
    description: "Export the current chart data to CSV. Saves the download to ./exports. DESTRUCTIVE: triggers a browser download.",
    destructive: true,
    inputSchema: emptySchema(),
    async run(_a, ctx) {
      const approved = await ctx.requestApproval("Export current chart data to CSV (download)?");
      if (!approved) return blocked("Export cancelled by user");
      const t = await tab();
      const res = await tv.exportChartData(t.page);
      audit({ ts: new Date().toISOString(), tool: "tv_chart_data_export", result: res.triggered ? "ok" : "error", tabUrl: t.url, screenshot: res.path ?? undefined });
      return { ok: res.triggered, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_drawing_add_trendline",
    description: "Experimental: add a vertical trend line via the left drawing toolbar using two clicks on the chart pane. Best-effort.",
    destructive: true,
    inputSchema: emptySchema(),
    async run(_a, ctx) {
      const approved = await ctx.requestApproval("Draw an experimental trend line on the chart?");
      if (!approved) return blocked("Drawing cancelled by user");
      const t = await tab();
      const res = await tv.addHorizontalLine(t.page);
      audit({ ts: new Date().toISOString(), tool: "tv_drawing_add_trendline", result: res.added ? "ok" : "error", tabUrl: t.url });
      return { ok: res.added, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_save",
    description: "Save the current chart layout. Provide a name to perform 'Save layout as...'. DESTRUCTIVE: overwrites the saved layout in your TradingView account.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Optional new name for 'Save layout as...'" },
    }),
    async run(args, ctx) {
      const approved = await ctx.requestApproval(`Save current chart layout${args.name ? ` as "${args.name}"` : ""}?`);
      if (!approved) return blocked("Layout save cancelled by user");
      const t = await tab();
      const res = await tv.saveLayout(t.page, typeof args.name === "string" ? args.name : undefined);
      audit({ ts: new Date().toISOString(), tool: "tv_layout_save", args, result: res.saved ? "ok" : "error", tabUrl: t.url });
      return { ok: res.saved, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_duplicate",
    description: "Duplicate the active chart layout. Optionally provide a new name. DESTRUCTIVE: creates a new layout in your account.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Optional name for the duplicated layout" },
    }),
    async run(args, ctx) {
      const approved = await ctx.requestApproval(`Duplicate current chart layout${args.name ? ` as "${args.name}"` : ""}?`);
      if (!approved) return blocked("Layout duplicate cancelled by user");
      const t = await tab();
      const res = await tv.duplicateLayout(t.page, typeof args.name === "string" ? args.name : undefined);
      audit({ ts: new Date().toISOString(), tool: "tv_layout_duplicate", args, result: res.duplicated ? "ok" : "error", tabUrl: t.url });
      return { ok: res.duplicated, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_rename",
    description: "Rename the active chart layout. DESTRUCTIVE: changes the saved layout name.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "New layout name" },
    }, ["name"]),
    async run(args, ctx) {
      const name = String(args.name ?? "");
      const approved = await ctx.requestApproval(`Rename active chart layout to "${name}"?`);
      if (!approved) return blocked("Layout rename cancelled by user");
      const t = await tab();
      const res = await tv.renameLayout(t.page, name);
      audit({ ts: new Date().toISOString(), tool: "tv_layout_rename", args, result: res.renamed ? "ok" : "error", tabUrl: t.url });
      return { ok: res.renamed, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_reset",
    description: "Reset the active chart layout to its default/empty state. DESTRUCTIVE: removes indicators and drawings.",
    destructive: true,
    inputSchema: emptySchema(),
    async run(_a, ctx) {
      const approved = await ctx.requestApproval("Reset the active chart layout to default?");
      if (!approved) return blocked("Layout reset cancelled by user");
      const t = await tab();
      const res = await tv.resetLayout(t.page);
      audit({ ts: new Date().toISOString(), tool: "tv_layout_reset", result: res.reset ? "ok" : "error", tabUrl: t.url });
      return { ok: res.reset, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_layout_export",
    description: "Export a local snapshot of the current layout (screenshot + metadata JSON) to ./layouts. Non-destructive.",
    destructive: false,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Optional base filename prefix" },
    }),
    async run(args) {
      const t = await tab();
      const res = await tv.exportLayout(t.page, typeof args.name === "string" ? args.name : undefined);
      return { ok: res.exported, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_indicator_add",
    description: "Add an indicator or strategy to the chart by name (e.g. 'RSI', 'MACD'). DESTRUCTIVE: modifies the chart.",
    destructive: true,
    inputSchema: schemaFromProperties({
      name: { type: "string", description: "Exact or partial name of the indicator/strategy to add" },
    }, ["name"]),
    async run(args, ctx) {
      const name = String(args.name ?? "");
      const approved = await ctx.requestApproval(`Add indicator/strategy "${name}" to the chart?`);
      if (!approved) return blocked("Indicator add cancelled by user");
      const t = await tab();
      const res = await tv.addIndicator(t.page, name);
      audit({ ts: new Date().toISOString(), tool: "tv_indicator_add", args, result: res.added ? "ok" : "error", tabUrl: t.url });
      return { ok: res.added, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_indicator_remove",
    description: "Remove an indicator from the chart by exact legend name or zero-based index. DESTRUCTIVE.",
    destructive: true,
    inputSchema: schemaFromProperties({
      nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }], description: "Indicator legend name or zero-based index" },
    }, ["nameOrIndex"]),
    async run(args, ctx) {
      const nameOrIndex = typeof args.nameOrIndex === "number" ? args.nameOrIndex : String(args.nameOrIndex ?? "");
      const approved = await ctx.requestApproval(`Remove indicator "${nameOrIndex}" from the chart?`);
      if (!approved) return blocked("Indicator remove cancelled by user");
      const t = await tab();
      const res = await tv.removeIndicator(t.page, nameOrIndex);
      audit({ ts: new Date().toISOString(), tool: "tv_indicator_remove", args, result: res.removed ? "ok" : "error", tabUrl: t.url });
      return { ok: res.removed, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_indicator_hide",
    description: "Hide an indicator by legend name or zero-based index. DESTRUCTIVE: changes chart visibility.",
    destructive: true,
    inputSchema: schemaFromProperties({
      nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }], description: "Indicator legend name or zero-based index" },
    }, ["nameOrIndex"]),
    async run(args, ctx) {
      const nameOrIndex = typeof args.nameOrIndex === "number" ? args.nameOrIndex : String(args.nameOrIndex ?? "");
      const approved = await ctx.requestApproval(`Hide indicator "${nameOrIndex}"?`);
      if (!approved) return blocked("Indicator hide cancelled by user");
      const t = await tab();
      const res = await tv.hideIndicator(t.page, nameOrIndex);
      audit({ ts: new Date().toISOString(), tool: "tv_indicator_hide", args, result: res.hidden ? "ok" : "error", tabUrl: t.url });
      return { ok: res.hidden, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_indicator_show",
    description: "Show a previously hidden indicator by legend name or zero-based index. DESTRUCTIVE: changes chart visibility.",
    destructive: true,
    inputSchema: schemaFromProperties({
      nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }], description: "Indicator legend name or zero-based index" },
    }, ["nameOrIndex"]),
    async run(args, ctx) {
      const nameOrIndex = typeof args.nameOrIndex === "number" ? args.nameOrIndex : String(args.nameOrIndex ?? "");
      const approved = await ctx.requestApproval(`Show indicator "${nameOrIndex}"?`);
      if (!approved) return blocked("Indicator show cancelled by user");
      const t = await tab();
      const res = await tv.showIndicator(t.page, nameOrIndex);
      audit({ ts: new Date().toISOString(), tool: "tv_indicator_show", args, result: res.shown ? "ok" : "error", tabUrl: t.url });
      return { ok: res.shown, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_indicator_settings",
    description: "Update an indicator's settings by legend name or index. `settings` is a map of input label to value. DESTRUCTIVE.",
    destructive: true,
    inputSchema: schemaFromProperties({
      nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }], description: "Indicator legend name or zero-based index" },
      settings: { type: "object", description: "Map of setting label/placeholder to new value", additionalProperties: true },
    }, ["nameOrIndex", "settings"]),
    async run(args, ctx) {
      const nameOrIndex = typeof args.nameOrIndex === "number" ? args.nameOrIndex : String(args.nameOrIndex ?? "");
      const settings = typeof args.settings === "object" && args.settings !== null ? (args.settings as Record<string, number | string | boolean>) : {};
      const approved = await ctx.requestApproval(`Update settings for indicator "${nameOrIndex}"?`);
      if (!approved) return blocked("Indicator settings update cancelled by user");
      const t = await tab();
      const res = await tv.setIndicatorSettings(t.page, nameOrIndex, settings);
      audit({ ts: new Date().toISOString(), tool: "tv_indicator_settings", args, result: res.updated ? "ok" : "error", tabUrl: t.url });
      return { ok: res.updated, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_chart_verify",
    description: "Best-effort runtime verification that an indicator is on the chart and expected plots/labels/tables are present. Read-only.",
    destructive: false,
    inputSchema: schemaFromProperties({
      expectedIndicatorName: { type: "string", description: "Indicator name to look for in the legend" },
      expectedPlots: { type: "integer", description: "Minimum number of plots expected (canvas plots cannot be auto-counted; will be reported)" },
      expectedLabels: { type: "integer", description: "Minimum number of label elements expected" },
      expectedTables: { type: "integer", description: "Minimum number of table elements expected" },
      maxWaitMs: { type: "integer", description: "Max time to wait for objects to appear (default 3000)" },
    }),
    async run(args) {
      const t = await tab();
      const res = await tv.verifyChart(t.page, {
        expectedIndicatorName: typeof args.expectedIndicatorName === "string" ? args.expectedIndicatorName : undefined,
        expectedPlots: typeof args.expectedPlots === "number" ? args.expectedPlots : undefined,
        expectedLabels: typeof args.expectedLabels === "number" ? args.expectedLabels : undefined,
        expectedTables: typeof args.expectedTables === "number" ? args.expectedTables : undefined,
        maxWaitMs: typeof args.maxWaitMs === "number" ? args.maxWaitMs : undefined,
      });
      return { ok: true, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_backup",
    description: "Back up the current Pine editor source to ./backups with a timestamp. Non-destructive.",
    destructive: false,
    inputSchema: schemaFromProperties({
      label: { type: "string", description: "Optional label appended to the backup filename" },
    }),
    async run(args) {
      const t = await tab();
      const res = await tv.backupPineSource(t.page, typeof args.label === "string" ? args.label : undefined);
      return { ok: res.backedUp, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_list_backups",
    description: "List available Pine source backups from ./backups, newest first. Read-only.",
    destructive: false,
    inputSchema: emptySchema(),
    async run() {
      const backups = tv.listBackups();
      return { ok: true, data: { count: backups.length, backups }, tabUrl: undefined };
    },
  },
  {
    name: "tv_pine_restore",
    description: "Restore a backup into the Pine editor. If backupName is omitted, restores the most recent backup. DESTRUCTIVE: overwrites editor contents (does not auto-save).",
    destructive: true,
    inputSchema: schemaFromProperties({
      backupName: { type: "string", description: "Exact backup filename from tv_pine_list_backups" },
    }),
    async run(args, ctx) {
      const approved = await ctx.requestApproval("Restore Pine source from backup? This overwrites the editor contents.");
      if (!approved) return blocked("Restore cancelled by user");
      const t = await tab();
      const res = await tv.restorePineSource(t.page, typeof args.backupName === "string" ? args.backupName : undefined);
      audit({ ts: new Date().toISOString(), tool: "tv_pine_restore", args, result: res.restored ? "ok" : "error", tabUrl: t.url });
      return { ok: res.restored, data: res, tabUrl: t.url };
    },
  },
  {
    name: "tv_pine_autofix",
    description: "Autonomous Pine Script repair loop. Reads source, compiles, optionally calls an LLM (OPENAI_API_KEY/ANTHROPIC_API_KEY) to patch errors, saves, adds to chart, and verifies. DESTRUCTIVE: may save and add to chart. Set autoSave/autoAddToChart=false to run read-only diagnostics.",
    destructive: true,
    inputSchema: schemaFromProperties({
      goal: { type: "string", description: "Natural-language goal, e.g. 'Fix all compile errors and add moving average'" },
      source: { type: "string", description: "Optional replacement source. If omitted, reads from the editor." },
      maxAttempts: { type: "integer", description: "Maximum repair attempts (1-10, default 5)" },
      autoSave: { type: "boolean", description: "Automatically save patched source (default true)" },
      autoAddToChart: { type: "boolean", description: "Automatically add to chart after compile success (default true)" },
      expectedIndicatorName: { type: "string", description: "Name to verify in chart legend after add-to-chart" },
    }, ["goal"]),
    async run(args, ctx) {
      const t = await tab();
      const report = await runAutofix(
        { page: t.page, tabUrl: t.url, requestApproval: ctx.requestApproval },
        {
          goal: String(args.goal ?? ""),
          source: typeof args.source === "string" ? args.source : undefined,
          maxAttempts: typeof args.maxAttempts === "number" ? args.maxAttempts : undefined,
          autoSave: typeof args.autoSave === "boolean" ? args.autoSave : undefined,
          autoAddToChart: typeof args.autoAddToChart === "boolean" ? args.autoAddToChart : undefined,
          expectedIndicatorName: typeof args.expectedIndicatorName === "string" ? args.expectedIndicatorName : undefined,
        }
      );
      return { ok: report.success, data: report, screenshot: report.screenshot ?? undefined, tabUrl: t.url };
    },
  },
];

export function allTools(): ToolDef[] {
  return tools;
}

export function getTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const def = getTool(name);
  if (!def) return denied(`Unknown tool: ${name}`);
  // URL-aware guard for tools that need a TradingView tab.
  const needsTab = name.startsWith("tv_") || name === "tv_status";
  let url: string | undefined;
  if (needsTab) {
    try {
      const t = await tab();
      url = t.url;
    } catch (e) {
      return denied("No TradingView tab available: " + String((e as Error).message ?? e));
    }
  }
  const g = await guard(def, args, url);
  if (g) return g;
  const start = Date.now();
  try {
    const result = await def.run(args, ctx);
    audit({
      ts: new Date().toISOString(),
      tool: name,
      args,
      result: result.ok ? "ok" : result.denied ? "denied" : result.blocked ? "blocked" : "error",
      durationMs: Date.now() - start,
      screenshot: result.screenshot,
      tabUrl: result.tabUrl,
      error: result.error,
    });
    return result;
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    logger.error({ tool: name, err }, "tool threw");
    audit({ ts: new Date().toISOString(), tool: name, args, result: "error", durationMs: Date.now() - start, error: err });
    return { ok: false, error: err };
  }
}


