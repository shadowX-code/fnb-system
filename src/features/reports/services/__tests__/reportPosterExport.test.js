import { describe, expect, it } from "vitest";
import { getPosterNode, outletSlug, reportExportFilename } from "../reportPosterExport.js";

describe("reportPosterExport filenames", () => {
  it("creates stable safe filenames for monthly reports", () => {
    expect(outletSlug("QA Demo — Café #1")).toBe("qa-demo-cafe-1");
    expect(reportExportFilename({ reportType: "monthly", outletName: "QA Demo — Café #1", year: 2026, month: 2, format: "png" }))
      .toBe("monthly-profit-report_qa-demo-cafe-1_2026-02.png");
  });

  it("marks yearly YTD files and keeps complete yearly files concise", () => {
    expect(reportExportFilename({ reportType: "yearly", outletName: "Outlet A", year: 2026, periodMode: "ytd", format: "pdf" }))
      .toBe("yearly-pnl-report_outlet-a_2026-ytd.pdf");
    expect(reportExportFilename({ reportType: "yearly", outletName: "Outlet A", year: 2025, periodMode: "yearly", format: "png" }))
      .toBe("yearly-pnl-report_outlet-a_2025.png");
  });
});

describe("reportPosterExport capture surface", () => {
  it("selects the poster canvas rather than its preview or export host wrapper", () => {
    const host = document.createElement("div");
    host.className = "preview-scale-wrapper";
    const poster = document.createElement("article");
    poster.className = "report-poster report-poster--monthly";
    host.appendChild(poster);
    expect(getPosterNode(host)).toBe(poster);
    expect(getPosterNode(poster)).toBe(poster);
  });
});
