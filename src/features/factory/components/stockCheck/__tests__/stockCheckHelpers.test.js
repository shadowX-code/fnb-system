import { describe, expect, it } from "vitest";
import { buildStockCheckRows, finishedGoodStockCheckIdentity } from "../stockCheckHelpers.js";

describe("Finished Goods Stock Check identity", () => {
  it("uses the product-family name with the selected SKU pack size", () => {
    const sku = { id: "sku-500", product_name: "Mushroom Sauce - 500kg Pack", product_family_name: "Mushroom Sauce", product_code: "S7", pack_size_qty: 500, pack_size_uom: "kg", status: "active" };
    const [row] = buildStockCheckRows("product", [sku], null);

    expect(finishedGoodStockCheckIdentity(row, sku)).toEqual({ primary: "Mushroom Sauce", secondary: "S7 · 500 kg" });
  });

  it("keeps packaging SKUs distinct while retaining product names with legitimate numbers", () => {
    const smallSku = { id: "sku-small", product_name: "Thai Sauce - 500 g Pack", product_family_name: "Thai Sauce 2024", product_code: "SK03-500g", pack_size_qty: 500, pack_size_uom: "g", status: "active" };
    const largeSku = { id: "sku-large", product_name: "Thai Sauce - 1 kg Pack", product_family_name: "Thai Sauce 2024", product_code: "SK03-1kg", pack_size_qty: 1, pack_size_uom: "kg", status: "active" };
    const [smallRow, largeRow] = buildStockCheckRows("product", [smallSku, largeSku], null);

    expect(finishedGoodStockCheckIdentity(smallRow, smallSku)).toEqual({ primary: "Thai Sauce 2024", secondary: "SK03-500g · 500 g" });
    expect(finishedGoodStockCheckIdentity(largeRow, largeSku)).toEqual({ primary: "Thai Sauce 2024", secondary: "SK03-1kg · 1 kg" });
  });

  it("does not create a dangling secondary label when optional SKU metadata is absent", () => {
    expect(finishedGoodStockCheckIdentity({ item_name: "Legacy Sauce" }, {})).toEqual({ primary: "Legacy Sauce", secondary: "" });
  });
});
