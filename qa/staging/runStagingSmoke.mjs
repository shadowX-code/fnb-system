import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { adminCredentials, assertCanonicalStagingUrl, crewCredentials } from "./stagingSmokeHelpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scope = process.argv[2];
const projectArguments = {
  harness: ["--project=harness"],
  crew: ["--project=crew-360", "--project=crew-390", "--project=crew-430"],
  admin: ["--project=admin-desktop"],
}[scope];

try {
  if (!projectArguments) throw new Error("Usage: node qa/staging/runStagingSmoke.mjs <harness|crew|admin>");
  assertCanonicalStagingUrl();
  if (scope === "crew") crewCredentials();
  if (scope === "admin") adminCredentials();
} catch (error) {
  console.error(`[Staging smoke] ${error.message}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.staging.config.mjs", ...projectArguments], { cwd: root, env: process.env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
