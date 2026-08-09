import { describe, expect, it } from "vitest";
import { packSizeText } from "../factoryFormatters.js";

describe("packSizeText", () => {
  it("preserves the Factory packaging-size fallback contract", () => {
    expect(packSizeText({ pack_size_qty: 500, pack_size_uom: "g" })).toBe("500 g");
    expect(packSizeText({ pack_size_qty: 1, pack_size_uom: "kg" })).toBe("1 kg");
    expect(packSizeText({ pack_size_qty: 0, pack_size_uom: "g" })).toBe("");
  });
});
