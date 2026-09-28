import {useRef,useState,useMemo,useEffect} from "react";
import {ChevronDown} from "lucide-react";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import DashboardSection from "../../../components/layout/DashboardSection.jsx";
export function InventoryCategoryIcon({ category, size = "md" }) {
  const initial = (category?.name || "Inventory").slice(0, 1).toUpperCase();
  const sizeClass = size === "sm" ? "h-10 w-10 text-sm" : "h-11 w-11 text-base";
  return (
    <div className={`${sizeClass} grid shrink-0 place-items-center rounded-2xl border border-primary/15 bg-primary/10 font-black text-primary shadow-sm`}>
      {initial}
    </div>
  );
}

export function SupplierAssignmentPicker({ suppliers, outletId, selectedIds = [], onSave, disabled = false }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState(selectedIds);
  const selected = new Set(draftIds);
  const outletSuppliers = useMemo(() => suppliers
    .filter((supplier) => supplier.status === "active" || supplier.is_active === true)
    .filter((supplier) => (supplier.outletIds || supplier.assignedOutletIds || []).includes(outletId))
    .filter((supplier) => !query.trim() || supplier.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name)), [suppliers, outletId, query]);
  const selectedSuppliers = suppliers.filter((supplier) => selectedIds.includes(supplier.id));
  const label = selectedSuppliers.length === 0
    ? "No supplier"
    : selectedSuppliers.length === 1
      ? selectedSuppliers[0].name
      : `${selectedSuppliers.length} suppliers`;

  useEffect(() => {
    if (open) setDraftIds(selectedIds);
  }, [open, selectedIds]);

  return (
    <>
      <button
        ref={anchorRef}
        className="inline-flex h-8 max-w-[180px] items-center gap-1 rounded-full border border-border bg-white px-2.5 type-caption font-bold text-text-primary transition hover:border-primary/30 hover:text-primary"
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="shrink-0 text-text-muted" />
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={280} estimatedHeight={340}>
        <div className="space-y-2">
          <div className="px-1">
            <div className="type-caption font-bold text-text-primary">Assign suppliers</div>
            <div className="type-micro text-text-muted">Only suppliers linked to this outlet are shown.</div>
          </div>
          <input
            className="control h-8 w-full text-[12px]"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search suppliers"
          />
          {draftIds.length ? (
            <div className="flex flex-wrap gap-1">
              {suppliers.filter((supplier) => draftIds.includes(supplier.id)).map((supplier) => (
                <span key={supplier.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{supplier.name}</span>
              ))}
            </div>
          ) : null}
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {outletSuppliers.length ? outletSuppliers.map((supplier) => {
              const checked = selected.has(supplier.id);
              return (
                <label key={supplier.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(draftIds);
                      if (event.target.checked) next.add(supplier.id);
                      else next.delete(supplier.id);
                      setDraftIds([...next]);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate type-body-sm font-semibold text-text-primary">{supplier.name}</span>
                </label>
              );
            }) : (
              <div className="rounded-xl bg-slate-50 px-3 py-2 type-caption font-semibold text-text-secondary">
                No active suppliers linked to this outlet.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-2">
            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary h-8 px-2.5 text-xs" type="button" disabled={disabled} onClick={() => { onSave(draftIds); setOpen(false); }}>Save</button>
          </div>
        </div>
      </FloatingLayer>
    </>
  );
}

export function SectionCard({ title, description, action, children, className = "" }) {
  return (
    <DashboardSection title={title} subtitle={description} action={action} className={className}>
      {children}
    </DashboardSection>
  );
}

export function focusEditableGridInput(gridRef, currentRow, currentField, direction) {
  const fields = ["par", "storage"];
  const visibleInputs = [...(gridRef.current?.querySelectorAll("[data-grid-row][data-grid-field]") || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({
      input,
      row: Number(input.dataset.gridRow),
      field: input.dataset.gridField,
      fieldIndex: fields.indexOf(input.dataset.gridField),
    }))
    .filter((entry) => Number.isFinite(entry.row) && entry.fieldIndex >= 0)
    .sort((a, b) => a.row - b.row || a.fieldIndex - b.fieldIndex);
  if (!visibleInputs.length) return;

  const currentIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.field === currentField);
  let nextIndex = currentIndex;
  if (direction === "next-row") nextIndex = visibleInputs.findIndex((entry) => entry.row > currentRow && entry.field === currentField);
  if (direction === "previous-row") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row < currentRow && visibleInputs[index].field === currentField) {
        nextIndex = index;
        break;
      }
    }
  }
  if (direction === "right") nextIndex = Math.min(visibleInputs.length - 1, currentIndex + 1);
  if (direction === "left") nextIndex = Math.max(0, currentIndex - 1);
  if (nextIndex < 0 || nextIndex === currentIndex) return;
  const target = visibleInputs[nextIndex]?.input;
  target?.focus?.();
  target?.select?.();
}

