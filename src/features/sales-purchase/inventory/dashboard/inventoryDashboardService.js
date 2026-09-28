import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { supabase } from "../../../../lib/supabase.ts";
import { isActiveInventoryItem, mapRemoteInventoryItem, outletConfigForItem, uniqueIds } from "../inventoryItemModel.js";
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

function incomplete(message) {
  return Object.assign(new Error(message), { readState: "incomplete" });
}

async function readStockEvidence(outletIds) {
  const { data, error } = await supabase.rpc("inventory_dashboard_stock_evidence", { p_outlet_ids: outletIds });
  if (error) throw Object.assign(new Error(`Inventory stock evidence: ${error.message}`), { readState: "error", cause: error });
  if (!data || !Array.isArray(data.positions) || !Number.isInteger(data.position_count)
      || data.position_count !== data.positions.length) {
    throw incomplete("Inventory stock evidence completeness could not be verified.");
  }
  return data.positions;
}

async function readRecentMovements(outletIds) {
  // This is an explicitly bounded recent-activity widget, not a complete
  // movement history or a stock-balance authority.
  const { data, error } = await supabase.from("inventory_movements").select("*")
    .in("outlet_id", outletIds).order("created_at", { ascending: false })
    .order("id", { ascending: true }).limit(6);
  if (error || !Array.isArray(data)) throw Object.assign(
    new Error(`Recent inventory movements: ${error?.message || "read failed"}`),
    { readState: "error", cause: error },
  );
  return data;
}

// Dashboard is a read-only projection. Every contributing collection must be
// verified complete before any aggregate becomes visible.
export async function loadInventoryDashboard(outletIds) {
  if (!outletIds.length) throw new Error("No accessible outlet.");
  const [links, groups, checks, orders, waste, stockEvidence, recentMovements] = await Promise.all([
    readByIds("inventory_item_outlets", "outlet_id", outletIds, { select: "*, outlets:outlet_id(*)" }),
    readByIds("inventory_stock_check_groups", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_stock_checks", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_purchase_orders", "outlet_id", outletIds, { select: "id, outlet_id, status, created_at", order: "created_at", ascending: false }),
    readByIds("inventory_waste_records", "outlet_id", outletIds, { order: "waste_date", ascending: false }),
    readStockEvidence(outletIds),
    readRecentMovements(outletIds),
  ]);
  const [itemRows, groupLinks] = await Promise.all([
    readByIds("inventory_items", "id", links.map((link) => link.inventory_item_id)),
    readByIds("inventory_stock_check_group_categories", "group_id", groups.map((group) => group.id)),
  ]);
  const linksByItem = new Map();
  for (const link of links) linksByItem.set(link.inventory_item_id, [...(linksByItem.get(link.inventory_item_id) || []), link]);
  const categoryIdsByGroup = new Map();
  for (const link of groupLinks) categoryIdsByGroup.set(link.group_id, [...(categoryIdsByGroup.get(link.group_id) || []), link.category_id]);
  const items = itemRows.map((row) => mapRemoteInventoryItem(row, linksByItem.get(row.id) || []));
  const expectedPositions = new Set();
  for (const item of items.filter(isActiveInventoryItem)) for (const outletId of item.linkedOutletIds || []) {
    if (!outletIds.includes(outletId)) continue;
    const config = outletConfigForItem(item, outletId);
    if (config?.isActive && Number.isFinite(Number(config.parLevel)) && Number(config.parLevel) > 0) {
      expectedPositions.add(`${outletId}:${item.id}`);
    }
  }
  const returnedPositions = new Set();
  for (const position of stockEvidence) {
    const key = `${position.outlet_id}:${position.item_id}`;
    if (returnedPositions.has(key) || !expectedPositions.has(key)
        || !["below_par", "sufficient", "changed", "unverified"].includes(position.state)) {
      throw incomplete("Inventory stock evidence does not match the verified outlet catalog.");
    }
    returnedPositions.add(key);
  }
  if (returnedPositions.size !== expectedPositions.size) {
    throw incomplete("Inventory stock evidence is missing an applicable outlet item.");
  }
  return {
    items,
    groups: groups.map((row) => mapRemoteStockCheckGroup(row, categoryIdsByGroup.get(row.id) || [])),
    checks: checks.map((row) => mapRemoteStockCheck(row, [])),
    orders: orders.map((row) => ({ id: row.id, outletId: row.outlet_id, status: row.status })),
    movements: recentMovements.map(mapRemoteInventoryMovement),
    waste: waste.map(mapRemoteWasteRecord),
    stockEvidence,
  };
}
