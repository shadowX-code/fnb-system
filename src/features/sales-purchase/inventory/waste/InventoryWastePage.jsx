import { useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Search, Sparkles, Trash2 } from "lucide-react";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../../components/forms/DatePickerField.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import InventoryWasteModal from "./InventoryWasteModal.jsx";
import InventoryWasteDetailModal from "./InventoryWasteDetailModal.jsx";

const wasteTypes = ["Spoilage", "Expired", "Kitchen Error", "Burnt", "Returned Item", "Staff Consumption", "Unknown"];

export default function InventoryWastePage({ wasteRecords, movements, selectedOutletId, onSelectedOutletChange, outletOptions, itemById, categoryById, outletById, actorNameByAnyId, formatDate, outletDisplayCode, todayInput, parseNonNegativeNumber, selectableItems, onRequestRecordWaste, onSaveWaste, onPreviewPhoto, actionRef, canView, canRecord }) {
  const [filters, setFilters] = useState({ wasteType: "all", from: "", to: "", search: "" });
  const [modal, setModal] = useState(null);
  const openRecordWaste = () => {
    const outletId = onRequestRecordWaste();
    if (outletId) setModal({ type: "record", outletId });
  };
  useEffect(() => {
    if (!actionRef) return undefined;
    actionRef.current = openRecordWaste;
    return () => { actionRef.current = null; };
  });
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
    <div className="card grid gap-3 p-3 lg:grid-cols-[220px_180px_170px_170px_1fr] lg:items-end"><SelectField label="Outlet" value={activeOutletId} options={outletOptions} onChange={onSelectedOutletChange} searchable /><SelectField label="Waste Type" value={filters.wasteType} options={[{ value: "all", label: "All Waste Types" }, ...wasteTypes.map((type) => ({ value: type, label: type }))]} onChange={(value) => updateFilter("wasteType", value)} /><DatePickerField label="From" value={filters.from} onChange={(value) => updateFilter("from", value)} /><DatePickerField label="To" value={filters.to} onChange={(value) => updateFilter("to", value)} /><label><div className="mb-1 type-caption font-semibold text-text-secondary">Search item/record</div><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} /><input className="control h-9 w-full pl-9 text-[13px]" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search item, category, note" /></div></label></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Trash2} label="Waste Quantity" value={totalWasteQuantity} helper="Total recorded quantity" tone={totalWasteQuantity ? "warning" : "success"} /><MetricCard icon={ClipboardList} label="Waste Records" value={filteredWaste.length} helper="Matching current filters" tone={filteredWaste.length ? "warning" : "success"} /><MetricCard icon={AlertTriangle} label="Highest Waste Item" value={topItem} helper="Based on quantity recorded" /><MetricCard icon={Sparkles} label="Unexplained Loss %" value="0%" helper="No unexplained loss logged" /></div>
    <DashboardSection title="Operational Insights" subtitle="Rule-based signals for leakage and stock variance."><div className="grid gap-3 xl:grid-cols-3">{["Top wasted items will appear after records are created.", "Recurring spoilage patterns will appear after more operational data is collected.", "Variance trends will appear after stock checks are completed."].map((insight) => <div key={insight} className="rounded-2xl border border-primary/15 bg-primary/5 p-3"><div className="flex items-center gap-2 type-body-sm font-bold text-text-primary"><Sparkles size={15} className="text-primary" /> Operational signal</div><p className="mt-2 type-body-sm text-text-secondary">{insight}</p></div>)}</div></DashboardSection>
    <DashboardSection title="Waste Types" subtitle="Current waste mix across the selected outlet and filter range." density="compact"><div className="flex flex-wrap gap-2">{typeCounts.map(({ type, count }) => <Badge key={type} tone={count ? "warning" : "neutral"}>{type} ({count})</Badge>)}</div></DashboardSection>
    <DashboardSection title="Waste Records" subtitle="Outlet-scoped waste entries and future audit trail structure.">{filteredWaste.length ? <div className="overflow-x-auto rounded-2xl border border-border"><table className="w-full min-w-[980px] text-left"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted"><tr><th className="px-3 py-2">Date</th><th>Item</th><th>Category</th><th>Waste Type</th><th>Qty</th><th>Outlet</th><th>Recorded By</th><th>Notes</th><th>Evidence</th><th>Actions</th></tr></thead><tbody className="divide-y divide-border text-[13px]">{filteredWaste.map((row) => { const item = itemById.get(row.itemId); const category = categoryById.get(item?.categoryId); return <tr key={row.id}><td className="px-3 py-2 font-semibold text-text-primary">{formatDate(row.date)}</td><td className="font-bold text-text-primary">{item?.name ?? "Inventory item"}</td><td>{category?.name || "Uncategorized"}</td><td><Badge tone="warning">{row.wasteType}</Badge></td><td className="font-semibold">{row.quantity} {row.unit || item?.unit}</td><td>{outletById.get(row.outletId)?.name || "Outlet"}</td><td>{actorNameByAnyId(row.recordedBy || row.user)}</td><td className="max-w-52 truncate">{row.notes || "-"}</td><td>{row.photoUrl || row.photo_url ? <button className="type-caption font-black text-primary underline-offset-2 hover:underline" type="button" onClick={() => onPreviewPhoto({ src: row.photoUrl || row.photo_url, title: `${item?.name || "Waste"} evidence` })}>📷 View Photo</button> : <span className="type-caption text-text-muted">—</span>}</td><td><button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "detail", waste: row })}>View</button></td></tr>; })}</tbody></table></div> : <EmptyState title="No waste records for this outlet and filter range." description="Record spoilage, expiry or kitchen error to begin tracking operational leakage." />}</DashboardSection>
    {modal?.type === "detail" ? (() => { const waste = modal.waste; const item = itemById.get(waste.itemId); return <InventoryWasteDetailModal waste={waste} item={item} outlet={outletById.get(waste.outletId)} category={categoryById.get(item?.categoryId)} movement={movements.find((entry) => entry.referenceType === "waste" && entry.referenceId === waste.id)} actorName={actorNameByAnyId(waste.recordedBy || waste.user)} formatDate={formatDate} outletDisplayCode={outletDisplayCode} onClose={() => setModal(null)} onPreviewPhoto={onPreviewPhoto} />; })() : null}
    {modal?.type === "record" ? <InventoryWasteModal outlet={outletById.get(modal.outletId)} items={selectableItems(modal.outletId)} todayInput={todayInput} parseNonNegativeNumber={parseNonNegativeNumber} onClose={() => setModal(null)} onSave={async (waste) => { if (await onSaveWaste(waste)) setModal(null); }} /> : null}
  </div>;
}
