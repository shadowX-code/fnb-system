import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), recent: vi.fn() }));
vi.mock("../../../../../services/inventoryCompleteRead.js", () => ({ readCompleteInventoryRows: mocks.read }));
vi.mock("../../../../../lib/supabase.ts", () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => {
    const query = { select: () => query, in: () => query, order: () => query, limit: (...args) => mocks.recent(...args) };
    return query;
  },
} }));
import { loadInventoryDashboard } from "../inventoryDashboardService.js";

describe("Inventory Dashboard scoped complete read", () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockResolvedValue({ data: [], count: 0, completeness: "complete" });
    mocks.rpc.mockReset().mockResolvedValue({ data: { position_count: 0, positions: [] }, error: null });
    mocks.recent.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("reads only Dashboard evidence under the accessible outlet scope", async () => {
    const data = await loadInventoryDashboard(["outlet-a"]);
    expect(data).toEqual({ items: [], groups: [], checks: [], orders: [], movements: [], stockEvidence: [],
      closingStatuses: null, costInsights: { state: "restricted" } });
    const tables = mocks.read.mock.calls.map(([table]) => table);
    expect(tables).toEqual(expect.arrayContaining([
      "inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks",
      "inventory_purchase_orders",
    ]));
    expect(tables).not.toEqual(expect.arrayContaining(["inventory_categories", "inventory_purchase_receipts", "inventory_purchase_receipt_items", "inventory_stock_check_items", "inventory_movements", "employees", "inventory_uoms"]));
    expect(mocks.rpc).toHaveBeenCalledWith("inventory_dashboard_stock_evidence", { p_outlet_ids: ["outlet-a"] });
    expect(mocks.recent).toHaveBeenCalledWith(5);
    for (const [table, options] of mocks.read.mock.calls) {
      if (["inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks", "inventory_purchase_orders", "inventory_waste_records"].includes(table)) {
        expect(options.in.outlet_id).toEqual(["outlet-a"]);
      }
    }
  });

  it("resolves verified closing publication and standard cost only for the requested scope", async () => {
    const cost = { start_date: "2026-10-30", end_date: "2026-11-28", increases: 1, decreases: 0, missing_costs: 0, top_changes: [] };
    mocks.read.mockImplementation(async table => ({ data: table === "inventory_stock_checks" ? [{
      id: "latest", outlet_id: "outlet-a", stock_check_type: "audit", audit_type: "Month-End Closing",
      accounting_month: "2026-10-01", status: "submitted",
    }] : [], completeness: "complete" }));
    mocks.rpc.mockImplementation(async name => ({ data: name === "inventory_dashboard_cost_insights" ? cost
      : name === "inventory_closing_context" ? { published: { source_audit_id: "published", amount: 0 } }
        : { position_count: 0, positions: [] } }));
    const data = await loadInventoryDashboard(["outlet-a", "outlet-b"], { canReadCosts: true, closingMonth: "2026-10-01" });
    expect(mocks.rpc).toHaveBeenCalledWith("inventory_dashboard_cost_insights", { p_outlet_ids: ["outlet-a", "outlet-b"] });
    expect(mocks.rpc).toHaveBeenCalledWith("inventory_closing_context", { p_check_id: "latest" });
    expect(data.costInsights).toEqual({ state: "ready", data: cost });
    expect(data.closingStatuses).toEqual({
      "outlet-a": { status: "Published", checkId: "published" },
      "outlet-b": { status: "No submission" },
    });
  });

  it("propagates incomplete evidence instead of returning a partial dashboard", async () => {
    mocks.read.mockImplementation(async (table) => {
      if (table === "inventory_stock_checks") throw Object.assign(new Error("truncated"), { readState: "incomplete" });
      return { data: [], count: 0, completeness: "complete" };
    });
    await expect(loadInventoryDashboard(["outlet-a"])).rejects.toMatchObject({ readState: "incomplete" });
  });

  it("fails closed when the server projection omits an applicable outlet item", async () => {
    mocks.read.mockImplementation(async (table) => ({ data: table === "inventory_item_outlets"
      ? [{ id: "link", outlet_id: "outlet-a", inventory_item_id: "item", par_level: 10, is_active: true }]
      : table === "inventory_items" ? [{ id: "item", item_name: "Rice", status: "active" }] : [], count: 1, completeness: "complete" }));
    await expect(loadInventoryDashboard(["outlet-a"])).rejects.toMatchObject({ readState: "incomplete" });
  });
});
