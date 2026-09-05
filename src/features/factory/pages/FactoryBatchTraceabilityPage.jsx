import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Package, PackageCheck, RefreshCw, Warehouse } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { FactoryTableLoadState } from "../components/FactoryPagination.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellAttention, FactoryCellDateTime, FactoryCellEntity, FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useBatchTraceabilityQuery from "../hooks/useBatchTraceabilityQuery.js";
import FinishedGoodBatchTraceabilityModal from "../modals/FinishedGoodBatchTraceabilityModal.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryListDate, malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { traceBatchNo, tracePackQuantity } from "../utils/batchTraceability.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const batchTypeLabel = (value) => value === "production" ? "Production" : value === "adjustment" ? "Adjustment" : value === "legacy_unallocated" ? "Legacy / Unallocated" : "—";

export default function FactoryBatchTraceabilityPage({ onNotify }) {
  const { finishedGoods, storageLocations } = useFactoryMasterData();
  const [detail, setDetail] = useState(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  const { filters, listing, updateFilters, clearFilters, requestPage, requestPageSize, retry, clearForPermission } = useBatchTraceabilityQuery({ onNotify, onPermissionDenied: closeDetail });
  const rows = listing.hasLoaded ? listing.rows : [];
  const summary = listing.summary || {};
  const finishedGoodOptions = finishedGoods.map((sku) => ({ value: sku.id, label: [sku.product_code, sku.product_family_name || sku.product_name, sku.variant_name || sku.pack_size].filter(Boolean).join(" · ") }));
  const storageOptions = storageLocations.filter((location) => String(location.location_type || "").toLowerCase() === "finished goods area").map((location) => ({ value: location.id, label: location.location_name }));
  const rowStatus = (row) => {
    if (["mismatch", "review_required"].includes(row.reconciliation_status)) return { label: "Reconciliation warning", status: "review_required" };
    if (row.batch_type === "legacy_unallocated") return { label: "Legacy / unallocated", status: "legacy_unallocated" };
    if (row.expiry_date && row.expiry_date < malaysiaBusinessDateInput()) return { label: "Expired", status: "expired" };
    if (Number(row.current_balance) <= 0) return { label: "Depleted", status: "depleted" };
    if (Number(row.original_qty) > 0 && Number(row.current_balance) / Number(row.original_qty) <= 0.2) return { label: "Low balance", status: "low_balance" };
    return { label: "Available", status: "available" };
  };
  const loadDetail = useCallback(async (batch) => {
    if (!batch?.batch_balance_id && !batch?.id) return;
    const batchId = batch.batch_balance_id || batch.id;
    setDetail({ value: batch, loading: true, error: "" });
    try {
      const value = await factoryService.getFinishedGoodBatchTraceabilityDetail(batch);
      setDetail((current) => current && (current.value?.batch_balance_id || current.value?.id) === batchId ? { value, loading: false, error: "" } : current);
    } catch (error) {
      console.error("[Factory] Unable to load Batch Traceability detail.", error);
      if (isFactoryPermissionError(error)) {
        setDetail(null);
        clearForPermission("Batch traceability is hidden by your current role.");
        onNotify?.({ title: "Batch traceability hidden", message: "Batch traceability is hidden by your current role.", tone: "error" });
        return;
      }
      setDetail((current) => current && (current.value?.batch_balance_id || current.value?.id) === batchId ? { ...current, loading: false, error: "Unable to load the latest batch details." } : current);
    }
  }, [clearForPermission, onNotify]);
  const batchTypeOptions = [{ value: "", label: "All" }, { value: "production", label: "Production" }, { value: "adjustment", label: "Adjustment" }, { value: "legacy_unallocated", label: "Legacy / unallocated" }];
  const expiryOptions = [{ value: "", label: "All" }, { value: "expired", label: "Expired" }, { value: "expiring_30", label: "Expiring in 30 days" }, { value: "valid", label: "Valid beyond 30 days" }, { value: "no_expiry", label: "No expiry recorded" }];
  const reconciliationOptions = [{ value: "", label: "All" }, { value: "reconciled", label: "Reconciled" }, { value: "legacy_unallocated", label: "Legacy / unallocated" }, { value: "review_required", label: "Review required" }, { value: "mismatch", label: "Mismatch" }];
  const optionLabel = (options, value) => options.find((option) => option.value === value)?.label || value;
  const activeFilters = useMemo(() => {
    const filtersForDisplay = [];
    if (filters.search) filtersForDisplay.push({ key: "search", label: "Search", value: filters.search, onRemove: () => updateFilters({ search: "" }) });
    if (filters.dateFrom || filters.dateTo) filtersForDisplay.push({ key: "date", label: "Date", value: [filters.dateFrom ? formatFactoryListDate(filters.dateFrom) : "Any", filters.dateTo ? formatFactoryListDate(filters.dateTo) : "Any"].join(" to "), onRemove: () => updateFilters({ dateFrom: "", dateTo: "" }) });
    if (filters.reconciliationStatus) filtersForDisplay.push({ key: "status", label: "Status", value: optionLabel(reconciliationOptions, filters.reconciliationStatus), onRemove: () => updateFilters({ reconciliationStatus: "" }) });
    if (filters.finishedGood) filtersForDisplay.push({ key: "finishedGood", label: "Packaging SKU", value: optionLabel(finishedGoodOptions, filters.finishedGood), onRemove: () => updateFilters({ finishedGood: "" }) });
    if (filters.batchType) filtersForDisplay.push({ key: "batchType", label: "Batch type", value: optionLabel(batchTypeOptions, filters.batchType), onRemove: () => updateFilters({ batchType: "" }) });
    if (filters.storageLocation) filtersForDisplay.push({ key: "storage", label: "Storage", value: optionLabel(storageOptions, filters.storageLocation), onRemove: () => updateFilters({ storageLocation: "" }) });
    if (filters.expiryStatus) filtersForDisplay.push({ key: "expiry", label: "Expiry", value: optionLabel(expiryOptions, filters.expiryStatus), onRemove: () => updateFilters({ expiryStatus: "" }) });
    return filtersForDisplay;
  }, [filters, finishedGoodOptions, storageOptions]);
  const columns = [
    { key: "batch_no", label: "Batch no.", className: "min-w-44", render: (row) => <FactoryCellEntity name={traceBatchNo(row)} code={batchTypeLabel(row.batch_type)} /> },
    { key: "sku", label: "Packaging SKU", className: "min-w-52", render: (row) => <FactoryCellEntity name={row.packaging_sku_code || "No SKU"} code={row.finished_good_name || row.packaging_sku_name || "—"} /> },
    { key: "original", label: "Produced / adjusted", className: "hidden 2xl:table-cell whitespace-nowrap", align: "right", render: (row) => tracePackQuantity(row.original_qty) },
    { key: "dispatched", label: "Dispatched", className: "hidden 2xl:table-cell whitespace-nowrap", align: "right", render: (row) => tracePackQuantity(row.completed_dispatch_qty) },
    { key: "remaining", label: "Remaining", className: "whitespace-nowrap", align: "right", render: (row) => <span className="font-semibold text-text-primary">{tracePackQuantity(row.current_balance)}</span> },
    { key: "dates", label: "Manufacturing / expiry", className: "hidden xl:table-cell min-w-40", render: (row) => <FactoryCellDateTime className="whitespace-nowrap" date={formatFactoryListDate(row.manufacturing_date)} time={row.expiry_date ? `Expiry ${formatFactoryListDate(row.expiry_date)}` : "No expiry recorded"} /> },
    { key: "storage", label: "Storage", className: "hidden xl:table-cell min-w-40", render: (row) => row.storage_location_name ? <FactoryCellEntity name={row.storage_location_name} code={row.storage_location_type || "—"} /> : <FactoryCellMuted /> },
    { key: "status", label: "Status", className: "min-w-36", render: (row) => { const status = rowStatus(row); const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : []; return <div className="space-y-1"><FactoryStatusBadge status={status.status}>{status.label}</FactoryStatusBadge>{diagnostics.length ? <FactoryCellAttention>{diagnostics.length} historical diagnostic{diagnostics.length === 1 ? "" : "s"}</FactoryCellAttention> : null}</div>; } },
    { key: "action", label: "Actions", className: "factory-table-sticky sticky right-0 w-14 shadow-[-1px_0_0_#dce3e8]", align: "right", render: (row) => <FactoryRowAction onClick={() => loadDetail(row)} /> },
  ];
  return <div className="space-y-5">
    <PageHeader section="Factory" title="Batch Traceability" description="Trace Finished Goods batches from Production or adjustment through Dispatch and Customer." actions={<button className="btn-secondary" type="button" onClick={retry}><RefreshCw size={15} /> Refresh</button>} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Package} label="Batch Records" value={listing.loadedTotal} helper="Filtered authoritative batches" /><MetricCard icon={PackageCheck} label="Available" value={Number(summary.available || 0)} helper="Usable batch balances" tone="success" /><MetricCard icon={Warehouse} label="Remaining Qty" value={tracePackQuantity(summary.remaining_qty || 0)} helper="Across filtered batches" /><MetricCard icon={AlertTriangle} label="Warnings" value={Number(summary.warnings || 0)} helper="Expiry or reconciliation review" tone={Number(summary.warnings || 0) ? "warning" : "success"} /></div>
    <FactoryFilterBar
      activeFilters={activeFilters}
      onClear={clearFilters}
      moreFilters={<><Field label="Packaging SKU"><SearchableSelect value={filters.finishedGood} options={[{ value: "", label: "All" }, ...finishedGoodOptions]} placeholder="All" onChange={(finishedGood) => updateFilters({ finishedGood })} /></Field><Field label="Batch type"><SearchableSelect value={filters.batchType} options={batchTypeOptions} placeholder="All" onChange={(batchType) => updateFilters({ batchType })} /></Field><Field label="Storage location"><SearchableSelect value={filters.storageLocation} options={[{ value: "", label: "All" }, ...storageOptions]} placeholder="All" onChange={(storageLocation) => updateFilters({ storageLocation })} /></Field><Field label="Expiry status"><SearchableSelect value={filters.expiryStatus} options={expiryOptions} placeholder="All" onChange={(expiryStatus) => updateFilters({ expiryStatus })} /></Field></>}
    >
      <Field label="Search"><input className={inputClass()} value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Batch, SKU, product or location" /></Field>
      <Field label="Date"><FeedXDatePicker value={filters.dateFrom} placeholder="From" onChange={(dateFrom) => updateFilters({ dateFrom })} /></Field>
      <Field label="To"><FeedXDatePicker value={filters.dateTo} placeholder="To" onChange={(dateTo) => updateFilters({ dateTo })} /></Field>
      <Field label="Status"><SearchableSelect value={filters.reconciliationStatus} options={reconciliationOptions} placeholder="All" onChange={(reconciliationStatus) => updateFilters({ reconciliationStatus })} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface><FactoryTableLoadState state={listing} label="Batch Traceability" onRetry={retry} permissionMessage="Batch traceability is hidden by your current role." /><FactoryTable columns={columns} rows={rows} loading={listing.loading} density="compact" rowHover="mint" emptyTitle="No records match these filters" emptyDescription="Clear filters to view authoritative batch records." />{listing.hasLoaded ? <FactoryPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} noun="" onPageChange={requestPage} onPageSizeChange={requestPageSize} /> : null}</FactoryDataSurface>
    {detail ? <FinishedGoodBatchTraceabilityModal batch={detail.value} loading={detail.loading} error={detail.error} onRetry={() => loadDetail(detail.value)} onClose={closeDetail} /> : null}
  </div>;
}
