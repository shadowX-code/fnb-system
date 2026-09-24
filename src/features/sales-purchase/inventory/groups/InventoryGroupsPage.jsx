import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, PackagePlus, Search } from "lucide-react";
import AdminFilterToolbar, { ALL_FILTER_OPTION, AdminOutletField } from "../../../../components/layout/AdminFilterToolbar.jsx";
import FactoryRowActions from "../../../factory/components/FactoryRowActions.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";

export function InventoryGroupsPageActions({ onCreateGroup }) {
  return <button className="btn-primary" type="button" onClick={onCreateGroup}><PackagePlus size={15} /> Add Group</button>;
}

export default function InventoryGroupsPage({
  groups,
  items,
  checks,
  categories,
  outlets,
  outletOptions,
  selectedOutletId,
  onSelectedOutletChange,
  date,
  statuses,
  frequencies,
  toTitle,
  statusTone,
  formatDate,
  groupCategoryIds,
  stockCheckItemsForGroup,
  dueStatus,
  compactFrequencyLabel,
  onEditGroup,
  onDuplicateGroup,
  onArchiveGroup,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [search, setSearch] = useState("");
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const filteredGroups = groups.filter((group) => {
    const outlet = outletById.get(group.outletId);
    const categoryIds = groupCategoryIds(group, items);
    const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).join(" ");
    const matchesOutlet = selectedOutletId === "all" || group.outletId === selectedOutletId;
    const matchesStatus = statusFilter === "all" || group.status === statusFilter;
    const matchesFrequency = frequencyFilter === "all" || group.frequency === frequencyFilter;
    const matchesSearch = !search.trim() || `${group.name} ${group.description} ${outlet?.name || ""} ${categoryNames}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesOutlet && matchesStatus && matchesFrequency && matchesSearch;
  });
  const dueToday = filteredGroups.filter((group) => dueStatus(group, checks, date) === "Due Today").length;
  const completedToday = filteredGroups.filter((group) => dueStatus(group, checks, date) === "Completed").length;
  const inactiveGroups = filteredGroups.filter((group) => group.status !== "active").length;
  const emptyTitle = selectedOutletId === "all" ? "Create stock check groups so outlets know what to count." : "Create the first stock check group for this outlet.";
  const accessibleOutletOptions = outletOptions.filter((option) => option.value !== "all");

  return (
    <div className="space-y-4">
      <AdminFilterToolbar ariaLabel="Stock check group filters" denseFields
        outlet={<AdminOutletField label="Outlet" value={selectedOutletId} options={accessibleOutletOptions} allowAll searchable onChange={onSelectedOutletChange} />}
        search={<label>
          <div className="mb-1 type-caption font-semibold text-text-secondary">Search group</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input className="control h-9 w-full pl-9 text-[13px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search group or category" />
          </div>
        </label>}
        filters={<><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} /><SelectField label="Frequency" value={frequencyFilter} options={[ALL_FILTER_OPTION, ...frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))]} onChange={setFrequencyFilter} /></>}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard icon={ClipboardList} label="Total Groups" value={filteredGroups.length} helper="Current filter scope" />
        <MetricCard icon={CalendarDays} label="Due Today" value={dueToday} helper="Ready to count" tone={dueToday ? "warning" : "success"} />
        <MetricCard icon={CheckCircle2} label="Completed Today" value={completedToday} helper="Done for selected date" tone="success" />
        <MetricCard icon={AlertTriangle} label="Inactive Groups" value={inactiveGroups} helper="Archived or inactive" tone={inactiveGroups ? "neutral" : "success"} />
      </div>
      <div className="card p-3">
        {filteredGroups.length ? (
          <div className="space-y-2">
            {filteredGroups.map((group) => {
              const categoryIds = groupCategoryIds(group, items);
              const itemCount = stockCheckItemsForGroup(group, items).length;
              const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean);
              const visibleCategories = categoryNames.slice(0, 2);
              const hiddenCategoryCount = Math.max(0, categoryNames.length - visibleCategories.length);
              const due = dueStatus(group, checks, date);
              const schedule = group.frequency === "custom"
                ? (() => { const days = group.checkDays || []; const count = days.length; return count === 1 ? `Every ${days[0]}` : count === 7 ? "Every day" : `Every ${count} days`; })()
                : compactFrequencyLabel(group);
              return (
                <div key={group.id} className="rounded-xl border border-border bg-white px-4 py-3 transition hover:border-primary/25 hover:bg-primary/5">
                  <div className="grid gap-x-5 gap-y-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(180px,.7fr)_minmax(200px,.85fr)_auto] xl:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-text-primary">{group.name}</div>
                      <div className="mt-1 type-caption text-text-secondary">{outletById.get(group.outletId)?.name || "Outlet"} · {group.shift} · Last checked {group.lastChecked ? formatDate(group.lastChecked) : "Never"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary" title={(group.checkDays || []).join(", ")}>{schedule}</span>
                      <Badge tone={statusTone(due.toLowerCase())}>{due}</Badge>
                    </div>
                    <div className="min-w-0">
                      <div className="type-caption font-semibold text-text-secondary">{itemCount} items</div>
                      <div className="mt-1 flex flex-wrap gap-1.5" title={categoryNames.join(", ")}>
                        {visibleCategories.map((name) => <span key={name} className="rounded-full border border-border bg-slate-50 px-2 py-0.5 type-caption font-semibold text-text-secondary">{name}</span>)}
                        {hiddenCategoryCount ? <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5 type-caption font-semibold text-text-secondary">+{hiddenCategoryCount}</span> : null}
                        {!categoryNames.length ? <span className="type-caption font-semibold text-text-muted">No categories</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 xl:justify-end">
                      <span className="type-caption font-semibold text-text-muted">{toTitle(group.status)}</span>
                      <FactoryRowActions directActions={[{ label: "Edit", variant: "button", onClick: () => onEditGroup(group) }, { label: "Duplicate", variant: "button", onClick: () => onDuplicateGroup(group, categoryIds) }, group.status === "active" ? { label: "Archive", variant: "button", destructive: true, onClick: () => onArchiveGroup(group) } : null]} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState title={emptyTitle} description="Groups decide which categories appear in custom or monthly checks." />}
      </div>
    </div>
  );
}
