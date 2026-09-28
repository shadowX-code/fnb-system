import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { supabase } from "../../../../lib/supabase.ts";
import { inventoryLifecycleService } from "../../../../services/inventoryLifecycleService.js";
import { mapRemoteInventoryItem, mapRemoteCategory, uniqueIds, isUuid } from "../inventoryItemModel.js";
import { mapRemoteStockCheckGroup } from "../groups/inventoryGroupsModel.js";
import { mapRemoteStockCheck } from "./inventoryStockCheckReadModel.js";

async function readByIds(table, column, ids, options = {}) {
  const unique = uniqueIds(ids);
  if (!unique.length) return [];
  const pages = await Promise.all(Array.from({ length: Math.ceil(unique.length / 100) }, (_, index) =>
    readCompleteInventoryRows(table, { ...options, in: { [column]: unique.slice(index * 100, index * 100 + 100) } })));
  return pages.flatMap((page) => page.data);
}

async function readCheckSummaries(checkIds) {
  const ids = uniqueIds(checkIds);
  if (!ids.length) return new Map();
  const { data, error } = await supabase.rpc("inventory_stock_check_row_summaries", { p_check_ids: ids });
  if (error) throw Object.assign(new Error(`Stock Check summaries: ${error.message}`), { readState: "error", cause: error });
  if (!data || !Array.isArray(data.summaries) || data.check_count !== ids.length
      || data.summaries.length !== ids.length) {
    throw Object.assign(new Error("Stock Check summary completeness could not be verified."), { readState: "incomplete" });
  }
  const summaries = new Map();
  for (const summary of data.summaries) {
    if (!ids.includes(summary.check_id) || summaries.has(summary.check_id)
        || ![summary.total, summary.skipped, summary.shortage].every((value) => Number.isInteger(value) && value >= 0)) {
      throw Object.assign(new Error("Stock Check summary identities or counts are incomplete."), { readState: "incomplete" });
    }
    summaries.set(summary.check_id, { total: summary.total, skipped: summary.skipped, shortage: summary.shortage });
  }
  return summaries;
}

// All joins are assembled from verified complete reads. Historical cards use
// server summaries; Result alone loads complete submitted evidence by identity.
export async function loadStockCheckExecution(outletIds) {
  if (!outletIds.length) return { items: [], categories: [], groups: [], checks: [], orders: [], people: [], completeness: "complete" };
  const [outletLinks, groupsRaw, checksRaw, categoriesRaw] = await Promise.all([
    readByIds("inventory_item_outlets", "outlet_id", outletIds, { select: "*, outlets:outlet_id(*)" }),
    readByIds("inventory_stock_check_groups", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_stock_checks", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_categories", { order: "sort_order" }),
  ]);
  const draftIds = checksRaw.filter((check) => check.status === "draft").map((check) => check.id);
  const historicalIds = checksRaw.filter((check) => check.status !== "draft").map((check) => check.id);
  const [itemRows, groupLinks, draftRows, summaries, orderRows, submittedActors, createdActors] = await Promise.all([
    readByIds("inventory_items", "id", outletLinks.map((link) => link.inventory_item_id), { order: "created_at", ascending: false }),
    readByIds("inventory_stock_check_group_categories", "group_id", groupsRaw.map((group) => group.id)),
    readByIds("inventory_stock_check_items", "stock_check_id", draftIds, { order: "created_at" }),
    readCheckSummaries(historicalIds),
    readByIds("inventory_purchase_orders", "source_stock_check_id", checksRaw.map((check) => check.id), { order: "created_at", ascending: false }),
    readByIds("employees", "id", checksRaw.map((check) => check.submitted_by), { select: "id, auth_user_id, full_name, nickname, email" }),
    readByIds("employees", "auth_user_id", checksRaw.map((check) => check.created_by), { select: "id, auth_user_id, full_name, nickname, email" }),
  ]);
  const categories = categoriesRaw.data.map(mapRemoteCategory);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const linksByItem = new Map();
  for (const link of outletLinks) linksByItem.set(link.inventory_item_id, [...(linksByItem.get(link.inventory_item_id) || []), link]);
  const groupCategoryIds = new Map();
  for (const link of groupLinks) groupCategoryIds.set(link.group_id, [...(groupCategoryIds.get(link.group_id) || []), link.category_id]);
  const rowsByCheck = new Map();
  for (const row of draftRows) rowsByCheck.set(row.stock_check_id, [...(rowsByCheck.get(row.stock_check_id) || []), row]);
  return {
    categories,
    items: itemRows.map((row) => mapRemoteInventoryItem(row, linksByItem.get(row.id) || [], categoryById)),
    groups: groupsRaw.map((row) => mapRemoteStockCheckGroup(row, groupCategoryIds.get(row.id) || [])),
    checks: checksRaw.map((row) => {
      const rows = row.status === "draft" ? (rowsByCheck.get(row.id) || []) : [];
      const check = mapRemoteStockCheck(row, row.status === "draft" ? rows : []);
      return row.status === "draft" ? check : {
        ...check,
        rowSummary: summaries.get(row.id),
      };
    }),
    orders: orderRows.map((row) => ({ id: row.id, sourceType: row.source_type, sourceStockCheckId: row.source_stock_check_id, status: row.status })),
    people: [...new Map([...submittedActors, ...createdActors].map((row) => [row.id, row])).values()]
      .map((row) => ({ id: row.id, authUserId: row.auth_user_id || "", name: row.nickname || row.full_name || row.email || "Unknown User" })),
    completeness: "complete",
  };
}

