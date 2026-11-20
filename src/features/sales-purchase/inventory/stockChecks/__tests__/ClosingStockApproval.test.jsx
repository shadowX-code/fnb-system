import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ClosingStockApproval from "../ClosingStockApproval.jsx";

const approve = vi.hoisted(() => vi.fn());
vi.mock("../../../../../services/inventoryLifecycleService.js", () => ({
  inventoryLifecycleService: { approveClosingStock: approve },
}));

afterEach(() => { cleanup(); approve.mockReset(); });

it("requires a reconciled quantity and evidence for an off-cutoff audit and publishes explicit zero", async () => {
  approve.mockResolvedValue({ id: "close", revision: 1, source_audit_id: "audit", amount: 0 });
  render(<ClosingStockApproval canApprove formatCurrency={amount => `RM ${amount}`}
    check={{ id: "audit", accountingMonth: "2026-10-01", physicalCountCutoff: "2026-10-31T14:00:00Z",
      rows: [{ itemId: "item", actualCount: 4, unit: "kg", unitCostSnapshot: 2 }] }}
    context={{ month_end_cutoff: "2026-10-31T16:00:00Z", period_ended: true, requires_reconciliation: true }}
    itemById={new Map([["item", { name: "Chilli" }]])} />);

  fireEvent.click(screen.getByRole("button", { name: "Review Closing Approval" }));
  const submit = screen.getByRole("button", { name: "Approve Closing Stock" });
  fireEvent.change(screen.getByLabelText("Month-End Quantity for Chilli"), { target: { value: "0" } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Supporting Evidence for Chilli"), { target: { value: "Cutoff worksheet" } });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Published revision 1 · RM 0"));
  expect(approve).toHaveBeenCalledWith(expect.objectContaining({
    checkId: "audit", supersedesId: null, reconciliation: [
      { item_id: "item", month_end_quantity: 0, evidence: "Cutoff worksheet" },
    ],
  }));
});
