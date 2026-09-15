import { describe, expect, it } from "vitest";
import { semanticStatusTone } from "../semanticStatus.js";

describe("semanticStatusTone", () => {
  it("maps common lifecycle, trust, scoring, and follow-up states consistently", () => {
    expect(semanticStatusTone("finalized")).toBe("success");
    expect(semanticStatusTone("review_required")).toBe("warning");
    expect(semanticStatusTone("confirmed")).toBe("success");
    expect(semanticStatusTone("included")).toBe("info");
    expect(semanticStatusTone("excluded")).toBe("neutral");
    expect(semanticStatusTone("requested")).toBe("warning");
    expect(semanticStatusTone("in progress")).toBe("info");
  });
});
