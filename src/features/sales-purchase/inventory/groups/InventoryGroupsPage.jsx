import { useMemo, useState } from "react";
import { PackagePlus, Pencil } from "lucide-react";
import AdminFilterToolbar, { ALL_FILTER_OPTION, AdminOutletField } from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import AdminSummaryGrid from "../../../../components/ui/AdminSummaryGrid.jsx";
import { FactoryDataSurface, FactoryTable } from "../../../factory/components/FactoryDataDisplay.jsx";
import FactoryRowActions from "../../../factory/components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../../../factory/components/FactoryStatusBadge.jsx";

function scheduleLabel(group, toTitle) {
  if (group.frequency === "monthly") return "Monthly";
  if (group.frequency === "custom") {
    const days = group.checkDays || [];
    if (days.length === 7) return "Daily";
    if (days.length === 1) return days[0].slice(0, 3);
    return days.length ? `${days.length} days` : "Custom";
  }
  return toTitle(group.frequency);
}

function GroupScopeDetails({ group, categoryById, onClose }) {
  return <Modal title="Scope Details" description={group.name} size="md" onClose={onClose}>
    <div className="mb-3 text-sm font-semibold text-text-primary">{group.scopeItems.length} {group.scopeItems.length === 1 ? "item" : "items"} in {group.categoryIds.length} {group.categoryIds.length === 1 ? "category" : "categories"}</div>
    <div className="divide-y divide-border">
      {group.categoryIds.map((categoryId) => {
        const categoryItems = group.scopeItems.filter((item) => item.categoryId === categoryId);
        return <section key={categoryId} className="py-3 first:pt-0">
          <div className="flex items-center justify-between gap-3 text-sm font-semibold text-text-primary">
            <h3>{categoryById.get(categoryId)?.name || "Uncategorized"}</h3>
            <span className="shrink-0 text-xs font-medium text-text-secondary">{categoryItems.length} {categoryItems.length === 1 ? "item" : "items"}</span>
          </div>
          {categoryItems.length ? <ul className="mt-2 divide-y divide-border/70">
            {categoryItems.map((item) => <li key={item.id} className="flex items-start justify-between gap-4 py-2 text-sm">
              <span className="min-w-0 break-words text-text-primary">{item.name}</span>
              <span className="max-w-[45%] break-all text-right text-xs text-text-secondary">{item.sku || "No SKU"}{item.unit ? ` · ${item.unit}` : ""}</span>
            </li>)}
          </ul> : <p className="mt-1 text-xs text-text-secondary">No active items linked to this outlet.</p>}
        </section>;
      })}
      {!group.categoryIds.length ? <p className="py-3 text-sm text-text-secondary">No categories selected.</p> : null}
    </div>
  </Modal>;
}

export function InventoryGroupsPageActions({ onCreateGroup }) {
  return <button className="btn-primary" type="button" onClick={onCreateGroup}><PackagePlus size={15} /> Add Group</button>;
}

export default function InventoryGroupsPage({
  groups,
  items,
  categories,
  outletOptions,
  selectedOutletId,
  onSelectedOutletChange,
  statuses,
  frequencies,
  toTitle,
  groupCategoryIds,
  stockCheckItemsForGroup,
  onEditGroup,
  onDuplicateGroup,
  onArchiveGroup,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [scopeGroupId, setScopeGroupId] = useState("");
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const tableRows = groups.filter((group) => {
    const categoryNames = groupCategoryIds(group, items).map((id) => categoryById.get(id)?.name).join(" ");
    return group.outletId === selectedOutletId
      && (statusFilter === "all" || group.status === statusFilter)
      && (frequencyFilter === "all" || group.frequency === frequencyFilter)
      && (!search.trim() || `${group.name} ${group.description} ${categoryNames}`.toLowerCase().includes(search.trim().toLowerCase()));
  }).map((group) => ({
    ...group,
    categoryIds: groupCategoryIds(group, items),
    scopeItems: stockCheckItemsForGroup(group, items),
    schedule: scheduleLabel(group, toTitle),
  }));
  const activeCount = tableRows.filter((group) => group.status === "active").length;
  const selectedScope = tableRows.find((group) => group.id === scopeGroupId);
  const columns = [
    { key: "group", label: "Group", className: "min-w-[200px] w-[32%]", render: (group) => <div className="min-w-0"><div className="break-words font-semibold text-text-primary">{group.name}</div>{group.shift ? <div className="mt-0.5 text-xs text-text-secondary">{group.shift}</div> : null}</div> },
    { key: "schedule", label: "Schedule", className: "min-w-[110px] w-[17%]", render: (group) => <span className="font-medium text-text-primary">{group.schedule}</span> },
    { key: "scope", label: "Scope", className: "min-w-[110px] w-[16%]", render: (group) => <button className="text-sm font-semibold text-primary hover:underline focus-visible:underline" type="button" aria-label={`View scope for ${group.name}`} onClick={() => setScopeGroupId(group.id)}>{group.scopeItems.length} {group.scopeItems.length === 1 ? "item" : "items"}</button> },
    { key: "status", label: "Status", className: "min-w-[105px] w-[13%]", render: (group) => <FactoryStatusBadge status={group.status}>{toTitle(group.status)}</FactoryStatusBadge> },
    { key: "actions", label: "Actions", className: "min-w-[120px] w-[15%]", align: "right", render: (group) => <FactoryRowActions onView={() => setScopeGroupId(group.id)} viewLabel="View" directActions={[{ label: "Edit", icon: Pencil, onClick: () => onEditGroup(group) }]} secondaryActions={[{ label: "Duplicate", onClick: () => onDuplicateGroup(group, group.categoryIds) }, group.status === "active" ? { label: "Deactivate", destructive: true, onClick: () => onArchiveGroup(group) } : null]} /> },
  ];

  return <div className="space-y-4">
    <AdminFilterToolbar ariaLabel="Stock check group filters" denseFields
      outlet={<AdminOutletField label="Outlet" value={selectedOutletId} options={outletOptions} searchable onChange={onSelectedOutletChange} />}
      search={<AdminSearchField label="Search Group" value={search} onChange={setSearch} placeholder="Search group or category" />}
      filters={<><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} /><SelectField label="Frequency" value={frequencyFilter} options={[ALL_FILTER_OPTION, ...frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))]} onChange={setFrequencyFilter} /></>}
    />
    <AdminSummaryGrid variant="compact" ariaLabel="Group configuration summary" items={[
      { key: "total", label: "Total Groups", value: tableRows.length },
      { key: "active", label: "Active", value: activeCount },
      { key: "inactive", label: "Inactive / Archived", value: tableRows.length - activeCount },
    ]} />
    <FactoryDataSurface>
      <FactoryTable columns={columns} rows={tableRows} rowHover="mint" emptyTitle={selectedOutletId ? "No stock check groups for this outlet" : "No accessible outlet"} emptyDescription="Groups configure which items appear in scheduled checks." />
    </FactoryDataSurface>
    {selectedScope ? <GroupScopeDetails group={selectedScope} categoryById={categoryById} onClose={() => setScopeGroupId("")} /> : null}
  </div>;
}
