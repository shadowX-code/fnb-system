import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ reports: [], items: [], ranges: [], mode: "complete", pending: null }));
vi.mock("../../../../lib/supabase.ts", () => ({ supabase: { from(table) {
  let filters = [], orders = [];
  const query = {
    select(_fields, options) { expect(options?.count).toBe("exact"); return query; },
    in(column, values) { filters.push([column, values]); return query; },
    order(column, options) { orders.push([column, options.ascending]); return query; },
    async range(start, end) {
      let rows = (table === "product_sales_reports" ? db.reports : db.items).filter(row => filters.every(([column, values]) => values.includes(row[column])));
      rows = [...rows].sort((a, b) => {
        for (const [column, ascending] of orders) {
          if (a[column] !== b[column]) return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1);
        }
        return 0;
      });
      db.ranges.push({ table, start, end, count: rows.length });
      if (table === "product_sales_reports" && db.mode === "report-error") return { data: null, count: null, error: { message: "Report read failed" } };
      if (table === "product_sales_items" && db.mode === "pending") await db.pending;
      return { data: rows.slice(start, (db.mode === "short" || (db.mode === "year-short" && rows.length === 1843)) && table === "product_sales_items" ? start + 20 : end + 1), count: rows.length, error: null };
    },
  };
  return query;
} } }));
vi.mock("../../../../services/assetTrackingService.js", () => ({ assetTrackingService: { listAssets: async () => [], listInspections: async () => [], listMaintenanceRecords: async () => [] } }));
vi.mock("../../../../services/dutyRosterService.js", () => ({ dutyRosterService: { listDutyRosters: async () => [] } }));
vi.mock("../../../../services/employeeService.js", () => ({ employeeService: { listEmployees: async () => [] } }));
import { productAnalyticsService } from "../../../../services/productAnalyticsService.js";
import { getNetSales } from "../../utils/analytics.js";
import { useCompleteProductItems } from "../../hooks/useCompleteProductItems.js";
import ProductAnalyticsPage from "../ProductAnalyticsPage.jsx";
import DashboardOverviewPage from "../DashboardOverviewPage.jsx";

