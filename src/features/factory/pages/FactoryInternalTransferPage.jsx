import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Boxes, PackageCheck, Plus, RefreshCw } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactorySummaryCard from "../components/FactorySummaryCard.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText, FactoryCellText } from "../components/FactoryTableCell.jsx";
import useFactoryLatestRequest from "../hooks/useFactoryLatestRequest.js";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatDateDisplay, malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";

const emptyFilters = { dateFrom: "", dateTo: "", type: "", location: "", search: "" };
const typeOptions = [{ value: "", label: "All" }, { value: "raw_material", label: "Raw Material" }, { value: "finished_good", label: "Finished Good" }];

function displayLocation(location) { return [location?.location_name, location?.location_code].filter(Boolean).join(" · ") || "—"; }
function draft() { return { inventory_type: "raw_material", from_location_id: "", to_location_id: "", transfer_date: malaysiaBusinessDateInput(), reason: "", notes: "", items: [] }; }

export function InternalTransferModal({ locations, onClose, onComplete }) {
  const [form, setForm] = useState(draft);
  const [available, setAvailable] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const eligibleLocations = locations.filter((location) => location.status === "active" && location.is_storage_location !== false);
  const selected = new Map(form.items.map((item) => [item.batch_balance_id, item]));
  useEffect(() => {
    let cancelled = false;
    setAvailable([]); setForm((current) => ({ ...current, items: [] }));
    if (!form.from_location_id) return undefined;
    setLoadingBatches(true); setError("");
    factoryService.getInternalTransferInventory(form.inventory_type, form.from_location_id)
      .then((rows) => { if (!cancelled) setAvailable(rows); })
      .catch((cause) => { if (!cancelled) setError(cause.message || "Unable to load current batch inventory."); })
      .finally(() => { if (!cancelled) setLoadingBatches(false); });
    return () => { cancelled = true; };
  }, [form.from_location_id, form.inventory_type]);
  const setQuantity = (batch, value) => setForm((current) => {
    const parsed = Number(value || 0);
    const currentItems = current.items.filter((item) => item.batch_balance_id !== batch.batch_balance_id);
    return { ...current, items: parsed > 0 ? [...currentItems, { batch_balance_id: batch.batch_balance_id, quantity: value }] : currentItems };
  });
  async function submit(event) {
    event.preventDefault(); setError("");
    if (!form.from_location_id || !form.to_location_id || form.from_location_id === form.to_location_id) return setError("Select different active storage Locations.");
    if (!form.reason.trim()) return setError("Reason is required.");
    if (!form.items.length) return setError("Enter a transfer quantity for at least one batch.");
    if (form.items.some((item) => Number(item.quantity) <= 0 || Number(item.quantity) > Number(available.find((batch) => batch.batch_balance_id === item.batch_balance_id)?.quantity || 0))) return setError("Transfer quantity must be within the current batch balance.");
    setSaving(true);
    try { await onComplete({ ...form, items: form.items.map((item) => ({ ...item, quantity: Number(item.quantity) })) }); onClose(); }
    catch (cause) { setError(cause.message || "Unable to complete Internal Transfer."); }
    finally { setSaving(false); }
  }
  return <Modal title="New Internal Transfer" description="Move exact existing batches between active storage Locations. Inventory totals remain unchanged." size="xl" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="internal-transfer-form" type="submit" disabled={saving}>{saving ? "Completing…" : "Complete Transfer"}</button></>}>
    <form id="internal-transfer-form" className="space-y-4" onSubmit={submit}>
      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Inventory Type *"><SearchableSelect value={form.inventory_type} options={typeOptions.slice(1)} onChange={(inventory_type) => setForm((current) => ({ ...current, inventory_type }))} /></Field>
        <Field label="Transfer Date *"><FeedXDatePicker required value={form.transfer_date} onChange={(transfer_date) => setForm((current) => ({ ...current, transfer_date }))} /></Field>
        <Field label="From Location *"><SearchableSelect value={form.from_location_id} options={eligibleLocations.map((location) => ({ value: location.id, label: displayLocation(location) }))} placeholder="Select source" onChange={(from_location_id) => setForm((current) => ({ ...current, from_location_id }))} /></Field>
        <Field label="To Location *"><SearchableSelect value={form.to_location_id} options={eligibleLocations.filter((location) => location.id !== form.from_location_id).map((location) => ({ value: location.id, label: displayLocation(location) }))} placeholder="Select destination" onChange={(to_location_id) => setForm((current) => ({ ...current, to_location_id }))} /></Field>
      </div>
      <Field label="Reason *"><input className={inputClass()} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is this stock being moved?" /></Field>
      <Field label="Notes"><textarea className={`${inputClass()} min-h-20`} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
      <section className="space-y-2"><div className="text-sm font-semibold text-text-primary">Positive on-hand batches</div>{loadingBatches ? <div className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-text-secondary">Loading current batch balances…</div> : !form.from_location_id ? <div className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-text-secondary">Select a source Location to load inventory.</div> : !available.length ? <div className="rounded-lg border border-border bg-surface-muted px-3 py-3 text-sm text-text-secondary">No positive on-hand batches at this Location.</div> : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-surface-muted text-xs font-semibold uppercase text-text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Batch</th><th className="px-3 py-2 text-right">Available</th><th className="px-3 py-2">Expiry</th><th className="px-3 py-2 w-40">Transfer Qty</th></tr></thead><tbody>{available.map((batch) => <tr key={batch.batch_balance_id} className="border-t border-border"><td className="px-3 py-2"><div className="font-medium text-text-primary">{batch.name}</div><div className="text-xs text-text-secondary">{batch.code || "—"}</div></td><td className="px-3 py-2 font-medium text-text-primary">{batch.batch_no}</td><td className="px-3 py-2 text-right font-medium text-text-primary">{quantity(batch.quantity, batch.uom)}</td><td className="px-3 py-2 text-text-secondary">{batch.expiry_date ? formatDateDisplay(batch.expiry_date) : "—"}</td><td className="px-3 py-2"><input className={inputClass()} type="number" min="0" max={batch.quantity} step="0.0001" value={selected.get(batch.batch_balance_id)?.quantity || ""} onChange={(event) => setQuantity(batch, event.target.value)} /></td></tr>)}</tbody></table></div>}</section>
    </form>
  </Modal>;
}

