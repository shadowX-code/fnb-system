import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMonthlyOutletReport, getYearlyOutletFinancialReport, getMonthlyAllOutletsReport, getYearlyAllOutletsFinancialReport } = vi.hoisted(() => ({ getMonthlyOutletReport: vi.fn(), getYearlyOutletFinancialReport: vi.fn(), getMonthlyAllOutletsReport: vi.fn(), getYearlyAllOutletsFinancialReport: vi.fn() }));
vi.mock("../../../../services/reportingService.js", () => ({ reportingService: { getMonthlyOutletReport, getYearlyOutletFinancialReport, getMonthlyAllOutletsReport, getYearlyAllOutletsFinancialReport } }));
const { exportPoster } = vi.hoisted(() => ({ exportPoster: vi.fn() }));
vi.mock("../../services/reportPosterExport.js", () => ({ exportPoster, REPORT_POSTER_LOGICAL_WIDTH: 1200, REPORT_POSTER_MONTHLY_LOGICAL_HEIGHT: 1500, REPORT_POSTER_YEARLY_LOGICAL_HEIGHT: 1200 * 297 / 210 }));
import ReportsPage from "../ReportsPage.jsx";

const outlet = { id: "outlet-a", name: "Outlet A" };
const allOutlets = { id: null, name: "All Outlets", scope: "all", outlet_count: 2 };
const auth = { hasPermission: () => true, profile: { role_outlet_access_type: "all" } };
const ui = { notify: vi.fn() };
const monthlyDataset = {
  reportType: "monthly", outlet, period: { year: 2026, month: 8 }, financialCompleteness: "incomplete",
  financials: { revenue: { amount: 100, presence: "present" }, purchaseBasedCogs: { amount: null, presence: "missing" }, opex: { amount: 0, presence: "present" }, netProfit: { amount: null, presence: "missing" } },
  productDataStatus: "unavailable", topProducts: [], lowestProducts: [],
};
const yearlyDataset = {
  reportType: "yearly", outlet, year: 2026, periodMode: "ytd", completeness: "incomplete",
  totals: { revenue: { amount: 100, presence: "present" }, purchaseBasedCogs: { amount: 20, presence: "present" }, opex: { amount: 0, presence: "present" }, netProfit: { amount: 80, presence: "present" } },
  months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, financials: { revenue: { amount: index === 0 ? 100 : null, presence: index === 0 ? "present" : "missing" }, purchaseBasedCogs: { amount: index === 0 ? 20 : null, presence: index === 0 ? "present" : "missing" }, opex: { amount: index === 0 ? 0 : null, presence: index === 0 ? "present" : "missing" }, netProfit: { amount: index === 0 ? 80 : null, presence: index === 0 ? "present" : "missing" } } })),
};
const allOutletsMonthlyDataset = { ...monthlyDataset, outlet: allOutlets };
const allOutletsYearlyDataset = { ...yearlyDataset, outlet: allOutlets };

beforeEach(() => { cleanup(); getMonthlyOutletReport.mockReset(); getYearlyOutletFinancialReport.mockReset(); getMonthlyAllOutletsReport.mockReset(); getYearlyAllOutletsFinancialReport.mockReset(); exportPoster.mockReset(); ui.notify.mockReset(); });

