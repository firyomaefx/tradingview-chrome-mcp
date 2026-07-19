/**
 * Entry point used by the caxa-packaged Windows executable.
 *
 * When caxa extracts the application into a temporary directory, this file is
 * run first. It detects the packaged environment and redirects persistent data
 * (logs, backups, screenshots, layouts, Playwright browsers) to a stable
 * location under %LOCALAPPDATA%\tradingview-chrome-mcp before starting the
 * normal server.
 */
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function isRunningFromCaxa(): boolean {
  // caxa extracts to a path like <tmpdir>/caxa/<identifier>/...
  const path = fileURLToPath(import.meta.url).replace(/\\/g, "/");
  const temp = tmpdir().replace(/\\/g, "/");
  return path.startsWith(temp) && path.includes("/caxa/");
}

function bootstrapCaxa(): void {
  process.env.NODE_ENV ??= "production";

  // Use %LOCALAPPDATA% on Windows, otherwise ~/.tradingview-chrome-mcp.
  const appData =
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "tradingview-chrome-mcp")
      : join(homedir(), ".tradingview-chrome-mcp");

  mkdirSync(appData, { recursive: true });

  // Redirect logs, backups, screenshots, and exports to a persistent directory.
  process.env.TV_DATA_DIR ??= appData;
  // Keep Playwright's browser cache in the same persistent directory so it is
  // reused across launches and does not bloat the extraction cache.
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(appData, "playwright");
}

if (isRunningFromCaxa()) {
  bootstrapCaxa();
}

// Start the normal MCP server. This executes the same main() as the unpackaged
// version, so behavior is identical once the environment is set up.
await import("./index.js");
