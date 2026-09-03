import { useCallback, useEffect, useMemo, useState } from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { FactoryTableLoadState, useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { formatFactoryDate, formatFactoryDateTime } from "../utils/factoryDates.js";
import { pluralizePackagingType, quantity } from "../utils/factoryFormatters.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";

const initialFilters = {
  dateFrom: "",
  dateTo: "",
  finishedGood: "",
  packagingSku: "",
  storageLocation: "",
  search: "",
};

function detailRow(label, value) {
  return <div key={label} className="border-b border-border py-2.5 last:border-0"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</div><div className="mt-0.5 text-sm font-semibold text-text-primary">{value || "—"}</div></div>;
}

function completedQuantity(row) {
  return quantity(row.completed_qty, pluralizePackagingType(row.completed_uom, row.completed_qty));
}

export default function FactoryMestiFinishedProductStorageControlPage({ onNotify }) {
  const [filters, setFilters] = useState(initialFilters);
  const [options, setOptions] = useState({ finished_goods: [], packaging_skus: [], storage_locations: [] });
  const [detail, setDetail] = useState(null);
  const querySignature = useMemo(() => JSON.stringify(filters), [filters]);
  const updateFilters = useCallback((next) => setFilters((current) => ({ ...current, ...next })), []);
  const clearFilters = useCallback(() => setFilters(initialFilters), []);
  const loadPage = useCallback(({ page, pageSize }) => factoryService.listMestiFinishedProductStorageControl({ page, pageSize, filters }), [filters]);
  const [listing, listingActions] = useFactoryPagedQuery({
    storageKey: "mesti-finished-product-storage-control",
    querySignature,
    loadPage,
    onError: (error) => {
      if (isFactoryPermissionError(error)) onNotify?.({ title: "Storage Control hidden", message: "Finished Product Storage Control is hidden by your current role.", tone: "error" });
    },
    shouldClearOnError: isFactoryPermissionError,
  });

  useEffect(() => {
    let active = true;
    factoryService.listMestiFinishedProductStorageControlFilterOptions()
      .then((value) => { if (active) setOptions(value); })
      .catch((error) => {
        console.error("[Factory] Unable to load Finished Product Storage Control filters.", error);
        if (isFactoryPermissionError(error)) onNotify?.({ title: "Storage Control hidden", message: "Finished Product Storage Control is hidden by your current role.", tone: "error" });
      });
    return () => { active = false; };
  }, [onNotify]);

  const finishedGoodOptions = [{ value: "", label: "All" }, ...(options.finished_goods || []).map((item) => ({ value: item.id, label: item.name || "Unnamed Finished Good" }))];
  const packagingSkuOptions = [{ value: "", label: "All" }, ...(options.packaging_skus || []).map((item) => ({ value: item.id, label: [item.code, item.name].filter(Boolean).join(" · ") || "Unnamed Packaging SKU" }))];
  const storageOptions = [{ value: "", label: "All" }, ...(options.storage_locations || []).map((item) => ({ value: item.id, label: item.name || "Unnamed Storage" }))];
  const rows = listing.hasLoaded ? listing.rows : [];
  const columns = [
    { key: "completion_date", label: "Date", render: (row) => <div className="whitespace-nowrap"><div className="font-semibold text-text-primary">{formatFactoryDate(row.completion_date)}</div><div className="text-xs text-text-secondary">{formatFactoryDateTime(row.completed_at).slice(11)}</div></div> },
    { key: "finished_good_name", label: "Finished Good", render: (row) => <span className="font-semibold text-text-primary">{row.finished_good_name || "—"}</span> },
    { key: "packaging_sku", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{row.packaging_sku_code || "—"}</div><div className="text-xs text-text-secondary">{row.packaging_sku_name || "—"}</div></div> },
    { key: "completed_qty", label: "Qty", align: "right", render: (row) => <span className="font-semibold text-text-primary">{completedQuantity(row)}</span> },
    { key: "storage_location_name", label: "Storage", render: (row) => row.storage_location_name || "—" },
    { key: "batch_no", label: "Batch", render: (row) => <span className="font-semibold text-text-primary">{row.batch_no || "—"}</span> },
    { key: "expiry_date", label: "Expiry", render: (row) => formatFactoryDate(row.expiry_date) },
    { key: "completed_by_name", label: "Completed By", render: (row) => row.completed_by_name || "—" },
  ];

  return <div className="space-y-4">
    <PageHeader section="MeSTI" title="Finished Product Storage Control" description="Read-only completed Production storage evidence." actions={<button className="btn-secondary" type="button" onClick={listingActions.retry}><RefreshCw size={15} /> Refresh</button>} />
    <div className="rounded-lg border border-border bg-white p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      <Field label="Date From"><FeedXDatePicker value={filters.dateFrom} onChange={(dateFrom) => updateFilters({ dateFrom })} /></Field>
      <Field label="Date To"><FeedXDatePicker value={filters.dateTo} onChange={(dateTo) => updateFilters({ dateTo })} /></Field>
      <Field label="Finished Good"><SearchableSelect value={filters.finishedGood} options={finishedGoodOptions} placeholder="All" onChange={(finishedGood) => updateFilters({ finishedGood })} /></Field>
      <Field label="Packaging SKU"><SearchableSelect value={filters.packagingSku} options={packagingSkuOptions} placeholder="All" onChange={(packagingSku) => updateFilters({ packagingSku })} /></Field>
      <Field label="Storage"><SearchableSelect value={filters.storageLocation} options={storageOptions} placeholder="All" onChange={(storageLocation) => updateFilters({ storageLocation })} /></Field>
      <Field label="Search"><input className={inputClass()} value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Batch, production, product" /></Field>
      <div className="flex items-end"><button className="btn-secondary w-full" type="button" onClick={clearFilters}>Clear Filters</button></div>
    </div></div>
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      <div className="border-b border-border px-4 py-3"><div className="text-sm font-bold text-text-primary">Completed Production Storage Records</div></div>
      <FactoryTableLoadState state={listing} label="Finished Product Storage Control" onRetry={listingActions.retry} permissionMessage="Finished Product Storage Control is hidden by your current role." />
      <FactoryTable columns={columns} rows={rows} emptyTitle="No Completed Production Storage Records" emptyDescription="Completed Production batches matching these filters will appear here automatically." onRowClick={setDetail} />
      {listing.hasLoaded ? <FactoryPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} onPageChange={listingActions.requestPage} onPageSizeChange={listingActions.requestPageSize} /> : null}
    </div>
    {detail ? <Modal title="Finished Product Storage Record" description="Canonical completed-Production and Finished Goods batch evidence." size="md" onClose={() => setDetail(null)}>
      <div className="grid gap-x-6 md:grid-cols-2">
        {detailRow("Job Order", detail.job_order_no)}
        {detailRow("Production", detail.production_no)}
        {detailRow("Production Batch", detail.batch_no)}
        {detailRow("Finished Good", detail.finished_good_name)}
        {detailRow("Packaging SKU", [detail.packaging_sku_code, detail.packaging_sku_name].filter(Boolean).join(" · "))}
        {detailRow("Completed Quantity", completedQuantity(detail))}
        {detailRow("Storage", detail.storage_location_name)}
        {detailRow("Manufacturing Date", formatFactoryDate(detail.manufacturing_date))}
        {detailRow("Expiry", formatFactoryDate(detail.expiry_date))}
        {detailRow("Completed By", detail.completed_by_name)}
        {detailRow("Completion Timestamp", formatFactoryDateTime(detail.completed_at))}
      </div>
    </Modal> : null}
  </div>;
}
