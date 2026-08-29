import { describe, expect, it } from "vitest";
import { buildAssetActivityProjection, buildAssetOperationalKpis, inspectionProgress, isAssetLowQuantity, isAssetMaintenanceEligible, isAssetMissing, isMaintenanceOverdue, sortInspectionsNewestFirst } from "../assetReadModel.js";
import { createMaintenanceRecordDraft, isMaintenanceRecordDraftInvalid, updateMaintenanceRecordDraft } from "../../hooks/useMaintenanceRecordForm.js";

describe("Asset read-model selectors", () => {
  const now = new Date("2026-08-30T09:00:00");
  it("keeps zero quantity with no positive minimum missing, not low", () => {
    const asset = { current_quantity: 0, minimum_quantity: 0, condition: "healthy" };
    expect(isAssetMissing(asset)).toBe(true);
    expect(isAssetLowQuantity(asset)).toBe(false);
  });
  it("projects attention and operational KPI semantics consistently", () => {
    const kpis = buildAssetOperationalKpis({ assets: [{ id: "missing", current_quantity: 0, minimum_quantity: 0, condition: "healthy" }, { id: "low", current_quantity: 2, minimum_quantity: 3, condition: "healthy" }, { id: "disposed", current_quantity: 0, minimum_quantity: 3, condition: "disposed" }], maintenanceRecords: [{ asset_id: "low", status: "scheduled", scheduled_date: "2026-08-29" }], now });
    expect(kpis).toMatchObject({ missingAssets: 1, lowQuantity: 1, needsAttention: 2, overdueMaintenance: 1, disposed: 1 });
  });
  it("handles due and maintenance eligibility without UI state", () => {
    expect(isMaintenanceOverdue({ status: "scheduled", scheduled_date: "2026-08-29" }, now)).toBe(true);
    expect(isMaintenanceOverdue({ status: "completed", scheduled_date: "2026-08-29" }, now)).toBe(false);
    expect(isAssetMaintenanceEligible({ maintenance_override: "inherit", maintenance_enabled: true })).toBe(true);
    expect(isAssetMaintenanceEligible({ maintenance_override: "disabled", maintenance_enabled: true })).toBe(false);
  });
  it("orders inspections and projects one cross-source activity timeline", () => {
    const newest = { inspection_date: "2026-08-30", created_at: "2026-08-30T01:00:00Z" };
    expect([newest, { inspection_date: "2026-08-29" }].sort(sortInspectionsNewestFirst)[0]).toBe(newest);
    expect(inspectionProgress({ completion_percentage: 50 })).toBe(50);
    expect(buildAssetActivityProjection({ assets: [{ id: "a", name: "Mixer", created_at: "2026-08-28", created_by: "u" }] })[0]).toMatchObject({ title: "Asset Added", actorId: "u" });
  });
});

describe("shared maintenance editor model", () => {
  it("uses the same transition and validation rules for both entry points", () => {
    const scheduled = createMaintenanceRecordDraft({ issue: "Motor", scheduled_date: "2026-09-01" }, "2026-08-30");
    const completed = updateMaintenanceRecordDraft(scheduled, "status", "completed", "2026-08-30");
    expect(completed).toMatchObject({ status: "completed", scheduled_date: "", completed_date: "2026-08-30" });
    expect(isMaintenanceRecordDraftInvalid(completed)).toBe(true);
    expect(isMaintenanceRecordDraftInvalid({ ...completed, action_taken: "Repaired" })).toBe(false);
  });
});
