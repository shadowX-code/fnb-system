import { describe, expect, it } from "vitest";
import { convertRawMaterialQuantity, factoryRecipeUsageUom } from "../factoryUomConversions.js";

const packMaterial = { uom: "pack", conversion_package_uom: "pack", conversion_package_quantity: 5, conversion_base_uom: "kg" };
const bottleMaterial = { uom: "bottle", conversion_package_uom: "bottle", conversion_package_quantity: 750, conversion_base_uom: "ml" };
const pailMaterial = { uom: "pail", conversion_package_uom: "pail", conversion_package_quantity: 15, conversion_base_uom: "kg" };

describe("Factory Raw Material conversion metadata", () => {
  it("keeps identity and canonical dimensional conversions", () => {
    expect(convertRawMaterialQuantity(2, "pack", "pack", packMaterial)).toEqual({ quantity: 2, reason: "" });
    expect(convertRawMaterialQuantity(1.5, "kg", "g", packMaterial)).toEqual({ quantity: 1500, reason: "" });
    expect(convertRawMaterialQuantity(1.5, "litre", "ml", bottleMaterial)).toEqual({ quantity: 1500, reason: "" });
  });

  it("converts pack, bottle, and pail relationships through their declared base UOM", () => {
    expect(convertRawMaterialQuantity(1200, "g", "pack", packMaterial)).toEqual({ quantity: 0.24, reason: "" });
    expect(convertRawMaterialQuantity(2, "pack", "g", packMaterial)).toEqual({ quantity: 10000, reason: "" });
    expect(convertRawMaterialQuantity(1.5, "litre", "bottle", bottleMaterial)).toEqual({ quantity: 2, reason: "" });
    expect(convertRawMaterialQuantity(2, "bottle", "ml", bottleMaterial)).toEqual({ quantity: 1500, reason: "" });
    expect(convertRawMaterialQuantity(3000, "g", "pail", pailMaterial)).toEqual({ quantity: 0.2, reason: "" });
    expect(convertRawMaterialQuantity(1, "pail", "g", pailMaterial)).toEqual({ quantity: 15000, reason: "" });
  });

  it("does not infer an unsupported package conversion", () => {
    expect(convertRawMaterialQuantity(1, "pack", "kg", { uom: "pack" })).toEqual({ quantity: null, reason: "Missing UOM conversion" });
    expect(convertRawMaterialQuantity(1, "pack", "pail", packMaterial)).toEqual({ quantity: null, reason: "Missing UOM conversion" });
  });

  it("uses configured package Base UOM or Storage UOM as the Recipe contract", () => {
    expect(factoryRecipeUsageUom({ ...packMaterial, conversion_base_uom: "g" })).toBe("g");
    expect(factoryRecipeUsageUom(bottleMaterial)).toBe("ml");
    expect(factoryRecipeUsageUom({ uom: "pack" })).toBe("pack");
  });

  it("does not claim a Base UOM when package conversion metadata is incomplete", () => {
    expect(factoryRecipeUsageUom({ uom: "pack", conversion_package_uom: "pack", conversion_package_quantity: 0, conversion_base_uom: "g" })).toBe("pack");
  });
});
