// Canonical, UI-independent projections for the Asset Tracking domain.
// These preserve the established Admin semantics and can be reused by future
// operational surfaces without duplicating page-level rules.
export const assetConditions = ["healthy", "needs_attention", "under_maintenance", "low_quantity", "damaged", "missing", "disposed"];
export const inspectionDraftStatuses = ["draft", "in_progress", "pending_review"];
export const maintenanceStatuses = ["scheduled", "in_progress", "completed"];

export function normalizeAssetCondition(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "good" || normalized === "active") return "healthy";
  if (["needs_review", "review", "need_repair", "need_repairs"].includes(normalized)) return "needs_attention";
  if (normalized === "inactive") return "disposed";
  return assetConditions.includes(normalized) ? normalized : "healthy";
}

export function isAssetMissing(asset = {}) {
  return normalizeAssetCondition(asset.condition) === "missing" || Number(asset.current_quantity || 0) <= 0;
}

export function isAssetLowQuantity(asset = {}) {
  const quantity = Number(asset.current_quantity || 0);
  const minimum = Number(asset.minimum_quantity || 0);
  return normalizeAssetCondition(asset.condition) === "low_quantity" || (minimum > 0 && quantity <= minimum);
}

export function needsAssetAttention(asset = {}) {
  const condition = normalizeAssetCondition(asset.condition);
  if (condition === "disposed" || asset.status === "archived") return false;
  return condition !== "healthy" || isAssetMissing(asset) || isAssetLowQuantity(asset);
}

export function isAssetMaintenanceEligible(asset = {}) {
  const override = ["inherit", "enabled", "disabled"].includes(asset.maintenance_override) ? asset.maintenance_override : "inherit";
  return override === "enabled" || (override === "inherit" && (asset.maintenance_enabled === true || asset.category?.maintenance_enabled === true));
}

function startOfDay(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function maintenanceRelevantDate(record = {}) {
  return record.completed_date || record.scheduled_date || record.date || record.created_at || record.updated_at || null;
}

export function maintenanceDaysUntil(record = {}, now = new Date()) {
  const value = record.scheduled_date || record.date;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
}

export function isMaintenanceOverdue(record = {}, now = new Date()) {
  return record.status !== "completed" && maintenanceDaysUntil(record, now) < 0;
}

export function isMaintenanceDueWithin(record = {}, days = 1, now = new Date()) {
  const dueIn = maintenanceDaysUntil(record, now);
  return record.status !== "completed" && dueIn !== null && dueIn <= days;
}

export function nextMaintenanceInfo(records = [], now = new Date()) {
  const candidates = records
    .filter((record) => record.status !== "completed")
    .map((record) => ({ record, date: record.scheduled_date || record.date }))
    .filter((entry) => entry.date)
    .sort((first, second) => new Date(first.date) - new Date(second.date));
  if (!candidates.length) return { label: "No schedule", tone: "neutral", days: null, date: null };
  const next = candidates[0];
  const days = maintenanceDaysUntil(next.record, now);
  if (days === null) return { label: "No schedule", tone: "neutral", days: null, date: null };
  if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, tone: "danger", days, date: next.date };
  if (days === 0) return { label: "Due Today", tone: "warning", days, date: next.date };
  if (days === 1) return { label: "Tomorrow", tone: "warning", days, date: next.date };
  const label = new Date(next.date).toLocaleDateString("en-MY", { day: "2-digit", month: "short" });
  return { label, tone: days <= 7 ? "warning" : "success", days, date: next.date };
}

export function isDraftInspection(inspection = {}) {
  return inspectionDraftStatuses.includes(inspection.status);
}

export function inspectionProgress(inspection = {}) {
  const explicit = Number(inspection.completion_percentage ?? inspection.summary?.completion_percentage);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const summary = inspection.summary || {};
  const total = Number(summary.total_assets || summary.totalAssets || 0);
  const checked = Number(summary.checked_assets || summary.checkedAssets || summary.matched_assets || 0);
  return total ? Math.round((checked / total) * 100) : 0;
}

export function sortInspectionsNewestFirst(first = {}, second = {}) {
  const time = (inspection, field) => {
    const value = new Date(inspection[field] || 0).getTime();
    return Number.isNaN(value) ? 0 : value;
  };
  return time(second, "inspection_date") - time(first, "inspection_date") ||
    time(second, "created_at") - time(first, "created_at") ||
    time(second, "updated_at") - time(first, "updated_at");
}

