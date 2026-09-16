import { Children, Fragment, isValidElement, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import ActionMenu from "../ui/ActionMenu.jsx";

function labelForField(field) {
  return String(isValidElement(field) ? field.props.label || field.props["aria-label"] || "" : "").toLowerCase();
}

function roleForField(field) {
  const declaredRole = isValidElement(field) ? field.type?.adminFilterRole : null;
  if (declaredRole) return declaredRole;
  const label = labelForField(field);
  if (label.includes("date range")) return "date-range";
  if (/(date|period|month|from|to)/.test(label)) return "period";
  return "filter";
}

function widthForField(field) {
  const role = roleForField(field);
  if (role === "date-range") return "w-full sm:w-[220px]";
  return "w-full sm:w-[180px]";
}

function slotItems(value) {
  return Children.toArray(value).flatMap((item) => isValidElement(item) && item.type === Fragment ? slotItems(item.props.children) : item ? [item] : []);
}

function standardFieldOrder(field) {
  const label = String(isValidElement(field) ? field.props.label || "" : "").toLowerCase();
  if (label.includes("search")) return 0;
  if (label === "date") return 1;
  if (label === "to") return 2;
  return 3;
}

export default function AdminFilterToolbar({
  outlet,
  period,
  periodWidth,
  search,
  filters,
  children,
  moreFilters,
  activeFilters = [],
  onClear,
  secondaryActions,
  primaryActions,
  sortChildren = false,
  className = "",
  ariaLabel = "Filters",
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const fields = [
    outlet && { field: outlet, slot: "outlet", role: "outlet", width: "w-full sm:w-[230px]" },
    period && { field: period, slot: "period", role: roleForField(period), width: periodWidth || widthForField(period) },
    search && { field: search, slot: "search", role: "search", width: "w-full min-w-0 sm:flex-[1_1_280px]" },
    ...slotItems(filters).map((field) => ({ field, slot: "filter", role: roleForField(field), width: widthForField(field) })),
    ...(sortChildren ? slotItems(children).sort((left, right) => standardFieldOrder(left) - standardFieldOrder(right)) : slotItems(children)).map((field) => ({ field, slot: "filter", role: roleForField(field), width: widthForField(field) })),
  ].filter(Boolean);

  return (
    <section className={`admin-filter-toolbar rounded-lg border border-border bg-surface/80 shadow-sm ${className}`.trim()} aria-label={ariaLabel} data-admin-filter-toolbar>
      <div className="admin-filter-toolbar-row flex flex-wrap items-end">
        <div className="flex min-w-0 flex-[1_1_640px] flex-wrap items-end" data-admin-filter-fields>
          {fields.map(({ field, slot, role, width }, index) => <div className={`${width} ${role === "search" ? "min-w-0" : "min-w-0 shrink-0"} admin-filter-field`.trim()} data-admin-filter-slot={slot} data-admin-filter-role={role} key={field?.key || index}>{field}</div>)}
        </div>
        {moreFilters || activeFilters.length || secondaryActions || primaryActions ? <div className="flex w-full flex-wrap items-end sm:w-auto sm:justify-end" data-admin-filter-actions>
          {moreFilters ? <ActionMenu open={moreOpen} onOpenChange={setMoreOpen} align="right" width={340} ariaLabel="More filters" trigger={({ toggle, ariaLabel: menuLabel }) => <button className={`btn-secondary h-10 shrink-0 px-3 text-sm ${moreOpen ? "border-primary/40 bg-primary/5 text-primary" : ""}`} type="button" aria-label={menuLabel} aria-expanded={moreOpen} onClick={toggle}><SlidersHorizontal size={15} /> Filters</button>}><div className="grid gap-3 p-1">{moreFilters}</div></ActionMenu> : null}
          {activeFilters.length ? <button className="btn-secondary h-10 shrink-0 px-3 text-sm" type="button" onClick={onClear}>Clear all</button> : null}
          {secondaryActions ? <div className="flex flex-wrap gap-2">{secondaryActions}</div> : null}
          {primaryActions ? <div className="flex flex-wrap gap-2">{primaryActions}</div> : null}
        </div> : null}
      </div>
      {activeFilters.length ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3" aria-label="Active filters"><span className="text-xs font-semibold text-text-muted">Filtered by</span>{activeFilters.map((filter) => <span className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/15 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary" key={filter.key}><span>{filter.label}: {filter.value}</span><button className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary/70 transition hover:bg-primary/10 hover:text-primary" type="button" aria-label={`Remove ${filter.label} filter`} onClick={filter.onRemove}><X size={13} /></button></span>)}</div> : null}
    </section>
  );
}
