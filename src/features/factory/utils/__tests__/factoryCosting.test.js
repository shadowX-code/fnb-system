import { describe, expect, it } from "vitest";
import { costVarianceInfo } from "../factoryCosting.js";

describe("Factory cost variance presentation contract", () => {
  it("keeps standard-to-actual variance and zero-standard handling stable", () => {
    expect(costVarianceInfo(100, 125)).toEqual({ variance: 25, variancePercent: 25 });
    expect(costVarianceInfo(0, 20)).toEqual({ variance: 20, variancePercent: 0 });
  });
});