// Synthetic rows reproduce the audited source cardinality and totals, without
// copying/importing business records or changing either environment.
const outlets = ["FC", "HLIPH", "HPIPH", "JYMT"].map(id => ({ id, name: id, status: "active" }));
const septemberCounts = [232, 241, 241, 190];
const septemberCents = [4107285, 9911277, 6552778, 10988184];
const financialCents = [4107380, 9911749, 6269015, 10986020];
function seedFixture() {
  db.reports = []; db.items = []; db.ranges = []; db.mode = "complete"; db.pending = null;
  for (const month of [8, 9]) outlets.forEach((outlet, index) => {
    const id = `${month}-${outlet.id}`;
    db.reports.push({ id, outlet_id: outlet.id, report_month: month, report_year: 2026, status: "completed", uploaded_at: `2026-${month === 9 ? "10" : "09"}-01T00:00:00Z` });
    const count = month === 9 ? septemberCounts[index] : [240, 240, 240, 218][index];
    const cents = month === 9 ? septemberCents[index] : count * 100000;
    for (let row = 0; row < count; row++) db.items.push({ id: `${id}-${String(row).padStart(3, "0")}`, report_id: id, outlet_id: outlet.id, category_name: "Fixture", product_name: month === 9 ? "September fixture" : "August fixture", quantity: 1, nett_sales: (Math.floor(cents / count) + (row < cents % count ? 1 : 0)) / 100 });
  });
}
const auth = { profile: { role_outlet_access_type: "all" }, hasPermission: () => true };
function store() { return { outlets, salesRecords: outlets.map((outlet, i) => ({ outlet_id: outlet.id, month: 9, year: 2026, amount: financialCents[i] / 100 })), salesChannels: [], purchaseRecords: [], suppliers: [], outletTaxConfigs: [], specialMonths: [] }; }
function mount(Page) { return render(<Page store={store()} auth={auth} ui={{ notify: vi.fn(), navigate: vi.fn() }} />); }
function signals() { return screen.getByText("Top Product Signals (MTD)").closest(".card"); }
beforeEach(() => { seedFixture(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-09T04:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Complete Product Analytics consumers", () => {
  it("reads all 904 September rows despite 938 higher-ranked August rows", async () => {
    const result = await productAnalyticsService.listCompleteItemsByReportIds(db.reports.map(row => row.id));
    const september = result.filter(row => row.report_id.startsWith("9-"));
    expect(result).toHaveLength(1842);
    expect(september).toHaveLength(904);
    expect(september.reduce((sum, row) => sum + row.nett_sales, 0)).toBeCloseTo(315595.24, 2);
    expect(db.ranges.map(row => row.start)).toEqual([0, 500, 1000, 1500]);
    expect(outlets.reduce((sum, outlet) => sum + getNetSales(store().salesRecords, outlet.id, 9, 2026), 0)).toBeCloseTo(312741.64, 2);
  });
  it("renders September totals only after both comparison and yearly complete reads", async () => {
    mount(ProductAnalyticsPage);
    await screen.findByText("Total Net Sales");
    expect(screen.getAllByText(/RM\s*315,595/).length).toBeGreaterThan(0);
    // Period+comparison and yearly each traverse all four item pages.
    expect(db.ranges.filter(row => row.table === "product_sales_items" && row.start === 1500)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Export/ }).disabled).toBe(false);
  });
  it("withholds product KPIs and export while loading, then on a short page", async () => {
    let release;
    db.mode = "pending"; db.pending = new Promise(resolve => { release = resolve; });
    mount(ProductAnalyticsPage);
    await waitFor(() => expect(db.ranges.some(row => row.table === "product_sales_items")).toBe(true));
    expect(screen.getByText("Loading complete product analytics…")).toBeTruthy();
    expect(screen.queryByText("Total Net Sales")).toBeNull();
    expect(screen.getByRole("button", { name: /Export/ }).disabled).toBe(true);
    db.mode = "short"; release();
    await screen.findByRole("alert");
    expect(screen.queryByText("Total Net Sales")).toBeNull();
    expect(screen.getByRole("button", { name: /Export/ }).disabled).toBe(true);
  });
  it("withholds monthly KPIs when only the yearly read is incomplete", async () => {
    db.reports.push({ id: "7-FC", outlet_id: "FC", report_month: 7, report_year: 2026, status: "completed" });
    db.items.push({ id: "7-FC-item", report_id: "7-FC", outlet_id: "FC", nett_sales: 1 });
    db.mode = "year-short";
    mount(ProductAnalyticsPage);
    await screen.findByRole("alert");
    expect(screen.queryByText("Total Net Sales")).toBeNull();
    expect(db.ranges.some(row => row.count === 1842 && row.start === 1500)).toBe(true);
  });
  it("does not let a late read overwrite a new outlet scope", async () => {
    let release;
    db.mode = "pending"; db.pending = new Promise(resolve => { release = resolve; });
    const version = db.reports;
    const { result, rerender } = renderHook(({ ids }) => useCompleteProductItems(ids, version), { initialProps: { ids: db.reports.map(row => row.id) } });
    await waitFor(() => expect(db.ranges.length).toBeGreaterThan(0));
    db.mode = "complete";
    rerender({ ids: ["9-FC"] });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toHaveLength(0);
    await waitFor(() => expect(result.current.data).toHaveLength(232));
    release();
    await waitFor(() => expect(db.ranges.some(row => row.count === 1842 && row.start === 1500)).toBe(true));
    expect(result.current.data).toHaveLength(232);
  });
  it("keeps Dashboard financial sales separate while completely reading product widgets", async () => {
    vi.setSystemTime(new Date("2026-09-30T04:00:00Z"));
    mount(DashboardOverviewPage);
    await waitFor(() => expect(within(signals()).queryByText("Loading complete product signals…")).toBeNull());
    expect(within(signals()).getAllByText("September fixture").length).toBeGreaterThan(0);
    expect(db.ranges.filter(row => row.table === "product_sales_items" && row.start === 1500)).toHaveLength(1);
    expect(screen.getAllByText(/RM\s*312,742/).length).toBeGreaterThan(0);
  });
  it("does not label failed Dashboard report reads as missing uploads", async () => {
    vi.setSystemTime(new Date("2026-09-30T04:00:00Z")); db.mode = "report-error";
    mount(DashboardOverviewPage);
    await waitFor(() => expect(within(signals()).getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/Product analytics is not uploaded for this month/)).toBeNull();
    expect(screen.getAllByText(/RM\s*312,742/).length).toBeGreaterThan(0);
  });
  it("withholds incomplete Dashboard product signals while preserving Sales Input KPIs", async () => {
    vi.setSystemTime(new Date("2026-09-30T04:00:00Z")); db.mode = "short";
    mount(DashboardOverviewPage);
    await waitFor(() => expect(within(signals()).getByRole("alert")).toBeTruthy());
    expect(within(signals()).queryByText("September fixture")).toBeNull();
    expect(screen.getAllByText(/RM\s*312,742/).length).toBeGreaterThan(0);
  });
});
