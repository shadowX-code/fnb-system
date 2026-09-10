import { useMemo, useState } from "react";
import { Activity, CheckCircle2, ClipboardCheck, Factory, FileText } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { ProductionSopBuilderModal, ProductionSopDocumentModal, QcChecklistPresetManagerModal } from "../modals/sop/FactoryProductionSopModals.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { sopMinutesLabel, sopTotalEstimatedMinutes } from "../utils/factoryFormatters.js";
import { productionSopActions } from "../utils/factoryPermissionActions.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";
import { groupedProductionSops } from "../utils/productionSop.js";

const qcPointCount = (sop) => (sop.steps || []).reduce((sum, step) => sum + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);

export default function FactoryProductionSopPage() {
  const { productFamilies, recipes, sops = [], qcChecklistTemplates, equipment } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const actions = useFactoryNavigation();
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [builder, setBuilder] = useState(null);
  const [detail, setDetail] = useState(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const filteredSops = useMemo(() => sops.filter((sop) => {
    const haystack = `${sop.product_name || ""} ${sop.product_name_en || ""} ${sop.product_family_name || ""} ${sop.version || ""}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase())) && (!filters.status || sop.status === filters.status);
  }), [filters, sops]);
  const groups = useMemo(() => groupedProductionSops(filteredSops), [filteredSops]);
  const pager = useFactoryClientPagination("production-sop", groups.length, 20, JSON.stringify(filters));
  const visibleGroups = groups.slice(pager.from, pager.to);
  const qcCheckpointCount = sops.reduce((sum, sop) => sum + qcPointCount(sop), 0);
  const coveredProducts = new Set(sops.map((sop) => sop.finished_good_id || sop.product_name).filter(Boolean)).size;
  const activeFilters = [
    filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) },
    filters.status && { key: "status", label: "Status", value: jobStatusLabel(filters.status), onRemove: () => setFilters((current) => ({ ...current, status: "" })) },
  ].filter(Boolean);
  const renderActions = (row) => {
    const available = productionSopActions(can, row.status);
    return <FactoryRowActions
      onView={() => setDetail(row)}
      primaryAction={available.activate ? { label: "Activate", onClick: () => actions.activateProductionSop(row) } : available.restore ? { label: "Restore", onClick: () => actions.restoreProductionSop(row) } : null}
      directActions={[
        available.edit ? { label: "Edit SOP", onClick: () => setBuilder(row) } : null,
        available.newVersion ? { label: "New Version", variant: "button", compact: true, onClick: async () => { const draft = await actions.createProductionSopNewVersion(row); if (draft) setBuilder(draft); } } : null,
      ]}
      secondaryActions={[
        available.deleteDraft ? { label: "Delete", destructive: true, onClick: () => actions.deleteProductionSop(row) } : null,
        available.archive ? { label: "Archive", destructive: true, onClick: () => actions.archiveProductionSop(row) } : null,
      ]}
    />;
  };
  const columns = [
    { key: "version", label: "Version", render: (row) => <span className="font-semibold text-text-primary">{row.version || "v1"}</span> },
    { key: "steps", label: "Steps", render: (row) => row.steps?.length || 0 },
    { key: "qc", label: "QC Points", render: (row) => qcPointCount(row) || <FactoryCellMuted>None</FactoryCellMuted> },
    { key: "estimated_time", label: "Estimated Time", render: (row) => sopMinutesLabel(sopTotalEstimatedMinutes(row)) },
    { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={jobStatusLabel(row.status)} /> },
    { key: "updated", label: "Updated", render: (row) => row.updated_at ? formatFactoryDate(row.updated_at) : <FactoryCellMuted /> },
    { key: "actions", label: "Actions", align: "right", render: renderActions },
  ];

  return <div className="space-y-5">
    <PageHeader section="Master Data" title="Production SOP" description="Manage standard process references, product steps and QC checkpoint flags." actions={<div className="flex flex-wrap gap-2">{productionSopActions(can, "").manageQcPresets ? <button className="btn-secondary" type="button" onClick={() => setPresetsOpen(true)}><ClipboardCheck size={15} /> Manage QC Checks</button> : null}{can("factory_production_sop.create") ? <button className="btn-primary" type="button" onClick={() => setBuilder({})}><FileText size={15} /> Create SOP</button> : null}</div>} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={ClipboardCheck} label="SOPs" value={sops.length} helper="Standard process references" /><MetricCard icon={Factory} label="Products Covered" value={coveredProducts} helper="Finished goods with SOPs" /><MetricCard icon={Activity} label="QC Checkpoints" value={qcCheckpointCount} helper="QC required steps" /><MetricCard icon={CheckCircle2} label="Active SOPs" value={sops.filter((sop) => sop.status === "active").length} helper="Available for production" /></div>
    <FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters({ search: "", status: "" })}>
      <Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Search product or version" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field>
      <Field label="Status"><SearchableSelect value={filters.status} options={[{ value: "", label: "All" }, { value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} placeholder="All" searchPlaceholder="Search status" onChange={(status) => setFilters((current) => ({ ...current, status }))} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface>
      {visibleGroups.length ? <div className="divide-y divide-border">{visibleGroups.map((group) => <section key={group.id} className="overflow-x-auto"><div className="flex items-center justify-between gap-4 border-b border-border bg-[var(--theme-subtle)] px-4 py-3"><div className="min-w-0"><div className="text-sm font-semibold text-text-primary">{group.productName}</div>{group.productNameCn ? <div className="mt-0.5 text-xs text-text-secondary">{group.productNameCn}</div> : null}</div><span className="shrink-0 text-xs font-semibold text-text-secondary">{group.sops.length} {group.sops.length === 1 ? "Version" : "Versions"}</span></div><FactoryTable columns={columns} rows={group.sops} rowHover="mint" onRowClick={setDetail} /></section>)}</div> : <EmptyState title="No Production SOPs" description="No SOPs match the selected filters." />}
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={groups.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
    {builder ? <ProductionSopBuilderModal initialValue={builder} productFamilies={productFamilies} recipes={recipes} sops={sops} equipment={equipment} qcChecklistTemplates={qcChecklistTemplates} onClose={() => setBuilder(null)} onSave={async (form) => { await actions.saveProductionSop(form); setBuilder(null); }} /> : null}
    {detail ? <ProductionSopDocumentModal sop={detail} onClose={() => setDetail(null)} /> : null}
    {presetsOpen ? <QcChecklistPresetManagerModal templates={qcChecklistTemplates} sops={sops} onClose={() => setPresetsOpen(false)} onCreate={actions.createQcChecklistTemplate} onUpdate={actions.updateQcChecklistTemplate} onArchive={actions.archiveQcChecklistTemplate} onRestore={actions.restoreQcChecklistTemplate} onDelete={actions.deleteQcChecklistTemplate} /> : null}
  </div>;
}
