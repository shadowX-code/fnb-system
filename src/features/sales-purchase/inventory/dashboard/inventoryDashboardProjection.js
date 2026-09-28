import { isActiveInventoryItem, outletConfigForItem } from "../inventoryItemModel.js";
import { stockCheckItemsForGroup } from "../groups/inventoryGroupsModel.js";
import { getBusinessDateInput } from "../waste/inventoryWasteService.js";

const finalStatuses = new Set(["submitted", "reviewed", "locked"]);
const closedOrders = new Set(["completed", "cancelled"]);

function groupDue(group, date) {
  if (group.status !== "active") return false;
  const [year, month, day] = date.split("-").map(Number);
  if (group.frequency === "custom") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" });
    return (group.checkDays || []).includes(weekday);
  }
  if (group.frequency === "monthly") {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day === (group.monthDay === "last" ? last : Math.min(Number(group.monthDay || 1), last));
  }
  return false;
}

function groupStatus(group, checks, date) {
  const run = checks.filter((check) => check.groupId === group.id && check.date === date && check.stockCheckType !== "audit");
  if (run.some((check) => finalStatuses.has(check.status))) return "Completed";
  if (run.some((check) => check.status === "skipped")) return "Skipped";
  const due = groupDue(group, date);
  const today = getBusinessDateInput("Asia/Kuala_Lumpur");
  if (due && date < today) return "Missed";
  if (run.some((check) => check.status === "draft")) return "Draft";
  return due ? "Due Today" : "Not Due";
}

function latestVerifiedCounts(checks) {
  const counts = new Map();
  const ordered = checks.filter((check) => finalStatuses.has(check.status))
    .sort((left, right) => String(right.submittedAt || right.date).localeCompare(String(left.submittedAt || left.date)));
  for (const check of ordered) {
    for (const row of check.rows || []) {
      const key = `${check.outletId}:${row.itemId}`;
      if (counts.has(key)) continue;
      counts.set(key, {
        check,
        count: row.skipped || row.na || row.actualCount === "" || row.actualCount === null || !Number.isFinite(Number(row.actualCount))
          ? null : Number(row.actualCount),
      });
    }
  }
  return counts;
}

function movementAfterCheck(movement, check) {
  const movementAt = Date.parse(movement.dateTime || "");
  const submittedAt = Date.parse(check.submittedAt || "");
  if (Number.isFinite(movementAt) && Number.isFinite(submittedAt)) return movementAt > submittedAt;
  if (movement.date > check.date) return true;
  // Without comparable times, a same-day movement cannot be ordered safely.
  return movement.date === check.date ? null : false;
}

export function projectInventoryDashboard(data, outlets, date) {
  const counts = latestVerifiedCounts(data.checks);
  const movementsByPosition = new Map();
  for (const movement of data.movements) {
    if (!movement.outletId || !movement.itemId || !Number.isFinite(Number(movement.quantity)) || Number(movement.quantity) === 0) continue;
    const key = `${movement.outletId}:${movement.itemId}`;
    movementsByPosition.set(key, [...(movementsByPosition.get(key) || []), movement]);
  }
  const itemsById = new Map(data.items.map((item) => [item.id, item]));
  const outletById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const outletRows = outlets.map((outlet) => {
    const groups = data.groups.filter((group) => group.outletId === outlet.id && group.status === "active");
    const due = groups.filter((group) => groupDue(group, date));
    const completed = due.filter((group) => groupStatus(group, data.checks, date) === "Completed").length;
    const stock = { belowPar: 0, sufficient: 0, changed: 0, unverified: 0 };
    for (const item of data.items.filter(isActiveInventoryItem)) {
      if (!item.linkedOutletIds?.includes(outlet.id)) continue;
      const config = outletConfigForItem(item, outlet.id);
      if (!config?.isActive || !Number.isFinite(Number(config.parLevel)) || Number(config.parLevel) <= 0) continue;
      const key = `${outlet.id}:${item.id}`;
      const evidence = counts.get(key);
      if (!evidence || evidence.count === null) { stock.unverified += 1; continue; }
      const movementStates = (movementsByPosition.get(key) || []).map((movement) => movementAfterCheck(movement, evidence.check));
      if (movementStates.includes(true)) stock.changed += 1;
      else if (movementStates.includes(null)) stock.unverified += 1;
      else if (evidence.count < Number(config.parLevel)) stock.belowPar += 1;
      else stock.sufficient += 1;
    }
    const pendingOrders = data.orders.filter((order) => order.outletId === outlet.id && !closedOrders.has(order.status)).length;
    const wasteCount = data.waste.filter((row) => row.outletId === outlet.id).length;
    const completion = due.length ? Math.round(completed / due.length * 100) : null;
    const status = stock.changed ? "Changed Since Check"
      : stock.unverified || stock.belowPar + stock.sufficient === 0 ? "Unverified"
        : stock.belowPar ? "Below Par at Last Check" : "Sufficient at Last Check";
    return { outlet, stock, pendingOrders, wasteCount, completion, status, due, groups };
  });
  const sum = (selector) => outletRows.reduce((total, row) => total + selector(row), 0);
  const dueCount = sum((row) => row.due.length);
  const completedCount = sum((row) => row.due.filter((group) => groupStatus(group, data.checks, date) === "Completed").length);
  const missedCount = outletRows.flatMap((row) => row.groups).filter((group) => groupStatus(group, data.checks, date) === "Missed").length;
  return {
    outletRows,
    stock: { belowPar: sum((row) => row.stock.belowPar), sufficient: sum((row) => row.stock.sufficient), changed: sum((row) => row.stock.changed), unverified: sum((row) => row.stock.unverified) },
    pendingOrders: sum((row) => row.pendingOrders),
    missedCount,
    checkCompletion: dueCount ? Math.round(completedCount / dueCount * 100) : null,
    groups: data.groups.filter((group) => group.status === "active" && outletById.has(group.outletId)),
    recentMovements: [...data.movements].sort((a, b) => String(b.dateTime || b.date).localeCompare(String(a.dateTime || a.date))).slice(0, 6).map((movement) => ({ ...movement, item: itemsById.get(movement.itemId), outlet: outletById.get(movement.outletId) })),
    groupStatus: (group) => groupStatus(group, data.checks, date),
    groupItemCount: (group) => stockCheckItemsForGroup(group, data.items).length,
  };
}
