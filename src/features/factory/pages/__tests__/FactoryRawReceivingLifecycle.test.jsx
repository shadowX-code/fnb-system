import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryService } from "../../../../services/factoryService.js";
import FactoryWorkspacePage from "../FactoryWorkspacePage.jsx";

const receiving = {
  id: "receiving-1", batch_no: "R-1", status: "draft", received_date: "2026-08-09",
  supplier_name: "Supplier", supplier_id: "supplier-1",
  items: [{ raw_material_id: "rm-1", received_qty: 2, uom: "kg" }],
};
const allReceivingPermissions = [
  "factory_raw_receiving.view", "factory_raw_receiving.create",
  "factory_raw_receiving.edit", "factory_raw_receiving.delete",
];
function makeAuth(permissions = allReceivingPermissions) {
  return { permissions, hasPermission: (key) => permissions.includes(key), profile: { id: "employee-1", nickname: "Isaac" } };
}
const baseData = {
  jobOrders: [], rawMaterials: [{ id: "rm-1", name: "Chili", name_en: "Chili", uom: "kg", status: "active" }],
  rawMaterialCategories: [], rawMaterialMovements: [], factorySuppliers: [{ id: "supplier-1", supplier_name: "Supplier", status: "active" }],
  factoryCustomers: [], storageLocations: [{ id: "loc-1", location_name: "Raw Store", location_type: "Raw Material Area", status: "active" }],
  productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [],
  rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], qcChecklistTemplates: [], auditLogs: [], accessIssues: [],
};

function mount({ ui = { confirm: vi.fn().mockResolvedValue(true), notify: vi.fn() }, auth = makeAuth(), batch = receiving } = {}) {
  const data = { ...baseData, receivings: [batch], receivingBatches: [batch] };
  const loadData = vi.spyOn(factoryService, "listFactoryData").mockResolvedValue(data);
  const listing = vi.spyOn(factoryService, "listFactoryListingPage").mockResolvedValue({ rows: [batch], summary: {}, totalCount: 1, page: 1, pageSize: 20 });
  vi.spyOn(factoryService, "getRawMaterialReceivingNoPreview").mockResolvedValue("R-NEW");
  vi.spyOn(factoryService, "getRawMaterialReceivingDefaults").mockResolvedValue({
    uom: "kg", storage_location_id: "loc-1", storage_location: "Raw Store",
    expiry_tracking_mode: "not_applicable", internal_batch_no: "R-NEW",
  });
  render(<FactoryWorkspacePage initialTab="raw-receiving" auth={auth} ui={ui} />);
  return { listing, loadData };
}

function historyRow(batchNo = "R-1") {
  return screen.getAllByText(batchNo).map((node) => node.closest("tr")).find(Boolean);
}

