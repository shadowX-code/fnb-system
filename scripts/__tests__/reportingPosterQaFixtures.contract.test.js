import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("scripts/seedReportingPosterQaFixtures.sh", "utf8");
const seed = readFileSync("scripts/seedReportingPosterQaFixtures.sql", "utf8");
const verify = readFileSync("scripts/verifyReportingPosterQaFixtures.sql", "utf8");

describe("Reporting poster Staging QA fixtures", () => {
  it("is an explicit, guarded Staging-only seed rather than a migration", () => {
    expect(shell).toContain('expected_ref="ujkzdaaadnvcfayuldmh"');
    expect(shell).toContain("Refusing Reporting fixture seed");
    expect(seed).toContain("STAGING ONLY; never a migration");
    expect(seed).toContain("QA Demo — Reporting Posters");
    expect(seed).toContain("QA-RPT-POSTER-2026");
  });

  it("uses ordinary Reporting source evidence and verifies it through canonical RPCs", () => {
    for (const sourceTable of ["sales_records", "purchase_records", "operating_expenses", "product_sales_reports", "product_sales_items"]) expect(seed).toContain(`public.${sourceTable}`);
    expect(verify).toContain("reporting_monthly_outlet_financials");
    expect(verify).toContain("reporting_monthly_outlet_product_sales");
    expect(seed).not.toContain("reportingService");
    expect(seed).not.toContain("mock mode");
  });

  it("covers complete, negative, explicit-zero, missing, product, and long-name poster states", () => {
    expect(seed).toContain("122000");
    expect(seed).toContain("30000");
    expect(seed).toContain("0, v_marker");
    expect(seed).toContain("Intentionally Long Category Name");
    expect(verify).toContain("April missing-Revenue fixture");
    expect(verify).toContain("May missing-COGS fixture");
    expect(verify).toContain("June missing-OpEx fixture");
    expect(verify).toContain("July product-unavailable fixture");
  });
});
