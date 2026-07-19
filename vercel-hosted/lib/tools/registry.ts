/**
 * Hosted tool registry.
 *
 * Reuses the tool names and JSON schemas from the local project for client
 * compatibility, but dispatches execution to a pluggable backend:
 *   - `mock`: deterministic fake market data for testing.
 *   - `market-data-api`: calls an upstream provider (implement `marketDataProvider`).
 *
 * Browser-only tools (screenshots, Pine editor, alerts, drawings) return a
 * clear error explaining that they are unavailable in hosted/serverless mode.
 *
 * Each SSE session gets its own isolated registry state so that one client
 * cannot change the symbol/timeframe or trigger an emergency stop for others.
 */
import { config } from "@/lib/config";
import * as schemas from "@/lib/validation/schemas";
import { type DetectedClient } from "@/lib/detect/client";

export interface ToolContext {
  requestApproval: (message: string) => Promise<boolean>;
  detectedClient?: DetectedClient;
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

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  destructive: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

interface SessionState {
  activeSymbol: string;
  activeTimeframe: string;
  emergencyStop: boolean;
}

const sessions = new Map<string, SessionState>();

function getSessionState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      activeSymbol: "NASDAQ:AAPL",
      activeTimeframe: "D",
      emergencyStop: false,
    };
    sessions.set(sessionId, state);
  }
  return state;
}

// Best-effort cleanup when sessions end.
export function clearSessionState(sessionId: string): void {
  sessions.delete(sessionId);
}

function schemaFromProperties(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function emptySchema(): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties: {} };
}

interface MarketDataProvider {
  getQuote(symbol: string, timeframe?: string): Promise<{ price: number; change: number; updatedAt: string }>;
  getMetadata(symbol: string, timeframe?: string): Promise<unknown>;
}

// Replace this with your real provider integration (Polygon, Yahoo Finance, etc.).
const marketDataProvider: MarketDataProvider = {
  async getQuote(symbol) {
    // Placeholder: derive a deterministic fake price from the symbol string.
    const seed = symbol.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
    return {
      price: Number((100 + (seed % 900) + Math.random()).toFixed(2)),
      change: Number(((seed % 10) - 5).toFixed(2)),
      updatedAt: new Date().toISOString(),
    };
  },
  async getMetadata(symbol, timeframe) {
    return { symbol, timeframe, source: "market-data-api", indicators: [], strategies: [] };
  },
};

function currentState(state: SessionState) {
  return {
    symbol: state.activeSymbol,
    timeframe: state.activeTimeframe,
    pageReady: true,
    diagnostics: {
      chromeReachable: false,
      tradingViewTabFound: false,
      pageDomReady: true,
    },
  };
}

async function mockQuote(symbol: string, timeframe?: string, activeTimeframe?: string): Promise<ToolResult> {
  const seed = symbol.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return {
    ok: true,
    data: {
      symbol,
      timeframe: timeframe ?? activeTimeframe ?? "D",
      price: Number((100 + (seed % 900)).toFixed(2)),
      change: Number(((seed % 10) - 5).toFixed(2)),
      updated_at: new Date().toISOString(),
      source: "mock",
    },
  };
}

async function fetchQuote(symbol: string, timeframe?: string, activeTimeframe?: string): Promise<ToolResult> {
  if (config.toolBackend === "mock") return mockQuote(symbol, timeframe, activeTimeframe);
  try {
    const quote = await marketDataProvider.getQuote(symbol, timeframe);
    return {
      ok: true,
      data: { symbol, timeframe: timeframe ?? activeTimeframe ?? "D", ...quote, source: config.toolBackend },
    };
  } catch (e) {
    return { ok: false, error: `Market data provider error: ${(e as Error).message}` };
  }
}

function notAvailable(feature: string): ToolResult {
  return {
    ok: false,
    error: `${feature} is not available in the hosted/serverless deployment. Run the local Chrome MCP server for browser automation.`,
  };
}

function unknownClient(): DetectedClient {
  return { name: "Remote SSE MCP client", clientId: "unknown", confidence: "low", source: "default" };
}

