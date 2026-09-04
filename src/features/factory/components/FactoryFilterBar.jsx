import { useState } from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";

export default function FactoryFilterBar({ children, moreFilters, activeFilters = [], onClear, className = "" }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <section className={`border-b border-border py-3 ${className}`} aria-label="Filters">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">{children}</div>
        {moreFilters ? (
          <ActionMenu
            open={moreOpen}
            onOpenChange={setMoreOpen}
            align="right"
            width={360}
            ariaLabel="More filters"
            trigger={({ toggle, ariaLabel }) => (
              <button className={`btn-secondary h-10 shrink-0 px-3 text-sm ${moreOpen ? "border-primary/40 bg-primary/5 text-primary" : ""}`} type="button" aria-label={ariaLabel} aria-expanded={moreOpen} onClick={toggle}>
                {moreOpen ? <SlidersHorizontal size={15} /> : <Plus size={15} />}
                Filters
              </button>
            )}
          >
            <div className="grid gap-3 p-2">{moreFilters}</div>
          </ActionMenu>
        ) : null}
        {hasActiveFilters ? <button className="btn-secondary h-10 shrink-0 px-3 text-sm" type="button" onClick={onClear}>Clear all</button> : null}
      </div>
      {hasActiveFilters ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
          <span className="text-xs font-semibold text-text-muted">Filtered by</span>
          {activeFilters.map((filter) => (
            <span key={filter.key} className="inline-flex h-7 items-center gap-1 rounded-full border border-primary/15 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary">
              <span>{filter.label}: {filter.value}</span>
              <button className="inline-flex h-5 w-5 items-center justify-center rounded-full text-primary/70 transition hover:bg-primary/10 hover:text-primary" type="button" aria-label={`Remove ${filter.label} filter`} onClick={filter.onRemove}><X size={13} /></button>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
