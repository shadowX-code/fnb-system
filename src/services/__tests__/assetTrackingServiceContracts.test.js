import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), audit: vi.fn(), upload: vi.fn(), removeStorage: vi.fn(), isImageDataUrl: vi.fn() }));

vi.mock("../../lib/supabase.ts", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "auth-1" } } })) },
    storage: { from: vi.fn(() => ({ remove: vi.fn(), upload: vi.fn(), getPublicUrl: vi.fn() })) },
  },
}));
vi.mock("../auditLogService.js", () => ({ auditLogService: { createAuditLog: mocks.audit } }));
vi.mock("../../utils/imageUpload.js", () => ({
  isImageDataUrl: mocks.isImageDataUrl,
  removeStorageObjectFromPublicUrl: mocks.removeStorage,
  uploadOptimizedDataUrl: mocks.upload,
}));

import { assetTrackingService } from "../assetTrackingService.js";

const asset = { id: "asset-1", outlet_id: "outlet-1", name: "Mixer", current_quantity: 10, minimum_quantity: 1, unit: "unit", condition: "healthy", status: "active" };
const inspection = {
  requestId: "inspection-request-1", outletId: "outlet-1", inspectionDate: "2026-08-10", checkedBy: "Untrusted display", checkedByEmployeeId: "untrusted-employee",
  categoryScope: { type: "all" }, status: "completed", summary: { completion_percentage: 100 }, currentStep: 3, draftData: { inspectionType: "routine_check" }, notes: "Daily check", remark: "Daily check",
  rows: [{ asset, counted_quantity: 7, condition_status: "damaged", evidence_required: true, evidence: [{ image_url: "https://evidence.test/crack.webp", caption: "Crack" }], remark: "Cracked bowl" }],
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.from.mockReset();
  mocks.audit.mockReset().mockResolvedValue(undefined);
  mocks.upload.mockReset();
  mocks.removeStorage.mockReset().mockResolvedValue({ removed: true });
  mocks.isImageDataUrl.mockReset().mockReturnValue(false);
  mocks.rpc.mockResolvedValue({ data: { inspection_id: "inspection-1", status: "completed" }, error: null });
});