function buildTools(sessionId: string): ToolDef[] {
  const state = getSessionState(sessionId);

  const getQuote = (symbol: string, timeframe?: string) =>
    fetchQuote(symbol, timeframe, state.activeTimeframe);

  return [
    {
      name: "ping",
      description: "Health check. Returns server version, backend, emergency-stop state, and MCP client info.",
      destructive: false,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        return {
          ok: true,
          data: {
            name: "tradingview-chrome-mcp-hosted",
            version: "0.2.0",
            backend: config.toolBackend,
            emergencyStop: state.emergencyStop,
            detectedClient: ctx.detectedClient ?? unknownClient(),
          },
        };
      },
    },
    {
      name: "mcp_client_info",
      description: "Report the remote MCP client connected via SSE. In hosted mode this is a remote client; use the local Chrome MCP server for parent-process detection.",
      destructive: false,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        return {
          ok: true,
          data: ctx.detectedClient ?? unknownClient(),
        };
      },
    },
    {
      name: "emergency_stop",
      description: "Immediately disable all tools for this session.",
      destructive: true,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        const ok = await ctx.requestApproval("Trigger emergency stop for this session?");
        if (!ok) return { ok: false, error: "Emergency stop requires approval", blocked: true };
        state.emergencyStop = true;
        return { ok: true, data: { emergencyStop: true } };
      },
    },
    {
      name: "emergency_clear",
      description: "Re-enable tools after an emergency stop for this session.",
      destructive: true,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        const ok = await ctx.requestApproval("Clear emergency stop and re-enable tools for this session?");
        if (!ok) return { ok: false, error: "Clearing emergency stop requires approval", blocked: true };
        state.emergencyStop = false;
        return { ok: true, data: { emergencyStop: false } };
      },
    },
    {
      name: "browser_status",
      description: "Browser automation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Browser status");
      },
    },
    {
      name: "browser_list_tabs",
      description: "Browser automation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Browser tab listing");
      },
    },
    {
      name: "tv_status",
      description: "Read the current market-data symbol, timeframe, and backend state.",
      destructive: false,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        return { ok: true, data: { ...currentState(state), detectedClient: ctx.detectedClient ?? unknownClient() } };
      },
    },
    {
      name: "tv_read_chart",
      description: "Alias for tv_status.",
      destructive: false,
      inputSchema: emptySchema(),
      async run(_a, ctx) {
        return { ok: true, data: { ...currentState(state), detectedClient: ctx.detectedClient ?? unknownClient() } };
      },
    },
    {
      name: "tv_screenshot",
      description: "Screenshots are unavailable in hosted/serverless mode.",
      destructive: false,
      inputSchema: schemaFromProperties({
        name: { type: "string" },
        fullPage: { type: "boolean" },
      }),
      async run() {
        return notAvailable("Screenshots");
      },
    },
    {
      name: "tv_open_pine_editor",
      description: "Pine editor automation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Pine editor");
      },
    },
    {
      name: "tv_read_pine_source",
      description: "Pine source reading is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({ scriptName: { type: "string" } }),
      async run() {
        return notAvailable("Pine source reading");
      },
    },
    {
      name: "tv_pine_create",
      description: "Pine script creation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({
        name: { type: "string" },
        source: { type: "string" },
        overwrite: { type: "boolean" },
      }, ["name", "source"]),
      async run() {
        return notAvailable("Pine script creation");
      },
    },
    {
      name: "tv_pine_patch",
      description: "Pine script patching is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({
        scriptName: { type: "string" },
        source: { type: "string" },
      }, ["scriptName", "source"]),
      async run() {
        return notAvailable("Pine script patching");
      },
    },
    {
      name: "tv_pine_compile_errors",
      description: "Pine compile-error reading is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Pine compile errors");
      },
    },
    {
      name: "tv_pine_save",
      description: "Pine script saving is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ scriptName: { type: "string" } }),
      async run() {
        return notAvailable("Pine script saving");
      },
    },
    {
      name: "tv_pine_add_to_chart",
      description: "Adding Pine scripts to chart is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ scriptName: { type: "string" } }),
      async run() {
        return notAvailable("Add Pine script to chart");
      },
    },
    {
      name: "tv_rename_script",
      description: "Pine script renaming is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }, ["name"]),
      async run() {
        return notAvailable("Pine script renaming");
      },
    },
    {
      name: "tv_change_symbol",
      description: "Set the active symbol for this session. Hosted: does not control a browser.",
      destructive: true,
      inputSchema: schemaFromProperties({ symbol: { type: "string" } }, ["symbol"]),
      async run(args) {
        const parsed = schemas.tvChangeSymbolIn.safeParse(args);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        state.activeSymbol = parsed.data.symbol;
        return { ok: true, data: { symbol: state.activeSymbol, changed: true } };
      },
    },
    {
      name: "tv_change_timeframe",
      description: "Set the active timeframe for this session. Hosted: does not control a browser.",
      destructive: true,
      inputSchema: schemaFromProperties({ timeframe: { type: "string" } }, ["timeframe"]),
      async run(args) {
        const parsed = schemas.tvChangeTimeframeIn.safeParse(args);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        state.activeTimeframe = parsed.data.timeframe;
        return { ok: true, data: { timeframe: state.activeTimeframe, changed: true } };
      },
    },
    {
      name: "tv_read_strategy_tester",
      description: "Strategy tester is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Strategy tester");
      },
    },
    {
      name: "tv_dismiss_dialogs",
      description: "Dialog dismissal is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Dialog dismissal");
      },
    },
    {
      name: "tv_layout_list",
      description: "Layout switching is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Layout listing");
      },
    },
    {
      name: "tv_layout_switch",
      description: "Layout switching is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }, ["name"]),
      async run() {
        return notAvailable("Layout switching");
      },
    },
    {
      name: "tv_alert_create",
      description: "Alert creation is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ message: { type: "string" } }, ["message"]),
      async run() {
        return notAvailable("Alert creation");
      },
    },
    {
      name: "tv_alert_list",
      description: "Alert listing is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Alert listing");
      },
    },
    {
      name: "tv_alert_delete",
      description: "Alert deletion is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ index: { type: "integer" } }, ["index"]),
      async run() {
        return notAvailable("Alert deletion");
      },
    },
    {
      name: "tv_watchlist_read",
      description: "Read the hosted watchlist (mock list of active and recent symbols).",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return {
          ok: true,
          data: {
            symbols: [state.activeSymbol, "NASDAQ:MSFT", "NASDAQ:GOOGL"],
            active: state.activeSymbol,
            source: config.toolBackend,
          },
        };
      },
    },
    {
      name: "tv_watchlist_add_symbol",
      description: "Hosted watchlist is read-only; use tv_change_symbol to update the active symbol.",
      destructive: true,
      inputSchema: schemaFromProperties({ symbol: { type: "string" } }, ["symbol"]),
      async run() {
        return notAvailable("Watchlist editing");
      },
    },
    {
      name: "tv_watchlist_sync",
      description: "Ensure a symbol is represented in market-data responses. Mock: returns the active symbol.",
      destructive: true,
      inputSchema: schemaFromProperties({
        symbol: { type: "string" },
        addIfMissing: { type: "boolean" },
      }),
      async run(args) {
        const parsed = schemas.tvWatchlistSyncIn.safeParse(args);
        if (!parsed.success) return { ok: false, error: parsed.error.message };
        const symbol = parsed.data.symbol ?? state.activeSymbol;
        return {
          ok: true,
          data: { symbol, synced: true, addIfMissing: parsed.data.addIfMissing ?? true },
        };
      },
    },
    {
      name: "tv_chart_metadata",
      description: "Read hosted chart metadata including the latest quote from the configured backend.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        const quoteResult = await getQuote(state.activeSymbol, state.activeTimeframe);
        if (!quoteResult.ok) return quoteResult;
        return {
          ok: true,
          data: {
            symbol: state.activeSymbol,
            timeframe: state.activeTimeframe,
            quote: quoteResult.data,
            indicators: [],
            strategies: [],
            overlays: [],
            paneCount: 1,
          },
        };
      },
    },
    {
      name: "tv_ensure_chart",
      description: "No-op in hosted mode: a market-data session is always available.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() {
        return { ok: true, data: { symbol: state.activeSymbol, timeframe: state.activeTimeframe, navigated: false } };
      },
    },
    {
      name: "tv_chart_data_export",
      description: "CSV export is unavailable in hosted mode.",
      destructive: true,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Chart data export");
      },
    },
    {
      name: "tv_drawing_add_trendline",
      description: "Drawing tools are unavailable in hosted mode.",
      destructive: true,
      inputSchema: emptySchema(),
      async run() {
        return notAvailable("Drawing tools");
      },
    },
    {
      name: "tv_layout_save",
      description: "Layout management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }),
      async run() { return notAvailable("Layout management"); },
    },
    {
      name: "tv_layout_duplicate",
      description: "Layout management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }),
      async run() { return notAvailable("Layout management"); },
    },
    {
      name: "tv_layout_rename",
      description: "Layout management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }, ["name"]),
      async run() { return notAvailable("Layout management"); },
    },
    {
      name: "tv_layout_reset",
      description: "Layout management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: emptySchema(),
      async run() { return notAvailable("Layout management"); },
    },
    {
      name: "tv_layout_export",
      description: "Layout export is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({ name: { type: "string" } }),
      async run() { return notAvailable("Layout export"); },
    },
    {
      name: "tv_indicator_add",
      description: "Indicator management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ name: { type: "string" } }, ["name"]),
      async run() { return notAvailable("Indicator management"); },
    },
    {
      name: "tv_indicator_remove",
      description: "Indicator management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }] } }, ["nameOrIndex"]),
      async run() { return notAvailable("Indicator management"); },
    },
    {
      name: "tv_indicator_hide",
      description: "Indicator management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }] } }, ["nameOrIndex"]),
      async run() { return notAvailable("Indicator management"); },
    },
    {
      name: "tv_indicator_show",
      description: "Indicator management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }] } }, ["nameOrIndex"]),
      async run() { return notAvailable("Indicator management"); },
    },
    {
      name: "tv_indicator_settings",
      description: "Indicator management is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ nameOrIndex: { oneOf: [{ type: "string" }, { type: "integer" }] }, settings: { type: "object" } }, ["nameOrIndex", "settings"]),
      async run() { return notAvailable("Indicator management"); },
    },
    {
      name: "tv_chart_verify",
      description: "Chart verification is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({
        expectedIndicatorName: { type: "string" },
        expectedPlots: { type: "integer" },
        expectedLabels: { type: "integer" },
        expectedTables: { type: "integer" },
      }),
      async run() { return notAvailable("Chart verification"); },
    },
    {
      name: "tv_pine_backup",
      description: "Pine editor automation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: schemaFromProperties({ label: { type: "string" } }),
      async run() { return notAvailable("Pine editor"); },
    },
    {
      name: "tv_pine_list_backups",
      description: "Pine editor automation is unavailable in hosted mode.",
      destructive: false,
      inputSchema: emptySchema(),
      async run() { return notAvailable("Pine editor"); },
    },
    {
      name: "tv_pine_restore",
      description: "Pine editor automation is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({ backupName: { type: "string" } }),
      async run() { return notAvailable("Pine editor"); },
    },
    {
      name: "tv_pine_autofix",
      description: "Pine editor automation is unavailable in hosted mode.",
      destructive: true,
      inputSchema: schemaFromProperties({
        goal: { type: "string" },
        source: { type: "string" },
        maxAttempts: { type: "integer" },
        autoSave: { type: "boolean" },
        autoAddToChart: { type: "boolean" },
        expectedIndicatorName: { type: "string" },
      }, ["goal"]),
      async run() { return notAvailable("Pine editor"); },
    },
  ];
}

export function allTools(): ToolDef[] {
  // Return a default session's tools for schema compatibility tests.
  return buildTools("__default__");
}

export function getTool(name: string): ToolDef | undefined {
  return allTools().find((t) => t.name === name);
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const def = getTool(name);
  if (!def) return { ok: false, error: `Unknown tool: ${name}`, denied: true };
  return def.run(args, ctx);
}

export function createHostedRegistry(sessionId: string): ToolRegistry {
  const tools = buildTools(sessionId);
  return {
    getAllTools: () => tools,
    runTool: async (name, args, ctx) => {
      const state = getSessionState(sessionId);
      if (state.emergencyStop) {
        return { ok: false, error: "Emergency stop is active", blocked: true };
      }
      const def = tools.find((t) => t.name === name);
      if (!def) return { ok: false, error: `Unknown tool: ${name}`, denied: true };
      if (def.destructive) {
        const approved = await ctx.requestApproval(`Execute destructive tool ${name}?`);
        if (!approved) return { ok: false, error: "Approval denied", blocked: true };
      }
      return def.run(args, ctx);
    },
  };
}

export interface ToolRegistry {
  getAllTools: () => ToolDef[];
  runTool: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
