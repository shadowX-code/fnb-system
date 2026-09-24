import { describe, expect, it } from "vitest";
import en from "../../../../locales/en/crew.js";
import zh from "../../../../locales/zh-CN/crew.js";
import ms from "../../../../locales/ms/crew.js";

describe("Crew Operations new copy", () => {
  it("defines the exit, result, attention and PO correction copy in EN, 中文 and BM", () => {
    for (const locale of [en, zh, ms]) {
      for (const key of ["saveProgressTitle", "unsavedCountChanges", "saveAndLeave", "discardCountChanges", "keepCounting",
        "resultSummary", "readOnlyEvidence", "moreChecks", "moreOrders", "continueDraft",
        "viewItemImage", "editOrder", "editSubmittedTitle", "editSubmittedBody", "poReopened"]) {
        expect(locale.inventory[key], key).toBeTruthy();
      }
      expect(locale.inventory.moreChecks).toContain("{{count}}");
      expect(locale.inventory.moreOrders).toContain("{{count}}");
      expect(locale.inventory.poDraftCount || locale.inventory.poDraftCount_one).toContain("{{count}}");
      expect(locale.inventory.viewItemImage).toContain("{{name}}");
    }
  });
});
