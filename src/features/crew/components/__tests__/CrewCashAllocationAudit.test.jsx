import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "../../../../i18n/index.js";
import CrewCashAllocationAudit from "../CrewCashAllocationAudit.jsx";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const original = { carry_forward: 0, amount_for_deposit: 446 };
const checkout = {
  carry_forward: 46, amount_for_deposit: 400, allocation_original: original,
  allocation_corrections: [{ id: "correction", before: original, after: { carry_forward: 46, amount_for_deposit: 400 }, actor_name: "QA Admin", created_at: "2026-10-02T08:00:00Z", reason: "Correct closing allocation: RM46 carried forward to next day; deposit corrected to RM400." }],
};
describe("shared immutable allocation audit", () => {
  for (const [language, title] of [["en", "Allocation Corrections"], ["zh-CN", "现金分配更正"], ["ms", "Pembetulan Agihan"]]) {
    it(`shows original/effective evidence and real actor/reason in ${language}`, async () => {
      await i18n.changeLanguage(language);
      render(<CrewCashAllocationAudit checkout={checkout} />);
      expect(screen.getByRole("region", { name: title })).toBeTruthy();
      expect(screen.getByText(/QA Admin/)).toBeTruthy();
      expect(screen.getByText(checkout.allocation_corrections[0].reason)).toBeTruthy();
      expect(screen.getAllByText(/446/).length).toBeGreaterThan(0);
      expect(screen.getByText(/→.*400/)).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });
  }
  it("does not invent corrections for an original checkout", () => {
    const { container } = render(<CrewCashAllocationAudit checkout={{ carry_forward: 0, amount_for_deposit: 446 }} />);
    expect(container.innerHTML).toBe("");
  });
});
