// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the canonical themed subtle surface when the optional muted surface is absent", () => {
  const css = readFileSync(new URL("../../../styles/index.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.admin-segmented-control\{[^}]*background:var\(--theme-surface-muted,var\(--theme-subtle,#f5f8fa\)\)/);
});
