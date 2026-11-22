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
    check={{ id: "audit", closingItemIds: ["item"], submittedAt: "2026-11-22T13:38:00Z", accountingMonth: "2026-10-01", physicalCountCutoff: "2026-10-31T14:00:00Z",
      rows: [{ itemId: "item", actualCount: 4, unit: "kg", unitCostSnapshot: 2 }] }}
    context={{ month_end_cutoff: "2026-10-31T16:00:00Z", period_ended: true, requires_reconciliation: true }}
    itemById={new Map([["item", { name: "Chilli" }]])} />);

  expect(screen.getByText(/Closing Month · Oct 2026/)).toBeTruthy();
  expect(screen.queryByText(/Accounting Cutoff|Physical Count Cutoff/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review Closing" }));
  const submit = screen.getByRole("button", { name: "Confirm Closing" });
  fireEvent.change(screen.getByLabelText("Month-End Quantity for Chilli"), { target: { value: "0" } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Supporting Evidence for Chilli"), { target: { value: "Cutoff worksheet" } });
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Approved · RM 0"));
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
    check={{ id: "audit", closingItemIds: ["item"], accountingMonth: "2026-10-01", createdAt: monthEnd, submittedAt: monthEnd,
      rows: [{ itemId: "item", actualCount: 4, unit: "kg", unitCostSnapshot: 2 }] }}
    context={{ month_end_cutoff: monthEnd, period_ended: true, requires_reconciliation: null }}
    itemById={new Map([["item", { name: "Chilli" }]])} />);

  expect(screen.getByText("Awaiting closing review")).toBeTruthy();
  expect(screen.queryByText("Actual Count Date and Time")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review Closing" }));
  const submit = screen.getByRole("button", { name: "Confirm Closing" });
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


it("reports missing pinned costs without offering to confirm a partial valuation", () => {
  const onShowUnvalued = vi.fn();
  render(<ClosingStockApproval canApprove formatCurrency={amount => `RM ${amount}`} onShowUnvalued={onShowUnvalued}
    check={{ id: "audit", closingItemIds: ["item"], accountingMonth: "2026-10-01", submittedAt: "2026-11-22T13:38:00Z",
      rows: [{ itemId: "item", actualCount: 0, unit: "pack", unitCostSnapshot: null }] }}
    context={{ month_end_cutoff: "2026-10-31T16:00:00Z", period_ended: true }} itemById={new Map()} />);
  expect(screen.getByRole("status").textContent).toBe("Not ready to confirm");
  expect(screen.getByText("1 item is missing a valid pinned unit cost.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review Closing" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review Unvalued Items" }));
  expect(onShowUnvalued).toHaveBeenCalledOnce();
  expect(approve).not.toHaveBeenCalled();
});
