import { describe, expect, it } from "vitest";
import { finishedGoodCommercialCost } from "../utils/finishedGoodsCommercial.js";

const recipe = { status: "active", product_family_id: "family-1", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", quantity_used: 10, uom: "kg" }] };
const receivings = [{ raw_material_id: "rm-1", unit_cost: 5, uom: "kg", received_date: "2026-08-01" }];
const sku = (pack_size_qty, pack_size_uom = "kg") => ({ product_family_id: "family-1", pack_size_qty, pack_size_uom });

describe("Finished Goods commercial cost authority", () => {
  it("uses exactly one active exact product-family recipe and scales compatible pack sizes", () => {
    expect(finishedGoodCommercialCost(sku(1), [recipe], receivings)).toBe(5);
    expect(finishedGoodCommercialCost(sku(500, "g"), [recipe], receivings)).toBe(2.5);
    expect(finishedGoodCommercialCost(sku(250, "g"), [recipe], receivings)).toBe(1.25);
  });
  it("rejects missing, ambiguous, unrelated, draft, and incompatible recipes", () => {
    expect(finishedGoodCommercialCost(sku(1), [], receivings)).toBeNull();
    expect(finishedGoodCommercialCost(sku(1), [recipe, { ...recipe, id: "two" }], receivings)).toBeNull();
    expect(finishedGoodCommercialCost(sku(1), [{ ...recipe, product_family_id: "other" }], receivings)).toBeNull();
    expect(finishedGoodCommercialCost(sku(1), [{ ...recipe, status: "draft" }], receivings)).toBeNull();
    expect(finishedGoodCommercialCost(sku(1, "L"), [recipe], receivings)).toBeNull();
    expect(finishedGoodCommercialCost(sku(1), [recipe], [])).toBeNull();
  });
});
