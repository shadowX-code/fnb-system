import { describe, expect, it } from "vitest";
import { deriveProductionPlanningRows } from "../productionPlanning.js";
import { buildProductionPlanningJobOrderDraft } from "../productionPlanningDraft.js";

const activeRecipeForSku = (recipes, sku) => recipes.find((recipe) => recipe.product_family_id === sku.product_family_id && recipe.status === "active");
const sku = { id: "sku-1", status: "active", product_family_id: "family-1", product_family_name: "Sambal", current_balance: 3, min_stock_level: 10 };

describe("Production Planning contracts", () => {
  it("derives status, coverage, open jobs, and suggested production from the authoritative SKU aggregate", () => {
    const [row] = deriveProductionPlanningRows({ finishedGoods: [sku], recipes: [{ status: "active", product_family_id: "family-1", uom: "kg" }], aggregates: [{ packagingSkuId: "sku-1", openJobOrderQty: 2, openJobOrderCount: 1 }], activeRecipeForSku });
    expect(row).toMatchObject({ planning_status: "Low Stock", coverage_percent: 30, open_job_qty: 2, open_job_count: 1, suggested_production_qty: 5, finished_good_name: "Sambal" });
  });
  it("keeps unavailable suggested production when the aggregate flags invalid Job Order quantities", () => {
    const [row] = deriveProductionPlanningRows({ finishedGoods: [sku], recipes: [], aggregates: [{ packagingSkuId: "sku-1", invalidJobOrderCount: 1 }], activeRecipeForSku });
    expect(row.open_job_quantity_incomplete).toBe(true); expect(row.open_job_qty).toBeNull(); expect(row.suggested_production_qty).toBeNull();
  });
  it("handles no-par, zero-stock, and over-covered stock states", () => {
    const rows = deriveProductionPlanningRows({ finishedGoods: [{ ...sku, id: "a", min_stock_level: 0 }, { ...sku, id: "b", current_balance: 0 }, { ...sku, id: "c", current_balance: 12 }], recipes: [], aggregates: [], activeRecipeForSku });
    expect(rows.map((row) => row.planning_status)).toEqual(["No Par Level", "Out of Stock", "Healthy"]);
    expect(rows.map((row) => row.suggested_production_qty)).toEqual([0, 10, 0]);
  });
  it("builds the exact bounded Job Order draft", () => {
    const draft = buildProductionPlanningJobOrderDraft({ row: { ...sku, suggested_production_qty: 4, finished_good_name: "Sambal" }, recipes: [], finishedGoods: [sku], activeRecipeForSku, packagingProductionPlan: () => ({ target_production_qty: 8, production_uom: "kg" }), inheritedRecipeUom: () => "kg", finishedGoodParentKey: () => "family-1", today: () => "2026-08-09" });
    expect(draft).toEqual({ product_family_key: "family-1", finished_good_id: "sku-1", product_name: "Sambal", target_production_qty: 8, target_quantity: 8, uom: "kg", planned_date: "2026-08-09", priority: "Normal", status: "draft" });
  });
});
