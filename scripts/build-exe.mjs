/**
 * Build a standalone Windows executable from the current project.
 *
 * Uses caxa to package the built dist/, production node_modules, and a small
 * bootstrap entry point into a single .exe file. The resulting binary can be
 * distributed to Windows users who do not have Node.js installed.
 *
 * Run with:
 *   npm run build:exe
 *
 * The output is written to the project root as tradingview-chrome-mcp.exe.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import caxa from "caxa";

const OUTPUT = join(process.cwd(), "tradingview-chrome-mcp.exe");

if (process.platform !== "win32") {
  console.warn("Windows .exe builds must be run on Windows (or use GitHub Actions windows-latest).");
  process.exit(1);
}

// 1. Build the TypeScript project.
console.log("Building TypeScript project...");
execSync("npm run build", { stdio: "inherit" });

// 2. Remove any previous .exe so caxa doesn't package itself.
if (existsSync(OUTPUT)) {
  rmSync(OUTPUT, { force: true });
}

// 3. Package with caxa. It copies the project to a temp build directory,
//    runs `npm dedupe --production` to drop devDependencies, then builds
//    a self-extracting .exe that runs dist/server/caxa-entry.js.
console.log("Packaging with caxa (this may take a minute)...");
await caxa({
  input: process.cwd(),
  output: OUTPUT,
  command: [
    "{{caxa}}/node_modules/.bin/node",
    "{{caxa}}/dist/server/caxa-entry.js",
  ],
  exclude: [
    ".git",
    ".github",
    "tests",
    "src",
    "vercel-hosted",
    "scripts",
    "*.md",
    "screenshots",
    "backups",
    "layouts",
    "exports",
    "logs",
    "node_modules/.cache",
    "node_modules/.package-lock.json",
    "*.exe",
  ],
  uncompressionMessage:
    "Unpacking tradingview-chrome-mcp the first time. This may take a moment...",
});

console.log(`\nCreated: ${OUTPUT}`);
if (existsSync(OUTPUT)) {
  const mb = statSync(OUTPUT).size / 1024 / 1024;
  console.log(`Size: ${mb.toFixed(2)} MB`);
}