export function focusMatrixGridInput(gridRef, currentRow, currentColumn, direction) {
  const visibleInputs = [...(gridRef.current?.querySelectorAll("[data-matrix-row][data-matrix-column]") || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({
      input,
      row: Number(input.dataset.matrixRow),
      column: Number(input.dataset.matrixColumn),
    }))
    .filter((entry) => Number.isFinite(entry.row) && Number.isFinite(entry.column))
    .sort((a, b) => a.row - b.row || a.column - b.column);
  if (!visibleInputs.length) return;

  const currentIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.column === currentColumn);
  let nextIndex = currentIndex;
  if (direction === "next-row") nextIndex = visibleInputs.findIndex((entry) => entry.row > currentRow && entry.column === currentColumn);
  if (direction === "previous-row") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row < currentRow && visibleInputs[index].column === currentColumn) {
        nextIndex = index;
        break;
      }
    }
  }
  if (direction === "right") {
    nextIndex = visibleInputs.findIndex((entry) => entry.row === currentRow && entry.column > currentColumn);
  }
  if (direction === "left") {
    for (let index = visibleInputs.length - 1; index >= 0; index -= 1) {
      if (visibleInputs[index].row === currentRow && visibleInputs[index].column < currentColumn) {
        nextIndex = index;
        break;
      }
    }
  }
  if (nextIndex < 0 || nextIndex === currentIndex) return;
  const target = visibleInputs[nextIndex]?.input;
  target?.focus?.();
  target?.select?.();
}

export function selectInputText(event) {
  if (!event.target.value) return;
  event.target.select?.();
}

export function parseNonNegativeNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return Math.max(0, parsed);
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadTextFile(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function todayInput(timeZone = "Asia/Kuala_Lumpur") {
  return getBusinessDateInput(timeZone);
}

export function getBusinessDateInput(timeZone = "Asia/Kuala_Lumpur", value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    // Fall back to browser local date if the requested timezone is unavailable.
  }
  return toDateInputValue(date);
}

export function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">{label}</div>
      <textarea className="control min-h-20 w-full resize-none text-[13px]" value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function focusIndexedInput(containerRef, currentIndex, direction, selector = "[data-entry-index]") {
  const inputs = [...(containerRef.current?.querySelectorAll(selector) || [])]
    .filter((input) => !input.disabled && input.offsetParent !== null)
    .map((input) => ({ input, index: Number(input.dataset.entryIndex) }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index);
  if (!inputs.length) return;
  const currentPosition = inputs.findIndex((entry) => entry.index === currentIndex);
  const nextPosition = direction === "previous"
    ? Math.max(0, currentPosition - 1)
    : Math.min(inputs.length - 1, currentPosition + 1);
  if (nextPosition < 0 || nextPosition === currentPosition) return;
  inputs[nextPosition]?.input?.focus?.();
  inputs[nextPosition]?.input?.select?.();
}
export function Field({ label, value, onChange, type = "text", placeholder, required = false, onBlur, error }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </div>
      <input
        className="control h-9 w-full text-[13px]"
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value ?? ""}
        placeholder={placeholder}
        onFocus={type === "number" ? selectInputText : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? <div className="mt-1 type-caption font-semibold text-rose-600">{error}</div> : null}
    </label>
  );
}
