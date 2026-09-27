import { describe, expect, it } from "vitest";
import { auditStockCheckValuation } from "../auditStockCheckValuation.js";

describe("auditStockCheckValuation", () => {
  it("values the complete immutable snapshot with signed actual-minus-Par variance", () => {
    const result = auditStockCheckValuation([
      { id: "short", expectedQty: 10, actualCount: 7, unitCostSnapshot: 5 },
      { id: "excess", expectedQty: 4, actualCount: 6, unitCostSnapshot: 2.5 },
      { id: "normal", expectedQty: 3, actualCount: 3, unitCostSnapshot: 4 },
    ]);
    expect(result.items.map(({ stockValue, varianceValue }) => ({ stockValue, varianceValue }))).toEqual([
      { stockValue: 35, varianceValue: -15 },
      { stockValue: 15, varianceValue: 5 },
      { stockValue: 12, varianceValue: 0 },
    ]);
    expect(result).toMatchObject({ stockValue: 62, shortageValue: 15, excessValue: 5, netVariance: -10, stockIncomplete: 0, varianceIncomplete: 0 });
  });

  it("accepts an explicitly configured zero cost but never interprets missing cost as zero", () => {
    const zero = auditStockCheckValuation([{ expectedQty: 2, actualCount: 2, unitCostSnapshot: 0 }]);
    expect(zero).toMatchObject({ stockValue: 0, shortageValue: 0, excessValue: 0, netVariance: 0 });
    const historical = auditStockCheckValuation([
      { expectedQty: 2, actualCount: 2, unitCostSnapshot: 0 },
      { expectedQty: 3, actualCount: 1, unitCostSnapshot: null },
    ]);
    expect(historical.items[1]).toMatchObject({ stockValue: null, varianceValue: null });
    expect(historical).toMatchObject({ stockValue: null, shortageValue: null, excessValue: null, netVariance: null, stockIncomplete: 1, varianceIncomplete: 1 });
  });

  it("does not assign value to skipped or unavailable counts", () => {
    const result = auditStockCheckValuation([
      { expectedQty: 5, actualCount: "", unitCostSnapshot: 3, skipped: true },
      { expectedQty: 5, actualCount: 4, unitCostSnapshot: 3, na: true },
    ]);
    expect(result.items.every((row) => row.stockValue === null && row.varianceValue === null)).toBe(true);
    expect(result.stockIncomplete).toBe(2);
  });

  it("does not report a complete net variance without a recorded Par quantity", () => {
    const result = auditStockCheckValuation([{ expectedQty: "", actualCount: 4, unitCostSnapshot: 3 }]);
    expect(result).toMatchObject({ stockValue: 12, netVariance: null, stockIncomplete: 0, varianceIncomplete: 1 });
  });
});
