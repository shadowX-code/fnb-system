import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Factory, FileText, TriangleAlert } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import FactorySummaryCard from "../components/FactorySummaryCard.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { ProductionSopBuilderModal, ProductionSopDocumentModal, QcChecklistPresetManagerModal } from "../modals/sop/FactoryProductionSopModals.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { sopTotalEstimatedMinutes } from "../utils/factoryFormatters.js";
import { productionSopActions } from "../utils/factoryPermissionActions.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";
import { productFirstProductionSops } from "../utils/productionSop.js";

const estimatedTimeLabel = (sop) => {
  const minutes = sopTotalEstimatedMinutes(sop);
  return minutes > 0 ? `${minutes.toLocaleString("en-MY")} min` : "Not set";
};

const structureLabel = (row) => [
  `${row.structure.stepCount} ${row.structure.stepCount === 1 ? "step" : "steps"}`,
  row.structure.subStepCount ? `${row.structure.subStepCount} ${row.structure.subStepCount === 1 ? "sub-step" : "sub-steps"}` : null,
].filter(Boolean).join(" · ");

export default function FactoryProductionSopPage() {
  const { productFamilies, recipes, sops = [], qcChecklistTemplates, equipment } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const actions = useFactoryNavigation();
  const [filters, setFilters] = useState({ search: "", status: "", setup: "" });
  const [builder, setBuilder] = useState(null);
  const [detail, setDetail] = useState(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState({});
  const productRows = useMemo(() => productFirstProductionSops(sops, equipment), [equipment, sops]);
  const filteredRows = useMemo(() => productRows.filter((row) => {
    const haystack = `${row.productName || ""} ${row.productNameCn || ""} ${(row.versions || []).map((version) => version.version || "").join(" ")}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase()))
      && (!filters.status || row.status === filters.status)
      && (!filters.setup || row.readiness.key === filters.setup);
  }), [filters, productRows]);
  const pager = useFactoryClientPagination("production-sop", filteredRows.length, 20, JSON.stringify(filters));
  const visibleRows = filteredRows.slice(pager.from, pager.to);
  const draftCount = productRows.filter((row) => row.status === "draft").length;
  const activeCount = productRows.filter((row) => row.status === "active").length;
  const needsSetupCount = productRows.filter((row) => row.status === "draft" && !row.readiness.isReady).length;
  const activeFilters = [
    filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) },
    filters.status && { key: "status", label: "Status", value: jobStatusLabel(filters.status), onRemove: () => setFilters((current) => ({ ...current, status: "" })) },
    filters.setup && { key: "setup", label: "Setup", value: filters.setup === "ready" ? "Ready" : "Needs setup", onRemove: () => setFilters((current) => ({ ...current, setup: "" })) },
  ].filter(Boolean);
  const renderActions = (row) => {
    const available = productionSopActions(can, row.status);
    return <FactoryRowActions
      onView={() => setDetail(row)}
      primaryAction={available.activate && row.readiness.isReady ? { label: "Activate", onClick: () => actions.activateProductionSop(row) } : available.restore ? { label: "Restore", onClick: () => actions.restoreProductionSop(row) } : null}
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
  const versionCell = (row, showHistory = true) => <div className="flex items-center gap-2 whitespace-nowrap"><span className="font-semibold text-text-primary">{row.version || "v1"}</span>{showHistory && row.versionCount > 1 ? <button className="text-xs font-medium text-text-secondary underline-offset-2 hover:text-primary hover:underline" type="button" aria-label={`${expandedProducts[row.id] ? "Hide" : "Show"} ${row.versionCount} versions for ${row.productName}`} aria-expanded={expandedProducts[row.id] ?? false} onClick={(event) => { event.stopPropagation(); setExpandedProducts((current) => ({ ...current, [row.id]: !current[row.id] })); }}>{row.versionCount} versions</button> : null}</div>;
  const columns = [
    { key: "product", label: "Product", className: "min-w-[190px]", render: (row) => <FactoryCellEntity name={row.productName} code={row.productNameCn} /> },
    { key: "version", label: "Version", render: (row) => versionCell(row) },
    { key: "structure", label: "Structure", className: "min-w-[150px]", render: (row) => <span className="whitespace-nowrap text-sm text-text-secondary">{structureLabel(row)}</span> },
    { key: "qc", label: "QC", render: (row) => row.structure.qcCount ? <span className="font-medium text-text-primary">{row.structure.qcCount} QC</span> : <FactoryCellMuted>None</FactoryCellMuted> },
    { key: "estimated_time", label: "Estimated Time", render: (row) => <span className="whitespace-nowrap text-sm text-text-secondary">{estimatedTimeLabel(row)}</span> },
    { key: "setup", label: "Setup", render: (row) => row.readiness.key === "not_applicable" ? <FactoryCellMuted>Not applicable</FactoryCellMuted> : <FactoryCellSemanticText tone={row.readiness.tone}>{row.readiness.label}</FactoryCellSemanticText> },
    { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={jobStatusLabel(row.status)} /> },
    { key: "updated", label: "Updated", render: (row) => row.updated_at ? formatFactoryDate(row.updated_at) : <FactoryCellMuted /> },
    { key: "actions", label: "Actions", align: "right", render: renderActions },
  ];
  const versionHistoryColumns = [
    { key: "version", label: "Version", render: (row) => versionCell(row, false) },
    ...columns.slice(2),
  ];

  return <div className="space-y-5">
    <PageHeader section="Master Data" title="Production SOP" description="Manage standard process references, product steps and QC checkpoint flags." actions={<div className="flex flex-wrap gap-2">{productionSopActions(can, "").manageQcPresets ? <button className="btn-secondary" type="button" onClick={() => setPresetsOpen(true)}><ClipboardCheck size={15} /> Manage QC Checks</button> : null}{can("factory_production_sop.create") ? <button className="btn-primary" type="button" onClick={() => setBuilder({})}><FileText size={15} /> Create SOP</button> : null}</div>} />
    <div className="grid gap-3 md:grid-cols-4"><FactorySummaryCard icon={Factory} label="Products with SOP" value={productRows.length} helper="Current product standards" /><FactorySummaryCard icon={ClipboardCheck} label="Draft" value={draftCount} helper="Current SOP drafts" /><FactorySummaryCard icon={CheckCircle2} tone="success" label="Active" value={activeCount} helper="Available for production" /><FactorySummaryCard icon={TriangleAlert} tone={needsSetupCount ? "warning" : "success"} label="Needs Setup" value={needsSetupCount} helper={needsSetupCount ? "Activation blocked" : "Ready to activate"} /></div>
    <FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters({ search: "", status: "", setup: "" })}>
      <Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Search product or version" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field>
      <Field label="Status"><SearchableSelect value={filters.status} options={[{ value: "", label: "All" }, { value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} placeholder="All" searchPlaceholder="Search status" onChange={(status) => setFilters((current) => ({ ...current, status }))} /></Field>
      <Field label="Setup"><SearchableSelect value={filters.setup} options={[{ value: "", label: "All" }, { value: "ready", label: "Ready" }, { value: "equipment_missing", label: "Needs setup" }]} placeholder="All" searchPlaceholder="Search setup" onChange={(setup) => setFilters((current) => ({ ...current, setup }))} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface>
      {visibleRows.length ? <FactoryTable columns={columns} rows={visibleRows} rowHover="mint" onRowClick={setDetail} renderAfterRow={(row) => expandedProducts[row.id] ? <div className="border-t border-border bg-[var(--theme-subtle)] px-4 py-3 md:px-8"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Version history</div><FactoryTable columns={versionHistoryColumns} rows={row.versions} rowHover="mint" onRowClick={setDetail} /></div> : null} /> : <EmptyState title="No Production SOPs" description="No SOPs match the selected filters." />}
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={filteredRows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
    {builder ? <ProductionSopBuilderModal initialValue={builder} productFamilies={productFamilies} recipes={recipes} sops={sops} equipment={equipment} qcChecklistTemplates={qcChecklistTemplates} onClose={() => setBuilder(null)} onSave={async (form) => { await actions.saveProductionSop(form); setBuilder(null); }} onUpdateRecipe={actions.updateDraftProductionSopRecipe} /> : null}
    {detail ? <ProductionSopDocumentModal sop={detail} recipes={recipes} onClose={() => setDetail(null)} /> : null}
    {presetsOpen ? <QcChecklistPresetManagerModal templates={qcChecklistTemplates} sops={sops} onClose={() => setPresetsOpen(false)} onCreate={actions.createQcChecklistTemplate} onUpdate={actions.updateQcChecklistTemplate} onArchive={actions.archiveQcChecklistTemplate} onRestore={actions.restoreQcChecklistTemplate} onDelete={actions.deleteQcChecklistTemplate} /> : null}
  </div>;
}
