import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ClosingStockApproval from "../ClosingStockApproval.jsx";

const approve = vi.hoisted(() => vi.fn());
vi.mock("../../../../../services/inventoryLifecycleService.js", () => ({
  inventoryLifecycleService: { approveClosingStock: approve },
}));

afterEach(() => { cleanup(); approve.mockReset(); });

const check = {
  id: "audit", accountingMonth: "2026-10-01", submittedAt: "2026-11-22T13:38:00Z",
  closingItemIds: ["counted", "missing"], rows: [
    { itemId: "counted", actualCount: 4, unit: "kg", unitCostSnapshot: 2 },
    { itemId: "missing", actualCount: 5, unit: "kg", unitCostSnapshot: null },
  ],
};
const date = () => screen.getByPlaceholderText("Select date");
const confirm = () => screen.getByRole("button", { name: "Confirm Closing" });
const checkbox = () => screen.getByRole("checkbox", { name: /approve reporting this value in Oct 2026/ });
const props = { check, context: { period_ended: true }, canApprove: true, formatCurrency: amount => `RM ${amount}` };

it("requires explicit attribution and publishes partial evidence in the selected month", async () => {
  approve.mockResolvedValue({ id: "close", revision: 1, source_audit_id: "audit", amount: 8,
    valuation_status: "partial", actual_count_date: "2026-11-21", valued_item_count: 1, total_item_count: 2 });
  const onShowUnvalued = vi.fn();
  render(<ClosingStockApproval {...props} onShowUnvalued={onShowUnvalued} />);

  expect(screen.getByText("1 item has no valid pinned cost and will remain unvalued.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review Unvalued Items" }));
  expect(onShowUnvalued).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Review Closing" }));
  expect(date().value).toBe("");
  expect(confirm().disabled).toBe(true);
  fireEvent.change(date(), { target: { value: "23 Nov 2026" } });
  expect(confirm().disabled).toBe(true);
  fireEvent.change(date(), { target: { value: "21 Nov 2026" } });
  expect(screen.getByText(/falls outside the selected Closing Month of Oct 2026/)).toBeTruthy();
  expect(screen.queryByText(/Month-End Quantity|Supporting Evidence/)).toBeNull();
  expect(confirm().disabled).toBe(true);
  fireEvent.click(checkbox());
  fireEvent.change(date(), { target: { value: "31 Nov 2026" } });
  expect(confirm().disabled).toBe(true);
  fireEvent.change(date(), { target: { value: "21 Nov 2026" } });
  fireEvent.click(checkbox());
  fireEvent.click(confirm());

  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Approved · Partial · RM 8"));
  expect(approve).toHaveBeenCalledWith(expect.objectContaining({
    checkId: "audit", supersedesId: null, confirmedClosingMonth: "2026-10-01", actualCountDate: "2026-11-21",
  }));
  expect(screen.getByText(/1 of 2 items valued.*Actual count 21 Nov 2026/)).toBeTruthy();
});

it("keeps a recorded physical date and shows wholly unvalued separately from explicit zero", async () => {
  approve.mockResolvedValue({ source_audit_id: "audit", amount: null, valuation_status: "partial",
    actual_count_date: "2026-11-01", valued_item_count: 0, total_item_count: 2 });
  render(<ClosingStockApproval {...props} check={{ ...check, physicalCountCutoff: "2026-10-31T16:00:00Z",
    rows: check.rows.map(row => ({ ...row, unitCostSnapshot: null })) }} />);
  fireEvent.click(screen.getByRole("button", { name: "Review Closing" }));
  expect(screen.queryByPlaceholderText("Select date")).toBeNull();
  expect(screen.getByText(/Known Stock Value.*—.*0 of 2 items valued/)).toBeTruthy();
  fireEvent.click(checkbox());
  fireEvent.click(confirm());
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Approved · Partial · —"));
});

it("still blocks publication without an explicit month or complete frozen roster", () => {
  render(<ClosingStockApproval {...props} check={{ ...check, accountingMonth: null, closingItemIds: null }} />);
  expect(screen.getByText("This audit has no recorded Closing Month.")).toBeTruthy();
  expect(screen.getByText("A complete frozen item list is required.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Review Closing" })).toBeNull();
});
