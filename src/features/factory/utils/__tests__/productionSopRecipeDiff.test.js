import { describe, expect, it } from "vitest";
import { productionSopRecipeDiff } from "../productionSop.js";

describe("productionSopRecipeDiff", () => {
  it("describes persisted Recipe-version changes without creating SOP structure", () => {
    const diff = productionSopRecipeDiff(
      { version: "v1", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", raw_material_name: "Soy", quantity_used: 2, uom: "kg" }, { raw_material_id: "rm-2", raw_material_name: "Sugar", quantity_used: 1, uom: "kg" }] },
      { version: "v2", yield_quantity: 12, uom: "kg", items: [{ raw_material_id: "rm-1", raw_material_name: "Soy", quantity_used: 3, uom: "kg" }, { raw_material_id: "rm-3", raw_material_name: "Garlic", quantity_used: 1, uom: "kg" }] },
    );

    expect(diff.standardOutputChanged).toBe(true);
    expect(diff.added).toEqual([expect.objectContaining({ raw_material_id: "rm-3", name: "Garlic" })]);
    expect(diff.removed).toEqual([expect.objectContaining({ raw_material_id: "rm-2", name: "Sugar" })]);
    expect(diff.quantityChanges).toEqual([expect.objectContaining({ raw_material_id: "rm-1", previous: "2 kg", next: "3 kg" })]);
  });
});
