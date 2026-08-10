import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: {
    listCategories: vi.fn(), listAssets: vi.fn(), listMovementLogs: vi.fn(), listInspections: vi.fn(), listMaintenanceRecords: vi.fn(),
    adjustQuantity: vi.fn(), submitInspection: vi.fn(), saveMaintenanceRecord: vi.fn(), saveAsset: vi.fn(), importAssetRow: vi.fn(), logImportMovement: vi.fn(),
    saveCategory: vi.fn(), archiveCategory: vi.fn(), reorderCategories: vi.fn(), updateInspectionStatus: vi.fn(), deleteInspection: vi.fn(), archiveAsset: vi.fn(), updateAssetCondition: vi.fn(),
  },
}));

vi.mock("../../../../services/assetTrackingService.js", () => ({ assetTrackingService: mocks.service }));
vi.mock("../../../../lib/supabase.ts", () => ({ supabase: { from: vi.fn(() => ({ select: vi.fn(() => ({ or: vi.fn(async () => ({ data: [], error: null })) })) })) } }));

import AssetTrackingPage from "../AssetTrackingPage.jsx";

const asset = {
  id: "asset-1", outlet_id: "outlet-1", category_id: "category-1", category_name: "Kitchen", name: "Mixer", current_quantity: 10,
  minimum_quantity: 1, unit: "unit", condition: "healthy", status: "active", maintenance_allowed: true,
};

function auth(permissions = []) {
  return { profile: { id: "employee-1", full_name: "Operator", role_outlet_access_type: "all" }, user: { id: "auth-1", email: "operator@test" }, hasPermission: (code) => permissions.includes(code) };
}

function mount(permissions) {
  const ui = { notify: vi.fn(), confirm: vi.fn() };
  render(<AssetTrackingPage store={{ outlets: [{ id: "outlet-1", code: "KLC", name: "KL Central", status: "active" }] }} ui={ui} auth={auth(permissions)} />);
  return ui;
}

