import { useState } from "react";
import { AlertTriangle, ClipboardList, Sparkles, Trash2 } from "lucide-react";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import FeedXDateRangePicker from "../../../../components/ui/FeedXDateRangePicker.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import InventoryWasteModal from "./InventoryWasteModal.jsx";
import InventoryWasteDetail, { wasteActorName } from './InventoryWasteDetail.jsx';
import InventoryItemPhotoPreview from '../InventoryItemPhotoPreview.jsx';
import PageHeader from '../../../../components/layout/PageHeader.jsx';
import { getAccessibleOutletOptions, hasPermission, notifyPermissionDenied } from '../../../../utils/accessControl.js';
import { isActiveInventoryItem } from '../groups/inventoryGroupsModel.js';
import { saveWasteWithEvidence, todayInput, formatDate, parseNonNegativeNumber } from './inventoryWasteService.js';
import useInventoryWasteRead from './useInventoryWasteRead.js';

const wasteTypes = ["Spoilage", "Expired", "Kitchen Error", "Burnt", "Returned Item", "Staff Consumption", "Unknown"];

export default function InventoryWastePage({ auth, ui, outlets }) {
  const outletOptions = getAccessibleOutletOptions(auth, outlets, { includeAll: false });
  const [outletId, onSelectedOutletChange] = useState('');
  const selectedOutletId = outletOptions.some(option => option.value === outletId) ? outletId : outletOptions[0]?.value || '';
  const canView = hasPermission(auth, 'inventory_waste.view');
  const canRecord = hasPermission(auth, 'inventory_waste.create') || hasPermission(auth, 'inventory_waste.manage');
  const read = useInventoryWasteRead({ outletId: selectedOutletId, scopeKey: auth?.user?.id || '', enabled: canView && !!selectedOutletId });
  const { wasteRecords = [], movements = [], items = [], categories = [], people = [] } = read.data || {};
  const itemById = new Map(items.map(row => [row.id, row]));
  const categoryById = new Map(categories.map(row => [row.id, row]));
  const outletById = new Map(outlets.map(row => [row.id, row]));
  const actorNameByAnyId = id => wasteActorName(id, people, auth);
  const selectableItems = id => items.filter(item => isActiveInventoryItem(item) && item.linkedOutletIds.includes(id));
  const [preview, onPreviewPhoto] = useState(null);
  const [filters, setFilters] = useState({ wasteType: 'all', from: '', to: '', search: '' });
  const [modal, setModal] = useState(null);
  const openRecordWaste = () => {
    if (!canRecord) return notifyPermissionDenied(ui, 'record waste');
    if (!selectedOutletId || !read.data) return;
    setModal({ type: 'record', outletId: selectedOutletId });
  };
  const onSaveWaste = async waste => {
    if (!canRecord) { notifyPermissionDenied(ui, 'record waste'); return false; }
    try {
      await saveWasteWithEvidence(waste);
      await read.refresh();
      ui?.notify?.({ title: 'Waste record created', message: 'A waste movement was added to the inventory audit trail.', tone: 'success' });
      return true;
    } catch (error) {
      await read.refresh();
      ui?.notify?.({ title: 'Failed to create Waste Record', message: error.message || 'Please try again.', tone: 'error' });
      return false;
    }
  };
  if (!canView) return <EmptyState title="Permission required" description="You do not have permission to view Wastage." />;
  const activeOutletId = selectedOutletId === "all" ? (outletOptions[0]?.value || "") : selectedOutletId;
  const filteredWaste = wasteRecords.filter((row) => {
    const item = itemById.get(row.itemId);
    const category = categoryById.get(item?.categoryId);
    const searchText = `${item?.name || ""} ${item?.sku || ""} ${category?.name || ""} ${row.notes || ""} ${outletById.get(row.outletId)?.name || ""}`.toLowerCase();
    return (activeOutletId ? row.outletId === activeOutletId : false)
      && (filters.wasteType === "all" || row.wasteType === filters.wasteType)
      && (!filters.from || row.date >= filters.from)
      && (!filters.to || row.date <= filters.to)
      && (!filters.search.trim() || searchText.includes(filters.search.trim().toLowerCase()));
  });
  const totalWasteQuantity = filteredWaste.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const typeCounts = wasteTypes.map((type) => ({ type, count: filteredWaste.filter((row) => row.wasteType === type).length }));
  const itemTotals = new Map();
  filteredWaste.forEach((row) => {
    const item = itemById.get(row.itemId);
    itemTotals.set(item?.name || "Inventory item", (itemTotals.get(item?.name || "Inventory item") || 0) + Number(row.quantity || 0));
  });
  const topItem = [...itemTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No data";
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title="Wastage" description="Record spoilage, expiry, damaged inventory and kitchen wastage." actions={canRecord ? <button className="btn-primary" type="button" disabled={!read.data} onClick={openRecordWaste}>Record Waste</button> : null} />
    {read.state === "refreshing" ? <p role="status">Refreshing Wastage. Showing the last verified complete read.</p> : null}
    {!read.data ? <div className="card p-4" role={read.error ? "alert" : "status"}><p>{!selectedOutletId ? "No accessible outlet" : read.error || "Loading complete Wastage…"}</p>{read.error ? <><p>No partial results are presented as complete.</p><button className="btn-secondary mt-3" onClick={read.refresh}>Retry</button></> : null}</div> : <>
    <AdminFilterToolbar outlet={<SelectField label="Outlet" value={activeOutletId} options={outletOptions} onChange={onSelectedOutletChange} searchable />} search={<AdminSearchField label="Search item/record" value={filters.search} onChange={(value) => updateFilter("search", value)} placeholder="Search item, category, note" />} filters={<SelectField label="Waste Type" value={filters.wasteType} options={[{ value: "all", label: "All" }, ...wasteTypes.map((type) => ({ value: type, label: type }))]} onChange={(value) => updateFilter("wasteType", value)} />} period={<FeedXDateRangePicker from={filters.from} to={filters.to} today={todayInput()} onApply={({ from, to }) => setFilters((current) => ({ ...current, from, to }))} />} periodAfterFilters />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Trash2} label="Waste Quantity" value={totalWasteQuantity} helper="Total recorded quantity" tone={totalWasteQuantity ? "warning" : "success"} /><MetricCard icon={ClipboardList} label="Waste Records" value={filteredWaste.length} helper="Matching current filters" tone={filteredWaste.length ? "warning" : "success"} /><MetricCard icon={AlertTriangle} label="Highest Waste Item" value={topItem} helper="Based on quantity recorded" /><MetricCard icon={Sparkles} label="Unexplained Loss %" value="0%" helper="No unexplained loss logged" /></div>
    <DashboardSection title="Operational Insights" subtitle="Rule-based signals for leakage and stock variance."><div className="grid gap-3 xl:grid-cols-3">{["Top wasted items will appear after records are created.", "Recurring spoilage patterns will appear after more operational data is collected.", "Variance trends will appear after stock checks are completed."].map((insight) => <div key={insight} className="rounded-2xl border border-primary/15 bg-primary/5 p-3"><div className="flex items-center gap-2 type-body-sm font-bold text-text-primary"><Sparkles size={15} className="text-primary" /> Operational signal</div><p className="mt-2 type-body-sm text-text-secondary">{insight}</p></div>)}</div></DashboardSection>
    <DashboardSection title="Waste Types" subtitle="Current waste mix across the selected outlet and filter range." density="compact"><div className="flex flex-wrap gap-2">{typeCounts.map(({ type, count }) => <Badge key={type} tone={count ? "warning" : "neutral"}>{type} ({count})</Badge>)}</div></DashboardSection>
    <DashboardSection title="Waste Records" subtitle="Outlet-scoped waste entries and future audit trail structure.">{filteredWaste.length ? <div className="overflow-x-auto rounded-2xl border border-border"><table className="w-full min-w-[980px] text-left"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted"><tr><th className="px-3 py-2">Date</th><th>Item</th><th>Category</th><th>Waste Type</th><th>Qty</th><th>Outlet</th><th>Recorded By</th><th>Notes</th><th>Evidence</th><th>Actions</th></tr></thead><tbody className="divide-y divide-border text-[13px]">{filteredWaste.map((row) => { const item = itemById.get(row.itemId); const category = categoryById.get(item?.categoryId); return <tr key={row.id}><td className="px-3 py-2 font-semibold text-text-primary">{formatDate(row.date)}</td><td className="font-bold text-text-primary">{item?.name ?? "Inventory item"}</td><td>{category?.name || "Uncategorized"}</td><td><Badge tone="warning">{row.wasteType}</Badge></td><td className="font-semibold">{row.quantity} {row.unit || item?.unit}</td><td>{outletById.get(row.outletId)?.name || "Outlet"}</td><td>{actorNameByAnyId(row.recordedBy || row.user)}</td><td className="max-w-52 truncate">{row.notes || "-"}</td><td>{row.photoUrl || row.photo_url ? <button className="type-caption font-black text-primary underline-offset-2 hover:underline" type="button" onClick={() => onPreviewPhoto({ src: row.photoUrl || row.photo_url, title: `${item?.name || "Waste"} evidence` })}>📷 View Photo</button> : <span className="type-caption text-text-muted">—</span>}</td><td><button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "detail", waste: row })}>View</button></td></tr>; })}</tbody></table></div> : <EmptyState title="No waste records for this outlet and filter range." description="Record spoilage, expiry or kitchen error to begin tracking operational leakage." />}</DashboardSection>
    {modal?.type === 'detail' ? <InventoryWasteDetail wasteId={modal.waste.id} auth={auth} outlets={outlets} onClose={() => setModal(null)} /> : null}
    {modal?.type === "record" ? <InventoryWasteModal outlet={outletById.get(modal.outletId)} items={selectableItems(modal.outletId)} todayInput={todayInput} parseNonNegativeNumber={parseNonNegativeNumber} onClose={() => setModal(null)} onSave={async (waste) => { if (await onSaveWaste(waste)) setModal(null); }} /> : null}
    <InventoryItemPhotoPreview preview={preview} onClose={() => onPreviewPhoto(null)} />
    </>}
  </div>;
}
