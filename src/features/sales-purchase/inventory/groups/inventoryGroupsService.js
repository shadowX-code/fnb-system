import { supabase } from "../../../../lib/supabase.ts";
import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { frequencies, groupCategoryIds, isUuid, mapRemoteStockCheckGroup, uniqueIds } from "./inventoryGroupsModel.js";
function debugLog(...args) { if (import.meta.env.DEV) console.log(...args); }
function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getBusinessDateInput(timeZone = "Asia/Kuala_Lumpur", value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    // Fall back to browser local date if the requested timezone is unavailable.
  }
  return toDateInputValue(date);
}
function todayInput(timeZone = "Asia/Kuala_Lumpur") {
  return getBusinessDateInput(timeZone);
}
function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}
function businessDateToTimestamp(value) {
  return `${normalizeBusinessDate(value)}T12:00:00.000Z`;
}
export async function persistRemoteStockCheckGroup(group) {
  const categoryIds = uniqueIds(groupCategoryIds(group, []));
  const frequency = frequencies.includes(group.frequency) ? group.frequency : "custom";
  const payload = {
    outlet_id: isUuid(group.outletId) ? group.outletId : null,
    name: String(group.name || "").trim(),
    description: String(group.description || "").trim() || null,
    shift: group.shift || "Closing",
    frequency_type: frequency,
    frequency_days: frequency === "custom" ? (group.checkDays || []) : [],
    schedule_config: {
      monthDay: group.monthDay || 1,
      checkDays: frequency === "custom" ? (group.checkDays || []) : [],
      assignedStaff: group.assignedStaff || "",
    },
    status: group.status || "active",
    last_checked_at: group.lastCheckedAt || (group.lastChecked ? businessDateToTimestamp(group.lastChecked) : null),
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) throw new Error("Group name is required.");
  if (!payload.outlet_id) throw new Error("Outlet is required.");

  const mode = isUuid(group.id) ? "edit" : "create";
  const groupResult = mode === "edit"
    ? await supabase
      .from("inventory_stock_check_groups")
      .update(payload)
      .eq("id", group.id)
      .select("*")
      .single()
    : await supabase
      .from("inventory_stock_check_groups")
      .insert(payload)
      .select("*")
      .single();
  debugLog("[StockCheckGroupSaveDebug]", { action: mode, payload, categoryIds, result: { data: groupResult.data, error: groupResult.error }, error: groupResult.error });
  if (groupResult.error) throw groupResult.error;

  const groupId = groupResult.data.id;
  const deleteResult = await supabase
    .from("inventory_stock_check_group_categories")
    .delete()
    .eq("group_id", groupId);
  debugLog("[StockCheckGroupSaveDebug]", { action: "delete-category-links", groupId, result: { data: deleteResult.data || null, error: deleteResult.error }, error: deleteResult.error });
  if (deleteResult.error) throw deleteResult.error;

  if (categoryIds.length) {
    const linkPayload = categoryIds.map((categoryId) => ({ group_id: groupId, category_id: categoryId }));
    const linkResult = await supabase
      .from("inventory_stock_check_group_categories")
      .insert(linkPayload);
    debugLog("[StockCheckGroupSaveDebug]", { action: "insert-category-links", groupId, payload: linkPayload, result: { data: linkResult.data || null, error: linkResult.error }, error: linkResult.error });
    if (linkResult.error) throw linkResult.error;
  }

  return mapRemoteStockCheckGroup(groupResult.data, categoryIds);
}
export async function archiveRemoteStockCheckGroup(groupId) {
  if (!isUuid(groupId)) throw new Error("This stock check group has not been saved to Supabase yet.");
  const result = await supabase
    .from("inventory_stock_check_groups")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .select("*")
    .single();
  debugLog("[StockCheckGroupSaveDebug]", { action: "archive", groupId, result: { data: result.data, error: result.error }, error: result.error });
  if (result.error) throw result.error;
  return mapRemoteStockCheckGroup(result.data);
}
export async function loadInventoryGroups() {
  const [groups, links, items, categories, outlets] = await Promise.all([
    readCompleteInventoryRows("inventory_stock_check_groups", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_stock_check_group_categories"),
    readCompleteInventoryRows("inventory_items", { order: "created_at", ascending: false }),
    readCompleteInventoryRows("inventory_categories", { order: "sort_order" }),
    readCompleteInventoryRows("inventory_item_outlets"),
  ]);
  const categoryIdsByGroup = new Map();
  for (const link of links.data) categoryIdsByGroup.set(link.group_id, [...(categoryIdsByGroup.get(link.group_id) || []), link.category_id]);
  const outletIdsByItem = new Map();
  for (const link of outlets.data) outletIdsByItem.set(link.inventory_item_id, [...(outletIdsByItem.get(link.inventory_item_id) || []), link.outlet_id]);
  return {
    groups: groups.data.map(row => mapRemoteStockCheckGroup(row, categoryIdsByGroup.get(row.id) || [])),
    categories: categories.data.map(row => ({ id: row.id, name: row.name || "Uncategorized", description: row.description || "", sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0), status: row.status || "active", createdAt: row.created_at || row.createdAt || "", updatedAt: row.updated_at || row.updatedAt || "" })),
    items: items.data.map(row => ({ id: row.id, name: row.item_name || row.name || "Inventory item", sku: row.sku_code || row.sku || "", categoryId: row.category_id || "", unit: row.unit || row.uom_code || row.uom || "", status: row.status || "active", linkedOutletIds: uniqueIds(outletIdsByItem.get(row.id) || []) })),
    completeness: "complete",
  };
}
