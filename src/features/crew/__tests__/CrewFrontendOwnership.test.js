import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";

// Follow the actual mobile import graph, including lazy imports. Admin preview
// code is not a Crew shell. This guards ownership, not component DOM structure.
const root = resolve("src/features/crew");
function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  if (node.type) callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value && typeof value === "object") visit(value, callback);
  }
}
function mobileSources(file = resolve(root, "CrewMobileApp.jsx"), result = new Map()) {
  if (result.has(file) || !file.startsWith(`${root}/`) || !/\.[jt]sx?$/.test(file)) return result;
  const source = readFileSync(file, "utf8");
  result.set(file, source);
  visit(parse(source, { sourceType: "module", plugins: ["jsx"] }), node => {
    const path = node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" ? node.source?.value : node.type === "CallExpression" && node.callee.type === "Import" ? node.arguments[0]?.value : null;
    if (!path?.startsWith(".")) return;
    const dependency = resolve(dirname(file), path);
    if (existsSync(dependency)) mobileSources(dependency, result);
  });
  return result;
}

describe("Crew frontend canonical ownership", () => {
  it("keeps portal/dialog ownership in shared primitives, not feature pages", () => {
    const sources = mobileSources();
    expect(sources.size).toBeGreaterThan(20);
    const owners = [...sources].filter(([, text]) => /\bcreatePortal\b|role=["']dialog["']/.test(text)).map(([file]) => relative(root, file)).sort();
    expect(owners).toEqual(["components/CrewBottomSheet.jsx", "components/CrewMobileModal.jsx"]);
  });

  it("keeps mobile consumers on canonical services, without direct Supabase/table access or QA fixtures", () => {
    const violations = [...mobileSources()].filter(([, text]) => /(?:from\s*["'][^"']*(?:supabase|qa\/crew)|\bsupabase\s*\.)/.test(text));
    expect(violations.map(([file]) => relative(root, file))).toEqual([]);
  });

  it("keeps Admin wording out of mobile loading and does not ship the local renderer harness", () => {
    for (const [file, text] of mobileSources()) expect(text, relative(root, file)).not.toContain("Loading Smart Operations Workspace");
    expect(readFileSync("index.html", "utf8")).not.toContain("qa/crew");
    expect(readFileSync("src/main.jsx", "utf8")).not.toContain("qa/crew");
  });
});
