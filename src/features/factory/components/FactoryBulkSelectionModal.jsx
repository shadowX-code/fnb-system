import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import { FactoryBulkThumbnail, FactoryImagePreview } from "./FactoryImagePreview.jsx";

export function Field({ label, children, error }) {
  return <label className="block"><span className="text-[10.5px] font-semibold text-[rgb(107,114,128)]">{label}</span><div className="mt-1.5">{children}</div>{error ? <div className="mt-1 text-xs font-semibold text-rose-600">{error}</div> : null}</label>;
}

export function inputClass(error) {
  return `w-full rounded-xl border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${error ? "border-rose-300" : "border-border"}`;
}

export function CompactSelect({ value, options, onChange, ariaLabel = "Select option", disabled = false }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const selected = options.find((option) => option.value === value) || options[0];
  return (
    <div>
      <button ref={anchorRef} className="flex h-9 min-w-[92px] items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 text-sm font-bold text-text-primary outline-none transition hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-text-muted" type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><span>{selected?.label || "—"}</span><ChevronDown size={14} className="text-text-muted" /></button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="end" minWidth={150} estimatedHeight={160} placement="auto" focusOnOpen>
        <div role="listbox" aria-label={ariaLabel}>{options.map((option) => <button key={option.value} className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold outline-none transition hover:bg-primary/5 focus:bg-primary/10 ${option.value === value ? "bg-primary/10 text-primary" : "text-text-primary"}`} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value ? <Check size={14} /> : null}</button>)}</div>
      </FloatingLayer>
    </div>
  );
}

export default function FactoryBulkSelectionModal({ title, description, items = [], existingIds = [], showImages = false, onClose, onAdd }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState([]);
  const [imagePreview, setImagePreview] = useState(null);
  const existingIdSet = useMemo(() => new Set(existingIds.filter(Boolean)), [existingIds]);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort((left, right) => left.localeCompare(right)), [items]);

  useEffect(() => { const timeout = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 180); return () => clearTimeout(timeout); }, [query]);
  useEffect(() => { const closeOnEscape = (event) => { if (event.key === "Escape" && !imagePreview) onClose(); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [imagePreview, onClose]);

  const visibleItems = items.filter((item) => (category === "all" || item.category === category) && (!debouncedQuery || `${item.primary || ""} ${item.secondary || ""} ${item.code || ""} ${item.meta || ""} ${item.category || ""}`.toLowerCase().includes(debouncedQuery)));
  const selectableVisibleIds = visibleItems.filter((item) => !item.disabled && !existingIdSet.has(item.id)).map((item) => item.id);
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedOrder.includes(id));
  const selectedItems = selectedOrder.map((id) => itemById.get(id)).filter(Boolean);
  const toggleItem = (id) => { if (!existingIdSet.has(id) && !itemById.get(id)?.disabled) setSelectedOrder((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); };
  const toggleVisible = () => setSelectedOrder((current) => allVisibleSelected ? current.filter((id) => !selectableVisibleIds.includes(id)) : [...current, ...selectableVisibleIds.filter((id) => !current.includes(id))]);
  const closeImagePreview = () => { const returnFocus = imagePreview?.trigger; setImagePreview(null); window.requestAnimationFrame(() => returnFocus?.focus?.()); };

  return (
    <Modal title={title} description={description} size="xl" onClose={onClose} panelClassName="max-md:h-[calc(100dvh-1rem)] max-md:max-h-none" bodyClassName="flex min-h-0 flex-col" footerClassName="items-center justify-between" footer={<><div className="mr-auto text-sm font-bold text-text-secondary">{selectedOrder.length} selected</div><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!selectedItems.length} onClick={() => onAdd(selectedItems)}>Add Selected</button></>}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className={`grid gap-3 ${categories.length > 1 ? "sm:grid-cols-[minmax(0,1fr)_220px]" : ""}`}>
          <label><div className="mb-1 text-xs font-semibold text-text-secondary">Search</div><input className={inputClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names or codes" autoFocus /></label>
          {categories.length > 1 ? <Field label="Category"><CompactSelect ariaLabel="Filter selection by category" value={category} options={[{ value: "all", label: "All" }, ...categories.map((value) => ({ value, label: value }))]} onChange={setCategory} /></Field> : null}
        </div>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary"><input className="h-4 w-4 accent-primary" type="checkbox" checked={allVisibleSelected} disabled={!selectableVisibleIds.length} onChange={toggleVisible} /><span>Select All Visible</span><span className="ml-auto text-xs font-semibold text-text-muted">{visibleItems.length} shown</span></label>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
          {visibleItems.length ? visibleItems.map((item) => {
            const alreadyAdded = existingIdSet.has(item.id); const disabled = alreadyAdded || item.disabled; const checked = alreadyAdded || selectedOrder.includes(item.id); const checkboxId = `factory-bulk-item-${item.id}`;
            return <div key={item.id} className={`flex min-h-14 items-center gap-3 border-b border-border px-3 py-3 last:border-0 ${disabled ? "bg-slate-50 opacity-70" : "bg-white hover:bg-primary/5"}`}><input id={checkboxId} className="h-4 w-4 shrink-0 accent-primary" type="checkbox" checked={checked} disabled={disabled} onChange={() => toggleItem(item.id)} />{showImages ? <FactoryBulkThumbnail item={item} onPreview={(previewItem, trigger) => setImagePreview({ item: previewItem, trigger })} /> : null}<label htmlFor={checkboxId} className={`min-w-0 flex-1 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}><span className="block font-bold text-text-primary">{item.primary || "Unnamed item"}</span>{item.secondary ? <span className="block text-sm font-semibold text-text-secondary">{item.secondary}</span> : null}<span className="mt-1 block text-xs font-semibold text-text-muted">{[item.code, item.meta].filter(Boolean).join(" · ") || "—"}</span></label><Badge tone={alreadyAdded ? "info" : item.disabled ? "neutral" : "success"}>{alreadyAdded ? "Already added" : item.statusLabel || "Active"}</Badge></div>;
          }) : <EmptyState title="No matching items" description="Try another name, code or category." />}
        </div>
      </div>
      {imagePreview ? <FactoryImagePreview item={imagePreview.item} onClose={closeImagePreview} /> : null}
    </Modal>
  );
}