describe("Asset Tracking trusted lifecycle RPC contracts", () => {
  it("does not expose obsolete import or condition-template mutation paths", () => {
    expect(assetTrackingService).not.toHaveProperty("logImportMovement");
    expect(assetTrackingService).not.toHaveProperty("listConditionTemplates");
    expect(assetTrackingService).not.toHaveProperty("saveConditionTemplate");
  });

  it("scopes inspection-item reads to the authorized inspection headers", async () => {
    const inspectionIds = ["inspection-1", "inspection-2"];
    const inspectionRows = inspectionIds.map((id) => ({ id, inspection_date: "2026-08-10", created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z" }));
    const itemRows = [{ id: "item-1", inspection_id: "inspection-1", asset_id: "asset-1", created_at: "2026-08-10T00:00:00Z" }];
    const inCalls = [];
    const chain = (result) => {
      const value = { select: () => value, order: () => value, eq: () => value, in: (column, ids) => { inCalls.push([column, ids]); return value; } };
      value.then = (resolve) => Promise.resolve(result).then(resolve);
      return value;
    };
    mocks.from.mockImplementation((table) => chain(table === "asset_inspections"
      ? { data: inspectionRows, error: null }
      : table === "asset_inspection_items"
        ? { data: itemRows, error: null }
        : { data: [], error: null }));

    await assetTrackingService.listInspections("", "outlet-1");
    expect(inCalls).toContainEqual(["inspection_id", inspectionIds]);
  });

  it("maps maintenance create and its condition transition to one trusted RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { record: { id: "maintenance-1", status: "in_progress" }, condition: "under_maintenance" }, error: null });
    await assetTrackingService.saveMaintenanceRecord(asset, { requestId: "maintenance-request-1", date: "2026-08-10", maintenance_type: "repair", priority: "high", issue: "Motor", action_taken: "Diagnosing", vendor: "Vendor", cost: 20, status: "in_progress", remark: "Urgent" });
    expect(mocks.rpc).toHaveBeenCalledWith("asset_save_maintenance", expect.objectContaining({
      p_request_id: "maintenance-request-1",
      p_payload: expect.objectContaining({ asset_id: "asset-1", outlet_id: "outlet-1", status: "in_progress", condition_intent: "under_maintenance", issue: "Motor" }),
    }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("maps maintenance edit through the same request-idempotent authority and surfaces rejection", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("maintenance transaction rejected") });
    await expect(assetTrackingService.saveMaintenanceRecord(asset, { id: "maintenance-1", requestId: "maintenance-edit-1", status: "completed", set_condition_good: true, issue: "Motor" })).rejects.toThrow("maintenance transaction rejected");
    expect(mocks.rpc).toHaveBeenCalledWith("asset_save_maintenance", expect.objectContaining({ p_request_id: "maintenance-edit-1", p_payload: expect.objectContaining({ id: "maintenance-1", condition_intent: "healthy" }) }));
  });

  it("maps a quantity-changing import row to its single trusted per-row RPC", async () => {
    await assetTrackingService.importAssetRow({ ...asset, id: "", asset_code: "AST-2", current_quantity: 4 }, { action: "create", requestId: "import-row-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("asset_import_row", expect.objectContaining({
      p_request_id: "import-row-1", p_action: "create", p_asset: expect.objectContaining({ outlet_id: "outlet-1", asset_code: "AST-2", current_quantity: 4 }),
    }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reuses an import row request ID so an uncertain retry has no second service path", async () => {
    await assetTrackingService.importAssetRow(asset, { action: "update", requestId: "import-row-stable" });
    await assetTrackingService.importAssetRow(asset, { action: "update", requestId: "import-row-stable" });
    expect(mocks.rpc.mock.calls.map(([, payload]) => payload.p_request_id)).toEqual(["import-row-stable", "import-row-stable"]);
  });

  it("maps quantity intent to the single trusted RPC without browser asset or movement DML", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { asset: { id: "asset-1", current_quantity: 7 }, movement: { id: "movement-1", quantity_change: -3 } }, error: null });

    await expect(assetTrackingService.adjustQuantity(asset, { requestId: "adjustment-request-1", type: "reduce", quantity: 3, reason: "broken", remark: "Cracked bowl", date: "2026-08-10" }))
      .resolves.toEqual(expect.objectContaining({ movement: expect.objectContaining({ quantity_change: -3 }) }));

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("asset_adjust_quantity", {
      p_request_id: "adjustment-request-1", p_asset_id: "asset-1", p_adjustment_type: "reduce", p_quantity: 3,
      p_reason: "broken", p_remark: "Cracked bowl", p_movement_date: "2026-08-10",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("preserves Crew employee attribution in the movement read model", async () => {
    const row = { id: "movement-1", asset_id: "asset-1", outlet_id: "outlet-1", movement_type: "correction", quantity_change: 0, quantity_before: 2, quantity_after: 2, reason: "stock_count", movement_date: "2026-09-17", created_by: null, created_by_employee_id: "employee-1", created_at: "2026-09-17T11:00:00Z" };
    const query = { select: () => query, order: () => query, eq: () => query, then: (resolve) => Promise.resolve({ data: [row], error: null }).then(resolve) };
    mocks.from.mockReturnValue(query);

    await expect(assetTrackingService.listMovementLogs("", "outlet-1")).resolves.toEqual([
      expect.objectContaining({ id: "movement-1", created_by: null, created_by_employee_id: "employee-1" }),
    ]);
  });

  it("reuses a supplied adjustment request ID for a safe ambiguous-network retry", async () => {
    await assetTrackingService.adjustQuantity(asset, { requestId: "stable-adjustment", type: "add", quantity: 2, reason: "add" });
    await assetTrackingService.adjustQuantity(asset, { requestId: "stable-adjustment", type: "add", quantity: 2, reason: "add" });

    expect(mocks.rpc.mock.calls.map(([, payload]) => payload.p_request_id)).toEqual(["stable-adjustment", "stable-adjustment"]);
  });

  it("surfaces trusted quantity RPC rejection without a false audit success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("insufficient quantity") });
    await expect(assetTrackingService.adjustQuantity(asset, { requestId: "failed-adjustment", type: "reduce", quantity: 99, reason: "broken" })).rejects.toThrow("insufficient quantity");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("maps ordinary inspection metadata, item intent, correction intent, and evidence references to one RPC", async () => {
    await assetTrackingService.submitInspection(inspection);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("asset_submit_inspection", {
      p_request_id: "inspection-request-1",
      p_payload: expect.objectContaining({
        draft_id: null, outlet_id: "outlet-1", inspection_date: "2026-08-10", status: "completed", apply_corrections: true,
        rows: [expect.objectContaining({ asset_id: "asset-1", expected_quantity: 10, counted_quantity: 7, difference: -3, condition_status: "damaged", evidence: [{ image_url: "https://evidence.test/crack.webp", caption: "Crack" }] })],
      }),
    });
  });

  it("uses the same supplied inspection request ID on retry and keeps upload outside the database RPC", async () => {
    await assetTrackingService.submitInspection(inspection);
    await assetTrackingService.submitInspection(inspection);
    expect(mocks.rpc.mock.calls.map(([, payload]) => payload.p_request_id)).toEqual(["inspection-request-1", "inspection-request-1"]);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("maps a draft save through the same trusted inspection authority without correction intent", async () => {
    await assetTrackingService.submitInspection({ ...inspection, requestId: "draft-request-1", status: "draft", applyCorrections: false });
    expect(mocks.rpc).toHaveBeenCalledWith("asset_submit_inspection", expect.objectContaining({
      p_request_id: "draft-request-1",
      p_payload: expect.objectContaining({ status: "draft", apply_corrections: false }),
    }));
  });

  it("archives drafts through the trusted authority and rejects non-archive direct status changes", async () => {
    await assetTrackingService.updateInspectionStatus("inspection-1", "archived", { requestId: "archive-request-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("asset_archive_inspection_draft", {
      p_request_id: "archive-request-1",
      p_inspection_id: "inspection-1",
    });
    await expect(assetTrackingService.updateInspectionStatus("inspection-1", "completed")).rejects.toThrow("Only resumable inspection drafts can be archived.");
  });

  it("uploads data-url evidence before the atomic database RPC and passes only its durable reference", async () => {
    mocks.isImageDataUrl.mockReturnValue(true);
    mocks.upload.mockResolvedValueOnce({ publicUrl: "https://storage.test/evidence.webp" });
    await assetTrackingService.submitInspection({ ...inspection, requestId: "uploaded-evidence", rows: [{ ...inspection.rows[0], evidence: [{ image_url: "data:image/webp;base64,abc", caption: "Crack" }] }] });
    expect(mocks.rpc).toHaveBeenCalledWith("asset_submit_inspection", expect.objectContaining({ p_payload: expect.objectContaining({ rows: [expect.objectContaining({ evidence: [{ image_url: "https://storage.test/evidence.webp", caption: "Crack" }] })] }) }));
  });

  it("surfaces inspection RPC rejection without browser multi-table fallback writes", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("inspection transaction rejected") });
    await expect(assetTrackingService.submitInspection({ ...inspection, requestId: "failed-inspection" })).rejects.toThrow("inspection transaction rejected");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not remove the current asset image when a staged replacement cannot be saved", async () => {
    mocks.isImageDataUrl.mockImplementation((value) => String(value || "").startsWith("data:"));
    mocks.upload.mockResolvedValueOnce({ publicUrl: "https://storage.test/new-image.webp" });
    const failedQuery = { eq: () => failedQuery, select: () => ({ single: async () => ({ data: null, error: new Error("asset write rejected") }) }) };
    mocks.from.mockReturnValue({ update: () => failedQuery });

    await expect(assetTrackingService.saveAsset({ ...asset, image_url: "data:image/webp;base64,new", thumbnail_url: "data:image/webp;base64,new", previous_image_url: "https://storage.test/old-image.webp" }))
      .rejects.toThrow("asset write rejected");

    expect(mocks.removeStorage).not.toHaveBeenCalled();
  });

  it("cleans up a replaced asset image only after its new reference is saved", async () => {
    mocks.isImageDataUrl.mockImplementation((value) => String(value || "").startsWith("data:"));
    mocks.upload.mockResolvedValueOnce({ publicUrl: "https://storage.test/new-image.webp" });
    const saved = { ...asset, image_url: "https://storage.test/new-image.webp", thumbnail_url: "https://storage.test/new-image.webp", category: { id: "category-1", name: "Kitchen", maintenance_enabled: false } };
    const successfulQuery = { eq: () => successfulQuery, select: () => ({ single: async () => ({ data: saved, error: null }) }) };
    mocks.from.mockReturnValue({ update: () => successfulQuery });

    await assetTrackingService.saveAsset({ ...asset, image_url: "data:image/webp;base64,new", thumbnail_url: "data:image/webp;base64,new", previous_image_url: "https://storage.test/old-image.webp" });

    expect(mocks.removeStorage).toHaveBeenCalledWith("asset-photos", "https://storage.test/old-image.webp");
  });
});
