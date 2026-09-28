import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn() }));
vi.mock("../../../../../services/inventoryCompleteRead.js", () => ({ readCompleteInventoryRows: mocks.read }));
vi.mock("../../../../../services/inventoryLifecycleService.js", () => ({ inventoryLifecycleService: {} }));
vi.mock("../../../../../lib/supabase.ts", () => ({ supabase: { rpc: mocks.rpc } }));
import { loadStockCheckExecution } from "../inventoryStockCheckExecutionService.js";
const read = mocks.read;

const rows = {
  inventory_item_outlets: [{ id: "link", inventory_item_id: "item", outlet_id: "A", par_level: 10 }],
  inventory_stock_check_groups: [{ id: "group", outlet_id: "A", name: "Opening", frequency_type: "custom", frequency_days: ["Monday"] }],
  inventory_stock_checks: [{ id: "check", outlet_id: "A", group_id: "group", status: "submitted", check_date: "2026-09-28" }],
  inventory_categories: [{ id: "category", name: "Frozen" }],
  employees: [{ id: "actor", full_name: "QA Actor" }],
  inventory_items: [{ id: "item", item_name: "QA Item", category_id: "category", unit: "kg", status: "active" }],
  inventory_stock_check_group_categories: [{ id: "category-link", group_id: "group", category_id: "category" }],
  inventory_stock_check_items: [{ id: "count", stock_check_id: "check", item_id: "item", par_level_quantity: 10, actual_count_quantity: 8, variance: 2 }],
  inventory_purchase_orders: [{ id: "po", source_stock_check_id: "check", source_type: "stock_check", status: "draft" }],
};
beforeEach(() => {
  read.mockReset().mockImplementation(async (table) => ({ data: rows[table] || [], completeness: "complete" }));
  mocks.rpc.mockReset().mockResolvedValue({ data: { check_count: 1, summaries: [{ check_id: "check", total: 1, skipped: 0, shortage: 1 }] }, error: null });
});

describe("Stock Check execution read boundary", () => {
  it("loads only execution context, with submitted Result evidence represented by card summary", async () => {
    const result = await loadStockCheckExecution(["A"]);
    expect(result.completeness).toBe("complete");
    expect(result.groups[0].categoryIds).toEqual(["category"]);
    expect(result.items[0].linkedOutletIds).toEqual(["A"]);
    expect(result.checks[0].rows).toEqual([]);
    expect(result.checks[0].rowSummary).toEqual({ total: 1, skipped: 0, shortage: 1 });
    expect(result.orders[0].sourceStockCheckId).toBe("check");
    expect(mocks.rpc).toHaveBeenCalledWith("inventory_stock_check_row_summaries", { p_check_ids: ["check"] });
    expect(read.mock.calls.map(([table]) => table)).not.toContain("inventory_stock_check_items");
    expect(read.mock.calls.map(([table]) => table)).not.toContain("inventory_purchase_receipts");
    expect(read.mock.calls.map(([table]) => table)).not.toContain("inventory_movements");
    expect(read.mock.calls.map(([table]) => table)).not.toContain("inventory_waste_records");
    expect(read).toHaveBeenCalledWith("inventory_stock_checks", expect.objectContaining({ in: { outlet_id: ["A"] } }));
  });

  it("does not present a partial linked read as a valid execution snapshot", async () => {
    mocks.rpc.mockResolvedValue({ data: { check_count: 0, summaries: [] }, error: null });
    await expect(loadStockCheckExecution(["A"])).rejects.toMatchObject({ readState: "incomplete" });
  });

  it("keeps complete Draft rows operational while summarizing submitted history", async () => {
    read.mockImplementation(async (table, options) => ({ data: table === "inventory_stock_checks"
      ? [...rows.inventory_stock_checks, { ...rows.inventory_stock_checks[0], id: "draft", status: "draft" }]
      : table === "inventory_stock_check_items" ? [{ ...rows.inventory_stock_check_items[0], stock_check_id: "draft" }]
        : rows[table] || [], completeness: "complete" }));
    const result = await loadStockCheckExecution(["A"]);
    expect(result.checks.find((check) => check.id === "draft").rows).toHaveLength(1);
    expect(read).toHaveBeenCalledWith("inventory_stock_check_items", expect.objectContaining({ in: { stock_check_id: ["draft"] } }));
  });
});
