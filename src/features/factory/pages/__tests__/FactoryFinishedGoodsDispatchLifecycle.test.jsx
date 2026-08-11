import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const dispatch = {
  id: "dispatch-1", dispatch_no: "D-1", status: "draft", dispatch_date: "2026-08-09",
  customer_id: "customer-1", customer_name: "Outlet", items_count: 1, total_qty: 2,
  items: [{ finished_good_id: "sku-1", quantity: 2, allocations: [{ batch_balance_id: "batch-1", quantity: 2 }] }],
};
const allDispatchPermissions = [
  "factory_finished_goods_dispatch.view", "factory_finished_goods_dispatch.create",
  "factory_finished_goods_dispatch.edit", "factory_finished_goods_dispatch.complete",
  "factory_finished_goods_dispatch.delete",
];
function makeAuth(permissions = allDispatchPermissions) {
  return { permissions, hasPermission: (key) => permissions.includes(key), profile: { id: "employee-1", nickname: "Isaac" } };
}
const baseData = {
  jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [],
  factorySuppliers: [], factoryCustomers: [{ id: "customer-1", customer_name: "Outlet", status: "active" }], storageLocations: [], productions: [],
  finishedGoods: [{ id: "sku-1", product_name: "Sambal", status: "active", product_code: "SKU", current_balance: 5 }],
  finishedGoodCategories: [], productFamilies: [], productMovements: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [],
  qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};
const batchAvailability = {
  finished_good_id: "sku-1", aggregate_balance: 5, allocatable_batch_balance: 5, unavailable_balance: 0,
  batches: [{ batch_id: "batch-1", batch_no: "B-1", available_qty: 5, location_valid: true, storage_location: "Finished Goods", storage_location_type: "Finished Goods Area", expiry_date: "", manufacturing_date: "2026-08-01" }],
  unavailable_batches: [],
};

function mount({ ui = { confirm: vi.fn().mockResolvedValue(true), notify: vi.fn() }, auth = makeAuth(), record = dispatch } = {}) {
  const data = { ...baseData, finishedGoodDispatches: [record] };
  const loadData = vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  const listing = vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [record], summary: { draft: record.status === "draft" ? 1 : 0 }, totalCount: 1, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "getFinishedGoodDispatchNoPreview").mockResolvedValue("D-NEW");
  vi.spyOn(factoryService, "getFinishedGoodBatchAvailability").mockResolvedValue(batchAvailability);
  render(<FactoryWorkspacePage initialTab="finished-goods-dispatch" auth={auth} ui={ui} />);
  return { listing, loadData };
}

function historyRow(dispatchNo = "D-1") {
  return screen.getAllByText(dispatchNo).map((node) => node.closest("tr")).find(Boolean);
}

