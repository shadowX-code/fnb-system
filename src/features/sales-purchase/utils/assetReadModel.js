// Canonical, UI-independent projections for the Asset Tracking domain.
// These preserve the established Admin semantics and can be reused by future
// operational surfaces without duplicating page-level rules.
// Physical condition is intentionally separate from quantity-derived availability.
// `low_quantity` and `missing` remain accepted legacy inputs, but are projections
// of availability rather than options an operator should persist as a condition.
export const assetConditions = ["healthy", "needs_attention", "under_maintenance", "damaged", "disposed"];
export const assetAvailabilityStates = ["available", "low_quantity", "missing"];
export const inspectionDraftStatuses = ["draft", "in_progress", "pending_review"];
export const maintenanceStatuses = ["scheduled", "in_progress", "completed"];

export function normalizeAssetCondition(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "good" || normalized === "active") return "healthy";
  if (["needs_review", "review", "need_repair", "need_repairs"].includes(normalized)) return "needs_attention";
  if (normalized === "inactive") return "disposed";
  if (["low_quantity", "missing"].includes(normalized)) return "healthy";
  return assetConditions.includes(normalized) ? normalized : "healthy";
}

function rawAssetCondition(asset = {}) {
  return String(asset.condition || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function getAssetAvailability(asset = {}) {
  const rawCondition = rawAssetCondition(asset);
  const quantity = Number(asset.current_quantity || 0);
  const minimum = Number(asset.minimum_quantity || 0);
  if (rawCondition === "missing" || quantity <= 0) return "missing";
  if (rawCondition === "low_quantity" || (minimum > 0 && quantity <= minimum)) return "low_quantity";
  return "available";
}

export function isAssetMissing(asset = {}) {
  return getAssetAvailability(asset) === "missing";
}

export function isAssetLowQuantity(asset = {}) {
  return getAssetAvailability(asset) === "low_quantity";
}

export function isAssetOperational(asset = {}) {
  return asset.status !== "archived" && normalizeAssetCondition(asset.condition) !== "disposed";
}

export function needsAssetAttention(asset = {}) {
  const condition = normalizeAssetCondition(asset.condition);
  if (!isAssetOperational(asset)) return false;
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

export function assetMatchesOperationalFilter(asset = {}, filter = "all", { maintenanceRecords = [], inspections = [], now = new Date() } = {}) {
  const records = maintenanceRecords.filter((record) => record.asset_id === asset.id);
  const condition = normalizeAssetCondition(asset.condition);
  if (filter === "all") return true;
  if (filter === "scheduled_maintenance") return records.some((record) => record.status === "scheduled");
  if (filter === "maintenance_due") return records.some((record) => isMaintenanceDueWithin(record, 1, now));
  if (filter === "under_maintenance") return condition === "under_maintenance" || records.some((record) => record.status === "in_progress");
  if (filter === "needs_attention") return ["needs_attention", "damaged"].includes(condition);
  if (filter === "low_quantity") return isAssetLowQuantity(asset);
  if (filter === "missing") return isAssetMissing(asset);
  if (filter === "disposed") return condition === "disposed";
  if (filter === "high_variance") return inspections.some((inspection) => (inspection.items || []).some((item) => item.asset_id === asset.id && Math.abs(Number(item.difference || 0)) > 0));
  if (filter === "no_photo") return !asset.image_url && !asset.thumbnail_url;
  if (filter === "inspected_today") {
    const todayKey = startOfDay(now).toDateString();
    return Boolean(asset.last_inspection_at && startOfDay(asset.last_inspection_at).toDateString() === todayKey) || inspections.some((inspection) => (
      startOfDay(inspection.inspection_date).toDateString() === todayKey && (inspection.items || []).some((item) => item.asset_id === asset.id)
    ));
  }
  return false;
}

export function buildAssetOperationalKpis({ assets = [], inspections = [], maintenanceRecords = [], now = new Date() } = {}) {
  const operationalAssets = assets.filter(isAssetOperational);
  const operationalAssetIds = new Set(operationalAssets.map((asset) => asset.id));
  const activeMaintenanceAssetIds = new Set(maintenanceRecords.filter((record) => record.status === "in_progress").map((record) => record.asset_id));
  const todayKey = startOfDay(now).toDateString();
  const inspectedTodayAssetIds = new Set();
  inspections.filter((inspection) => startOfDay(inspection.inspection_date).toDateString() === todayKey).forEach((inspection) => (inspection.items || []).forEach((item) => inspectedTodayAssetIds.add(item.asset_id)));
  const selectorContext = { maintenanceRecords, inspections, now };
  return {
    scheduledMaintenance: operationalAssets.filter((asset) => assetMatchesOperationalFilter(asset, "scheduled_maintenance", selectorContext)).length,
    overdueMaintenance: maintenanceRecords.filter((record) => isMaintenanceOverdue(record, now) && operationalAssetIds.has(record.asset_id)).length,
    underMaintenance: operationalAssets.filter((asset) => assetMatchesOperationalFilter(asset, "under_maintenance", selectorContext) || activeMaintenanceAssetIds.has(asset.id)).length,
    missingLowQuantity: operationalAssets.filter((asset) => isAssetMissing(asset) || isAssetLowQuantity(asset)).length,
    needsAttention: operationalAssets.filter((asset) => assetMatchesOperationalFilter(asset, "needs_attention", selectorContext)).length,
    missingAssets: operationalAssets.filter((asset) => assetMatchesOperationalFilter(asset, "missing", selectorContext)).length,
    lowQuantity: operationalAssets.filter((asset) => assetMatchesOperationalFilter(asset, "low_quantity", selectorContext)).length,
    disposed: assets.filter((asset) => assetMatchesOperationalFilter(asset, "disposed", selectorContext)).length,
    recentlyInspected: operationalAssets.filter((asset) => inspectedTodayAssetIds.has(asset.id) || assetMatchesOperationalFilter(asset, "inspected_today", selectorContext) || (asset.last_inspection_at && startOfDay(asset.last_inspection_at).toDateString() === todayKey)).length,
  };
}

// This is the sole human-readable mapping for a movement in both the list and
// activity surfaces. Lifecycle values remain technical in storage/RPCs.
export function latestMovementSummary(movement) {
  if (!movement) return "—";
  const amount = Math.abs(Number(movement.quantity_change || 0));
  if (movement.reason === "import") return `Asset Imported · ${amount ? `${movement.quantity_change > 0 ? "+" : ""}${movement.quantity_change}` : "Recorded"}`;
  if (movement.movement_type === "add") return `Quantity Adjusted · +${amount}`;
  if (movement.movement_type === "reduce") return `Quantity Adjusted · -${amount}`;
  if (movement.movement_type === "correction") return movement.reason === "inspection"
    ? "Inspection Quantity Correction"
    : `Quantity Adjusted${amount ? ` · ${movement.quantity_change > 0 ? "+" : ""}${movement.quantity_change}` : ""}`;
  if (movement.movement_type === "transfer_in") return "Transfer · Received";
  if (movement.movement_type === "transfer_out") return "Transfer · Sent";
  return "Quantity adjusted";
}

export function buildAssetActivityProjection({ assets = [], movements = [], inspections = [], maintenanceRecords = [] } = {}) {
  const assetNameById = new Map(assets.map((asset) => [asset.id, asset.name || "Asset"]));
  const importedAssetIds = new Set(movements.filter((movement) => movement.reason === "import").map((movement) => movement.asset_id));
  const assetRows = assets.filter((asset) => asset.created_at && !importedAssetIds.has(asset.id)).slice(0, 6).map((asset) => {
    const archived = asset.status === "archived";
    return {
      id: `asset-${archived ? "archived" : "created"}-${asset.id}`,
      date: archived ? asset.updated_at || asset.created_at : asset.created_at,
      title: archived ? "Asset Archived" : "Asset Added",
      detail: archived ? `${asset.name} was archived from Asset Tracking.` : `${asset.name} was added to Asset Tracking.`,
      type: archived ? "archived" : "created",
      actorId: archived ? asset.updated_by : asset.created_by_employee_id || asset.created_by,
      actorPrefix: archived ? "Archived" : "Created",
    };
  });
  const movementRows = movements.slice(0, 8).map((movement) => {
    const imported = movement.reason === "import";
    const inspectionCorrection = movement.reason === "inspection";
    return {
      id: `movement-${movement.id}`,
      date: movement.updated_at || movement.created_at || movement.movement_date,
      title: imported ? "Asset Imported" : inspectionCorrection ? "Inspection Quantity Correction" : "Quantity Adjusted",
      detail: `${assetNameById.get(movement.asset_id) || "Asset"} · ${movement.reason || movement.movement_type || "quantity adjusted"}`,
      type: imported ? "created" : inspectionCorrection ? "inspection" : "movement",
      actorId: movement.created_by_employee_id || movement.created_by,
      actorPrefix: imported ? "Imported" : inspectionCorrection ? "Inspected" : "Adjusted",
    };
  });
  const maintenanceRows = maintenanceRecords.slice(0, 6).map((record) => {
    const title = record.status === "completed" ? "Maintenance Completed" : record.status === "in_progress" ? "Maintenance Updated" : "Maintenance Scheduled";
    return { id: `maintenance-${record.id}`, date: record.updated_at || record.created_at || record.completed_date || record.scheduled_date || record.date, title, detail: record.issue || record.maintenance_type || "Maintenance", type: "maintenance", actorId: record.created_by, actorPrefix: record.status === "completed" ? "Completed" : record.status === "in_progress" ? "Updated" : "Scheduled", metadata: assetNameById.get(record.asset_id) };
  });
  const inspectionRows = inspections.slice(0, 6).map((inspection) => {
    const isDraft = ["draft", "in_progress", "pending_review"].includes(inspection.status);
    return {
      id: `inspection-${inspection.id}`,
      date: inspection.updated_at || inspection.created_at || inspection.inspection_date,
      title: isDraft ? "Inspection Draft Saved" : "Inspection Completed",
      detail: `${inspection.summary?.total_assets || (inspection.items || []).length || 0} assets checked`,
      type: "inspection",
      actorId: inspection.checked_by_employee_id || inspection.checked_by || inspection.created_by,
      actorPrefix: isDraft ? "Saved by" : "Inspected",
    };
  });
  return [...movementRows, ...maintenanceRows, ...inspectionRows, ...assetRows].filter((row) => row.date).sort((first, second) => new Date(second.date) - new Date(first.date)).slice(0, 8);
}