async function prepareNew() {
  fireEvent.click(await screen.findByRole("button", { name: "Receive Raw Material" }));
  fireEvent.click(screen.getByRole("button", { name: "Supplier *" }));
  fireEvent.click(await screen.findByText("Supplier"));
  fireEvent.click(screen.getByRole("button", { name: "Select Raw Material" }));
  fireEvent.click(await screen.findByText("Chili"));
  await waitFor(() => expect(document.querySelector('[data-factory-row-field="receiving-qty"]')).not.toBeNull());
  fireEvent.change(document.querySelector('[data-factory-row-field="receiving-qty"]'), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Supplier DO / Invoice No." }), { target: { value: "DO-1" } });
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Factory Raw Receiving mounted lifecycle", () => {
  it("completes an eligible draft once through the Workspace and refreshes receiving history", async () => {
    const { listing } = mount();
    const save = vi.spyOn(factoryService, "saveRawMaterialReceivingBatch").mockResolvedValue({ ...receiving, status: "completed" });
    await screen.findAllByText("R-1");
    fireEvent.click(within(historyRow()).getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(receiving, { complete: true }));
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("cancels an eligible draft once and refreshes receiving history", async () => {
    const { listing } = mount();
    const cancel = vi.spyOn(factoryService, "cancelRawMaterialReceivingBatch").mockResolvedValue({ ...receiving, status: "cancelled" });
    await screen.findAllByText("R-1");
    fireEvent.click(within(historyRow()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(receiving));
    expect(cancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("opens the real new-entry panel only for the create permission", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Receive Raw Material" }));
    expect(screen.getByText("Receiving Items")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save Draft" })).not.toBeNull();
  });

  it("saves a new receiving draft through the mounted panel with one history refresh", async () => {
    const { listing, loadData } = mount();
    const save = vi.spyOn(factoryService, "saveRawMaterialReceivingBatch").mockResolvedValue({ ...receiving, id: "new", status: "draft" });
    const cancel = vi.spyOn(factoryService, "cancelRawMaterialReceivingBatch");
    await prepareNew();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      supplier_id: "supplier-1", reference_no: "DO-1", received_date: expect.any(String),
      items: [expect.objectContaining({
        raw_material_id: "rm-1", received_qty: "2", uom: "kg", storage_location_id: "loc-1",
        internal_batch_no: "R-NEW", expiry_tracking_mode: "not_applicable", expiry_source: "not_applicable", expiry_date: "",
      })],
    }), { complete: false });
    expect(save.mock.calls[0][0].completion_request_id).toEqual(expect.any(String));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Receiving Items")).toBeNull());
  });

  it("directly completes a new receiving through the mounted panel with one history refresh", async () => {
    const { listing, loadData } = mount();
    const save = vi.spyOn(factoryService, "saveRawMaterialReceivingBatch").mockResolvedValue({ ...receiving, id: "new", status: "completed" });
    const cancel = vi.spyOn(factoryService, "cancelRawMaterialReceivingBatch");
    await prepareNew();
    fireEvent.click(screen.getByRole("button", { name: "Complete Receiving" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      supplier_id: "supplier-1", reference_no: "DO-1", received_date: expect.any(String),
      items: [expect.objectContaining({
        raw_material_id: "rm-1", received_qty: "2", uom: "kg", storage_location_id: "loc-1",
        internal_batch_no: "R-NEW", expiry_tracking_mode: "not_applicable", expiry_source: "not_applicable", expiry_date: "",
      })],
    }), { complete: true });
    expect(save.mock.calls[0][0].completion_request_id).toEqual(expect.any(String));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
    expect(loadData).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Receiving Items")).toBeNull());
  });

  it("keeps a rejected new draft open and retryable without a successful refresh", async () => {
    const notify = vi.fn();
    const { listing, loadData } = mount({ ui: { confirm: vi.fn().mockResolvedValue(true), notify } });
    const save = vi.spyOn(factoryService, "saveRawMaterialReceivingBatch")
      .mockRejectedValueOnce(new Error("reject"))
      .mockResolvedValue({ ...receiving, id: "new", status: "draft" });
    await prepareNew();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Receiving Items")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save Draft" }).disabled).toBe(false);
    expect(listing).toHaveBeenCalledTimes(1);
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to save receiving Draft", tone: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("deduplicates rapid repeated Save Draft submissions while the first request is pending", async () => {
    const pending = deferred();
    const { listing } = mount();
    const save = vi.spyOn(factoryService, "saveRawMaterialReceivingBatch").mockReturnValue(pending.promise);
    await prepareNew();
    const saveButton = screen.getByRole("button", { name: "Save Draft" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    pending.resolve({ ...receiving, id: "new", status: "draft" });
    await waitFor(() => expect(listing).toHaveBeenCalledTimes(2));
  });

  it("hides new receiving, complete, and cancel actions when their current permissions are absent", async () => {
    mount({ auth: makeAuth(["factory_raw_receiving.view"]) });
    await screen.findAllByText("R-1");
    expect(screen.queryByRole("button", { name: "Receive Raw Material" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("hides draft-only receiving actions after a batch is completed", async () => {
    mount({ batch: { ...receiving, status: "completed" } });
    await screen.findAllByText("R-1");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