export async function persistRemoteStockCheck(activeGroup, rows = [], status = "draft", userId, employeeId) {
  if (!activeGroup) throw new Error("Stock check is not active.");
  const isAudit = activeGroup.stockCheckType === "audit";
  const checkDate = String(activeGroup.date || "").slice(0, 10);
  const existingId = isUuid(activeGroup.existingCheckId) ? activeGroup.existingCheckId : (isUuid(activeGroup.id) && isAudit ? activeGroup.id : "");
  const payload = {
    outlet_id: isUuid(activeGroup.outletId) ? activeGroup.outletId : null,
    group_id: isAudit ? null : (isUuid(activeGroup.id) ? activeGroup.id : null),
    stock_check_type: isAudit ? "audit" : "scheduled",
    check_name: isAudit ? (activeGroup.auditName || activeGroup.name || "Audit Stock Check") : (activeGroup.name || "Stock Check"),
    shift: activeGroup.shift || (isAudit ? "Audit" : null),
    check_date: checkDate,
    audit_type: isAudit ? (activeGroup.auditType || "Custom Audit") : null,
    audit_name: isAudit ? (activeGroup.auditName || activeGroup.name || "Audit Stock Check") : null,
    audit_category_ids: isAudit ? uniqueIds(activeGroup.categoryIds || activeGroup.auditCategoryIds || []) : [],
    notes: activeGroup.notes || null,
    status,
    submitted_at: status === "submitted" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (status === "submitted" && isUuid(employeeId)) payload.submitted_by = employeeId;
  if (!payload.outlet_id) throw new Error("Outlet is required.");
  if (!isAudit && !payload.group_id) throw new Error("Stock check group is required.");
  const result = await inventoryLifecycleService.saveInventoryStockCheck({
    check: { id: existingId || null, ...payload },
    items: rows.map((row) => ({
      item_id: isUuid(row.itemId) ? row.itemId : null,
      category_id: isUuid(row.categoryId) ? row.categoryId : null,
      par_level_quantity: row.expectedQty === "" || row.expectedQty === null || row.expectedQty === undefined ? null : Number(row.expectedQty),
      actual_count_quantity: row.actualCount === "" || row.actualCount === null || row.actualCount === undefined ? null : Number(row.actualCount),
      actual_missing: row.actualCount === "" || row.actualCount === null || row.actualCount === undefined,
      variance: Number(row.variance || 0),
      unit: row.unit || null,
      status: row.skipped ? "skipped" : (row.na ? "na" : row.status || "normal"),
      notes: row.notes || null,
      skipped: Boolean(row.skipped),
      na: Boolean(row.na),
      skip_reason: row.skipped ? (row.skipReason || null) : null,
    })),
  });
  return mapRemoteStockCheck(result.check || {}, result.items || []);
}

export async function deleteRemoteStockCheckDraft(checkId) {
  if (!isUuid(checkId)) throw new Error("This audit draft has not been saved to Supabase yet.");
  await inventoryLifecycleService.deleteStockCheckDraft({ checkId });
  return true;
}
