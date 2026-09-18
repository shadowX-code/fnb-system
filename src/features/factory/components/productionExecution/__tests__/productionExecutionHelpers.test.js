import { describe, expect, it } from "vitest";
import { allocateRawMaterialFefo, buildInitialUsageRows } from "../productionExecutionHelpers.js";

const material = { id: "material-1", name_en: "Sauce Base", uom: "pack", conversion_package_uom: "pack", conversion_package_quantity: 5, conversion_base_uom: "kg" };
const recipe = {
  id: "recipe-1", status: "active", product_name: "Sauce", yield_quantity: 10, uom: "kg",
  items: [{ id: "item-1", raw_material_id: material.id, quantity_used: 1200, recipe_usage_uom: "g" }],
};

describe("Production recipe usage conversion", () => {
  it("scales recipe usage then allocates in Raw Material storage UOM", () => {
    const [row] = buildInitialUsageRows({ product_name: "Sauce", actual_output_qty: 20 }, [material], [recipe]);
    expect(row).toEqual(expect.objectContaining({ recipe_usage_quantity: 2400, recipe_usage_uom: "g", standard_usage: 0.48, actual_usage: 0.48, uom: "pack", conversion_error: "" }));
  });

  it("keeps production blocked when the declared relationship is absent", () => {
    const [row] = buildInitialUsageRows({ product_name: "Sauce", actual_output_qty: 20 }, [{ ...material, conversion_package_uom: "", conversion_package_quantity: null, conversion_base_uom: "" }], [recipe]);
    expect(row).toEqual(expect.objectContaining({ standard_usage: 0, actual_usage: "", uom: "pack", conversion_error: "Missing UOM conversion" }));
  });

  it("rounds fractional package consumption once at the operational four-decimal boundary", () => {
    const fractionalRecipe = {
      ...recipe,
      yield_quantity: 26,
      items: [{ ...recipe.items[0], quantity_used: 12000 }],
    };
    const fractionalMaterial = { ...material, conversion_package_quantity: 1000, conversion_base_uom: "g" };
    const [row] = buildInitialUsageRows({ product_name: "Sauce", actual_output_qty: 82 }, [fractionalMaterial], [fractionalRecipe]);

    expect(row).toEqual(expect.objectContaining({
      recipe_usage_quantity: expect.closeTo(37846.153846153846),
      standard_usage: 37.8462,
      actual_usage: 37.8462,
      uom: "pack",
    }));
  });

  it("keeps FEFO allocations exactly equal to the four-decimal required quantity", () => {
    const allocation = allocateRawMaterialFefo(37.8462, [
      { batch_balance_id: "batch-1", available_qty: 20 },
      { batch_balance_id: "batch-2", available_qty: 17.8462 },
    ]);

    expect(allocation).toEqual(expect.objectContaining({
      remaining: 0,
      allocations: [
        expect.objectContaining({ batch_balance_id: "batch-1", allocated_qty: 20 }),
        expect.objectContaining({ batch_balance_id: "batch-2", allocated_qty: 17.8462 }),
      ],
    }));
  });
});