export function buildAssetOperationalKpis({ assets = [], inspections = [], maintenanceRecords = [], now = new Date() } = {}) {
  const operationalAssets = assets.filter((asset) => normalizeAssetCondition(asset.condition) !== "disposed");
  const operationalAssetIds = new Set(operationalAssets.map((asset) => asset.id));
  const activeMaintenanceAssetIds = new Set(maintenanceRecords.filter((record) => record.status === "in_progress").map((record) => record.asset_id));
  const todayKey = startOfDay(now).toDateString();
  const inspectedTodayAssetIds = new Set();
  inspections.filter((inspection) => startOfDay(inspection.inspection_date).toDateString() === todayKey).forEach((inspection) => (inspection.items || []).forEach((item) => inspectedTodayAssetIds.add(item.asset_id)));
  return {
    scheduledMaintenance: maintenanceRecords.filter((record) => record.status === "scheduled" && operationalAssetIds.has(record.asset_id)).length,
    overdueMaintenance: maintenanceRecords.filter((record) => isMaintenanceOverdue(record, now) && operationalAssetIds.has(record.asset_id)).length,
    underMaintenance: operationalAssets.filter((asset) => normalizeAssetCondition(asset.condition) === "under_maintenance" || activeMaintenanceAssetIds.has(asset.id)).length,
    missingLowQuantity: operationalAssets.filter((asset) => isAssetMissing(asset) || isAssetLowQuantity(asset)).length,
    needsAttention: operationalAssets.filter(needsAssetAttention).length,
    missingAssets: operationalAssets.filter(isAssetMissing).length,
    lowQuantity: operationalAssets.filter(isAssetLowQuantity).length,
    disposed: assets.filter((asset) => normalizeAssetCondition(asset.condition) === "disposed").length,
    recentlyInspected: operationalAssets.filter((asset) => inspectedTodayAssetIds.has(asset.id) || (asset.last_inspection_at && startOfDay(asset.last_inspection_at).toDateString() === todayKey)).length,
  };
}

export function buildAssetActivityProjection({ assets = [], movements = [], inspections = [], maintenanceRecords = [] } = {}) {
  const assetNameById = new Map(assets.map((asset) => [asset.id, asset.name || "Asset"]));
  const importedAssetIds = new Set(movements.filter((movement) => movement.reason === "import").map((movement) => movement.asset_id));
  const assetRows = assets.filter((asset) => asset.created_at && !importedAssetIds.has(asset.id)).slice(0, 6).map((asset) => ({ id: `asset-created-${asset.id}`, date: asset.created_at, title: "Asset Added", detail: `${asset.name} was added to Asset Tracking.`, type: "created", actorId: asset.created_by, actorPrefix: "Created" }));
  const movementRows = movements.slice(0, 8).map((movement) => ({ id: `movement-${movement.id}`, date: movement.updated_at || movement.created_at || movement.movement_date, title: movement.movement_type === "correction" ? "Inspection update" : "Quantity Adjusted", detail: `${assetNameById.get(movement.asset_id) || "Asset"} · ${movement.reason || movement.movement_type || "quantity adjusted"}`, type: "movement", actorId: movement.created_by, actorPrefix: "Recorded" }));
  const maintenanceRows = maintenanceRecords.slice(0, 6).map((record) => ({ id: `maintenance-${record.id}`, date: record.updated_at || record.created_at || record.completed_date || record.scheduled_date || record.date, title: record.status === "completed" ? "Maintenance Completed" : "Maintenance Scheduled", detail: record.issue || record.maintenance_type || "Maintenance", type: "maintenance", actorId: record.created_by, actorPrefix: record.status === "completed" ? "Completed" : "Scheduled", metadata: assetNameById.get(record.asset_id) }));
  const inspectionRows = inspections.slice(0, 6).map((inspection) => ({ id: `inspection-${inspection.id}`, date: inspection.updated_at || inspection.created_at || inspection.inspection_date, title: "Inspection Completed", detail: `${inspection.summary?.total_assets || (inspection.items || []).length || 0} assets checked`, type: "inspection", actorId: inspection.checked_by_employee_id || inspection.checked_by || inspection.created_by, actorPrefix: "Inspected" }));
  return [...movementRows, ...maintenanceRows, ...inspectionRows, ...assetRows].filter((row) => row.date).sort((first, second) => new Date(second.date) - new Date(first.date)).slice(0, 8);
}
