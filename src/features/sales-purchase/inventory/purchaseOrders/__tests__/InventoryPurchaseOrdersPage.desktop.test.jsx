import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InventoryPurchaseOrdersPage from "../InventoryPurchaseOrdersPage.jsx";

const order = {
  id: "po-1",
  poNo: "INT-PO-001",
  supplierId: "supplier-1",
  outletId: "outlet-1",
  status: "partial_received",
  sourceType: "stock_check",
  createdAt: "2026-08-09T08:00:00.000Z",
  lines: [
    { id: "line-1", itemId: "item-1", requestedQty: 10, receivedQty: 4, unit: "kg" },
    { id: "line-2", itemId: "item-2", requestedQty: 5, receivedQty: 1, unit: "kg" },
  ],
};

const filterOrders = [
  order,
  {
    id: "po-2",
    poNo: "INT-PO-002",
    supplierId: "supplier-2",
    outletId: "outlet-2",
    status: "draft",
    sourceType: "manual",
    createdAt: "2026-08-10T08:00:00.000Z",
    lines: [{ id: "line-3", itemId: "item-4", requestedQty: 8, receivedQty: 0, unit: "kg" }],
  },
  {
    id: "po-3",
    poNo: "INT-PO-003",
    supplierId: "supplier-2",
    outletId: "outlet-1",
    status: "submitted",
    sourceType: "manual",
    createdAt: "2026-08-11T08:00:00.000Z",
    lines: [{ id: "line-4", itemId: "item-3", requestedQty: 6, receivedQty: 0, unit: "kg" }],
  },
];

const statusOrders = [
  { ...order, id: "po-draft", poNo: "INT-DRAFT", status: "draft", lines: [{ id: "draft-line", itemId: "item-1", requestedQty: 10, receivedQty: 0 }] },
  { ...order, id: "po-submitted", poNo: "INT-SUBMITTED", status: "submitted", lines: [{ id: "submitted-line", itemId: "item-1", requestedQty: 10, receivedQty: 0 }] },
  { ...order, id: "po-confirmed", poNo: "INT-CONFIRMED", status: "supplier_confirmed", lines: [{ id: "confirmed-line", itemId: "item-1", requestedQty: 10, receivedQty: 0 }] },
  { ...order, id: "po-partial", poNo: "INT-PARTIAL", status: "partial_received", lines: [{ id: "partial-line", itemId: "item-1", requestedQty: 10, receivedQty: 4 }] },
  { ...order, id: "po-full", poNo: "INT-FULL", status: "fully_received", lines: [{ id: "full-line", itemId: "item-1", requestedQty: 10, receivedQty: 10 }] },
  { ...order, id: "po-completed", poNo: "INT-COMPLETED", status: "completed", lines: [{ id: "completed-line", itemId: "item-1", requestedQty: 10, receivedQty: 10 }] },
  { ...order, id: "po-cancelled", poNo: "INT-CANCELLED", status: "cancelled", lines: [{ id: "cancelled-line", itemId: "item-1", requestedQty: 10, receivedQty: 0 }] },
];

function mount({ orders = [order] } = {}) {
  const callbacks = {
    onRequestEdit: vi.fn(), onSubmit: vi.fn(), onConfirm: vi.fn(), onRequestReceive: vi.fn(), onComplete: vi.fn(), onCancel: vi.fn(), onView: vi.fn(), onCopyPurchaseOrder: vi.fn(),
  };
  render(<InventoryPurchaseOrdersPage
    orders={orders}
    items={[{ id: "item-1", name: "Dried Chilli" }, { id: "item-2", name: "Coconut Milk" }, { id: "item-3", name: "Tomato Paste" }, { id: "item-4", name: "Coconut Cream" }]}
    suppliers={[{ id: "supplier-1", name: "Chilli Supplier" }, { id: "supplier-2", name: "Coconut Supplier" }]}
    outletOptions={[{ value: "all", label: "All outlets" }, { value: "outlet-1", label: "KL Central" }, { value: "outlet-2", label: "PJ Hub" }]}
    outletById={new Map([["outlet-1", { name: "KL Central" }], ["outlet-2", { name: "PJ Hub" }]])}
    getBusinessPoNo={(entry) => `PO-2026-${String(entry.id.split("-").pop()).padStart(3, "0")}`}
    formatDate={(value) => ({ "2026-08-09T08:00:00.000Z": "09 Aug 2026", "2026-08-10T08:00:00.000Z": "10 Aug 2026", "2026-08-11T08:00:00.000Z": "11 Aug 2026" }[value] || "10 Aug 2026")}
    todayInput={() => "2026-08-10"}
    statusTone={() => "warning"}
    {...callbacks}
  />);
  return callbacks;
}

