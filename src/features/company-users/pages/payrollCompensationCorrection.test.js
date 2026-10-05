import { describe, it, expect } from "vitest";
import { compensationCorrectionInput } from "./payrollCompensationPresentation.js";

describe("historical compensation correction", () => {
  const versions = [
    { effective_from: "2026-02-01", revision: 1, default_cost_outlet_id: "original", source_document_id: "contract" },
    { effective_from: "2026-08-01", revision: 1, default_cost_outlet_id: "later", source_document_id: null },
    { effective_from: "2026-02-01", revision: 2, default_cost_outlet_id: "corrected", source_document_id: "contract" },
  ];
  it("preserves the selected date's effective metadata, not current metadata", () => {
    const input = compensationCorrectionInput({ effectiveFrom: "2026-02-01", payBasis: "hourly", rate: "8", reason: "Correction" }, versions);
    expect(input).toEqual({ effectiveFrom: "2026-02-01", payBasis: "hourly", rate: 8, reason: "Correction", defaultCostOutletId: "corrected", sourceDocumentId: "contract" });
  });
  it("preserves later version metadata for its own correction", () => {
    expect(compensationCorrectionInput({ effectiveFrom: "2026-08-01", rate: "9" }, versions)).toMatchObject({ rate: 9, defaultCostOutletId: "later", sourceDocumentId: null });
  });
  it("does not borrow metadata from a future revision", () => {
    expect(compensationCorrectionInput({ effectiveFrom: "2026-01-01", rate: "8" }, versions)).toMatchObject({ defaultCostOutletId: null, sourceDocumentId: null });
  });
});