async function prepareNew({ allocate = false } = {}) {
  fireEvent.click(await screen.findByRole("button", { name: "Create Dispatch" }));
  fireEvent.click(screen.getByRole("button", { name: "Customer *" }));
  fireEvent.click(await screen.findByText("Outlet"));
  fireEvent.click(screen.getByRole("button", { name: "Packaging SKU" }));
  fireEvent.click(await screen.findByText("SKU · Sambal"));
  await waitFor(() => expect(document.querySelector('[data-factory-row-field="dispatch-qty"]')).not.toBeNull());
  const quantityInput = document.querySelector('[data-factory-row-field="dispatch-qty"]');
  fireEvent.change(quantityInput, { target: { value: "2" } });
  if (!allocate) return;
  fireEvent.blur(quantityInput);
  await screen.findByRole("heading", { name: "Batch Allocation" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply Allocation" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Apply Allocation" }));
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Finished Goods Dispatch mounted lifecycle", () => {
  it("completes an eligible draft once and refreshes dispatch history plus Factory data", async () => {
    const { listing, loadData } = mount();
    const complete = vi.spyOn(factoryService, "completeFinishedGoodDispatch").mockResolvedValue({ ...dispatch, status: "completed" });
    await screen.findAllByText("D-1");
    fireEvent.click(within(historyRow()).getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(dispatch));
    expect(complete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadData).toHaveBeenCalledTimes(2));
  });

  it("cancels an eligible draft once and refreshes only dispatch history", async () => {
    const { listing, loadData } = mount();
    const cancel = vi.spyOn(factoryService, "cancelFinishedGoodDispatch").mockResolvedValue({ ...dispatch, status: "cancelled" });
    await screen.findAllByText("D-1");
    fireEvent.click(within(historyRow()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(dispatch));
    expect(cancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it("saves a new dispatch draft through the mounted form with one history refresh", async () => {
    const { listing, loadData } = mount();
    const save = vi.spyOn(factoryService, "saveFinishedGoodDispatch").mockResolvedValue({ ...dispatch, id: "new", dispatch_no: "D-NEW", status: "draft" });
    const complete = vi.spyOn(factoryService, "saveAndCompleteFinishedGoodDispatch");
    const cancel = vi.spyOn(factoryService, "cancelFinishedGoodDispatch");
    await prepareNew();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: "customer-1", customer_name: "Outlet", dispatch_date: expect.any(String), status: "draft",
      completion_request_id: expect.any(String),
      items: [expect.objectContaining({ finished_good_id: "sku-1", quantity: "2", allocations: [] })],
    }));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Dispatch Items")).toBeNull());
  });

  it("directly completes a new dispatch with its caller-owned request ID and batch allocation", async () => {
    const { listing, loadData } = mount();
    const complete = vi.spyOn(factoryService, "saveAndCompleteFinishedGoodDispatch").mockResolvedValue({ ...dispatch, id: "new", dispatch_no: "D-NEW", status: "completed" });
    const save = vi.spyOn(factoryService, "saveFinishedGoodDispatch");
    const cancel = vi.spyOn(factoryService, "cancelFinishedGoodDispatch");
    await prepareNew({ allocate: true });
    fireEvent.click(screen.getByRole("button", { name: "Complete Dispatch" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: "customer-1", customer_name: "Outlet", dispatch_date: expect.any(String),
      completion_request_id: expect.any(String),
      items: [expect.objectContaining({ finished_good_id: "sku-1", quantity: "2", allocations: [expect.objectContaining({ batch_id: "batch-1", batch_no: "B-1", quantity: 2 })] })],
    }));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadData).toHaveBeenCalledTimes(2));
    expect(save).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(screen.getByText("Completed finished goods dispatch record.")).not.toBeNull();
  });

  it("keeps a rejected new dispatch completion open and retryable without a successful refresh", async () => {
    const notify = vi.fn();
    const { listing, loadData } = mount({ ui: { confirm: vi.fn().mockResolvedValue(true), notify } });
    const complete = vi.spyOn(factoryService, "saveAndCompleteFinishedGoodDispatch")
      .mockRejectedValueOnce(new Error("reject"))
      .mockResolvedValue({ ...dispatch, id: "new", dispatch_no: "D-NEW", status: "completed" });
    await prepareNew({ allocate: true });
    fireEvent.click(screen.getByRole("button", { name: "Complete Dispatch" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Dispatch Items")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Complete Dispatch" }).disabled).toBe(false);
    expect(listing).toHaveBeenCalledTimes(1);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to complete dispatch", tone: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Dispatch" }));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(loadData).toHaveBeenCalledTimes(2));
  });

  it("keeps a rejected new draft open and retryable without a successful refresh", async () => {
    const notify = vi.fn();
    const { listing, loadData } = mount({ ui: { confirm: vi.fn().mockResolvedValue(true), notify } });
    const save = vi.spyOn(factoryService, "saveFinishedGoodDispatch")
      .mockRejectedValueOnce(new Error("reject"))
      .mockResolvedValue({ ...dispatch, id: "new", dispatch_no: "D-NEW", status: "draft" });
    await prepareNew();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Dispatch Items")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save Draft" }).disabled).toBe(false);
    expect(listing).toHaveBeenCalledTimes(1);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save dispatch", tone: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("deduplicates rapid repeated Save Draft submissions while the first request is pending", async () => {
    const pending = deferred();
    const { listing } = mount();
    const save = vi.spyOn(factoryService, "saveFinishedGoodDispatch").mockReturnValue(pending.promise);
    await prepareNew();
    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    pending.resolve({ ...dispatch, id: "new", dispatch_no: "D-NEW", status: "draft" });
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("hides or disables current dispatch actions when create, complete, and delete permissions are absent", async () => {
    mount({ auth: makeAuth(["factory_finished_goods_dispatch.view"]) });
    await screen.findAllByText("D-1");
    expect(screen.getByRole("button", { name: "Create Dispatch" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("hides draft-only edit, complete, and cancel actions after a dispatch is completed", async () => {
    mount({ record: { ...dispatch, status: "completed" } });
    await screen.findAllByText("D-1");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
