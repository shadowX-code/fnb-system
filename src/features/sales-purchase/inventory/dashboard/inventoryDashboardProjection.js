import { stockCheckGroupDueOnDate } from "../groups/inventoryGroupsModel.js";
import { getBusinessDateInput } from "../waste/inventoryWasteService.js";

const finalStatuses = new Set(["submitted", "reviewed", "locked"]);
const closedOrders = new Set(["completed", "cancelled"]);
const stockStates = { below_par: "belowPar", sufficient: "sufficient", changed: "changed", unverified: "unverified" };
const emptyStock = () => ({ belowPar: 0, sufficient: 0, changed: 0, unverified: 0 });
const runKey = (outletId, groupId, date) => `${outletId}:${groupId}:${date}`;

function earlierDate(date, days) {
  const calendarDate = new Date(`${date}T00:00:00Z`);
  calendarDate.setUTCDate(calendarDate.getUTCDate() - days);
  return calendarDate.toISOString().slice(0, 10);
}

export function previousClosingMonth(date) {
  return earlierDate(`${date.slice(0, 7)}-01`, 1).slice(0, 7) + "-01";
}

export function projectInventoryDashboard(data, outlets, date) {
  const itemsById = new Map(data.items.map(item => [item.id, item]));
  const outletById = new Map(outlets.map(outlet => [outlet.id, outlet]));
  const outletRows = outlets.map(outlet => ({
    outlet, stock: emptyStock(), pendingOrders: 0, due: 0, completed: 0,
    closing: data.closingStatuses?.[outlet.id],
  }));
  const rowsByOutlet = new Map(outletRows.map(row => [row.outlet.id, row]));
  for (const evidence of data.stockEvidence) {
    const row = rowsByOutlet.get(evidence.outlet_id);
    if (row) row.stock[stockStates[evidence.state]] += 1;
  }
  for (const order of data.orders) {
    const row = rowsByOutlet.get(order.outletId);
    if (row && !closedOrders.has(order.status)) row.pendingOrders += 1;
  }

  const completed = new Set();
  const skipped = new Set();
  const drafts = new Set();
  for (const check of data.checks) {
    if (check.stockCheckType === "audit" || !check.groupId) continue;
    const key = runKey(check.outletId, check.groupId, check.date);
    if (finalStatuses.has(check.status)) completed.add(key);
    else if (check.status === "skipped") skipped.add(key);
    else if (check.status === "draft") drafts.add(key);
  }

  const recentDates = Array.from({ length: 7 }, (_, index) => earlierDate(date, index + 1));
  const dueRuns = [];
  for (const group of data.groups) {
    const row = rowsByOutlet.get(group.outletId);
    if (!row || group.status !== "active") continue;
    if (stockCheckGroupDueOnDate(group, date)) {
      const key = runKey(group.outletId, group.id, date);
      row.due += 1;
      if (completed.has(key)) row.completed += 1;
      else if (!skipped.has(key)) dueRuns.push({ group, outlet: row.outlet, date, status: drafts.has(key) ? "In progress" : "Due today" });
    }
    const created = group.createdAt ? getBusinessDateInput("Asia/Kuala_Lumpur", new Date(group.createdAt)) : "";
    const missed = recentDates.find(day => {
      if (day < created || !stockCheckGroupDueOnDate(group, day)) return false;
      const key = runKey(group.outletId, group.id, day);
      return !completed.has(key) && !skipped.has(key);
    });
    if (missed) dueRuns.push({ group, outlet: row.outlet, date: missed, status: "Overdue" });
  }
  dueRuns.sort((a, b) => b.date.localeCompare(a.date) || a.outlet.name.localeCompare(b.outlet.name) || a.group.name.localeCompare(b.group.name));

  const sum = selector => outletRows.reduce((total, row) => total + selector(row), 0);
  const dueCount = sum(row => row.due);
  const completedCount = sum(row => row.completed);
  return {
    outletRows: outletRows.map(row => ({ ...row, completion: row.due ? Math.round(row.completed / row.due * 100) : null })),
    stock: Object.fromEntries(Object.keys(emptyStock()).map(state => [state, sum(row => row.stock[state])])),
    pendingOrders: sum(row => row.pendingOrders),
    dueCount,
    completedCount,
    checkCompletion: dueCount ? Math.round(completedCount / dueCount * 100) : null,
    dueRuns,
    recentMovements: data.movements.filter(movement => outletById.has(movement.outletId)).slice(0, 5)
      .map(movement => ({ ...movement, item: itemsById.get(movement.itemId), outlet: outletById.get(movement.outletId) })),
  };
}
