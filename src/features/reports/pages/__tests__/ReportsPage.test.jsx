import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMonthlyOutletReport, getYearlyOutletFinancialReport } = vi.hoisted(() => ({ getMonthlyOutletReport: vi.fn(), getYearlyOutletFinancialReport: vi.fn() }));
vi.mock("../../../../services/reportingService.js", () => ({ reportingService: { getMonthlyOutletReport, getYearlyOutletFinancialReport } }));
import ReportsPage from "../ReportsPage.jsx";

const outlet = { id: "outlet-a", name: "Outlet A" };
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
  months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, financials: { revenue: { amount: index === 0 ? 100 : null, presence: index === 0 ? "present" : "missing" }, purchaseBasedCogs: { amount: null, presence: "missing" }, opex: { amount: null, presence: "missing" }, netProfit: { amount: null, presence: "missing" } } })),
};

beforeEach(() => { cleanup(); getMonthlyOutletReport.mockReset(); getYearlyOutletFinancialReport.mockReset(); ui.notify.mockReset(); });

describe("ReportsPage", () => {
  it("generates a Monthly poster only on Generate and preserves missing/product unavailable states", async () => {
    getMonthlyOutletReport.mockResolvedValue(monthlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(screen.getByText("Generate a report preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(getMonthlyOutletReport).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-a" })));
    expect(screen.getByLabelText("Monthly Profit Report poster")).toBeTruthy();
    expect(screen.getByText(/Product performance unavailable/)).toBeTruthy();
    expect(screen.getByText(/No completed Product Analytics report exists/)).toBeTruthy();
    expect(screen.queryByText("Completed Product Analytics report")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("switches to a 12-month Yearly/YTD poster and calls the yearly Reporting service", async () => {
    getYearlyOutletFinancialReport.mockResolvedValue(yearlyDataset);
    render(<ReportsPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Monthly Profit" }));
    fireEvent.click(screen.getByRole("button", { name: "Yearly P&L" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await waitFor(() => expect(getYearlyOutletFinancialReport).toHaveBeenCalledWith(expect.objectContaining({ outletId: "outlet-a" })));
    expect(screen.getByLabelText("Yearly P&L Report poster")).toBeTruthy();
    expect(screen.getAllByText("Jan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("YTD / Incomplete").length).toBeGreaterThan(0);
  });

  it("keeps poster components free of direct Supabase dependencies", async () => {
    const monthly = await import("../../components/MonthlyProfitPoster.jsx?contract");
    const yearly = await import("../../components/YearlyPnlPoster.jsx?contract");
    expect(String(monthly.default)).not.toContain("supabase");
    expect(String(yearly.default)).not.toContain("supabase");
  });
});
