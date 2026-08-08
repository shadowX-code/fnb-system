export function canonicalDashboardUom(value) { return String(value || "unit").trim().toLowerCase() || "unit"; }
export function dashboardUomOptions(rows) { return [...new Set((rows || []).map((row) => canonicalDashboardUom(row.uom_key || row.uom)).filter(Boolean))].sort(); }
export function selectedDashboardUom(options, selected) { return options.includes(selected) ? selected : options[0] || ""; }
export function dashboardProductAxisLabel(row) { return [row?.product, row?.packaging_sku].filter(Boolean).join(" · "); }
export function visibleDashboardActions(actions, filter) { const statusByFilter = { low: "low_stock", out: "out_of_stock", expiring: "expiring", reconciliation: "reconciliation" }; return filter === "all" ? actions : (actions || []).filter((row) => row.inventory_status === statusByFilter[filter]); }
export function toggleDashboardActionFilter(current, next) { return current === next ? "all" : next; }
