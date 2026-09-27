import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/reportingService.js", () => ({ reportingService: { getYearlyScopeFinancialReport: read } }));
vi.mock("../../components/PeriodFilterBar.jsx", () => ({ default: () => null }));
vi.mock("../../hooks/usePeriodFilters.js", () => ({ default: () => ({ outletId: "outlet-a", month: 1, year: 2026 }) }));
vi.mock("../../utils/analytics.js", async (original) => ({ ...await original(), buildAlerts: () => [], getOutletTaxConfig: () => ({ enabled: false }) }));
import OutletPnlPage from "../OutletPnlPage.jsx";
import DataHealthPage from "../DataHealthPage.jsx";
import { buildYearlyFinancialDataset } from "../../../../services/reportingDatasets.js";
afterEach(() => { cleanup(); read.mockReset(); });
const store = { outlets: [{ id: "outlet-a", name: "Outlet A" }], salesRecords: [{ outlet_id: "outlet-a", month: 1, year: 2026, amount: 987654 }], purchaseRecords: [], operatingExpenses: [], salesChannels: [], outletTaxConfigs: [], monthlyLocks: [{ outlet_id: "outlet-a", month: 1, year: 2026, is_locked: true }] };
describe("legacy financial truthfulness", () => {
  it("does not use browser source totals when Reporting is incomplete", async () => {
    read.mockResolvedValue(buildYearlyFinancialDataset({ year: 2026, currentYear: 2026, currentMonth: 1, monthlyContracts: [] }));
    render(<OutletPnlPage store={store} ui={{ notify: vi.fn() }} />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Incomplete financial evidence"));
    expect(screen.queryByText(/987,654/)).toBeNull();
    expect(screen.queryByText("RM 0.00")).toBeNull();
    expect(screen.getByText(/EBITDA trend unavailable/)).toBeTruthy();
  });
  it("reports a failed Reporting read, not a valid empty financial result", async () => {
    read.mockRejectedValue(new Error("Reporting unavailable"));
    render(<OutletPnlPage store={store} ui={{ notify: vi.fn() }} />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reporting unavailable Financial results are unavailable.");
  });
  it("does not present browser locks or invented audit actors as business authority", () => {
    render(<DataHealthPage store={store} />);
    expect(screen.queryByRole("button", { name: /Lock|Unlock/ })).toBeNull();
    expect(screen.queryByText(/Frozen|Marcus Lee|Amanda|Jason|Recent Activity/)).toBeNull();
    expect(screen.getAllByText(/EBITDA remains unavailable/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Incomplete").length).toBeGreaterThan(0);
  });
});
