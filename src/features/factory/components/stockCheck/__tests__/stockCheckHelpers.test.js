import { describe, expect, it } from "vitest";
import { buildStockCheckRows, finishedGoodStockCheckIdentity, positiveAdjustmentBatchLabel, setStockCheckCountStatus } from "../stockCheckHelpers.js";

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

  it("renders a linked reconciliation batch distinctly from an existing Production batch", () => {
    expect(positiveAdjustmentBatchLabel({ positive_adjustment_batch_balance_id: "batch-1", positive_adjustment_batch_no: "ADJ-FGSC260916-01", positive_adjustment_batch_source_type: "adjustment" })).toBe("Reconciliation Batch ADJ-FGSC260916-01");
    expect(positiveAdjustmentBatchLabel({ positive_adjustment_batch_balance_id: "batch-1", positive_adjustment_batch_no: "ADJ-FGSC260916-01", positive_adjustment_batch_source_type: "" })).toBe("Reconciliation Batch ADJ-FGSC260916-01");
    expect(positiveAdjustmentBatchLabel({ positive_adjustment_batch_balance_id: "batch-2", positive_adjustment_batch_no: "PB260916-01", positive_adjustment_batch_source_type: "production" })).toBe("Existing batch PB260916-01");
  });

  it("keeps a draft physical count distinct from Skip and restores it when counted again", () => {
    const [skipped] = setStockCheckCountStatus([{ id: "row-1", physical_qty: "0", batch_allocations: [{ id: "allocation" }] }], "skip");
    expect(skipped).toMatchObject({ count_status: "skip", physical_qty: "0", batch_allocations: [] });
    const [counted] = setStockCheckCountStatus([skipped], "counted");
    expect(counted).toMatchObject({ count_status: "counted", physical_qty: "0" });
  });
});