beforeEach(() => {
  Object.values(mocks.service).forEach((mock) => mock.mockReset());
  mocks.service.listCategories.mockResolvedValue([{ id: "category-1", name: "Kitchen", is_active: true }]);
  mocks.service.listAssets.mockResolvedValue([asset]);
  mocks.service.listMovementLogs.mockResolvedValue([]);
  mocks.service.listInspections.mockResolvedValue([]);
  mocks.service.listMaintenanceRecords.mockResolvedValue([]);
  mocks.service.adjustQuantity.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("Asset Tracking page lifecycle guards", () => {
  it("keeps view-only Asset Tracking read-only and does not expose lifecycle actions", async () => {
    mount(["asset_tracking.view"]);
    await screen.findByText("Mixer");

    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Inspection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Asset" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Mixer" }));
    expect(screen.queryByText("Adjust Quantity")).toBeNull();
    expect(mocks.service.adjustQuantity).not.toHaveBeenCalled();
  });

  it("uses asset_tracking.manage for the mounted adjustment action and prevents a second click while saving", async () => {
    let resolveAdjustment;
    mocks.service.adjustQuantity.mockImplementationOnce(() => new Promise((resolve) => { resolveAdjustment = resolve; }));
    mount(["asset_tracking.view", "asset_tracking.manage"]);
    await screen.findByText("Mixer");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Mixer" }));
    fireEvent.click(screen.getByText("Adjust Quantity"));

    const confirm = screen.getByRole("button", { name: "Confirm Adjustment" });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.service.adjustQuantity).toHaveBeenCalledTimes(1));
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mocks.service.adjustQuantity).toHaveBeenCalledTimes(1);
    expect(mocks.service.adjustQuantity).toHaveBeenCalledWith(asset, expect.objectContaining({ type: "add", quantity: 1 }));
    resolveAdjustment();
  });

  it("keeps the mounted adjustment modal usable after a rejected service call and does not refresh as success", async () => {
    mocks.service.adjustQuantity.mockRejectedValueOnce(new Error("movement insert failed")).mockResolvedValueOnce(undefined);
    const ui = mount(["asset_tracking.view", "asset_tracking.manage"]);
    await screen.findByText("Mixer");
    fireEvent.click(screen.getByRole("button", { name: "More actions for Mixer" }));
    fireEvent.click(screen.getByText("Adjust Quantity"));

    const confirm = screen.getByRole("button", { name: "Confirm Adjustment" });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(screen.getByRole("heading", { name: "Adjust Quantity" })).toBeTruthy();
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to adjust quantity", tone: "error" }));
    expect(mocks.service.listAssets).toHaveBeenCalledTimes(1);

    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.service.adjustQuantity).toHaveBeenCalledTimes(2));
  });

  it("submits the mounted inspection through the parent-owned trusted service bridge once and refreshes only after success", async () => {
    let resolveInspection;
    mocks.service.submitInspection.mockImplementationOnce(() => new Promise((resolve) => { resolveInspection = resolve; }));
    mount(["asset_tracking.view", "asset_tracking.manage"]);
    await screen.findByText("Mixer");
    fireEvent.click(screen.getByRole("button", { name: "Start Inspection" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue Checklist" }));
    fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
    const submit = screen.getByRole("button", { name: "Submit Inspection" });
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.service.submitInspection).toHaveBeenCalledTimes(1));
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.service.submitInspection).toHaveBeenCalledTimes(1);
    expect(mocks.service.submitInspection).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String), status: "completed", outletId: "outlet-1" }));
    resolveInspection({ inspection_id: "inspection-1" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Asset Inspection Audit" })).toBeNull());
    expect(mocks.service.listAssets).toHaveBeenCalledTimes(2);
  });

  it("keeps the inspection modal retryable after trusted RPC rejection without a false refresh", async () => {
    mocks.service.submitInspection.mockRejectedValueOnce(new Error("inspection transaction rejected")).mockResolvedValueOnce({ inspection_id: "inspection-1" });
    const ui = mount(["asset_tracking.view", "asset_tracking.manage"]);
    await screen.findByText("Mixer");
    fireEvent.click(screen.getByRole("button", { name: "Start Inspection" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue Checklist" }));
    fireEvent.click(screen.getByRole("button", { name: "Review & Submit" }));
    const submit = screen.getByRole("button", { name: "Submit Inspection" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Unable to submit inspection", tone: "error" }));
    expect(mocks.service.listAssets).toHaveBeenCalledTimes(1);
    const requestId = mocks.service.submitInspection.mock.calls[0][0].requestId;
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.service.submitInspection).toHaveBeenCalledTimes(2));
    expect(mocks.service.submitInspection.mock.calls[1][0].requestId).toBe(requestId);
  });

  it("keeps current import progress when an atomic row RPC succeeds", async () => {
    mocks.service.importAssetRow.mockResolvedValue({ asset: { id: "imported-asset", current_quantity: 4 } });
    const ui = mount(["asset_tracking.view", "asset_tracking.create"]);
    await screen.findByText("Mixer");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("heading", { name: "Import Assets" });

    const file = new File([""], "assets.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => "Asset Name,Asset Code,Outlet Code,Category,Quantity,Minimum Quantity,Condition,Location,Purchase Date,Warranty Expiry,Status,Description,Notes\nImported Mixer,AST-2,KLC,Kitchen,4,1,Good,Store,,,Active,Imported asset," });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await screen.findByText("Imported Mixer");
    fireEvent.click(screen.getByRole("button", { name: "Confirm Import" }));

    await waitFor(() => expect(mocks.service.importAssetRow).toHaveBeenCalledTimes(1));
    expect(mocks.service.importAssetRow).toHaveBeenCalledWith(expect.objectContaining({ current_quantity: 4 }), expect.objectContaining({ action: "create", requestId: expect.any(String) }));
    expect(screen.getByText(/Import complete: 1 created/)).toBeTruthy();
    expect(ui.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Asset import completed" }));
  });
});
