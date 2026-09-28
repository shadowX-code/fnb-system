import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { mapRemoteInventoryItem, uniqueIds } from "../inventoryItemModel.js";
import { mapRemoteStockCheckGroup } from "../groups/inventoryGroupsModel.js";
import { mapRemoteStockCheck } from "../stockChecks/inventoryStockCheckReadModel.js";
import { mapRemoteInventoryMovement } from "../movements/inventoryMovementService.js";
import { mapRemoteWasteRecord } from "../waste/inventoryWasteService.js";

async function readByIds(table, column, ids, options = {}) {
  const unique = uniqueIds(ids);
  if (!unique.length) return [];
  const pages = await Promise.all(Array.from({ length: Math.ceil(unique.length / 100) }, (_, index) =>
    readCompleteInventoryRows(table, { ...options, in: { [column]: unique.slice(index * 100, index * 100 + 100) } })));
  return pages.flatMap((page) => page.data);
}

// Dashboard is a read-only projection. Every contributing collection must be
// verified complete before any aggregate becomes visible.
export async function loadInventoryDashboard(outletIds) {
  if (!outletIds.length) throw new Error("No accessible outlet.");
  const [links, groups, checks, orders, movements, waste] = await Promise.all([
    readByIds("inventory_item_outlets", "outlet_id", outletIds, { select: "*, outlets:outlet_id(*)" }),
    readByIds("inventory_stock_check_groups", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_stock_checks", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_purchase_orders", "outlet_id", outletIds, { select: "id, outlet_id, status, created_at", order: "created_at", ascending: false }),
    readByIds("inventory_movements", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_waste_records", "outlet_id", outletIds, { order: "waste_date", ascending: false }),
  ]);
  const [itemRows, groupLinks, checkRows] = await Promise.all([
    readByIds("inventory_items", "id", links.map((link) => link.inventory_item_id)),
    readByIds("inventory_stock_check_group_categories", "group_id", groups.map((group) => group.id)),
    readByIds("inventory_stock_check_items", "stock_check_id", checks.map((check) => check.id)),
  ]);
  const linksByItem = new Map();
  for (const link of links) linksByItem.set(link.inventory_item_id, [...(linksByItem.get(link.inventory_item_id) || []), link]);
  const categoryIdsByGroup = new Map();
  for (const link of groupLinks) categoryIdsByGroup.set(link.group_id, [...(categoryIdsByGroup.get(link.group_id) || []), link.category_id]);
  const rowsByCheck = new Map();
  for (const row of checkRows) rowsByCheck.set(row.stock_check_id, [...(rowsByCheck.get(row.stock_check_id) || []), row]);
  return {
    items: itemRows.map((row) => mapRemoteInventoryItem(row, linksByItem.get(row.id) || [])),
    groups: groups.map((row) => mapRemoteStockCheckGroup(row, categoryIdsByGroup.get(row.id) || [])),
    checks: checks.map((row) => mapRemoteStockCheck(row, rowsByCheck.get(row.id) || [])),
    orders: orders.map((row) => ({ id: row.id, outletId: row.outlet_id, status: row.status })),
    movements: movements.map(mapRemoteInventoryMovement),
    waste: waste.map(mapRemoteWasteRecord),
  };
}