function select(currentLabel, optionLabel) {
  fireEvent.click(screen.getByRole("button", { name: currentLabel }));
  fireEvent.click(screen.getByRole("button", { name: optionLabel }));
}

function expectVisible(...poNos) {
  for (const poNo of poNos) expect(screen.getAllByTitle(`Internal system ID: ${poNo}`)).toHaveLength(2);
  for (const poNo of ["INT-PO-001", "INT-PO-002", "INT-PO-003"].filter((entry) => !poNos.includes(entry))) expect(screen.queryAllByTitle(`Internal system ID: ${poNo}`)).toHaveLength(0);
}

function actionRow(table, poNo) {
  return within(table).getByTitle(`Internal system ID: ${poNo}`).closest("tr");
}

function actionNames(row) {
  return within(row).getAllByRole("button").map((button) => button.textContent.trim());
}

function mobileCard(poNo) {
  const marker = screen.getAllByTitle(`Internal system ID: ${poNo}`).find((node) => node.tagName === "DIV");
  return marker.closest(".rounded-2xl");
}

describe("InventoryPurchaseOrdersPage desktop table", () => {
  it("faithfully presents the active PO desktop table data columns", () => {
    mount();
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(["Business PO No.", "Supplier", "Outlet", "Items", "Received Progress", "Status", "Source", "Created Date", "Actions"]);
    const row = within(table).getByTitle("Internal system ID: INT-PO-001").closest("tr");
    expect(within(row).getByText("PO-2026-001")).toBeTruthy();
    expect(within(row).getByText("Chilli Supplier")).toBeTruthy();
    expect(within(row).getByText("KL Central")).toBeTruthy();
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(row).getByText("5 / 15")).toBeTruthy();
    expect(within(row).getByText("Partial Received")).toBeTruthy();
    expect(within(row).getByText("Stock Check")).toBeTruthy();
    expect(within(row).getByText("09 Aug 2026")).toBeTruthy();
  });

  it("matches the active PO outlet, supplier, status, source, date, search, and combined filter semantics", () => {
    mount({ orders: filterOrders });
    expectVisible("INT-PO-001", "INT-PO-002", "INT-PO-003");

    select("All outlets", "PJ Hub");
    expectVisible("INT-PO-002");
    select("PJ Hub", "All outlets");

    select("All Suppliers", "Coconut Supplier");
    expectVisible("INT-PO-002", "INT-PO-003");
    select("Coconut Supplier", "All Suppliers");

    select("All Status", "Partial Received");
    expectVisible("INT-PO-001");
    select("Partial Received", "All Status");

    select("All Sources", "Stock Check");
    expectVisible("INT-PO-001");
    select("Stock Check", "All Sources");

    const [from, to] = screen.getAllByPlaceholderText("28 May 2026");
    fireEvent.change(from, { target: { value: "10 Aug 2026" } });
    fireEvent.change(to, { target: { value: "10 Aug 2026" } });
    expectVisible("INT-PO-002");
    fireEvent.change(from, { target: { value: "" } });
    fireEvent.change(to, { target: { value: "" } });

    fireEvent.change(screen.getByPlaceholderText("Search business PO no, internal ID, supplier or item"), { target: { value: "  coconut cream  " } });
    expectVisible("INT-PO-002");
    fireEvent.change(screen.getByPlaceholderText("Search business PO no, internal ID, supplier or item"), { target: { value: "PO-2026-002" } });
    select("All outlets", "PJ Hub");
    select("All Sources", "Manual");
    expectVisible("INT-PO-002");
  });

  it("matches the active desktop action surface and delegates every lifecycle intent through bounded callbacks", () => {
    const callbacks = mount({ orders: statusOrders });
    const table = screen.getByRole("table");
    const draft = actionRow(table, "INT-DRAFT");
    const submitted = actionRow(table, "INT-SUBMITTED");
    const confirmed = actionRow(table, "INT-CONFIRMED");
    const partial = actionRow(table, "INT-PARTIAL");
    const full = actionRow(table, "INT-FULL");
    const completed = actionRow(table, "INT-COMPLETED");
    const cancelled = actionRow(table, "INT-CANCELLED");

    expect(actionNames(draft)).toEqual(["Submit Order", "View", "Copy Text", "Edit", "Cancel"]);
    expect(actionNames(submitted)).toEqual(["Receive", "View", "Copy Text", "Mark Confirmed", "Cancel"]);
    expect(actionNames(confirmed)).toEqual(["Receive", "View", "Copy Text", "Cancel"]);
    expect(actionNames(partial)).toEqual(["Receive More", "View", "Copy Text", "Complete PO"]);
    expect(actionNames(full)).toEqual(["Complete PO", "View", "Copy Text"]);
    expect(actionNames(completed)).toEqual(["View", "Copy Text"]);
    expect(actionNames(cancelled)).toEqual(["View", "Copy Text"]);

    fireEvent.click(within(draft).getByRole("button", { name: "Submit Order" }));
    fireEvent.click(within(draft).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(submitted).getByRole("button", { name: "Receive" }));
    fireEvent.click(within(submitted).getByRole("button", { name: "Mark Confirmed" }));
    fireEvent.click(within(confirmed).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(partial).getByRole("button", { name: "Receive More" }));
    fireEvent.click(within(partial).getByRole("button", { name: "Complete PO" }));
    fireEvent.click(within(completed).getByRole("button", { name: "View" }));
    fireEvent.click(within(cancelled).getByRole("button", { name: "Copy Text" }));

    expect(callbacks.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: "po-draft" }));
    expect(callbacks.onRequestEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "po-draft" }));
    expect(callbacks.onRequestReceive).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "po-submitted" }));
    expect(callbacks.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: "po-submitted" }));
    expect(callbacks.onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "po-confirmed" }));
    expect(callbacks.onRequestReceive).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "po-partial" }));
    expect(callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "po-partial" }));
    expect(callbacks.onView).toHaveBeenCalledWith(expect.objectContaining({ id: "po-completed" }));
    expect(callbacks.onCopyPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "po-cancelled" }));
  });

  it("matches the active mobile card fields, status-specific action surface, and bounded callback mapping", () => {
    const callbacks = mount({ orders: statusOrders });
    const draft = mobileCard("INT-DRAFT");
    const submitted = mobileCard("INT-SUBMITTED");
    const confirmed = mobileCard("INT-CONFIRMED");
    const partial = mobileCard("INT-PARTIAL");
    const full = mobileCard("INT-FULL");
    const completed = mobileCard("INT-COMPLETED");
    const cancelled = mobileCard("INT-CANCELLED");

    expect(within(partial).getByText("Supplier")).toBeTruthy();
    expect(within(partial).getByText("Chilli Supplier")).toBeTruthy();
    expect(within(partial).getByText("Outlet")).toBeTruthy();
    expect(within(partial).getByText("KL Central")).toBeTruthy();
    expect(within(partial).getByText("Source")).toBeTruthy();
    expect(within(partial).getByText("Stock Check")).toBeTruthy();
    expect(within(partial).getByText("Created Date")).toBeTruthy();
    expect(within(partial).getByText("09 Aug 2026")).toBeTruthy();
    expect(within(partial).getByText("Items received")).toBeTruthy();
    expect(within(partial).getByText("4 / 10")).toBeTruthy();
    expect(within(partial).getByText("40%")).toBeTruthy();

    expect(actionNames(draft)).toEqual(["Submit Order", "View", "Copy Text", "Edit", "Cancel"]);
    expect(actionNames(submitted)).toEqual(["Mark Confirmed", "View", "Copy Text", "Cancel"]);
    expect(actionNames(confirmed)).toEqual(["Receive", "View", "Copy Text", "Cancel"]);
    expect(actionNames(partial)).toEqual(["Receive More", "View", "Copy Text"]);
    expect(actionNames(full)).toEqual(["Complete PO", "View", "Copy Text"]);
    expect(actionNames(completed)).toEqual(["View", "Copy Text"]);
    expect(actionNames(cancelled)).toEqual(["View", "Copy Text"]);

    fireEvent.click(within(draft).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(submitted).getByRole("button", { name: "Mark Confirmed" }));
    fireEvent.click(within(confirmed).getByRole("button", { name: "Receive" }));
    fireEvent.click(within(partial).getByRole("button", { name: "Receive More" }));
    fireEvent.click(within(full).getByRole("button", { name: "Complete PO" }));
    fireEvent.click(within(completed).getByRole("button", { name: "View" }));
    fireEvent.click(within(cancelled).getByRole("button", { name: "Copy Text" }));

    expect(callbacks.onRequestEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "po-draft" }));
    expect(callbacks.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: "po-submitted" }));
    expect(callbacks.onRequestReceive).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "po-confirmed" }));
    expect(callbacks.onRequestReceive).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "po-partial" }));
    expect(callbacks.onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: "po-full" }));
    expect(callbacks.onView).toHaveBeenCalledWith(expect.objectContaining({ id: "po-completed" }));
    expect(callbacks.onCopyPurchaseOrder).toHaveBeenCalledWith(expect.objectContaining({ id: "po-cancelled" }));
  });
});

afterEach(cleanup);
