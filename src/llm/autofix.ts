/**
 * Autonomous Pine Script repair orchestrator.
 *
 * Executes the Observe → Read → Compile → Diagnose → Patch → Save → Verify
 * loop using the current TradingView tab. If an LLM API key is configured, the
 * patch generation is automatic; otherwise the caller must provide a corrected
 * `source` and the tool will only run the compile/save/verify cycle.
 *
 * Persistence (this phase): every run is recorded in the local SQLite source of
 * truth — a task row, a baseline Pine version + on-disk backup, a compile_errors
 * row and a fixes row per attempt, a screenshot row, and hash-chained audit
 * entries. Operational summaries are enqueued for cloud sync. The script is
 * backed up before every edit, and only small LLM-generated patches are applied
 * (the editor receives the patched source, never a blind full replacement from
 * an untrusted source). Success is never claimed without compilation and visual
 * verification.
 */
import type { PageLike } from "../browser/driver-types.js";
import { logger } from "../logging/logger.js";
import { audit, paths } from "../logging/logger.js";
import { captureScreenshot } from "../adapters/tradingview/adapter.js";
import * as tv from "../adapters/tradingview/adapter.js";
import { generatePineFix, isLlmConfigured, type PineFixRequest } from "./client.js";
import { getDb } from "../db/database.js";
import {
  createTask,
  createVersion,
  findOrCreateScript,
  insertCompileErrors,
  insertFix,
  insertScreenshot,
  setScriptCurrentVersion,
  updateTask,
} from "../db/repositories.js";
import { getLicenceState } from "../licensing/licensing.js";
import { appendAudit } from "../audit/audit-chain.js";
import { enqueueForSync } from "../sync/sync-manager.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface AutofixContext {
  page: PageLike;
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
  taskId: number | null;
}

const DEFAULT_MAX_ATTEMPTS = 5;

function writeBackup(source: string, taskId: number, attempt: number): string {
  const backupsDir = join(paths.projectRoot, "backups");
  mkdirSync(backupsDir, { recursive: true });
  const name = `task-${taskId}-attempt-${attempt}-${randomUUID()}.pine`;
  const full = join(backupsDir, name);
  writeFileSync(full, source, "utf8");
  return full;
}

