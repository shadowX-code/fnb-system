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

it("requires explicit physical evidence even when the operational timestamps match the accounting cutoff", async () => {
  const monthEnd = "2026-10-31T16:00:00Z";
  approve.mockResolvedValue({ id: "close", revision: 1, source_audit_id: "audit", amount: 8 });
  render(<ClosingStockApproval canApprove formatCurrency={amount => `RM ${amount}`}
    check={{ id: "audit", accountingMonth: "2026-10-01", createdAt: monthEnd, submittedAt: monthEnd,
      rows: [{ itemId: "item", actualCount: 4, unit: "kg", unitCostSnapshot: 2 }] }}
    context={{ month_end_cutoff: monthEnd, period_ended: true, requires_reconciliation: null }}
    itemById={new Map([["item", { name: "Chilli" }]])} />);

  expect(screen.getByText("Awaiting confirmation")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review Closing Approval" }));
  const submit = screen.getByRole("button", { name: "Approve Closing Stock" });
  expect(submit.disabled).toBe(true);
  expect(screen.queryByLabelText("Month-End Quantity for Chilli")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("Select date"), { target: { value: "1 Nov 2026" } });
  fireEvent.click(screen.getByRole("button", { name: "Physical Count Time" }));
  fireEvent.click(screen.getByRole("button", { name: "Hour" }));
  fireEvent.click(screen.getByRole("option", { name: "12", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(submit.disabled).toBe(false);
  expect(screen.queryByLabelText("Month-End Quantity for Chilli")).toBeNull();
  fireEvent.click(submit);
  await waitFor(() => expect(approve).toHaveBeenCalledWith(expect.objectContaining({
    physicalCountCutoff: "2026-11-01T00:00:00+08:00", reconciliation: [],
  })));
});
