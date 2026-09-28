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
    expect(data).toEqual({ items: [], groups: [], checks: [], orders: [], movements: [], waste: [], stockEvidence: [] });
    const tables = mocks.read.mock.calls.map(([table]) => table);
    expect(tables).toEqual(expect.arrayContaining([
      "inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks",
      "inventory_purchase_orders", "inventory_waste_records",
    ]));
    expect(tables).not.toEqual(expect.arrayContaining(["inventory_categories", "inventory_purchase_receipts", "inventory_purchase_receipt_items", "inventory_stock_check_items", "inventory_movements", "employees", "inventory_uoms"]));
    expect(mocks.rpc).toHaveBeenCalledWith("inventory_dashboard_stock_evidence", { p_outlet_ids: ["outlet-a"] });
    for (const [table, options] of mocks.read.mock.calls) {
      if (["inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks", "inventory_purchase_orders", "inventory_waste_records"].includes(table)) {
        expect(options.in.outlet_id).toEqual(["outlet-a"]);
      }
    }
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
