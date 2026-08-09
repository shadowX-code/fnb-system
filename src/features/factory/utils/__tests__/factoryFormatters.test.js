import { describe, expect, it } from "vitest";
import { compactCompare, dispatchLineBaseEquivalentLabel, dispatchTotalLabel, normalizePackSizeToBase, packSizeText, recipeOperatorIdentity } from "../factoryFormatters.js";

describe("packSizeText", () => {
  it("preserves the Factory packaging-size fallback contract", () => {
    expect(packSizeText({ pack_size_qty: 500, pack_size_uom: "g" })).toBe("500 g");
    expect(packSizeText({ pack_size_qty: 1, pack_size_uom: "kg" })).toBe("1 kg");
    expect(packSizeText({ pack_size_qty: 0, pack_size_uom: "g" })).toBe("");
  });

  it("preserves the packaging balance label used by legacy Job Order SKU options", async () => {
    const { skuBalanceLabel } = await import("../factoryFormatters.js");
    expect(skuBalanceLabel({ current_balance: 1, packaging_type: "Pouch" })).toBe("1 Pouch");
    expect(skuBalanceLabel({ current_balance: 2, packaging_type: "Pouch" })).toBe("2 Pouches");
  });

  it("preserves extracted workspace reference and pack-size presentation helpers", () => {
    expect(compactCompare("500 g Pack")).toBe("500gpack");
    expect(normalizePackSizeToBase(500, "g")).toEqual({ amount: 0.5, uom: "kg" });
    expect(dispatchLineBaseEquivalentLabel({ quantity: 3, pack_size_qty: 500, pack_size_uom: "g" })).toBe("1.5 kg");
    expect(dispatchTotalLabel({ total_qty: 3, items: [{ packaging_type: "Pack" }] })).toBe("3 Packs");
    expect(recipeOperatorIdentity({ product_name: "Sambal", version: "v2" })).toBe("Sambal · v2");
  });
});
