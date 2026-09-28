import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../../../services/inventoryCompleteRead.js", () => ({ readCompleteInventoryRows: mocks.read }));
import { loadInventoryDashboard } from "../inventoryDashboardService.js";

describe("Inventory Dashboard scoped complete read", () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockResolvedValue({ data: [], count: 0, completeness: "complete" });
  });

  it("reads only Dashboard evidence under the accessible outlet scope", async () => {
    const data = await loadInventoryDashboard(["outlet-a"]);
    expect(data).toEqual({ items: [], groups: [], checks: [], orders: [], movements: [], waste: [] });
    const tables = mocks.read.mock.calls.map(([table]) => table);
    expect(tables).toEqual(expect.arrayContaining([
      "inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks",
      "inventory_purchase_orders", "inventory_movements", "inventory_waste_records",
    ]));
    expect(tables).not.toEqual(expect.arrayContaining(["inventory_categories", "inventory_purchase_receipts", "inventory_purchase_receipt_items", "employees", "inventory_uoms"]));
    for (const [table, options] of mocks.read.mock.calls) {
      if (["inventory_item_outlets", "inventory_stock_check_groups", "inventory_stock_checks", "inventory_purchase_orders", "inventory_movements", "inventory_waste_records"].includes(table)) {
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
});
