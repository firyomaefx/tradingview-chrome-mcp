import { getTradingViewTab } from "../dist/browser/controller.js";
import * as tv from "../dist/adapters/tradingview/adapter.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const t = await getTradingViewTab();
const page = t.page;
const log = (k,v)=>console.log(k, JSON.stringify(v));

// Skip createLayout (it leaves stray overlays). Operate on the current chart.
log("dismiss", await tv.dismissDialogs(page));

const before = await tv.readChartState(page);
log("before", before);
await tv.captureScreenshot(page, "destruct2-before");

log("changeSymbol->AAPL", await tv.changeSymbol(page, "AAPL"));
await page.waitForTimeout(1200);
log("stateAfterSymbol", await tv.readChartState(page));
await tv.captureScreenshot(page, "destruct2-symbol-aapl");
log("changeSymbol->back", await tv.changeSymbol(page, before.symbol ?? "MYX:FCPO1!"));
await page.waitForTimeout(1000);

log("changeTimeframe->15", await tv.changeTimeframe(page, "15"));
await page.waitForTimeout(1000);
log("stateAfterTimeframe", await tv.readChartState(page));
await tv.captureScreenshot(page, "destruct2-timeframe-15");
log("changeTimeframe->back", await tv.changeTimeframe(page, "5"));
await page.waitForTimeout(800);

log("openPineEditor", await tv.openPineEditor(page));
const sample = readFileSync(join(process.cwd(),"tests","fixtures","sample.pine"),"utf8");
log("pineCreate", await tv.setPineSource(page, sample));
await page.waitForTimeout(800);
log("compileErrors", await tv.readCompileErrors(page));
await tv.captureScreenshot(page, "destruct2-pine-source");
log("pineSave", await tv.clickSave(page, "MCP Test SMA"));
await page.waitForTimeout(1500);
log("compileAfterSave", await tv.readCompileErrors(page));
log("pineAddToChart", await tv.addScriptToChart(page));
await page.waitForTimeout(1500);
await tv.captureScreenshot(page, "destruct2-pine-added");

log("after", await tv.readChartState(page));
await tv.captureScreenshot(page, "destruct2-after");
console.log("DONE");
process.exit(0);

