import { Children, isValidElement, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import ActionMenu from "../ui/ActionMenu.jsx";

function widthForField(field) {
  const label = String(isValidElement(field) ? field.props.label || field.props["aria-label"] || "" : "").toLowerCase();
  if (label.includes("search")) return "w-full sm:w-[min(360px,100%)]";
  if (/(outlet|supplier|customer|employee|product|material|position)/.test(label)) return "w-full sm:w-[230px]";
  if (/(date|period|month|from|to)/.test(label)) return "w-full sm:w-[180px]";
  return "w-full sm:w-[200px]";
}

function slotItems(value) {
  return Children.toArray(value).filter(Boolean);
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
  periodWidth = "w-full sm:w-[180px]",
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
    outlet && { field: outlet, width: "w-full sm:w-[230px]" },
    period && { field: period, width: periodWidth },
    search && { field: search, width: "w-full sm:w-[min(360px,100%)]" },
    ...slotItems(filters).map((field) => ({ field, width: widthForField(field) })),
    ...(sortChildren ? slotItems(children).sort((left, right) => standardFieldOrder(left) - standardFieldOrder(right)) : slotItems(children)).map((field) => ({ field, width: widthForField(field) })),
  ].filter(Boolean);

  return (
    <section className={`border-b border-border py-4 ${className}`.trim()} aria-label={ariaLabel}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
          {fields.map(({ field, width }, index) => <div className={width} key={field?.key || index}>{field}</div>)}
        </div>
        {moreFilters ? <ActionMenu open={moreOpen} onOpenChange={setMoreOpen} align="right" width={340} ariaLabel="More filters" trigger={({ toggle, ariaLabel: menuLabel }) => <button className={`btn-secondary h-10 shrink-0 px-3 text-sm ${moreOpen ? "border-primary/40 bg-primary/5 text-primary" : ""}`} type="button" aria-label={menuLabel} aria-expanded={moreOpen} onClick={toggle}><SlidersHorizontal size={15} /> Filters</button>}><div className="grid gap-3 p-1">{moreFilters}</div></ActionMenu> : null}
        {activeFilters.length ? <button className="btn-secondary h-10 shrink-0 px-3 text-sm" type="button" onClick={onClear}>Clear all</button> : null}
        {secondaryActions ? <div className="flex flex-wrap gap-2">{secondaryActions}</div> : null}
        {primaryActions ? <div className="flex flex-wrap gap-2">{primaryActions}</div> : null}
      </div>
      {activeFilters.length ? <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters"><span className="text-xs font-semibold text-text-muted">Filtered by</span>{activeFilters.map((filter) => <span className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/15 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary" key={filter.key}><span>{filter.label}: {filter.value}</span><button className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary/70 transition hover:bg-primary/10 hover:text-primary" type="button" aria-label={`Remove ${filter.label} filter`} onClick={filter.onRemove}><X size={13} /></button></span>)}</div> : null}
    </section>
  );
}