describe("ReportsPage", () => {
  it("generates a Monthly poster only on Generate and preserves missing/product unavailable states", async () => {
    getMonthlyAllOutletsReport.mockResolvedValue(allOutletsMonthlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(screen.getByRole("button", { name: "All Outlets" })).toBeTruthy();
    expect(screen.getByText("Generate a report preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(getMonthlyAllOutletsReport).toHaveBeenCalledWith(expect.objectContaining({ year: expect.any(Number), month: expect.any(Number) })));
    expect(screen.getAllByLabelText("Monthly P&L Report poster")).toHaveLength(2);
    expect(screen.getAllByText(/Product performance unavailable/)).toHaveLength(2);
    expect(screen.getAllByText(/No completed Product Analytics report exists/)).toHaveLength(2);
    expect(screen.queryByText("Completed Product Analytics report")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("switches to a 12-month Yearly/YTD poster and calls the yearly Reporting service", async () => {
    getYearlyAllOutletsFinancialReport.mockResolvedValue(allOutletsYearlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Monthly P&L" }));
    fireEvent.click(screen.getByRole("button", { name: "Yearly P&L" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(getYearlyAllOutletsFinancialReport).toHaveBeenCalledWith(expect.objectContaining({ year: expect.any(Number) })));
    expect(screen.getAllByLabelText("Yearly P&L Report poster")).toHaveLength(2);
    expect(screen.getAllByText("Jan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("YTD / Incomplete").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 / 12 months reported")).toHaveLength(2);
    expect(screen.getAllByText("Monthly Revenue Performance")).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: "Monthly Revenue Performance: revenue bars" })).toHaveLength(1);
    expect(screen.getAllByText("Performance Snapshot")).toHaveLength(2);
    expect(screen.getAllByText("Monthly P&L Details")).toHaveLength(2);
    expect(screen.getAllByText("20.0%")).toHaveLength(2);
    expect(screen.getAllByText("80.0% EBITDA Margin")).toHaveLength(4);
  });

  it("exports only the current generated dataset and prevents export before Generate", async () => {
    getMonthlyAllOutletsReport.mockResolvedValue(allOutletsMonthlyDataset);
    exportPoster.mockResolvedValue("monthly-pnl-report_all-outlets_2026-08.png");
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(screen.queryByRole("button", { name: "Download PNG" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(screen.getAllByLabelText("Monthly P&L Report poster")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Download PNG" }));
    await waitFor(() => expect(exportPoster).toHaveBeenCalledWith(expect.objectContaining({ reportType: "monthly", dataset: allOutletsMonthlyDataset, format: "png", element: expect.anything() })));
    expect(screen.getByRole("status").textContent).toContain("monthly-pnl-report_all-outlets_2026-08.png");
  });

  it("keeps export disabled without reports.export and surfaces export failures", async () => {
    getMonthlyAllOutletsReport.mockResolvedValue(allOutletsMonthlyDataset);
    const noExportAuth = { ...auth, hasPermission: (permission) => permission !== "reports.export" };
    const { rerender } = render(<ReportsPage auth={noExportAuth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(screen.getAllByLabelText("Monthly P&L Report poster")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Download PDF" }).disabled).toBe(true);
    expect(screen.getByText((_, node) => node?.textContent === "Download controls require the reports.export permission.")).toBeTruthy();

    rerender(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    exportPoster.mockRejectedValue(new Error("Capture failed"));
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Capture failed"));
  });

  it("renders an unscaled fixed logical poster surface for export", async () => {
    getMonthlyAllOutletsReport.mockResolvedValue(allOutletsMonthlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(screen.getAllByLabelText("Monthly P&L Report poster")).toHaveLength(2));
    const exportHost = document.querySelector('[aria-hidden="true"][style*="1200px"]');
    expect(exportHost).toBeTruthy();
    expect(exportHost.style.left).toBe("-10000px");
    expect(exportHost.querySelector(".report-poster")).toBeTruthy();
  });

  it("keeps poster components free of direct Supabase dependencies", async () => {
    const monthly = await import("../../components/MonthlyProfitPoster.jsx?contract");
    const yearly = await import("../../components/YearlyPnlPoster.jsx?contract");
    expect(String(monthly.default)).not.toContain("supabase");
    expect(String(yearly.default)).not.toContain("supabase");
  });

  it("keeps individual outlet generation on its existing canonical Reporting reads", async () => {
    getMonthlyOutletReport.mockResolvedValue(monthlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(screen.getByRole("button", { name: "All Outlets" }));
    fireEvent.click(screen.getByRole("button", { name: "Outlet A" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(getMonthlyOutletReport).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-a" })));
    expect(getMonthlyAllOutletsReport).not.toHaveBeenCalled();
  });
});
