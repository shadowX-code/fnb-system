import { normalizeBusinessDate } from '../waste/inventoryWasteService.js';
import { uniqueIds } from '../InventoryItemModel.js';
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
    auditName: row.audit_name || row.check_name || "",
    auditCategoryIds: categoryIds,
    checkName: row.check_name || "",
    notes: row.notes || "",
    categoryIds,
    status: row.status || "draft",
    rows: mappedRows,
    createdBy: row.created_by || "",
    submittedBy: row.submitted_by || "",
    submittedAt: row.submitted_at || "",
    reviewedAt: row.reviewed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

