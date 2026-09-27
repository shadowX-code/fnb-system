export function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function mapRemoteStockCheckGroup(row = {}, categoryIds = []) {
  const schedule = row.schedule_config || {};
  const lastCheckedAt = row.last_checked_at || row.lastCheckedAt || "";
  return {
    id: row.id,
    outletId: row.outlet_id || row.outletId || "",
    name: row.name || "Stock Check Group",
    description: row.description || "",
    categoryIds: uniqueIds(categoryIds),
    itemIds: [],
    frequency: row.frequency_type || row.frequency || "custom",
    checkDays: Array.isArray(row.frequency_days) ? row.frequency_days : (schedule.checkDays || []),
    monthDay: schedule.monthDay || row.month_day || 1,
    shift: row.shift || "Closing",
    assignedStaff: schedule.assignedStaff || row.assigned_staff || "",
    status: row.status || "active",
    lastChecked: lastCheckedAt || "",
    lastCheckedAt,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export function groupCategoryIds(group = {}, items = []) {
  const directIds = group.categoryIds || group.category_ids || [];
  if (directIds.length) return uniqueIds(directIds);
  const itemIds = group.itemIds || group.item_ids || [];
  if (!itemIds.length) return [];
  const categoryIds = itemIds
    .map((itemId) => items.find((item) => item.id === itemId)?.categoryId)
    .filter(Boolean);
  return uniqueIds(categoryIds);
}

export function itemHasActiveOutletLink(item = {}, outletId) {
  return (item.linkedOutletIds || []).includes(outletId);
}
export const statuses = ["active", "inactive", "archived"];
export const frequencies = ["custom", "monthly"];
export const shifts = ["Opening", "Mid", "Closing", "Any Shift"];
export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export function isActiveInventoryItem(item = {}) { return item.isActive !== false && !["inactive", "archived", "deleted"].includes(String(item.status || "active").toLowerCase()); }
export function stockCheckItemsForGroup(group = {}, items = []) {
  const selectedItemIds = uniqueIds(group.itemIds || group.item_ids || []);
  if (group.stockCheckType === "audit" && selectedItemIds.length) {
    const selected = new Set(selectedItemIds);
    return items
      .filter(isActiveInventoryItem)
      .filter((item) => selected.has(item.id))
      .filter((item) => itemHasActiveOutletLink(item, group.outletId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const selectedCategories = new Set(groupCategoryIds(group, items));
  if (!selectedCategories.size) return [];
  return items
    .filter(isActiveInventoryItem)
    .filter((item) => selectedCategories.has(item.categoryId))
    .filter((item) => itemHasActiveOutletLink(item, group.outletId))
    .sort((a, b) => a.name.localeCompare(b.name));
}
