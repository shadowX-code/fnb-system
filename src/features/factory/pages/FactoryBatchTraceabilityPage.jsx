import { useCallback, useState } from "react";
import { AlertTriangle, Package, PackageCheck, RefreshCw, Warehouse } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { FactoryTableLoadState } from "../components/FactoryPagination.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useBatchTraceabilityQuery from "../hooks/useBatchTraceabilityQuery.js";
import FinishedGoodBatchTraceabilityModal from "../modals/FinishedGoodBatchTraceabilityModal.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryDate, malaysiaBusinessDateInput } from "../utils/factoryDates.js";
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
    if (["mismatch", "review_required"].includes(row.reconciliation_status)) return { label: "Reconciliation Warning", tone: "danger" };
    if (row.batch_type === "legacy_unallocated") return { label: "Legacy / Unallocated", tone: "warning" };
    if (row.expiry_date && row.expiry_date < malaysiaBusinessDateInput()) return { label: "Expired", tone: "danger" };
    if (Number(row.current_balance) <= 0) return { label: "Depleted", tone: "neutral" };
    if (Number(row.original_qty) > 0 && Number(row.current_balance) / Number(row.original_qty) <= 0.2) return { label: "Low Balance", tone: "warning" };
    return { label: "Available", tone: "success" };
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
  const columns = [
    { key: "batch_no", label: "Batch No.", render: (row) => <div><div className="font-black text-text-primary">{traceBatchNo(row)}</div><Badge tone={row.batch_type === "production" ? "info" : "neutral"}>{batchTypeLabel(row.batch_type)}</Badge></div> },
    { key: "sku", label: "Packaging SKU", render: (row) => <div><div className="font-bold text-text-primary">{row.packaging_sku_code || "No SKU"}</div><div className="text-xs font-semibold text-text-secondary">{row.finished_good_name || row.packaging_sku_name || "—"}</div></div> },
    { key: "original", label: "Produced / Adjusted", render: (row) => tracePackQuantity(row.original_qty) },
    { key: "dispatched", label: "Dispatched", render: (row) => tracePackQuantity(row.completed_dispatch_qty) },
    { key: "remaining", label: "Remaining", render: (row) => <span className="font-black text-text-primary">{tracePackQuantity(row.current_balance)}</span> },
    { key: "dates", label: "Manufacturing / Expiry", render: (row) => <div className="whitespace-nowrap"><div>{formatFactoryDate(row.manufacturing_date)}</div><div className="text-xs text-text-secondary">{row.expiry_date ? `Expiry ${formatFactoryDate(row.expiry_date)}` : "No Expiry Recorded"}</div></div> },
    { key: "storage", label: "Storage", render: (row) => <div><div className="font-semibold text-text-primary">{row.storage_location_name || "—"}</div><div className="text-xs text-text-secondary">{row.storage_location_type || "—"}</div></div> },
    { key: "status", label: "Status", render: (row) => { const status = rowStatus(row); const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : []; return <div className="space-y-1"><Badge tone={status.tone}>{status.label}</Badge>{diagnostics.length ? <div className="text-[10.5px] font-bold text-amber-700">{diagnostics.length} historical diagnostic{diagnostics.length === 1 ? "" : "s"}</div> : null}</div>; } },
    { key: "action", label: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => loadDetail(row)}>View Details</button> },
  ];
  return <div className="space-y-5">
    <PageHeader section="Factory" title="Batch Traceability" description="Trace Finished Goods batches from Production or adjustment through Dispatch and Customer." actions={<button className="btn-secondary" type="button" onClick={retry}><RefreshCw size={15} /> Refresh</button>} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Package} label="Batch Records" value={listing.loadedTotal} helper="Filtered authoritative batches" /><MetricCard icon={PackageCheck} label="Available" value={Number(summary.available || 0)} helper="Usable batch balances" tone="success" /><MetricCard icon={Warehouse} label="Remaining Qty" value={tracePackQuantity(summary.remaining_qty || 0)} helper="Across filtered batches" /><MetricCard icon={AlertTriangle} label="Warnings" value={Number(summary.warnings || 0)} helper="Expiry or reconciliation review" tone={Number(summary.warnings || 0) ? "warning" : "success"} /></div>
    <div className="rounded-xl border border-border bg-white p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Field label="Date From"><FeedXDatePicker value={filters.dateFrom} onChange={(dateFrom) => updateFilters({ dateFrom })} /></Field><Field label="Date To"><FeedXDatePicker value={filters.dateTo} onChange={(dateTo) => updateFilters({ dateTo })} /></Field><Field label="Packaging SKU"><SearchableSelect value={filters.finishedGood} options={[{ value: "", label: "All" }, ...finishedGoodOptions]} placeholder="All" onChange={(finishedGood) => updateFilters({ finishedGood })} /></Field><Field label="Batch Type"><SearchableSelect value={filters.batchType} options={[{ value: "", label: "All" }, { value: "production", label: "Production" }, { value: "adjustment", label: "Adjustment" }, { value: "legacy_unallocated", label: "Legacy / Unallocated" }]} placeholder="All" onChange={(batchType) => updateFilters({ batchType })} /></Field><Field label="Expiry Status"><SearchableSelect value={filters.expiryStatus} options={[{ value: "", label: "All" }, { value: "expired", label: "Expired" }, { value: "expiring_30", label: "Expiring in 30 Days" }, { value: "valid", label: "Valid Beyond 30 Days" }, { value: "no_expiry", label: "No Expiry Recorded" }]} placeholder="All" onChange={(expiryStatus) => updateFilters({ expiryStatus })} /></Field><Field label="Storage Location"><SearchableSelect value={filters.storageLocation} options={[{ value: "", label: "All" }, ...storageOptions]} placeholder="All" onChange={(storageLocation) => updateFilters({ storageLocation })} /></Field><Field label="Reconciliation"><SearchableSelect value={filters.reconciliationStatus} options={[{ value: "", label: "All" }, { value: "reconciled", label: "Reconciled" }, { value: "legacy_unallocated", label: "Legacy / Unallocated" }, { value: "review_required", label: "Review Required" }, { value: "mismatch", label: "Mismatch" }]} placeholder="All" onChange={(reconciliationStatus) => updateFilters({ reconciliationStatus })} /></Field><Field label="Batch No."><input className={inputClass()} value={filters.batchNo} onChange={(event) => updateFilters({ batchNo: event.target.value })} placeholder="Search batch" /></Field><Field label="Search"><input className={inputClass()} value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="SKU, source, location" /></Field><div className="flex items-end"><button className="btn-secondary w-full" type="button" onClick={clearFilters}>Clear Filters</button></div></div></div>
    <Card title="Finished Goods Batch Records" description="One row per authoritative Production, Adjustment or Legacy / Unallocated balance."><FactoryTableLoadState state={listing} label="Batch Traceability" onRetry={retry} permissionMessage="Batch traceability is hidden by your current role." /><div className="md:hidden">{!rows.length ? <div className="p-4 text-sm text-text-secondary">No authoritative batches match the selected filters.</div> : <div className="divide-y divide-border">{rows.map((row) => { const status = rowStatus(row); return <div key={row.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-text-primary">{traceBatchNo(row)}</div><div className="text-sm font-semibold text-text-secondary">{row.packaging_sku_code || "No SKU"} · {row.finished_good_name || row.packaging_sku_name || "—"}</div></div><Badge tone={status.tone}>{status.label}</Badge></div><div className="grid grid-cols-3 gap-2 text-sm"><div><div className="text-[10.5px] text-text-muted">Original</div><div className="font-bold">{tracePackQuantity(row.original_qty)}</div></div><div><div className="text-[10.5px] text-text-muted">Dispatched</div><div className="font-bold">{tracePackQuantity(row.completed_dispatch_qty)}</div></div><div><div className="text-[10.5px] text-text-muted">Remaining</div><div className="font-bold">{tracePackQuantity(row.current_balance)}</div></div></div><button className="btn-secondary w-full" type="button" onClick={() => loadDetail(row)}>View Details</button></div>; })}</div>}</div><div className="hidden md:block"><FactoryTable columns={columns} rows={rows} emptyTitle="No Batch Records Found" emptyDescription="No authoritative batches match the selected filters." /></div>{listing.hasLoaded ? <FactoryPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} onPageChange={requestPage} onPageSizeChange={requestPageSize} /> : null}</Card>
    {detail ? <FinishedGoodBatchTraceabilityModal batch={detail.value} loading={detail.loading} error={detail.error} onRetry={() => loadDetail(detail.value)} onClose={closeDetail} /> : null}
  </div>;
}
