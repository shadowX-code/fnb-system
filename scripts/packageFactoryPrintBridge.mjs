import { mkdirSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const output = resolve("public/downloads");
mkdirSync(output, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "feedx-bridge-"));
const files = [
  "Install-Bridge.ps1",
  "Start-Bridge.ps1",
  "Bridge.psm1",
  "Transport.cs",
  "README.md",
];
for (const name of files)
  copyFileSync(resolve("tools/windows-print-bridge", name), join(root, name));
// zip is supplied by the build/release host; no runtime dependency is required on Windows.
execFileSync("zip", [
  "-q",
  "-X",
  "-j",
  join(output, "feedx-print-bridge-staging.zip"),
  ...files.map((f) => join(root, f)),
]);
console.log("Packaged FeedX Staging Windows bridge.");