function TransferDetailModal({ value, onClose }) {
  return <Modal title={value.transfer_no} description={`${value.inventory_type === "raw_material" ? "Raw Material" : "Finished Good"} Internal Transfer`} size="lg" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><div><div className="text-xs font-semibold text-text-muted">From</div><div className="mt-1 font-semibold text-text-primary">{value.from_location?.name || "—"}</div></div><div><div className="text-xs font-semibold text-text-muted">To</div><div className="mt-1 font-semibold text-text-primary">{value.to_location?.name || "—"}</div></div><div><div className="text-xs font-semibold text-text-muted">Reason</div><div className="mt-1 font-medium text-text-primary">{value.reason}</div></div><div><div className="text-xs font-semibold text-text-muted">Created by</div><div className="mt-1 font-medium text-text-primary">{value.created_by_name || "—"}</div></div></div><FactoryDataSurface><FactoryTable rows={value.items || []} columns={[{ key: "item", label: "Item", render: (row) => <FactoryCellEntity name={row.name} code={row.code} /> }, { key: "batch", label: "Batch", render: (row) => row.batch_no || "—" }, { key: "quantity", label: "Qty", align: "right", render: (row) => <span className="font-semibold text-text-primary">{quantity(row.quantity, row.uom)}</span> }]} emptyTitle="No transfer items" /></FactoryDataSurface>{value.notes ? <div><div className="text-xs font-semibold text-text-muted">Notes</div><div className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">{value.notes}</div></div> : null}</div></Modal>;
}

export default function FactoryInternalTransferPage({ onNotify }) {
  const { storageLocations } = useFactoryMasterData(); const { can } = useFactoryPermissions(); const runLatest = useFactoryLatestRequest();
  const [filters, setFilters] = useState(emptyFilters); const [data, setData] = useState({ rows: [], total_count: 0 }); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [modal, setModal] = useState(null);
  const load = useCallback(() => runLatest(() => factoryService.getInternalTransferData({ page, pageSize, filters }), { onStart: () => { setLoading(true); setError(""); }, onSuccess: setData, onError: (cause) => setError(cause.message || "Unable to load Internal Transfers."), onFinally: () => setLoading(false) }), [filters, page, pageSize, runLatest]);
  useEffect(() => { load(); }, [load]); useEffect(() => { setPage(1); }, [filters]);
  const rows = data.rows || []; const summary = useMemo(() => ({ total: Number(data.total_count || 0), raw: rows.filter((row) => row.inventory_type === "raw_material").length, finished: rows.filter((row) => row.inventory_type === "finished_good").length }), [data.total_count, rows]);
  const activeFilters = [filters.dateFrom || filters.dateTo ? { key: "date", label: "Date", value: `${filters.dateFrom || "Any"} – ${filters.dateTo || "Any"}`, onRemove: () => setFilters((current) => ({ ...current, dateFrom: "", dateTo: "" })) } : null, filters.type ? { key: "type", label: "Type", value: typeOptions.find((item) => item.value === filters.type)?.label, onRemove: () => setFilters((current) => ({ ...current, type: "" })) } : null, filters.location ? { key: "location", label: "Location", value: storageLocations.find((item) => item.id === filters.location)?.location_name || "Selected", onRemove: () => setFilters((current) => ({ ...current, location: "" })) } : null, filters.search ? { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) } : null].filter(Boolean);
  async function complete(transfer) { await factoryService.completeInternalTransfer(transfer); onNotify?.({ title: "Transfer completed", message: "Source and destination balances were updated with paired movement evidence.", tone: "success" }); await load(); }
  const columns = [{ key: "date", label: "Date", render: (row) => formatDateDisplay(row.transfer_date) }, { key: "no", label: "Transfer No.", render: (row) => <span className="font-semibold text-text-primary">{row.transfer_no}</span> }, { key: "type", label: "Type", render: (row) => <FactoryCellSemanticText tone={row.inventory_type === "raw_material" ? "blue" : "green"}>{row.inventory_type === "raw_material" ? "Raw Material" : "Finished Good"}</FactoryCellSemanticText> }, { key: "from", label: "From", render: (row) => <FactoryCellText primary={row.from_location?.name} secondary={row.from_location?.code} /> }, { key: "to", label: "To", render: (row) => <FactoryCellText primary={row.to_location?.name} secondary={row.to_location?.code} /> }, { key: "items", label: "Items", render: (row) => `${row.items?.length || 0} ${(row.items?.length || 0) === 1 ? "item" : "items"}` }, { key: "by", label: "Created By", render: (row) => row.created_by_name || <FactoryCellMuted /> }, { key: "status", label: "Status", render: () => <FactoryCellSemanticText tone="green">Completed</FactoryCellSemanticText> }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions onView={() => setModal({ type: "view", value: row })} /> }];
  return <div className="space-y-5"><PageHeader section="Warehouse" title="Internal Transfer" description="Move exact Raw Material or Finished Good batches between Factory storage Locations." actions={can("factory_internal_transfer.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "create" })}><Plus size={15} /> New Transfer</button> : null} /><FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters(emptyFilters)}><Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Transfer no., reason or Location" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field><Field label="Date"><FeedXDatePicker value={filters.dateFrom} onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} /></Field><Field label="To"><FeedXDatePicker value={filters.dateTo} onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} /></Field><Field label="Type"><SearchableSelect value={filters.type} options={typeOptions} onChange={(type) => setFilters((current) => ({ ...current, type }))} /></Field><Field label="Location"><SearchableSelect value={filters.location} options={[{ value: "", label: "All" }, ...storageLocations.map((location) => ({ value: location.id, label: displayLocation(location) }))]} onChange={(location) => setFilters((current) => ({ ...current, location }))} /></Field></FactoryFilterBar><div className="grid gap-3 md:grid-cols-3"><FactorySummaryCard icon={ArrowLeftRight} label="Transfers" value={summary.total} helper="Filtered completed transfers" /><FactorySummaryCard icon={Boxes} tone="info" label="RM Transfers" value={summary.raw} /><FactorySummaryCard icon={PackageCheck} tone="success" label="FG Transfers" value={summary.finished} /></div>{error ? <div role="alert" className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"><span>{error}</span><button className="btn-secondary" type="button" onClick={load}><RefreshCw size={14} /> Retry</button></div> : null}<FactoryDataSurface><FactoryTable columns={columns} rows={rows} loading={loading} emptyTitle="No Internal Transfers" emptyDescription="Complete a batch-preserving transfer between storage Locations to begin." /><FactoryPagination page={page} pageSize={pageSize} total={Number(data.total_count || 0)} loading={loading} noun="transfers" onPageChange={setPage} onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} /></FactoryDataSurface>{modal?.type === "create" ? <InternalTransferModal locations={storageLocations} onClose={() => setModal(null)} onComplete={complete} /> : null}{modal?.type === "view" ? <TransferDetailModal value={modal.value} onClose={() => setModal(null)} /> : null}</div>;
}
