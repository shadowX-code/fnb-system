import { describe, expect, it } from "vitest";
import { convertCostQuantity, costVarianceInfo, recipeCostLineInfo } from "../factoryCosting.js";

describe("Factory cost variance presentation contract", () => {
  it("keeps standard-to-actual variance and zero-standard handling stable", () => {
    expect(costVarianceInfo(100, 125)).toEqual({ variance: 25, variancePercent: 25 });
    expect(costVarianceInfo(0, 20)).toEqual({ variance: 20, variancePercent: 0 });
  });
});

describe("Factory Recipe/BOM costing conversions", () => {
  it.each(["pack", "pail", "bottle", "pcs"])("uses identity conversion for matching %s cost basis", (uom) => {
    expect(convertCostQuantity(2.5, uom, uom)).toBe(2.5);
  });

  it("keeps canonical mass and volume conversions", () => {
    expect(convertCostQuantity(1.5, "kg", "g")).toBe(1500);
    expect(convertCostQuantity(1500, "g", "kg")).toBe(1.5);
    expect(convertCostQuantity(1.5, "L", "ml")).toBe(1500);
    expect(convertCostQuantity(1500, "ml", "L")).toBe(1.5);
  });

  it("keeps incompatible package UOMs incomplete instead of guessing", () => {
    expect(convertCostQuantity(1, "pack", "pail")).toBeNull();
    expect(convertCostQuantity(1, "bottle", "kg")).toBeNull();
  });

  it("keeps canonical receipt provenance with a costed package line", () => {
    const cost = recipeCostLineInfo(
      { raw_material_id: "material-1", quantity_used: 2, uom: "pack", wastage_percent: 0 },
      [{ raw_material_id: "material-1", unit_cost: 2.85, uom: "pack", receipt_no: "RCV-001", received_date: "2026-09-03" }],
    );

    expect(cost).toEqual(expect.objectContaining({ lineCost: 5.7, missingCost: false, unsupportedCost: false, source: "RCV-001" }));
  });
});
