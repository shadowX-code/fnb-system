import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path) => readFileSync(`src/${path}`, "utf8");

describe("shared Admin brand colors", () => {
  it.each([
    "components/layout/SystemNavigationChip.css",
    "components/navigation/AdminUnderlineTabs.jsx",
    "components/forms/AdminMultiSelectGroup.css",
    "components/tables/tableControls.css",
    "components/tables/AdminPagination.jsx",
    "components/ui/Drawer.jsx",
  ])("uses theme roles instead of literal brand colors in %s", (path) => {
    const styles = source(path);
    expect(styles).toMatch(/(?:theme-)?primary-ink/);
    expect(styles).not.toMatch(/\b(?:text|bg|border|outline|ring)-(?:green|emerald|teal|cyan)-\d+/);
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b/i);
  });

  it("uses neutral group surfaces and separates live status from navigation selection", () => {
    expect(source("components/tables/tableControls.css"))
      .toMatch(/\.admin-table-group--workspace>th\{background:var\(--theme-table-header\);color:var\(--theme-text\)/);
    const tabs = source("components/navigation/AdminUnderlineTabs.jsx");
    expect(tabs).toContain("hover:border-primary-ink hover:text-primary-ink");
    expect(tabs).not.toContain("--factory-success-text");
    const navigation = source("components/layout/SystemNavigationChip.css");
    expect(navigation).toMatch(/\.system-nav-chip__status\s*\{[^}]+color: var\(--factory-success-text\)/);
    expect(navigation.match(/--factory-success-text/g)).toHaveLength(1);
    expect(source("layouts/AppShell.jsx")).not.toMatch(/rgba?\(34,\s*197,\s*94/);
  });
});