export async function runAutofix(ctx: AutofixContext, options: AutofixOptions): Promise<AutofixReport> {
  const { page, tabUrl, requestApproval } = ctx;
  const licence = getLicenceState();
  const editionCap = licence.limits.maxAutofixAttempts;
  const requested = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxAttempts = Math.min(Math.max(requested, 1), editionCap);

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
    taskId: null,
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

  // Persist the task + baseline version + on-disk backup.
  const db = getDb();
  const taskId = createTask(db, options.goal, { edition: licence.edition, maxAttempts });
  report.taskId = taskId;
  const scriptId = findOrCreateScript(db, options.expectedIndicatorName ?? "autofix-target");
  const baseline = writeBackup(currentSource, taskId, 0);
  const baselineVersion = createVersion(db, {
    scriptId,
    source: currentSource,
    backupPath: baseline,
    sourceTaskId: taskId,
    notes: "pre-edit baseline",
  });
  let currentVersionId = baselineVersion.id;
  setScriptCurrentVersion(db, scriptId, currentVersionId);
  appendAudit("pine", "autofix_start", { taskId, goal: options.goal, edition: licence.edition, maxAttempts });

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.info({ attempt, goal: options.goal }, "autofix attempt");
      updateTask(db, taskId, { attempt_count: attempt });
      const compile = await tv.readCompileErrors(page);
      insertCompileErrors(db, {
        taskId,
        versionId: currentVersionId,
        attempt,
        errors: compile.errors,
        warnings: compile.warnings,
        success: compile.success,
      });
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
        insertFix(db, {
          taskId,
          versionIdBefore: currentVersionId,
          versionIdAfter: null,
          attempt,
          patchKind: "none",
          error: report.error,
        });
        break;
      }

      // Generate patch.
      const fix = await generatePineFix({
        goal: options.goal,
        source: currentSource,
        errors: compile.errors,
        warnings: compile.warnings,
        attempt,
      } as PineFixRequest);
      if (!fix.source) {
        attemptReport.patchError = fix.error ?? "LLM returned no source";
        report.error = attemptReport.patchError;
        report.note = `Stopped at attempt ${attempt}; LLM patch generation failed.`;
        insertFix(db, {
          taskId,
          versionIdBefore: currentVersionId,
          versionIdAfter: null,
          attempt,
          patchKind: "llm",
          error: attemptReport.patchError,
        });
        break;
      }

      // Back up the pre-edit source before applying the patch.
      const preEditBackup = writeBackup(currentSource, taskId, attempt);
      const beforeVersionId = currentVersionId;
      currentSource = fix.source;
      attemptReport.patchApplied = true;

      // Apply patch to editor.
      if (!(await tv.hasMonacoEditor(page))) {
        await tv.openPineEditor(page);
      }
      await tv.setPineSource(page, currentSource);

      // Record the patched version.
      const patchedVersion = createVersion(db, {
        scriptId,
        source: currentSource,
        backupPath: preEditBackup,
        sourceTaskId: taskId,
        notes: `attempt ${attempt} patch`,
      });
      currentVersionId = patchedVersion.id;
      setScriptCurrentVersion(db, scriptId, currentVersionId);
      insertFix(db, {
        taskId,
        versionIdBefore: beforeVersionId,
        versionIdAfter: currentVersionId,
        attempt,
        llmModel: process.env.TV_LLM_MODEL ?? null,
        patchKind: "llm",
      });

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
      if (report.screenshot) insertScreenshot(db, taskId, report.screenshot, "autofix-failed");
      updateTask(db, taskId, { status: "failed", finished_at: new Date().toISOString(), success: 0, error: report.error });
      audit({ ts: new Date().toISOString(), tool: "tv_pine_autofix", result: "error", error: report.error, tabUrl });
      appendAudit("pine", "autofix_end", { taskId, success: false, error: report.error });
      enqueueForSync("task.summary", { taskId, goal: options.goal, success: false, edition: licence.edition, attempts: report.attempts.length }, taskId);
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

    // Runtime verification — never claim success without it.
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
    if (report.screenshot) insertScreenshot(db, taskId, report.screenshot, "autofix-success");
    report.success = report.compileSuccess && (options.autoAddToChart === false || report.addedToChart) && verify.verified;
    report.note = report.success
      ? "Autonomous repair completed: compiled, added to chart, and verified."
      : `Autonomous repair finished with issues: compile=${report.compileSuccess}, added=${report.addedToChart}, verified=${verify.verified}.`;

    updateTask(db, taskId, {
      status: report.success ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      success: report.success ? 1 : 0,
      error: report.error,
    });
    audit({
      ts: new Date().toISOString(),
      tool: "tv_pine_autofix",
      result: report.success ? "ok" : "error",
      error: report.error ?? undefined,
      tabUrl,
      screenshot: report.screenshot ?? undefined,
    });
    appendAudit("pine", "autofix_end", { taskId, success: report.success, addedToChart: report.addedToChart, verified: verify.verified });
    enqueueForSync("task.summary", { taskId, goal: options.goal, success: report.success, edition: licence.edition, attempts: report.attempts.length }, taskId);
    return report;
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    logger.error({ tool: "tv_pine_autofix", err }, "autofix threw");
    report.error = err;
    report.note = `Unexpected error during autonomous repair: ${err}`;
    report.screenshot = await safeScreenshot(page, "autofix-error").catch(() => null);
    if (report.screenshot) insertScreenshot(db, taskId, report.screenshot, "autofix-error");
    updateTask(db, taskId, { status: "failed", finished_at: new Date().toISOString(), success: 0, error: err });
    audit({ ts: new Date().toISOString(), tool: "tv_pine_autofix", result: "error", error: err, tabUrl });
    appendAudit("pine", "autofix_end", { taskId, success: false, error: err });
    enqueueForSync("task.summary", { taskId, goal: options.goal, success: false, edition: licence.edition, attempts: report.attempts.length, error: err }, taskId);
    return report;
  }
}

async function safeScreenshot(page: PageLike, name: string): Promise<string | null> {
  try {
    return await captureScreenshot(page, name, false);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "autofix screenshot failed");
    return null;
  }
}