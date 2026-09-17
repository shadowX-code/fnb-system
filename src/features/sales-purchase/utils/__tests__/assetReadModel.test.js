import { describe, expect, it } from "vitest";
import { assetMatchesOperationalFilter, buildAssetActivityProjection, buildAssetOperationalKpis, getAssetAvailability, inspectionProgress, isAssetLowQuantity, isAssetMaintenanceEligible, isAssetMissing, isMaintenanceOverdue, sortInspectionsNewestFirst } from "../assetReadModel.js";
import { createMaintenanceRecordDraft, isMaintenanceRecordDraftInvalid, updateMaintenanceRecordDraft } from "../../hooks/useMaintenanceRecordForm.js";

describe("Asset read-model selectors", () => {
  const now = new Date("2026-08-30T09:00:00");
  it("keeps zero quantity with no positive minimum missing, not low", () => {
    const asset = { current_quantity: 0, minimum_quantity: 0, condition: "healthy" };
    expect(getAssetAvailability(asset)).toBe("missing");
    expect(isAssetMissing(asset)).toBe(true);
    expect(isAssetLowQuantity(asset)).toBe(false);
  });
  it("keeps availability independent from a good physical condition and shares it with filters", () => {
    const assets = [
      { id: "available", current_quantity: 4, minimum_quantity: 2, condition: "healthy" },
      { id: "low", current_quantity: 2, minimum_quantity: 2, condition: "healthy" },
      { id: "missing", current_quantity: 0, minimum_quantity: 2, condition: "healthy" },
    ];
    const kpis = buildAssetOperationalKpis({ assets, now });
    expect(getAssetAvailability(assets[2])).toBe("missing");
    expect(isAssetLowQuantity(assets[2])).toBe(false);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "low_quantity", { now }))).toHaveLength(kpis.lowQuantity);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "missing", { now }))).toHaveLength(kpis.missingAssets);
  });
  it("uses the same selector for every operational summary signal", () => {
    const assets = [
      { id: "scheduled", current_quantity: 4, condition: "healthy" },
      { id: "in-service", current_quantity: 4, condition: "healthy" },
      { id: "attention", current_quantity: 4, condition: "needs_attention" },
      { id: "low", current_quantity: 2, minimum_quantity: 2, condition: "healthy" },
      { id: "missing", current_quantity: 0, condition: "healthy" },
      { id: "disposed", current_quantity: 1, condition: "disposed" },
      { id: "inspected", current_quantity: 4, condition: "healthy" },
    ];
    const maintenanceRecords = [
      { asset_id: "scheduled", status: "scheduled", scheduled_date: "2026-08-31" },
      { asset_id: "in-service", status: "in_progress", scheduled_date: "2026-08-30" },
    ];
    const inspections = [{ inspection_date: "2026-08-30", items: [{ asset_id: "inspected" }] }];
    const context = { maintenanceRecords, inspections, now };
    const kpis = buildAssetOperationalKpis({ assets, ...context });
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "scheduled_maintenance", context))).toHaveLength(kpis.scheduledMaintenance);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "under_maintenance", context))).toHaveLength(kpis.underMaintenance);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "needs_attention", context))).toHaveLength(kpis.needsAttention);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "low_quantity", context))).toHaveLength(kpis.lowQuantity);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "missing", context))).toHaveLength(kpis.missingAssets);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "disposed", context))).toHaveLength(kpis.disposed);
    expect(assets.filter((asset) => assetMatchesOperationalFilter(asset, "inspected_today", context))).toHaveLength(kpis.recentlyInspected);
  });
  it("projects physical condition and availability KPI semantics independently", () => {
    const kpis = buildAssetOperationalKpis({ assets: [{ id: "missing", current_quantity: 0, minimum_quantity: 0, condition: "healthy" }, { id: "low", current_quantity: 2, minimum_quantity: 3, condition: "healthy" }, { id: "attention", current_quantity: 5, minimum_quantity: 3, condition: "needs_attention" }, { id: "disposed", current_quantity: 0, minimum_quantity: 3, condition: "disposed" }], maintenanceRecords: [{ asset_id: "low", status: "scheduled", scheduled_date: "2026-08-29" }], now });
    expect(kpis).toMatchObject({ missingAssets: 1, lowQuantity: 1, needsAttention: 1, overdueMaintenance: 1, disposed: 1 });
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
  it("does not represent a resumable inspection draft as a completed inspection", () => {
    const rows = buildAssetActivityProjection({ inspections: [{ id: "draft-1", status: "draft", updated_at: "2026-08-30T01:00:00Z", summary: { total_assets: 3 } }] });
    expect(rows[0]).toMatchObject({ title: "Inspection Draft Saved", actorPrefix: "Saved by", detail: "3 assets checked" });
  });
  it("uses canonical activity names for imports, inspections, maintenance, and archives", () => {
    const rows = buildAssetActivityProjection({
      assets: [{ id: "asset-1", name: "Mixer" }, { id: "asset-2", name: "Retired oven", status: "archived", created_at: "2026-08-28T00:00:00Z", updated_at: "2026-08-31T00:00:00Z" }],
      movements: [{ id: "import", asset_id: "asset-1", reason: "import", movement_type: "correction", created_at: "2026-08-30T01:00:00Z" }],
      inspections: [{ id: "inspection", status: "completed", updated_at: "2026-08-30T00:00:00Z", summary: { total_assets: 1 } }],
      maintenanceRecords: [{ id: "maintenance", asset_id: "asset-1", status: "in_progress", updated_at: "2026-08-29T00:00:00Z" }],
    });
    expect(rows.map((row) => row.title)).toEqual(["Asset Archived", "Asset Imported", "Inspection Completed", "Maintenance Updated"]);
  });
});

describe("shared maintenance editor model", () => {
  it("accepts the null record used when opening a new maintenance entry", () => {
    expect(createMaintenanceRecordDraft(null, "2026-08-30")).toMatchObject({
      id: "",
      status: "scheduled",
      scheduled_date: "2026-08-30",
    });
  });

  it("uses the same transition and validation rules for both entry points", () => {
    const scheduled = createMaintenanceRecordDraft({ issue: "Motor", scheduled_date: "2026-09-01" }, "2026-08-30");
    const completed = updateMaintenanceRecordDraft(scheduled, "status", "completed", "2026-08-30");
    expect(completed).toMatchObject({ status: "completed", scheduled_date: "", completed_date: "2026-08-30" });
    expect(isMaintenanceRecordDraftInvalid(completed)).toBe(true);
    expect(isMaintenanceRecordDraftInvalid({ ...completed, action_taken: "Repaired" })).toBe(false);
  });
});
