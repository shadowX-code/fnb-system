import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { supabase } from "../../../../lib/supabase.ts";
import { isActiveInventoryItem, mapRemoteInventoryItem, outletConfigForItem, uniqueIds } from "../inventoryItemModel.js";
import { mapRemoteStockCheckGroup } from "../groups/inventoryGroupsModel.js";
import { mapRemoteStockCheck } from "../stockChecks/inventoryStockCheckReadModel.js";
import { loadClosingContext } from "../stockChecks/inventoryStockCheckResultService.js";
import { MONTH_END_CLOSING } from "../stockChecks/monthEndClosing.js";
import { mapRemoteInventoryMovement } from "../movements/inventoryMovementService.js";

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
    .in("outlet_id", outletIds).order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true }).limit(5);
  if (error || !Array.isArray(data)) throw Object.assign(
    new Error(`Recent inventory movements: ${error?.message || "read failed"}`),
    { readState: "error", cause: error },
  );
  return data;
}

async function readCostInsights(outletIds) {
  try {
    const { data, error } = await supabase.rpc("inventory_dashboard_cost_insights", { p_outlet_ids: outletIds });
    if (error || !data?.start_date || !data?.end_date || !Array.isArray(data.top_changes)
        || ![data.increases, data.decreases, data.missing_costs].every(Number.isInteger)) {
      return { state: "unavailable" };
    }
    return { state: "ready", data };
  } catch {
    return { state: "unavailable" };
  }
}

async function readClosingStatuses(checks, outletIds, closingMonth) {
  const byOutlet = new Map();
  for (const check of checks) {
    if (check.auditType !== MONTH_END_CLOSING || check.accountingMonth !== closingMonth
        || !["draft", "submitted"].includes(check.status)) continue;
    const current = byOutlet.get(check.outletId);
    if (!current || (check.status === "submitted" && (current.status !== "submitted"
      || check.submittedAt > current.submittedAt))) byOutlet.set(check.outletId, check);
  }
  return Object.fromEntries(await Promise.all(outletIds.map(async outletId => {
    const check = byOutlet.get(outletId);
    if (!check) return [outletId, { status: "No submission" }];
    if (check.status !== "submitted") return [outletId, { status: "Draft" }];
    try {
      const context = await loadClosingContext(check.id);
      if (!context || !Object.hasOwn(context, "published")) return [outletId, { status: "Unavailable" }];
      return [outletId, context.published
        ? { status: "Published", checkId: context.published.source_audit_id }
        : { status: "Submitted", checkId: check.id }];
    } catch {
      return [outletId, { status: "Unavailable" }];
    }
  })));
}

// Require complete operations evidence. Restricted or failed optional insights
// carry their own state without replacing complete operational counts.
export async function loadInventoryDashboard(outletIds, { canReadCosts = false, closingMonth = "" } = {}) {
  if (!outletIds.length) throw new Error("No accessible outlet.");
  const [links, groups, checkRows, orders, stockEvidence, recentMovements, costInsights] = await Promise.all([
    readByIds("inventory_item_outlets", "outlet_id", outletIds, { select: "*, outlets:outlet_id(*)" }),
    readByIds("inventory_stock_check_groups", "outlet_id", outletIds, { order: "created_at", ascending: false }),
    readByIds("inventory_stock_checks", "outlet_id", outletIds, {
      select: "id,group_id,outlet_id,stock_check_type,audit_type,accounting_month,status,check_date,created_at,submitted_at",
      order: "created_at", ascending: false,
    }),
    readByIds("inventory_purchase_orders", "outlet_id", outletIds, { select: "id, outlet_id, status, created_at", order: "created_at", ascending: false }),
    readStockEvidence(outletIds),
    readRecentMovements(outletIds),
    canReadCosts ? readCostInsights(outletIds) : { state: "restricted" },
  ]);
  const checks = checkRows.map((row) => mapRemoteStockCheck(row, []));
  const [itemRows, closingStatuses] = await Promise.all([
    readByIds("inventory_items", "id", [...links.map(link => link.inventory_item_id), ...recentMovements.map(row => row.inventory_item_id)]),
    closingMonth ? readClosingStatuses(checks, outletIds, closingMonth) : null,
  ]);
  const linksByItem = new Map();
  for (const link of links) linksByItem.set(link.inventory_item_id, [...(linksByItem.get(link.inventory_item_id) || []), link]);
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
    groups: groups.map(row => mapRemoteStockCheckGroup(row)),
    checks,
    orders: orders.map((row) => ({ id: row.id, outletId: row.outlet_id, status: row.status })),
    movements: recentMovements.map(mapRemoteInventoryMovement),
    stockEvidence,
    closingStatuses,
    costInsights,
  };
}
