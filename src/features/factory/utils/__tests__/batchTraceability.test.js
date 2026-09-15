import { describe, expect, it } from "vitest";
import { traceBatchNo } from "../batchTraceability.js";

describe("traceBatchNo", () => {
  it("shows a canonical reconciliation batch reference without relabeling it as Production", () => {
    expect(traceBatchNo({ source_type: "adjustment", batch_no: "ADJ-FGSC260915-01-S7" })).toBe("ADJ-FGSC260915-01-S7");
  });

  it("continues to hide legacy batch identifiers that are not canonical traceability evidence", () => {
    expect(traceBatchNo({ source_type: "legacy_unallocated", batch_no: "UNALLOCATED-S01" })).toBe("—");
  });
});
