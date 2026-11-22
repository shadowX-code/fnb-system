import { describe, expect, it } from "vitest";
import { auditStockCheckValuation } from "../auditStockCheckValuation.js";

describe("auditStockCheckValuation", () => {
  it("values the complete immutable snapshot with signed actual-minus-Par variance", () => {
    const result = auditStockCheckValuation([
      { id: "short", expectedQty: 10, unit: "kg", actualCount: 7, unitCostSnapshot: 5 },
      { id: "excess", expectedQty: 4, unit: "kg", actualCount: 6, unitCostSnapshot: 2.5 },
      { id: "normal", expectedQty: 3, unit: "kg", actualCount: 3, unitCostSnapshot: 4 },
    ]);
    expect(result.items.map(({ stockValue, varianceValue }) => ({ stockValue, varianceValue }))).toEqual([
      { stockValue: 35, varianceValue: -15 },
      { stockValue: 15, varianceValue: 5 },
      { stockValue: 12, varianceValue: 0 },
    ]);
    expect(result).toMatchObject({ stockValue: 62, shortageValue: 15, excessValue: 5, netVariance: -10, stockIncomplete: 0, varianceIncomplete: 0 });
  });

  it("accepts an explicitly configured zero cost but never interprets missing cost as zero", () => {
    const zero = auditStockCheckValuation([{ expectedQty: 2, unit: "kg", actualCount: 2, unitCostSnapshot: 0 }]);
    expect(zero).toMatchObject({ stockValue: 0, shortageValue: 0, excessValue: 0, netVariance: 0 });
    const historical = auditStockCheckValuation([
      { expectedQty: 2, unit: "kg", actualCount: 2, unitCostSnapshot: 0 },
      { expectedQty: 3, unit: "kg", actualCount: 1, unitCostSnapshot: null },
    ]);
    expect(historical.items[1]).toMatchObject({ stockValue: null, varianceValue: null });
    expect(historical).toMatchObject({ stockValue: null, knownStockValue: 0, valuedItemCount: 1, missingCostCount: 1, shortageValue: 0, excessValue: 0, netVariance: 0, stockIncomplete: 1, varianceIncomplete: 1, varianceItemCount: 1 });
  });

  it("does not assign value to skipped or unavailable counts", () => {
    const result = auditStockCheckValuation([
      { expectedQty: 5, unit: "kg", actualCount: "", unitCostSnapshot: 3, skipped: true },
      { expectedQty: 5, unit: "kg", actualCount: 4, unitCostSnapshot: 3, na: true },
    ]);
    expect(result.items.every((row) => row.stockValue === null && row.varianceValue === null)).toBe(true);
    expect(result).toMatchObject({ stockIncomplete: 2, knownStockValue: null, valuedItemCount: 0, missingCostCount: 0 });
  });

  it("totals eligible variance rows with independent coverage, retaining zero and excluding missing units or Par", () => {
    const result = auditStockCheckValuation([
      { unit: "kg", expectedQty: 10, actualCount: 7, unitCostSnapshot: 5 },
      { unit: "kg", expectedQty: 4, actualCount: 6, unitCostSnapshot: 2.5 },
      { unit: "kg", expectedQty: "", actualCount: 4, unitCostSnapshot: 3 },
      { unit: "", expectedQty: 0, actualCount: 10, unitCostSnapshot: 4 },
      { unit: "kg", expectedQty: 0, actualCount: 0, unitCostSnapshot: 0 },
    ]);
    expect(result).toMatchObject({ valuedItemCount: 4, varianceItemCount: 3, varianceIncomplete: 2,
      shortageValue: 15, excessValue: 5, netVariance: -10 });
    expect(result.items[2]).toMatchObject({ stockValue: 12, varianceValue: null });
    expect(result.items[3]).toMatchObject({ stockValue: null, varianceValue: null });
  });

  it("does not report a complete net variance without a recorded Par quantity", () => {
    const result = auditStockCheckValuation([{ expectedQty: "", unit: "kg", actualCount: 4, unitCostSnapshot: 3 }]);
    expect(result).toMatchObject({ stockValue: 12, netVariance: null, stockIncomplete: 0, varianceIncomplete: 1 });
  });
});
