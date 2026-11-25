#!/usr/bin/env node
// Build unsigned review artifacts into a caller-supplied directory outside the repository.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.argv[2]) throw new Error("Pass a private output directory outside the repository.");
const output = resolve(process.argv[2]);
if (output === repository || output.startsWith(repository + sep)) {
  throw new Error("Production candidates belong outside the repository and hosted downloads.");
}
mkdirSync(output, { recursive: true });
const source = mkdtempSync(join(tmpdir(), "feedx-bridge-production-"));
const mappings = [
  ["ujkzdaaadnvcfayuldmh", "oyfobxdoyfuzsodogpgs"],
  ["fnb-system-staging.vercel.app", "os.feedx.my"],
  ["feedx-printer-staging", "feedx-printer"],
  ["my.feedx.staging.print-bridge", "my.feedx.print-bridge"],
  ["FeedXPrintBridge", "FeedXPrintBridgeProduction"],
  ["Staging", "Production"],
];
try {
  for (const name of ["windows-print-bridge", "macos-print-bridge", "print-bridge"]) {
    const directory = join(source, "tools", name);
    cpSync(join(repository, "tools", name), directory, { recursive: true, filter: (path) => !path.endsWith("__pycache__") });
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const file = join(directory, item.name);
      if (item.name.endsWith(".zip")) continue;
      const original = readFileSync(file, "utf8");
      // Preserve validators which already list both supported environment labels.
      const marker = "__FEEDX_BOTH_ENVIRONMENTS__";
      const neutral = original.replaceAll("Staging|Production", marker).replaceAll('"Staging", "Production"', marker + "TUPLE");
      const replacement = mappings.reduce((value, [from, to]) => value.replaceAll(from, to), neutral)
        .replaceAll(marker + "TUPLE", '"Staging", "Production"').replaceAll(marker, "Staging|Production");
      if (/ujkzdaaadnvcfayuldmh|fnb-system-staging\.vercel\.app|feedx-printer-staging|my\.feedx\.staging\.print-bridge/.test(replacement))
        throw new Error("Staging identity remained in a Production-bound payload.");
      writeFileSync(file, replacement);
    }
  }
  execFileSync("makensis", ["-V2", `-DOUTPUT=${join(output, "FeedX-Print-Bridge-Production-Windows.exe")}`,
    join(source, "tools/windows-print-bridge/Setup.nsi")], { stdio: "inherit" });
  execFileSync("sh", [join(source, "tools/macos-print-bridge/package.sh"), output], { stdio: "inherit" });
} finally {
  rmSync(source, { recursive: true, force: true });
}
