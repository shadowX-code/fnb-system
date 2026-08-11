import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sales: { getSalesRecords: vi.fn(), saveSalesRecords: vi.fn() },
  purchase: { getPurchaseRecords: vi.fn(), savePurchaseRecords: vi.fn() },
}));

vi.mock("../../../../services/salesRecordService.js", () => ({ salesRecordService: mocks.sales }));
vi.mock("../../../../services/purchaseRecordService.js", () => ({ purchaseRecordService: mocks.purchase }));

import SalesInputPage from "../SalesInputPage.jsx";
import PurchaseInputPage from "../PurchaseInputPage.jsx";

const store = {
  outlets: [{ id: "outlet-1", name: "KL Central", code: "KLC" }],
  monthlyLocks: [], salesRecords: [], purchaseRecords: [], outletTaxConfigs: [],
  salesChannels: [{ id: "channel-1", name: "Dine In", type: "channel", status: "active" }],
  suppliers: [], purchaseCategories: [], employees: [],
};
const auth = { profile: { role_outlet_access_type: "all" }, hasPermission: (code) => ["sales_input.view", "purchase_input.view"].includes(code) };
const salesEditorAuth = { profile: { role_outlet_access_type: "all" }, hasPermission: (code) => ["sales_input.view", "sales_input.edit"].includes(code) };

beforeEach(() => {
  localStorage.setItem("salesPurchase.periodFilters", JSON.stringify({ outletId: "outlet-1", month: 8, year: 2026 }));
  mocks.sales.getSalesRecords.mockReset().mockResolvedValue([]);
  mocks.sales.saveSalesRecords.mockReset();
  mocks.purchase.getPurchaseRecords.mockReset().mockResolvedValue([]);
  mocks.purchase.savePurchaseRecords.mockReset();
});
afterEach(cleanup);

describe("monthly save mounted permission boundary", () => {
  it("keeps Sales monthly persistence unreachable for a view-only permission profile", async () => {
    render(<SalesInputPage store={store} setStore={vi.fn()} ui={{ notify: vi.fn() }} auth={auth} />);
    await screen.findByRole("heading", { name: "Sales Input" });
    expect(screen.queryByRole("button", { name: /Save Sales Data/ })).toBeNull();
    expect(mocks.sales.saveSalesRecords).not.toHaveBeenCalled();
  });

  it("keeps Purchase monthly persistence unreachable for a view-only permission profile", async () => {
    render(<PurchaseInputPage store={store} setStore={vi.fn()} ui={{ notify: vi.fn(), confirm: vi.fn() }} auth={auth} />);
    await screen.findByText("Read-only access");
    expect(screen.queryByRole("button", { name: /Save Purchase Data/ })).toBeNull();
    expect(mocks.purchase.savePurchaseRecords).not.toHaveBeenCalled();
  });

  it("Sales submits one request ID and applies the canonical period returned by the trusted snapshot RPC", async () => {
    mocks.sales.saveSalesRecords.mockResolvedValueOnce([{
      id: "sales-1", outlet_id: "outlet-1", year: 2026, month: 8,
      channel_id: "channel-1", channel_name: "Dine In", amount: 125, remark: "canonical",
    }]);
    render(<SalesInputPage store={store} setStore={vi.fn()} ui={{ notify: vi.fn() }} auth={salesEditorAuth} />);
    await screen.findByRole("heading", { name: "Sales Input" });
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Sales Data/ }));
    await waitFor(() => expect(mocks.sales.saveSalesRecords).toHaveBeenCalledTimes(1));
    expect(mocks.sales.saveSalesRecords).toHaveBeenCalledWith(
      "outlet-1", 2026, 8,
      [expect.objectContaining({ channel_id: "channel-1", channel_name: "Dine In", amount: 125 })],
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    await waitFor(() => expect(screen.getAllByText(/Saved successfully/).length).toBeGreaterThan(0));
    expect(screen.getByDisplayValue("125")).toBeTruthy();
  });

  it("Sales preserves the same request ID for a retry after an RPC failure", async () => {
    mocks.sales.saveSalesRecords
      .mockRejectedValueOnce(new Error("snapshot unavailable"))
      .mockResolvedValueOnce([]);
    render(<SalesInputPage store={store} setStore={vi.fn()} ui={{ notify: vi.fn() }} auth={salesEditorAuth} />);
    await screen.findByRole("heading", { name: "Sales Input" });
    const saveButton = screen.getByRole("button", { name: /Save Sales Data/ });
    fireEvent.click(saveButton);
    await waitFor(() => expect(mocks.sales.saveSalesRecords).toHaveBeenCalledTimes(1));
    fireEvent.click(saveButton);
    await waitFor(() => expect(mocks.sales.saveSalesRecords).toHaveBeenCalledTimes(2));
    expect(mocks.sales.saveSalesRecords.mock.calls[1][4]).toBe(mocks.sales.saveSalesRecords.mock.calls[0][4]);
  });

  it("Sales keeps the existing in-flight submit guard while the snapshot RPC is pending", async () => {
    let resolveSave;
    mocks.sales.saveSalesRecords.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    render(<SalesInputPage store={store} setStore={vi.fn()} ui={{ notify: vi.fn() }} auth={salesEditorAuth} />);
    await screen.findByRole("heading", { name: "Sales Input" });
    const saveButton = screen.getByRole("button", { name: /Save Sales Data/ });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    await waitFor(() => expect(mocks.sales.saveSalesRecords).toHaveBeenCalledTimes(1));
    resolveSave([]);
    await waitFor(() => expect(saveButton.disabled).toBe(false));
  });
});
