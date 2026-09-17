import { describe, expect, it } from "vitest";
import { buildLocationInventoryIndex, locationInventoryCountLabel } from "../locationInventory.js";

describe("Location inventory read projection", () => {
  it("groups only positive canonical balances by Location and keeps batch detail reconcilable", () => {
    const index = buildLocationInventoryIndex({
      rawMaterialBatches: [
        { id: "raw-a", storage_location_id: "location-1", raw_material_id: "rm-1", current_balance: 4, uom: "kg", internal_batch_no: "RM-01", status: "active", raw_material: { name_en: "Chili", material_code: "CHI" } },
        { id: "raw-b", storage_location_id: "location-1", raw_material_id: "rm-1", current_balance: 3, uom: "kg", internal_batch_no: "RM-02", status: "active", raw_material: { name_en: "Chili", material_code: "CHI" } },
        { id: "raw-zero", storage_location_id: "location-1", raw_material_id: "rm-2", current_balance: 0, uom: "kg", internal_batch_no: "RM-03", raw_material: { name_en: "Garlic", material_code: "GAR" } },
      ],
      finishedGoodBatches: [
        { id: "fg-a", storage_location_id: "location-1", finished_good_id: "fg-1", current_balance: 6, batch_no: "FG-01", finished_good: { product_code: "SAM-500", product_name: "Sambal 500g", uom: "Packs", product_family: { name_en: "Sambal" } } },
        { id: "fg-zero", storage_location_id: "location-1", finished_good_id: "fg-2", current_balance: 0, batch_no: "FG-02", finished_good: { product_code: "SAU-500", product_name: "Sauce", uom: "Packs" } },
      ],
    });
    const location = index.get("location-1");
    expect(location.rawMaterials).toHaveLength(1);
    expect(location.rawMaterials[0]).toMatchObject({ name: "Chili", quantity: 7, uom: "kg" });
    expect(location.rawMaterials[0].batches).toHaveLength(2);
    expect(location.finishedGoods).toHaveLength(1);
    expect(location.finishedGoods[0]).toMatchObject({ name: "Sambal", code: "SAM-500", quantity: 6, uom: "Packs" });
    expect(locationInventoryCountLabel(location)).toBe("1 RM · 1 FG");
  });

  it("does not expose an unavailable inventory family in its summary", () => {
    const location = { rawMaterials: [{ id: "rm-1" }], finishedGoods: [{ id: "fg-1" }] };
    expect(locationInventoryCountLabel(location, { includeRawMaterials: true, includeFinishedGoods: false })).toBe("1 RM");
    expect(locationInventoryCountLabel(location, { includeRawMaterials: false, includeFinishedGoods: true })).toBe("1 FG");
    expect(locationInventoryCountLabel()).toBe("Empty");
  });
});
