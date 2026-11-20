import { normalizeBusinessDate } from '../waste/inventoryWasteService.js';
import { uniqueIds } from '../inventoryItemModel.js';
import { isValidClosingQuantity } from './monthEndClosing.js';

export function stockCheckCountState(row, isClosing = false) {
  if (row.skipped) return "skipped";
  if (row.na) return isClosing ? "pending" : "na";
  const actual = row.actualCount;
  const present = actual != null && actual !== "" && Number.isFinite(Number(actual));
  return present && (!isClosing || isValidClosingQuantity(actual)) ? "counted" : "pending";
}

export function projectStockCheckCount(row, parLevel, isClosing = false) {
  const state = stockCheckCountState(row, isClosing);
  if (state !== "counted") {
    const label = { pending: "Pending", skipped: "Skipped", na: "Not Available" }[state];
    return { state, label, tone: "neutral", variance: null };
  }
  const par = Number(parLevel || 0);
  const variance = par - Number(row.actualCount);
  if (variance < 0) return { state, label: "Excess", tone: "info", variance };
  if (variance === 0) return { state, label: "Normal", tone: "success", variance };
  if (variance >= Math.max(3, par * 0.35)) return { state, label: "Critical", tone: "danger", variance };
  return { state, label: "Shortage", tone: "warning", variance };
}

export function summarizeAuditRows(rows = []) {
  const totals = { total: rows.length, shortage: 0, excess: 0, skipped: 0 };
  for (const row of rows) {
    if (row.skipped || row.status === "skipped") {
      totals.skipped += 1;
      continue;
    }
    if (row.na || row.status === "na" || row.status === "pending"
      || !isValidClosingQuantity(row.actualCount) || !isValidClosingQuantity(row.expectedQty)) continue;

    const actual = Number(row.actualCount);
    const par = Number(row.expectedQty);
    if (actual < par) totals.shortage += 1;
    if (actual > par) totals.excess += 1;
  }
  return totals;
}

export function mapRemoteStockCheckItem(row = {}) {
  return {
    id: row.id,
    itemId: row.item_id || "",
    categoryId: row.category_id || "",
    expectedQty: row.par_level_quantity === null || row.par_level_quantity === undefined ? "" : Number(row.par_level_quantity),
    actualCount: row.actual_count_quantity === null || row.actual_count_quantity === undefined ? "" : Number(row.actual_count_quantity),
    variance: row.variance === null || row.variance === undefined ? 0 : Number(row.variance),
    unitCostSnapshot: row.unit_cost_snapshot === null || row.unit_cost_snapshot === undefined ? null : Number(row.unit_cost_snapshot),
    unit: row.unit || "",
    status: row.skipped ? "skipped" : (row.status || "normal"),
    notes: row.notes || "",
    skipped: Boolean(row.skipped),
    skipReason: row.skip_reason || "",
    na: row.status === "na",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

export function mapRemoteStockCheck(row = {}, rows = []) {
  const checkType = row.stock_check_type || row.check_type || "scheduled";
  const checkDate = normalizeBusinessDate(row.check_date || row.created_at);
  const mappedRows = rows.map(mapRemoteStockCheckItem);
  const categoryIds = row.audit_category_ids?.length
    ? uniqueIds(row.audit_category_ids)
    : uniqueIds(mappedRows.map((item) => item.categoryId).filter(Boolean));
  return {
    id: row.id,
    groupId: row.group_id || "",
    outletId: row.outlet_id || "",
    date: checkDate,
    shift: row.shift || "",
    stockCheckType: checkType,
    auditType: row.audit_type || "",
    accountingMonth: row.accounting_month || "",
    correctionOfId: row.correction_of_id || "",
    correctionReason: row.correction_reason || "",
    physicalCountCutoff: row.physical_count_cutoff || "",
    auditName: row.audit_name || row.check_name || "",
    auditCategoryIds: categoryIds,
    checkName: row.check_name || "",
    notes: row.notes || "",
    categoryIds,
    status: row.status || "draft",
    rows: mappedRows,
    createdBy: row.created_by || "",
    createdByEmployeeId: row.created_by_employee_id || "",
    submittedBy: row.submitted_by || "",
    submittedAt: row.submitted_at || "",
    reviewedAt: row.reviewed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export function formatQuantity(value) {
  return value === "" || value === null || value === undefined ? "—" : value;
}

export function auditItemChanged(row, source) {
  if (!source) return false;
  const actual = row.actualCount === "" ? "" : Number(row.actualCount);
  return actual !== source.actualCount || row.notes !== source.notes;
}

export function sourceCountLabel(row) {
  if (!row) return "—";
  if (row.skipped) return "Skipped";
  if (row.na) return "Not available";
  return row.actualCount === "" ? "—" : `${formatQuantity(row.actualCount)} ${row.unit}`.trim();
}
