import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ClosingStockResult from "../ClosingStockResult.jsx";

const publish = vi.hoisted(() => vi.fn());
vi.mock("../../../../../services/inventoryLifecycleService.js", () => ({
  inventoryLifecycleService: { publishExistingClosing: publish },
}));
afterEach(() => { cleanup(); publish.mockReset(); });

const check = {
  id: "audit", accountingMonth: "2026-10-01", closingItemIds: ["counted", "missing"], rows: [
    { itemId: "counted", actualCount: 4, unit: "kg", unitCostSnapshot: 2 },
    { itemId: "missing", actualCount: 5, unit: "kg", unitCostSnapshot: null },
  ],
};
const props = { check, context: {}, canPublish: true, formatCurrency: amount => `RM ${amount}` };

it("requires an explicit historical publish click and collects no invented date", async () => {
  publish.mockResolvedValue({ source_audit_id: "audit", amount: 8, valuation_status: "partial",
    actual_count_date: null, valued_item_count: 1, total_item_count: 2 });
  render(<ClosingStockResult {...props} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(publish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Publish Closing" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Published · Partial · RM 8"));
  expect(publish).toHaveBeenCalledWith({ checkId: "audit", requestId: expect.any(String) });
  expect(screen.getByText("1 of 2 items valued. Actual count date not recorded.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish Closing" })).toBeNull();
});

it("blocks publication without approval scope or an eligible frozen roster", () => {
  const { rerender } = render(<ClosingStockResult {...props} canPublish={false} />);
  expect(screen.queryByRole("button", { name: "Publish Closing" })).toBeNull();
  rerender(<ClosingStockResult {...props} check={{ ...check, accountingMonth: null, closingItemIds: null }} />);
  expect(screen.getByText("This audit has no recorded Closing Month.")).toBeTruthy();
  expect(screen.getByText("A complete frozen item list is required.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Publish Closing" })).toBeNull();
});
