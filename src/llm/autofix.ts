/**
 * Autonomous Pine Script repair orchestrator.
 *
 * Executes the Observe → Read → Compile → Diagnose → Patch → Save → Verify
 * loop using the current TradingView tab. If an LLM API key is configured, the
 * patch generation is automatic; otherwise the caller must provide a corrected
 * `source` and the tool will only run the compile/save/verify cycle.
 */
import type { Page } from "playwright";
import { logger } from "../logging/logger.js";
import { audit } from "../logging/logger.js";
import { captureScreenshot } from "../adapters/tradingview/adapter.js";
import * as tv from "../adapters/tradingview/adapter.js";
import { generatePineFix, isLlmConfigured, type PineFixRequest } from "./client.js";

export interface AutofixContext {
  page: Page;
  tabUrl: string;
  requestApproval: (message: string) => Promise<boolean>;
}

export interface AutofixOptions {
  goal: string;
  source?: string;
  maxAttempts?: number;
  autoSave?: boolean;
  autoAddToChart?: boolean;
  expectedIndicatorName?: string;
}

export interface AutofixAttempt {
  number: number;
  compileSuccess: boolean;
  errors: string[];
  warnings: string[];
  patchApplied: boolean;
  patchError?: string;
}

export interface AutofixReport {
  success: boolean;
  attempts: AutofixAttempt[];
  finalSource: string | null;
  compileSuccess: boolean;
  addedToChart: boolean;
  verification: { verified: boolean; foundIndicators: string[]; foundLabels: number; foundTables: number; errors: string[] } | null;
  screenshot: string | null;
  error: string | null;
  note: string;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export async function runAutofix(ctx: AutofixContext, options: AutofixOptions): Promise<AutofixReport> {
  const { page, tabUrl, requestApproval } = ctx;
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1), 10);
  const report: AutofixReport = {
    success: false,
    attempts: [],
    finalSource: null,
    compileSuccess: false,
    addedToChart: false,
    verification: null,
    screenshot: null,
    error: null,
    note: "",
  };

  // Pre-flight approval for the whole autonomous run if it may save/add.
  const needsApproval = options.autoSave !== false || options.autoAddToChart !== false;
  if (needsApproval) {
    const approved = await requestApproval(
      `Run autonomous Pine Script repair for up to ${maxAttempts} attempts? This may save and add the script to the chart.`
    );
    if (!approved) {
      report.note = "Autonomous repair not approved";
      return report;
    }
  }

  // Read existing source if none provided.
  let currentSource = options.source ?? null;
  if (!currentSource) {
    const read = await tv.readPineSource(page);
    currentSource = read.source;
    if (!currentSource) {
      report.error = "No Pine source provided and editor is empty/closed";
      report.note = "Cannot autofix without source";
      return report;
    }
  }

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.info({ attempt, goal: options.goal }, "autofix attempt");
      const compile = await tv.readCompileErrors(page);
      const attemptReport: AutofixAttempt = {
        number: attempt,
        compileSuccess: compile.success,
        errors: compile.errors,
        warnings: compile.warnings,
        patchApplied: false,
      };
      report.attempts.push(attemptReport);
      report.compileSuccess = compile.success;
      report.finalSource = currentSource;

      if (compile.success) {
        report.compileSuccess = true;
        report.note = `Compiled successfully after ${attempt} attempt(s).`;
        break;
      }

      if (!isLlmConfigured()) {
        report.error = "Compilation failed and no LLM API key is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable automatic patching.";
        report.note = `Stopped at attempt ${attempt}; ${compile.errors.length} error(s) remain.`;
        break;
      }

      // Generate patch.
      const fix = await generatePineFix({
        goal: options.goal,
        source: currentSource,
        errors: compile.errors,
        warnings: compile.warnings,
        attempt,
      });
      if (!fix.source) {
        attemptReport.patchError = fix.error ?? "LLM returned no source";
        report.error = attemptReport.patchError;
        report.note = `Stopped at attempt ${attempt}; LLM patch generation failed.`;
        break;
      }
      currentSource = fix.source;
      attemptReport.patchApplied = true;

      // Apply patch to editor.
      if (!(await tv.hasMonacoEditor(page))) {
        await tv.openPineEditor(page);
      }
      await tv.setPineSource(page, currentSource);

      // Save if requested (default true).
      if (options.autoSave !== false) {
        const saved = await tv.clickSave(page);
        if (!saved.saved) {
          report.error = "Failed to save patched source";
          report.note = `Stopped at attempt ${attempt}; save failed.`;
          break;
        }
      }
    }

    report.finalSource = currentSource;

    // If compile still failed, return early with diagnostics.
    if (!report.compileSuccess) {
      if (!report.error) {
        report.error = `Could not reach zero errors after ${maxAttempts} attempt(s).`;
      }
      report.screenshot = await safeScreenshot(page, "autofix-failed");
      audit({
        ts: new Date().toISOString(),
        tool: "tv_pine_autofix",
        result: "error",
        error: report.error,
        tabUrl,
      });
      return report;
    }

    // Add to chart if requested (default true).
    if (options.autoAddToChart !== false) {
      const add = await tv.addScriptToChart(page);
      report.addedToChart = add.added;
      if (!add.added) {
        report.error = "Compiled source could not be added to chart";
      }
    }

    // Runtime verification.
    const verify = await tv.verifyChart(page, {
      expectedIndicatorName: options.expectedIndicatorName,
      maxWaitMs: 5000,
    });
    report.verification = {
      verified: verify.verified,
      foundIndicators: verify.foundIndicators,
      foundLabels: verify.foundLabels,
      foundTables: verify.foundTables,
      errors: verify.errors,
    };

    report.screenshot = await safeScreenshot(page, "autofix-success");
    report.success = report.compileSuccess && (options.autoAddToChart === false || report.addedToChart) && verify.verified;
    report.note = report.success
      ? "Autonomous repair completed: compiled, added to chart, and verified."
      : `Autonomous repair finished with issues: compile=${report.compileSuccess}, added=${report.addedToChart}, verified=${verify.verified}.`;

    audit({
      ts: new Date().toISOString(),
      tool: "tv_pine_autofix",
      result: report.success ? "ok" : "error",
      error: report.error ?? undefined,
      tabUrl,
      screenshot: report.screenshot ?? undefined,
    });
    return report;
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    logger.error({ tool: "tv_pine_autofix", err }, "autofix threw");
    report.error = err;
    report.note = `Unexpected error during autonomous repair: ${err}`;
    report.screenshot = await safeScreenshot(page, "autofix-error").catch(() => null);
    audit({ ts: new Date().toISOString(), tool: "tv_pine_autofix", result: "error", error: err, tabUrl });
    return report;
  }
}

async function safeScreenshot(page: Page, name: string): Promise<string | null> {
  try {
    return await captureScreenshot(page, name, false);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "autofix screenshot failed");
    return null;
  }
}
