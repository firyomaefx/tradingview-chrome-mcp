/**
 * Zod input schemas for every MCP tool. Centralized so the server and the
 * dashboard can both validate and document parameters identically.
 */
import { z } from "zod";

export const sVoid = z.object({}).strict();

export const sSymbol = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9:.]+$/, "Symbol must be uppercase exchange-style ticker (e.g. NASDAQ:AAPL)");

export const sTimeframe = z.enum([
  "1", "5", "15", "30", "60", "240", "D", "W", "M",
]);

export const sScriptName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9 _-]+$/, "Script name has invalid characters");

export const sPineSource = z
  .string()
  .min(1)
  .max(200_000)
  .refine((s) => s.includes("//@version"), "Pine source must declare a //@version");

export const sScriptId = z.string().regex(/^[A-Za-z0-9_-]+$/).min(1).max(120);

export const sFilename = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.\- ]+$/, "Filename must be safe ASCII");

export const sTabQuery = z.object({
  tabId: z.number().int().positive().optional(),
  titleContains: z.string().max(120).optional(),
  urlContains: z.string().max(240).optional(),
}).strict();

export const tvStatusIn = sVoid;
export const tvReadChartIn = sVoid;
export const tvScreenshotIn = z.object({
  name: sFilename.optional(),
  fullPage: z.boolean().optional(),
}).strict();

export const tvOpenPineEditorIn = sVoid;
export const tvReadPineSourceIn = z.object({
  scriptName: z.string().max(80).optional(),
}).strict();
export const tvPineCreateIn = z.object({
  name: sScriptName,
  source: sPineSource,
  overwrite: z.boolean().optional(),
}).strict();
export const tvPinePatchIn = z.object({
  scriptName: z.string().max(80),
  source: sPineSource,
}).strict();
export const tvPineSaveIn = z.object({
  scriptName: z.string().max(80).optional(),
}).strict();
export const tvPineCompileErrorsIn = sVoid;
export const tvPineAddToChartIn = z.object({
  scriptName: z.string().max(80).optional(),
}).strict();

export const tvRenameScriptIn = z.object({
  name: sScriptName,
}).strict();

export const tvChangeSymbolIn = z.object({
  symbol: sSymbol,
}).strict();

export const tvWatchlistSyncIn = z.object({
  symbol: sSymbol.optional(),
  addIfMissing: z.boolean().optional(),
}).strict();

export const tvChartMetadataIn = sVoid;
export const tvChangeTimeframeIn = z.object({
  timeframe: sTimeframe,
}).strict();

export const tvReadStrategyTesterIn = sVoid;

export const browserStatusIn = sVoid;
export const browserListTabsIn = sVoid;

export const emergencyStopIn = sVoid;
export const emergencyClearIn = sVoid;

export const pingIn = sVoid;
