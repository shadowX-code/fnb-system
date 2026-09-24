import { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, PackagePlus } from "lucide-react";
import AdminFilterToolbar, { ALL_FILTER_OPTION, AdminOutletField } from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import FactoryRowActions from "../../../factory/components/FactoryRowActions.jsx";
import { FactoryDataSurface, FactoryTable } from "../../../factory/components/FactoryDataDisplay.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
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
  const tableRows = filteredGroups.map((group) => {
    const categoryIds = groupCategoryIds(group, items);
    const categoryNames = categoryIds.map((id) => categoryById.get(id)?.name).filter(Boolean);
    const days = group.checkDays || [];
    return {
      ...group,
      outletName: outletById.get(group.outletId)?.name || "Outlet",
      categoryIds,
      categoryNames,
      itemCount: stockCheckItemsForGroup(group, items).length,
      checkStatus: dueStatus(group, checks, date),
      schedule: group.frequency === "custom"
        ? days.length === 1 ? `Every ${days[0]}` : days.length === 7 ? "Every day" : `Every ${days.length} days`
        : compactFrequencyLabel(group),
    };
  });
  const columns = [
    { key: "group", label: "Group", className: "min-w-[180px] w-[23%]", render: (group) => <div className="min-w-0"><div className="font-semibold text-text-primary break-words">{group.name}</div><div className="mt-0.5 text-xs text-text-secondary">Last checked {group.lastChecked ? formatDate(group.lastChecked) : "Never"}</div></div> },
    { key: "outlet", label: "Outlet / Shift", className: "min-w-[145px] w-[17%]", render: (group) => <div><div className="font-medium text-text-primary">{group.outletName}</div><div className="mt-0.5 text-xs text-text-secondary">{group.shift}</div></div> },
    { key: "schedule", label: "Schedule", className: "min-w-[125px] w-[13%]", render: (group) => <span className="font-medium text-text-primary" title={(group.checkDays || []).join(", ")}>{group.schedule}</span> },
    { key: "checkStatus", label: "Check Status", className: "min-w-[125px] w-[13%]", render: (group) => <Badge tone={statusTone(group.checkStatus.toLowerCase())}>{group.checkStatus === "Due Today" ? "Due" : group.checkStatus}</Badge> },
    { key: "scope", label: "Scope", className: "min-w-[185px] w-[20%]", render: (group) => <div className="min-w-0"><div className="text-xs font-semibold text-text-secondary">{group.itemCount} items</div><div className="mt-1 flex flex-wrap gap-1" title={group.categoryNames.join(", ")}>{group.categoryNames.slice(0, 2).map((name) => <span key={name} className="max-w-[110px] truncate rounded-full border border-border bg-slate-50 px-2 py-0.5 text-xs font-medium text-text-secondary">{name}</span>)}{group.categoryNames.length > 2 ? <span className="rounded-full border border-border bg-slate-50 px-2 py-0.5 text-xs font-medium text-text-secondary">+{group.categoryNames.length - 2}</span> : null}{!group.categoryNames.length ? <span className="text-xs text-text-muted">No categories</span> : null}</div></div> },
    { key: "status", label: "Status", className: "min-w-[80px] w-[8%]", render: (group) => <span className="text-xs font-medium text-text-secondary">{toTitle(group.status)}</span> },
    { key: "actions", label: "Actions", className: "min-w-[80px] w-[6%]", align: "right", render: (group) => <FactoryRowActions secondaryActions={[{ label: "Edit", onClick: () => onEditGroup(group) }, { label: "Duplicate", onClick: () => onDuplicateGroup(group, group.categoryIds) }, group.status === "active" ? { label: "Archive", destructive: true, onClick: () => onArchiveGroup(group) } : null]} /> },
  ];

  return (
    <div className="space-y-4">
      <AdminFilterToolbar ariaLabel="Stock check group filters" denseFields
        outlet={<AdminOutletField label="Outlet" value={selectedOutletId} options={accessibleOutletOptions} allowAll searchable onChange={onSelectedOutletChange} />}
        search={<AdminSearchField label="Search Group" value={search} onChange={setSearch} placeholder="Search group or category" />}
        filters={<><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} /><SelectField label="Frequency" value={frequencyFilter} options={[ALL_FILTER_OPTION, ...frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))]} onChange={setFrequencyFilter} /></>}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard icon={ClipboardList} label="Total Groups" value={filteredGroups.length} helper="Current filter scope" />
        <MetricCard icon={CalendarDays} label="Due Today" value={dueToday} helper="Ready to count" tone={dueToday ? "warning" : "success"} />
        <MetricCard icon={CheckCircle2} label="Completed Today" value={completedToday} helper="Done for selected date" tone="success" />
        <MetricCard icon={AlertTriangle} label="Inactive Groups" value={inactiveGroups} helper="Archived or inactive" tone={inactiveGroups ? "neutral" : "success"} />
      </div>
      <FactoryDataSurface>
        <FactoryTable columns={columns} rows={tableRows} rowHover="mint" emptyTitle={emptyTitle} emptyDescription="Groups decide which categories appear in custom or monthly checks." />
      </FactoryDataSurface>
    </div>
  );
}
