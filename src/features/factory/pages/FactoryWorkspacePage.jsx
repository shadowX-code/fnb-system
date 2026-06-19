import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, ClipboardList, Clock3, Factory, FileText, Package, PackageCheck, Play, RefreshCw, Tag, Truck, Warehouse } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";

const priorityOptions = ["Low", "Normal", "High", "Urgent"];
const jobStatusOptions = ["draft", "released", "in_progress", "completed", "cancelled"];
const commonUoms = ["kg", "g", "litre", "ml", "pcs", "carton", "pail", "bottle", "pack"];
const packagingTypes = ["Pack", "Bottle", "Sachet", "Tub", "Pail", "Bag", "Carton", "Tray", "Box"];
const factoryCustomerTypes = ["Outlet", "Distributor", "Retailer", "OEM", "Export", "Other"];
const storageLocationTypes = ["Dry Store", "Chiller", "Freezer", "Production Area", "Finished Goods Area", "Packaging Area"];
const qcStatusOptions = ["Pending", "Pass", "Hold", "Failed"];
const varianceThresholdPercent = 5;
const varianceReasonTolerance = 0.000001;
const stockCheckWarningPercent = 2;
const stockCheckCriticalPercent = 5;

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function previewProductionBatchNo(value) {
  const source = value || todayInput();
  const [year, month, day] = String(source).slice(0, 10).split("-");
  if (!year || !month || !day) return "PB-YYMMDD-001";
  return `PB-${String(year).slice(-2)}${month}${day}-001`;
}

function money(value) {
  return `RM${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function quantity(value, uom) {
  return `${Number(value || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

function percent(value) {
  return `${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function productionTimeLabel(minutes) {
  const totalMinutes = Number(minutes || 0);
  if (!totalMinutes) return "Not set";
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function formatDateDisplay(value, placeholder = "Select date") {
  if (!value) return placeholder;
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return placeholder;
  return `${day}/${month}/${year}`;
}

function monthStart(value) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function anchoredRect(anchor, width, height) {
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 16;
  const popoverWidth = Math.min(Math.max(rect.width, width), window.innerWidth - viewportPadding * 2);
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const openUpward = spaceBelow < height && rect.top > height;
  return {
    left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - popoverWidth - viewportPadding)),
    top: openUpward ? Math.max(viewportPadding, rect.top - height - 6) : rect.bottom + 6,
    width: popoverWidth,
    maxHeight: openUpward ? Math.min(height, rect.top - viewportPadding - 8) : Math.min(height, spaceBelow),
  };
}

function timeInput() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function employeeDisplayName(auth) {
  return auth?.profile?.nickname || auth?.profile?.full_name || auth?.profile?.email || "";
}

function statusTone(status) {
  if (status === "approved") return "success";
  if (status === "submitted") return "info";
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "in_progress" || status === "released" || status === "planned") return "info";
  return "neutral";
}

function jobStatusLabel(status) {
  const normalized = status === "planned" ? "released" : status;
  if (normalized === "in_progress") return "In Progress";
  return String(normalized || "draft").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Field({ label, children, error }) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-semibold text-[rgb(107,114,128)]">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? <div className="mt-1 text-xs font-semibold text-rose-600">{error}</div> : null}
    </label>
  );
}

function inputClass(error) {
  return `w-full rounded-xl border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${
    error ? "border-rose-300" : "border-border"
  }`;
}

function SearchableSelect({ value, options, placeholder, onChange, error, searchPlaceholder = "Search", emptyText = "No matching options", disabled = false, buttonRef }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => `${option.label} ${option.helper || ""}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="relative">
      <button ref={buttonRef} className={`${inputClass(error)} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-70`} type="button" disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span className={selected ? "text-text-primary" : "text-text-muted"}>{selected?.label || placeholder}</span>
        <span className="text-xs text-text-muted">Search</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-2 rounded-xl border border-border bg-white p-2 shadow-xl">
          <input className={inputClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {visibleOptions.length ? visibleOptions.map((option) => (
              <button
                key={option.value}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-primary/10 ${option.value === value ? "bg-primary/10 font-bold text-primary" : "text-text-primary"}`}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="block">{option.label}</span>
                {option.helper ? <span className="block text-xs text-text-secondary">{option.helper}</span> : null}
              </button>
            )) : <div className="px-3 py-4 text-sm font-semibold text-text-secondary">{emptyText}</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RawMaterialCellPicker({ value, materials, placeholder, open, openUpward, onToggle, onClose, onSelect, error, buttonRef }) {
  const [query, setQuery] = useState("");
  const wrapperNode = useRef(null);
  const searchNode = useRef(null);
  const selected = materials.find((material) => material.id === value);
  const visibleMaterials = materials.filter((material) => `${rawMaterialLabel(material)} ${rawMaterialSummary(material)} ${material.storage_location || ""}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!open) {
      setQuery("");
      return undefined;
    }
    const onPointerDown = (event) => {
      if (wrapperNode.current?.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    setTimeout(() => searchNode.current?.focus?.(), 0);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div ref={wrapperNode} className="relative">
      <button
        ref={buttonRef}
        className={`min-h-[54px] w-full rounded-xl border bg-surface px-3 py-2 text-left outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 ${error ? "border-rose-300" : "border-border"}`}
        type="button"
        onClick={onToggle}
      >
        {selected ? (
          <span className="block">
            <span className="block truncate text-sm font-semibold text-text-primary">{rawMaterialLabel(selected)}</span>
            <span className="mt-0.5 block truncate text-xs text-text-secondary">{rawMaterialSummary(selected)}</span>
          </span>
        ) : (
          <span className="block text-sm font-semibold text-text-muted">{placeholder}</span>
        )}
      </button>
      {open ? (
        <div className={`absolute left-0 z-[90] w-full rounded-2xl border border-border bg-white p-2 shadow-2xl ${openUpward ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"}`}>
          <input
            ref={searchNode}
            className="mb-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search raw material"
          />
          <div className="max-h-[280px] overflow-y-auto pr-1">
            {visibleMaterials.length ? visibleMaterials.map((material) => (
              <button
                key={material.id}
                className={`mb-1.5 block w-full rounded-xl border px-3 py-2.5 text-left transition last:mb-0 hover:border-primary hover:bg-primary/5 ${material.id === value ? "border-primary bg-primary/10" : "border-transparent bg-white"}`}
                type="button"
                onClick={() => onSelect(material.id)}
              >
                <span className="block truncate text-sm font-bold text-text-primary">{rawMaterialLabel(material)}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">{rawMaterialSummary(material)}</span>
                {material.storage_location ? <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">{material.storage_location}</span> : null}
              </button>
            )) : <div className="px-3 py-5 text-center text-sm font-semibold text-text-secondary">No matching raw materials</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FeedXDatePicker({ value, onChange, placeholder = "Select date", error, buttonRef, required = false }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(value));
  const [pickerMode, setPickerMode] = useState("days");
  const [yearRangeStart, setYearRangeStart] = useState(() => {
    const startYear = value ? monthStart(value).getFullYear() : new Date().getFullYear();
    return startYear - (startYear % 12);
  });
  const buttonNode = useRef(null);
  const panelNode = useRef(null);
  const todayIso = todayInput();
  const selectedIso = value || "";
  const monthOptions = Array.from({ length: 12 }, (_, index) => ({ value: index, label: new Date(2026, index, 1).toLocaleDateString("en-MY", { month: "short" }) }));
  const yearOptions = Array.from({ length: 12 }, (_, index) => yearRangeStart + index);
  const days = useMemo(() => {
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visibleMonth]);

  function updateRect() {
    setRect(anchoredRect(buttonNode.current, 300, 360));
  }

  function selectDate(nextDate) {
    onChange(isoDate(nextDate));
    setOpen(false);
  }

  function shiftMonth(delta) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function setMonth(month) {
    setVisibleMonth((current) => new Date(current.getFullYear(), Number(month), 1));
    setPickerMode("days");
  }

  function setYear(year) {
    setVisibleMonth((current) => new Date(Number(year), current.getMonth(), 1));
    setPickerMode("months");
  }

  useEffect(() => {
    if (value) {
      const selectedDate = monthStart(value);
      setVisibleMonth(selectedDate);
      setYearRangeStart(selectedDate.getFullYear() - (selectedDate.getFullYear() % 12));
    }
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onPointerDown = (event) => {
      if (buttonNode.current?.contains(event.target) || panelNode.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    updateRect();
    setPickerMode("days");
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div>
      <button
        ref={(node) => {
          buttonNode.current = node;
          if (buttonRef) buttonRef(node);
        }}
        className={`${inputClass(error)} flex items-center justify-between bg-white text-left ${value ? "text-text-primary" : "text-text-muted"}`}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          updateRect();
        }}
      >
        <span>{formatDateDisplay(value, placeholder)}</span>
        <span className="text-xs font-semibold text-text-muted">{required ? "Required" : "Optional"}</span>
      </button>
      {open && rect ? createPortal(
        <div
          ref={panelNode}
          className="fixed z-[80] rounded-2xl border border-border bg-white p-3 shadow-2xl"
          style={{ left: rect.left, top: rect.top, width: rect.width }}
        >
          <div className="flex items-center gap-2">
            <button className="btn-secondary px-2 py-1 text-xs" type="button" onClick={() => shiftMonth(-1)}>Prev</button>
            <button
              className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm font-bold outline-none transition ${pickerMode === "months" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-primary hover:border-primary/50"}`}
              type="button"
              onClick={() => setPickerMode((current) => current === "months" ? "days" : "months")}
            >
              {monthOptions[visibleMonth.getMonth()]?.label}
            </button>
            <button
              className={`w-24 rounded-lg border px-2 py-1.5 text-sm font-bold outline-none transition ${pickerMode === "years" ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-primary hover:border-primary/50"}`}
              type="button"
              onClick={() => {
                setYearRangeStart(visibleMonth.getFullYear() - (visibleMonth.getFullYear() % 12));
                setPickerMode((current) => current === "years" ? "days" : "years");
              }}
            >
              {visibleMonth.getFullYear()}
            </button>
            <button className="btn-secondary px-2 py-1 text-xs" type="button" onClick={() => shiftMonth(1)}>Next</button>
          </div>
          {pickerMode === "years" ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-secondary">
                <button className="rounded-lg px-2 py-1 hover:bg-slate-100" type="button" onClick={() => setYearRangeStart((current) => current - 12)}>Prev 12</button>
                <span>{yearRangeStart} - {yearRangeStart + 11}</span>
                <button className="rounded-lg px-2 py-1 hover:bg-slate-100" type="button" onClick={() => setYearRangeStart((current) => current + 12)}>Next 12</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {yearOptions.map((year) => (
                  <button
                    key={year}
                    className={`rounded-xl px-3 py-2 text-sm font-bold transition ${year === visibleMonth.getFullYear() ? "bg-primary text-white shadow-sm" : "bg-surface text-text-primary hover:bg-primary/10 hover:text-primary"}`}
                    type="button"
                    onClick={() => setYear(year)}
                  >
                    {year}
                  </button>
                ))}
              </div>
            </div>
          ) : pickerMode === "months" ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {monthOptions.map((month) => (
                <button
                  key={month.value}
                  className={`rounded-xl px-3 py-2 text-sm font-bold transition ${month.value === visibleMonth.getMonth() ? "bg-primary text-white shadow-sm" : "bg-surface text-text-primary hover:bg-primary/10 hover:text-primary"}`}
                  type="button"
                  onClick={() => setMonth(month.value)}
                >
                  {month.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-text-muted">
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {days.map((date) => {
                  const currentIso = isoDate(date);
                  const inMonth = date.getMonth() === visibleMonth.getMonth();
                  const selected = currentIso === selectedIso;
                  const today = currentIso === todayIso;
                  return (
                    <button
                      key={currentIso}
                      className={`h-9 rounded-lg text-sm font-semibold transition ${selected ? "bg-primary text-white shadow-sm" : today ? "bg-primary/10 text-primary" : inMonth ? "text-text-primary hover:bg-slate-100" : "text-text-muted/50 hover:bg-slate-50"}`}
                      type="button"
                      onClick={() => selectDate(date)}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => selectDate(new Date())}>Today</button>
            <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => {
              onChange("");
              setOpen(false);
            }}>Clear</button>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function focusFirstInvalid(refs, firstKey) {
  setTimeout(() => {
    const node = refs.current?.[firstKey];
    node?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    node?.focus?.({ preventScroll: true });
  }, 0);
}

function finishedGoodLabel(product) {
  return product?.product_family_name || product?.product_name_en || product?.product_name || "";
}

function finishedGoodHelper(product) {
  const packSize = Number(product?.pack_size_qty || 0) > 0 ? `${product.pack_size_qty} ${product.pack_size_uom || ""}`.trim() : "";
  return [product?.variant_name, product?.product_code, packSize, packagingTypeLabel(product)].filter(Boolean).join(" · ");
}

function rawMaterialLabel(material) {
  return material?.name_en || material?.name || "";
}

function rawMaterialHelper(material) {
  return [material?.material_code, material?.name_cn || material?.name_bm, material?.uom].filter(Boolean).join(" · ");
}

function rawMaterialSummary(material) {
  return `${material?.material_code || "No SKU"} · Balance ${quantity(material?.current_balance, material?.uom)}`;
}

function WarehouseBarList({ rows, valueLabel }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.value || 0)), 1);
  if (!rows.length) return <EmptyState title="No warehouse data" description="Complete production or stock movements to populate this view." />;
  return (
    <div className="space-y-3 p-4">
      {rows.map((row) => (
        <div key={row.id || row.label}>
          <div className="flex items-center justify-between gap-3 text-xs font-semibold">
            <span className="truncate text-text-primary">{row.label}</span>
            <span className="shrink-0 text-text-secondary">{valueLabel ? valueLabel(row.value, row) : row.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (Number(row.value || 0) / maxValue) * 100)}%` }} />
          </div>
          {row.helper ? <div className="mt-1 text-xs text-text-muted">{row.helper}</div> : null}
        </div>
      ))}
    </div>
  );
}

function varianceFor(standardUsage, actualUsage) {
  const standard = Number(standardUsage || 0);
  const actual = Number(actualUsage || 0);
  const variance = actual - standard;
  const variancePercent = standard === 0 ? (actual === 0 ? 0 : 100) : (variance / standard) * 100;
  return { variance, variancePercent };
}

function stockCheckVariance(systemQty, physicalQty) {
  const system = Number(systemQty || 0);
  const physical = Number(physicalQty || 0);
  const variance = physical - system;
  const variancePercent = system === 0 ? (physical === 0 ? 0 : 100) : (variance / system) * 100;
  const absPercent = Math.abs(variancePercent);
  const status = absPercent > stockCheckCriticalPercent ? "Critical" : absPercent > stockCheckWarningPercent ? "Warning" : "Normal";
  return { variance, variancePercent, status };
}

function stockVarianceTone(status) {
  if (status === "Critical") return "danger";
  if (status === "Warning") return "warning";
  return "success";
}

function latestReceivingCost(receivings, rawMaterialId) {
  return latestReceivingCostInfo(receivings, rawMaterialId).unitCost;
}

function latestReceivingCostInfo(receivings, rawMaterialId) {
  const rows = receivings
    .filter((row) => row.raw_material_id === rawMaterialId && Number(row.unit_cost || 0) > 0)
    .sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0));
  const row = rows[0];
  return {
    unitCost: Number(row?.unit_cost || 0),
    receiptNo: row?.receipt_no || "",
    supplierName: row?.supplier_name || "",
    receivedDate: row?.received_date || "",
    missingCost: !row,
  };
}

function usageUnitCost(usage, receivings) {
  return usageUnitCostInfo(usage, receivings).unitCost;
}

function usageUnitCostInfo(usage, receivings) {
  const recordedCost = Number(usage.unit_cost || 0);
  if (recordedCost > 0) return { unitCost: recordedCost, source: usage.receiving_ref || "Recorded receiving", missingCost: false };
  const latestCost = latestReceivingCostInfo(receivings, usage.raw_material_id);
  return { unitCost: latestCost.unitCost, source: latestCost.receiptNo || "Missing Cost", missingCost: latestCost.missingCost };
}

function productionCost(production, receivings) {
  return productionCostInfo(production, receivings).cost;
}

function productionCostInfo(production, receivings) {
  return (production.material_usage || []).reduce((summary, usage) => {
    const costInfo = usageUnitCostInfo(usage, receivings);
    summary.cost += Number(usage.actual_usage || 0) * costInfo.unitCost;
    if (costInfo.missingCost) summary.missingCostRows += 1;
    return summary;
  }, { cost: 0, missingCostRows: 0 });
}

function recipeCostInfo(recipe, receivings) {
  const itemRows = (recipe.items || []).map((item) => {
    const latestCost = latestReceivingCostInfo(receivings, item.raw_material_id);
    const quantityWithWastage = Number(item.quantity_used || 0) * (1 + Number(item.wastage_percent || 0) / 100);
    return {
      ...item,
      quantity_with_wastage: quantityWithWastage,
      unit_cost: latestCost.unitCost,
      cost_source: latestCost.receiptNo || "Missing Cost",
      supplier_name: latestCost.supplierName,
      received_date: latestCost.receivedDate,
      missing_cost: latestCost.missingCost,
      standard_cost: quantityWithWastage * latestCost.unitCost,
    };
  });
  const standardCost = itemRows.reduce((sum, item) => sum + item.standard_cost, 0);
  const yieldQuantity = Number(recipe.yield_quantity || 0);
  return {
    itemRows,
    standardCost,
    costPerUnit: yieldQuantity ? standardCost / yieldQuantity : 0,
    missingCostRows: itemRows.filter((item) => item.missing_cost).length,
  };
}

function costVarianceInfo(standardCost, actualCost) {
  const standard = Number(standardCost || 0);
  const actual = Number(actualCost || 0);
  const variance = actual - standard;
  const variancePercent = standard ? (variance / standard) * 100 : 0;
  return { variance, variancePercent };
}

function costDisplay(value, missingCostRows = 0) {
  return missingCostRows ? "Missing Cost" : money(value);
}

function includesText(value, search) {
  if (!search) return true;
  return String(value || "").toLowerCase().includes(String(search).toLowerCase());
}

function compactCompare(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function packSizeText(sku) {
  return Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`.trim() : "";
}

function packagingTypeLabel(sku) {
  return sku?.packaging_type || "Pack";
}

function pluralizePackagingType(type, value) {
  const label = type || "Pack";
  if (Number(value || 0) === 1) return label;
  if (/ch$/i.test(label)) return `${label}es`;
  return `${label}s`;
}

function skuBalanceLabel(sku) {
  const balance = Number(sku?.current_balance || 0);
  return quantity(balance, pluralizePackagingType(packagingTypeLabel(sku), balance));
}

function movementPackagingQtyLabel(movement) {
  const movementQty = Number(movement?.quantity || 0);
  return quantity(movementQty, pluralizePackagingType(packagingTypeLabel(movement), Math.abs(movementQty)));
}

function dispatchTotalLabel(dispatch) {
  const items = dispatch?.items || [];
  if (!items.length) return "—";
  const types = [...new Set(items.map((item) => packagingTypeLabel(item)).filter(Boolean))];
  if (types.length === 1) {
    return quantity(dispatch.total_qty, pluralizePackagingType(types[0], dispatch.total_qty));
  }
  return `${Number(dispatch.items_count || items.length).toLocaleString("en-MY")} SKU${Number(dispatch.items_count || items.length) === 1 ? "" : "s"}`;
}

function movementBaseEquivalentLabel(movement) {
  const movementQty = Number(movement?.quantity || 0);
  const base = normalizePackSizeToBase(movement?.pack_size_qty || movement?.base_qty, movement?.pack_size_uom || movement?.base_uom);
  if (!movementQty || !base) return "—";
  return quantity(movementQty * base.amount, base.uom);
}

function movementSourceLabel(movement) {
  if (movement?.reference_type === "production") return "Completed Production";
  if (movement?.reference_type === "finished_goods_dispatch") return "Finished Goods Dispatch";
  if (movement?.reference_type === "stock_check") return "Stock Check Adjustment";
  if (movement?.reference_type === "manual_adjustment") return "Manual Adjustment";
  return movement?.reference_type || "—";
}

function movementTypeLabel(movement) {
  if (movement?.reference_type === "production" && Number(movement?.quantity || 0) > 0) return "Production Stock In";
  if (movement?.reference_type === "finished_goods_dispatch") return "Dispatch Out";
  return movement?.movement_type || "Movement";
}

function normalizePackSizeToBase(qty, uom) {
  const amount = Number(qty || 0);
  const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") return { amount, uom: "kg" };
  if (unit === "g" || unit === "gram" || unit === "grams") return { amount: amount / 1000, uom: "kg" };
  if (unit === "l" || unit === "litre" || unit === "liter" || unit === "litres" || unit === "liters") return { amount, uom: "L" };
  if (unit === "ml" || unit === "millilitre" || unit === "milliliter" || unit === "millilitres" || unit === "milliliters") return { amount: amount / 1000, uom: "L" };
  return null;
}

function packagingProductionPlan(packQty, sku, recipeUom = "") {
  const targetPackQty = Number(packQty || 0);
  const packSizeQty = Number(sku?.pack_size_qty || sku?.base_qty || 0);
  const packSizeUom = sku?.pack_size_uom || sku?.base_uom || "";
  const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom);
  const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;

  if (!targetPackQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };
  if (packBase) {
    if (recipeBase && recipeBase.uom !== packBase.uom) {
      return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: recipeBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
    }
    return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packBase.amount, production_uom: packBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }

  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedPackUom.toLowerCase()) {
    return { target_pack_qty: targetPackQty, target_production_qty: 0, production_uom: normalizedRecipeUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU Pack Size UOM cannot convert to the active recipe UOM." };
  }
  return { target_pack_qty: targetPackQty, target_production_qty: targetPackQty * packSizeQty, production_uom: normalizedRecipeUom || normalizedPackUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}

function packagingPackEstimate(productionQty, productionUom, sku, recipeUom = "") {
  const targetProductionQty = Number(productionQty || 0);
  const packSizeQty = Number(sku?.pack_size_qty || sku?.base_qty || 0);
  const packSizeUom = sku?.pack_size_uom || sku?.base_uom || "";
  const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom);
  const productionBase = normalizePackSizeToBase(targetProductionQty, productionUom);
  const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;

  if (!targetProductionQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: productionUom || recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!String(productionUom || "").trim()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM is required." };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };

  if (packBase) {
    if (!productionBase) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (productionBase.uom !== packBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (recipeBase && recipeBase.uom !== productionBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
    return { target_pack_qty: productionBase.amount / packBase.amount, target_production_qty: productionBase.amount, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }

  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedProductionUom = String(productionUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
  if (normalizedPackUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
  return { target_pack_qty: targetProductionQty / packSizeQty, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}

function activeRecipeForSku(recipes = [], sku = {}, productName = "") {
  return recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id && recipe.product_family_id === sku?.product_family_id)
    || recipes.find((recipe) => recipe.status === "active" && recipe.finished_good_id && recipe.finished_good_id === sku?.id)
    || recipes.find((recipe) => recipe.status === "active" && String(recipe.product_name || "").toLowerCase() === String(productName || sku?.product_family_name || sku?.product_name || "").toLowerCase());
}

function finishedGoodParentKey(sku) {
  return sku?.product_family_id ? `family:${sku.product_family_id}` : sku?.id ? `sku:${sku.id}` : "";
}

function packagingBaseBalanceInfo(skus = []) {
  if (!skus.length) return { label: "—", amount: null, uom: "" };
  let total = 0;
  let baseUom = "";
  for (const sku of skus) {
    const base = normalizePackSizeToBase(sku.pack_size_qty || sku.base_qty, sku.pack_size_uom || sku.base_uom);
    if (!base) return { label: "Mixed", amount: null, uom: "" };
    if (baseUom && baseUom !== base.uom) return { label: "Mixed", amount: null, uom: "" };
    baseUom = base.uom;
    total += Number(sku.current_balance || 0) * base.amount;
  }
  return { label: quantity(total, baseUom), amount: total, uom: baseUom };
}

function variantIsPackSize(sku) {
  const variant = compactCompare(sku?.variant_name);
  if (!variant) return true;
  const packSize = compactCompare(packSizeText(sku));
  if (!packSize) return false;
  return variant === packSize || variant === `${packSize}pack` || variant === `${packSize}packing`;
}

function jobProgressPercent(job) {
  if (job?.status === "completed") return 100;
  if (job?.status === "in_progress") return 50;
  return 0;
}

function progressToneClass(percent) {
  if (percent >= 100) return "bg-emerald-500";
  if (percent >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

function jobFinishedGoodName(job) {
  return job?.product_family_name || job?.product_name_en || job?.product_name || "Finished Good";
}

function jobPackagingSkuLabel(job) {
  return [job?.variant_name || packSizeText(job) || "Packaging SKU", job?.product_code || "No SKU"].filter(Boolean).join(" · ");
}

function factoryTimeLabel(value) {
  if (!value) return "—";
  if (/^\d{2}:\d{2}/.test(String(value))) return String(value).slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });
}

function factoryActivitySortValue(value, fallbackDate = todayInput()) {
  if (!value) return 0;
  const text = String(value);
  if (/^\d{2}:\d{2}/.test(text)) return new Date(`${fallbackDate}T${text.slice(0, 5)}:00`).getTime();
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function productionOutputLabel(production) {
  return quantity(production?.good_output_qty || production?.actual_output_qty || production?.actual_produced_qty || production?.produced_quantity, production?.uom);
}

function aggregateProductionOutput(productions = []) {
  if (!productions.length) return "0";
  let total = 0;
  let uom = "";
  for (const production of productions) {
    const rowUom = production.uom || "";
    if (uom && rowUom && uom !== rowUom) return "Mixed";
    if (!uom) uom = rowUom;
    total += Number(production.good_output_qty || production.actual_output_qty || production.actual_produced_qty || production.produced_quantity || 0);
  }
  return quantity(total, uom);
}

function productionYieldPercent(production) {
  const actualProduced = Number(production.actual_produced_qty || production.produced_quantity || 0);
  if (!actualProduced) return 0;
  return (Number(production.good_output_qty || 0) / actualProduced) * 100;
}

function weightedMaterialVariancePercent(productions) {
  let standard = 0;
  let variance = 0;
  productions.forEach((production) => {
    (production.material_usage || []).forEach((usage) => {
      standard += Number(usage.standard_usage || 0);
      variance += Number(usage.variance_qty || 0);
    });
  });
  return standard ? (variance / standard) * 100 : 0;
}

function FactoryTable({ columns, rows, emptyTitle, emptyDescription, onRowClick }) {
  if (!rows.length) return <div className="p-4"><EmptyState title={emptyTitle} description={emptyDescription} /></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {columns.map((column) => (
              <th key={column.key} className={`px-4 py-2.5 ${column.align === "right" ? "text-right" : ""}`}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-border last:border-0 ${onRowClick ? "cursor-pointer transition hover:bg-slate-50" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 text-sm ${column.align === "right" ? "text-right" : ""}`}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessIssueNotice({ issues }) {
  if (!issues?.length) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="font-bold">Some Factory data is hidden by your current role.</div>
      <div className="mt-1 text-xs font-semibold text-amber-800">
        {issues.map((issue) => issue.label).join(", ")}
      </div>
    </div>
  );
}

function FinishedGoodDetailModal({ product, productions, movements, productionCosts, onClose }) {
  const productKey = String(product.product_name || "").toLowerCase();
  const productProductions = productions.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const productMovements = movements.filter((row) => row.finished_good_id === product.id || String(row.product_name || "").toLowerCase() === productKey);
  const costRows = productionCosts.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const totalActualCost = costRows.reduce((sum, row) => sum + Number(row.actual_cost || 0), 0);
  const totalGoodOutput = productProductions.reduce((sum, row) => sum + Number(row.good_output_qty || row.produced_quantity || 0), 0);
  const averageCost = totalGoodOutput ? totalActualCost / totalGoodOutput : 0;
  const hasCostData = costRows.some((row) => (row.material_usage || []).length);
  const hasMissingCost = !hasCostData || costRows.some((row) => row.missing_cost_rows);
  const batchRows = productProductions.filter((row) => row.batch_no);
  return (
    <Modal title={product.product_name} description="Finished goods stock, production and movement detail" onClose={onClose} size="2xl">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Current Balance" value={skuBalanceLabel(product)} helper={product.product_code || "Packaging SKU"} />
          <MetricCard icon={Factory} label="Production Runs" value={productProductions.length} helper="Completed history" />
          <MetricCard icon={Activity} label="Movements" value={productMovements.length} helper="Stock movement rows" />
          <MetricCard icon={Truck} label="Avg Actual Cost" value={hasMissingCost ? "Missing Cost" : money(averageCost)} helper="From actual usage" />
        </div>
        <Card title="Production History" description="Completed production records for this finished good.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
              { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
              { key: "output", label: "Good Output", render: (row) => quantity(row.good_output_qty || row.produced_quantity, row.uom) },
              { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
            ]}
            rows={productProductions}
            emptyTitle="No production history"
            emptyDescription="Complete production first to create finished goods production history."
          />
        </Card>
        <Card title="Movement History" description="Finished goods stock movements linked to this SKU.">
          <FactoryTable
            columns={[
              { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.reference_type || "No source"}</div></div> },
              { key: "movement_type", label: "Movement", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
              { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
              { key: "movement_date", label: "Date", render: (row) => row.movement_date || "—" },
            ]}
            rows={productMovements}
            emptyTitle="No movement history"
            emptyDescription="Production stock-in and stock check adjustments will appear here."
          />
        </Card>
        <Card title="Batch History" description="Batch numbers from completed production runs.">
          <FactoryTable
            columns={[
              { key: "batch_no", label: "Batch", render: (row) => row.batch_no || "—" },
              { key: "production_no", label: "Production", render: (row) => row.production_no },
              { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
              { key: "operator_name", label: "Operator", render: (row) => row.operator_name || "—" },
            ]}
            rows={batchRows}
            emptyTitle="No batch history"
            emptyDescription="Complete production with a batch number to populate batch history."
          />
        </Card>
      </div>
    </Modal>
  );
}

function ProductGroupModal({ initialValue, categories = [], onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    name_en: "",
    name_cn: "",
    name_bm: "",
    category_id: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeCategories = categories.filter((category) => category.status === "active" || category.id === form.category_id);
  const categoryOptions = activeCategories.map((category) => ({ value: category.id, label: category.name, helper: category.description || category.status }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name_en || "").trim()) {
      setError("Finished Good name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!onArchive || !initialValue?.id) return;
    setSaving(true);
    try {
      await onArchive(initialValue);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Finished Good" : "Create Finished Good"}
      description="Finished Goods organize one or more packaging SKUs under one product identity."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {initialValue?.id && initialValue.status !== "archived" ? <button className="btn-danger" type="button" disabled={saving} onClick={archive}>Archive Finished Good</button> : <span />}
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-product-group-form" disabled={saving}>{saving ? "Saving..." : "Save Finished Good"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-product-group-form" className="space-y-4" onSubmit={submit}>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Product Identity</div>
            <div className="mt-1 text-sm text-text-secondary">The product master name shared by all packaging SKUs.</div>
          </div>
          <Field label="Product Name (EN) *">
            <input className={inputClass(error)} value={form.name_en || ""} onChange={(event) => {
              setError("");
              setForm((current) => ({ ...current, name_en: event.target.value }));
            }} />
          </Field>
          <Field label="Product Name (CN)">
            <input className={inputClass()} value={form.name_cn || ""} onChange={(event) => setForm((current) => ({ ...current, name_cn: event.target.value }))} />
          </Field>
          <Field label="Product Name (BM)">
            <input className={inputClass()} value={form.name_bm || ""} onChange={(event) => setForm((current) => ({ ...current, name_bm: event.target.value }))} />
          </Field>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">Configuration</div>
            <div className="mt-1 text-sm text-text-secondary">Finished Good status and category for warehouse filtering.</div>
          </div>
          <Field label="Category">
            <SearchableSelect
              value={form.category_id || ""}
              options={categoryOptions}
              placeholder="Select Category"
              searchPlaceholder="Search categories"
              emptyText="No categories"
              onChange={(categoryId) => setForm((current) => ({ ...current, category_id: categoryId }))}
            />
          </Field>
          <Field label="Status *">
            <select className={inputClass()} value={form.status || "active"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </section>
        <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
        </section>
      </form>
    </Modal>
  );
}

function FinishedGoodMasterModal({ initialValue, categories, storageLocations = [], productFamilies = [], onClose, onSave, onArchive }) {
  const fieldRefs = useRef({});
  const [form, setForm] = useState(() => ({
    product_code: "",
    product_name: initialValue?.product_name || "",
    product_name_en: initialValue?.product_name_en || initialValue?.product_name || "",
    product_name_cn: "",
    product_name_bm: "",
    product_family_id: "",
    product_family_name: "",
    variant_name: "",
    packaging_type: "Pack",
    pack_size_qty: "",
    pack_size_uom: "kg",
    base_qty: "",
    base_uom: "",
    category_id: "",
    category: "",
    uom: "kg",
    min_stock_level: 0,
    storage_location_id: "",
    storage_location: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const selectedCategory = categories.find((category) => category.id === form.category_id);
  const selectedFamily = productFamilies.find((family) => family.id === form.product_family_id);
  const parentName = selectedFamily?.name_en || form.product_family_name || form.product_name_en || form.product_name || "Unassigned Finished Good";
  const parentCategory = selectedFamily?.category || selectedCategory?.name || form.category || "No category";
  const activeStorageLocations = storageLocations.filter((location) => location.status === "active" || location.id === form.storage_location_id);
  const storageLocationOptions = [
    { value: "", label: "No Storage Location", helper: "Leave blank" },
    ...activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") || location.status })),
  ];

  async function submit(event) {
    event.preventDefault();
    setError("");
    const nextErrors = {
      category_id: !form.category_id ? "Category is required." : "",
      product_code: !String(form.product_code || "").trim() ? "SKU Code is required." : "",
      product_name_en: !String(form.product_name_en || form.product_name || parentName || "").trim() ? "Finished Good name is required." : "",
      variant_name: !String(form.variant_name || "").trim() ? "Packaging Variant is required." : "",
      pack_size_qty: !Number(form.pack_size_qty || 0) ? "Pack Size Qty is required." : "",
      pack_size_uom: !String(form.pack_size_uom || "").trim() ? "Pack Size UOM is required." : "",
      uom: !String(form.uom || "").trim() ? "UOM is required." : "",
      status: !String(form.status || "").trim() ? "Status is required." : "",
    };
    const activeErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message));
    setFieldErrors(activeErrors);
    const firstError = Object.keys(activeErrors)[0];
    if (firstError) {
      setError("Please complete required fields.");
      focusFirstInvalid(fieldRefs, firstError);
      return;
    }
    setSaving(true);
    try {
      const skuUom = form.pack_size_uom || form.uom;
      const variantName = String(form.variant_name || "").trim();
      const parentProductName = selectedFamily?.name_en || form.product_family_name || parentName;
      const productName = [parentProductName, variantName].filter(Boolean).join(" - ") || String(form.product_code || "").trim();
      await onSave({
        ...form,
        product_name: productName,
        product_name_en: productName,
        product_name_cn: selectedFamily?.name_cn || form.product_name_cn || "",
        product_name_bm: selectedFamily?.name_bm || form.product_name_bm || "",
        category: selectedCategory?.name || selectedFamily?.category || form.category || "",
        product_family_id: selectedFamily?.id || form.product_family_id || "",
      product_family_name: parentProductName || "",
      packaging_type: form.packaging_type || "Pack",
      base_qty: form.pack_size_qty,
        base_uom: skuUom,
        uom: skuUom,
      });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!onArchive || !initialValue?.id) return;
    setSaving(true);
    try {
      await onArchive(initialValue);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Packaging SKU" : "Add Packaging SKU"}
      description={`${initialValue?.id ? "Edit" : "Add"} a packaging SKU under ${parentName}.`}
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {initialValue?.id && initialValue.status !== "archived" ? <button className="btn-danger" type="button" disabled={saving} onClick={archive}>Archive</button> : <span />}
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-finished-good-form" disabled={saving}>{saving ? "Saving..." : "Save Packaging SKU"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-finished-good-form" className="space-y-4" onSubmit={submit}>
        <div className="space-y-5">
          <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <div className="text-[10.5px] font-semibold text-[rgb(107,114,128)]">Finished Good</div>
            <div className="mt-1 text-lg font-bold text-text-primary">{parentName}</div>
            <div className="mt-1 text-sm font-semibold text-text-secondary">Category: {parentCategory}</div>
            {fieldErrors.category_id ? <div className="mt-2 text-xs font-semibold text-rose-600">Edit the Finished Good and select a category before adding Packaging SKUs.</div> : null}
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
            <Field label="SKU Code *" error={fieldErrors.product_code}>
              <input ref={(node) => { fieldRefs.current.product_code = node; }} className={inputClass(fieldErrors.product_code)} value={form.product_code || ""} onChange={(event) => {
                setFieldErrors((current) => ({ ...current, product_code: "" }));
                setForm((current) => ({ ...current, product_code: event.target.value }));
              }} />
            </Field>
            <Field label="Packaging Variant *" error={fieldErrors.variant_name}>
              <input ref={(node) => { fieldRefs.current.variant_name = node; }} className={inputClass(fieldErrors.variant_name)} value={form.variant_name || ""} placeholder="1kg Pack, 2kg Pack, 5kg Pail" onChange={(event) => {
                setFieldErrors((current) => ({ ...current, variant_name: "" }));
                setForm((current) => ({ ...current, variant_name: event.target.value }));
              }} />
            </Field>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Packaging Type">
                <select className={inputClass()} value={form.packaging_type || "Pack"} onChange={(event) => setForm((current) => ({ ...current, packaging_type: event.target.value }))}>
                  {packagingTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="Pack Size Qty *" error={fieldErrors.pack_size_qty}>
                <input ref={(node) => { fieldRefs.current.pack_size_qty = node; }} className={inputClass(fieldErrors.pack_size_qty)} type="number" min="0" step="0.0001" value={form.pack_size_qty ?? ""} onChange={(event) => {
                  const value = event.target.value;
                  setFieldErrors((current) => ({ ...current, pack_size_qty: "" }));
                  setForm((current) => ({
                    ...current,
                    pack_size_qty: value,
                    base_qty: value,
                  }));
                }} />
              </Field>
              <Field label="Pack Size UOM *" error={fieldErrors.pack_size_uom}>
                <select ref={(node) => { fieldRefs.current.pack_size_uom = node; }} className={inputClass(fieldErrors.pack_size_uom)} value={form.pack_size_uom || "kg"} onChange={(event) => {
                  const value = event.target.value;
                  setFieldErrors((current) => ({ ...current, pack_size_uom: "", uom: "" }));
                  setForm((current) => ({
                    ...current,
                    pack_size_uom: value,
                    base_uom: value,
                    uom: value,
                  }));
                }}>
                  {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Storage Location">
              <SearchableSelect
                value={form.storage_location_id || ""}
                options={storageLocationOptions}
                placeholder="Select Storage Location"
                searchPlaceholder="Search locations"
                emptyText="No storage locations"
                onChange={(locationId) => setForm((current) => ({ ...current, storage_location_id: locationId }))}
              />
            </Field>
            <Field label="Status *" error={fieldErrors.status}>
              <select ref={(node) => { fieldRefs.current.status = node; }} className={inputClass(fieldErrors.status)} value={form.status} onChange={(event) => {
                setFieldErrors((current) => ({ ...current, status: "" }));
                setForm((current) => ({ ...current, status: event.target.value }));
              }}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-slate-50/60 p-4">
            <div>
              <div className="text-sm font-semibold text-text-primary">Notes</div>
              <div className="mt-1 text-sm text-text-secondary">Internal remarks for warehouse and production teams.</div>
            </div>
            <Field label="Remarks">
              <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
            </Field>
          </section>
        </div>
      </form>
    </Modal>
  );
}

function FinishedGoodCategoryModal({ categories, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    name: "",
    description: "",
    status: "active",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  function edit(category) {
    setForm({ id: category.id, name: category.name || "", description: category.description || "", status: category.status || "active" });
    setError("");
  }

  async function archive(category) {
    setSaving(true);
    try {
      await onArchive(category);
      if (form.id === category.id) setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Finished Good Categories"
      description="Group finished goods products for warehouse visibility and filtering."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <form id="factory-finished-good-category-form" className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <Field label="Category Name">
            <input className={inputClass()} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className={inputClass()} rows={3} value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Category" : "Create Category"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm({ name: "", description: "", status: "active" })}>New</button> : null}
          </div>
        </form>
        <div className="max-h-[460px] overflow-y-auto rounded-xl border border-border bg-white">
          {categories.length ? categories.map((category) => (
            <div key={category.id} className="flex items-start justify-between gap-3 border-b border-border p-4 last:border-0">
              <div>
                <div className="font-bold text-text-primary">{category.name}</div>
                <div className="mt-1 text-sm text-text-secondary">{category.description || "No description"}</div>
                <div className="mt-2"><Badge tone={category.status === "active" ? "success" : "neutral"}>{category.status}</Badge></div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(category)}>Edit</button>
                {category.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(category)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No categories" description="Create a category before saving finished good products." />}
        </div>
      </div>
    </Modal>
  );
}

function RawMaterialDetailModal({ material, receivings, movements, stockChecks, onClose }) {
  const materialReceivings = receivings.filter((row) => row.raw_material_id === material.id);
  const materialMovements = movements.filter((row) => row.raw_material_id === material.id);
  const materialChecks = stockChecks
    .flatMap((check) => (check.items || []).filter((item) => item.raw_material_id === material.id).map((item) => ({ ...item, check_no: check.check_no, check_date: check.check_date, status: check.status })));
  const latestCost = latestReceivingCostInfo(receivings, material.id);
  const consumptionRows = materialMovements.filter((row) => Number(row.quantity || 0) < 0 || String(row.movement_type || "").toLowerCase().includes("production"));
  const costTrendRows = materialReceivings.filter((row) => Number(row.unit_cost || 0) > 0).slice(0, 8);
  return (
    <Modal title={rawMaterialLabel(material)} description="Raw material stock, receiving, consumption and count detail" onClose={onClose} size="2xl">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Current Balance" value={quantity(material.current_balance, material.uom)} helper={material.material_code || "Raw material"} />
          <MetricCard icon={Truck} label="Receiving Rows" value={materialReceivings.length} helper="Supplier deliveries" />
          <MetricCard icon={Factory} label="Consumption Rows" value={consumptionRows.length} helper="Production usage / stock-out" />
          <MetricCard icon={PackageCheck} label="Latest Unit Cost" value={latestCost.missingCost ? "Missing Cost" : money(latestCost.unitCost)} helper={latestCost.receivedDate || "No receiving cost"} />
        </div>
        <Card title="Receiving History" description="Supplier receiving rows linked to this raw material.">
          <FactoryTable
            columns={[
              { key: "receipt", label: "Receipt", render: (row) => <div><div className="font-bold text-text-primary">{row.receipt_no}</div><div className="text-xs text-text-secondary">{row.received_date}</div></div> },
              { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
              { key: "batch_no", label: "Batch", render: (row) => row.batch_no || "—" },
              { key: "qty", label: "Qty", render: (row) => quantity(row.received_qty, row.uom) },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => money(row.unit_cost) },
            ]}
            rows={materialReceivings}
            emptyTitle="No receiving history"
            emptyDescription="Record receiving for this raw material to populate receiving history."
          />
        </Card>
        <Card title="Consumption and Movement History" description="Movement log from receiving, production actual usage and approved stock checks.">
          <FactoryTable
            columns={[
              { key: "reference", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.reference_type || "No source"}</div></div> },
              { key: "movement_type", label: "Movement", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
              { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
              { key: "movement_date", label: "Date", render: (row) => row.movement_date || "—" },
              { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
            ]}
            rows={materialMovements}
            emptyTitle="No movement history"
            emptyDescription="Receiving, production usage and approved stock checks will create movement history."
          />
        </Card>
        <Card title="Stock Check History" description="Physical count rows for this raw material.">
          <FactoryTable
            columns={[
              { key: "check_no", label: "Check", render: (row) => <div><div className="font-bold text-text-primary">{row.check_no}</div><div className="text-xs text-text-secondary">{row.check_date}</div></div> },
              { key: "variance_qty", label: "Variance Qty", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_percent", label: "Variance %", render: (row) => percent(row.variance_percent) },
              { key: "variance_status", label: "Variance", render: (row) => <Badge tone={stockVarianceTone(row.variance_status)}>{row.variance_status}</Badge> },
              { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
            ]}
            rows={materialChecks}
            emptyTitle="No stock check history"
            emptyDescription="Approved and submitted raw stock checks for this material will appear here."
          />
        </Card>
        <Card title="Supplier Cost Trend" description="Recent receiving unit cost by supplier.">
          <FactoryTable
            columns={[
              { key: "received_date", label: "Date", render: (row) => row.received_date || "—" },
              { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
              { key: "batch_no", label: "Batch", render: (row) => row.batch_no || "—" },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => money(row.unit_cost) },
            ]}
            rows={costTrendRows}
            emptyTitle="No cost trend"
            emptyDescription="Receiving rows with unit cost will populate supplier cost trend."
          />
        </Card>
      </div>
    </Modal>
  );
}

function RawMaterialMasterModal({ initialValue, categories, storageLocations = [], onClose, onSave, onArchive }) {
  const fieldRefs = useRef({});
  const [form, setForm] = useState(() => ({
    material_code: "",
    name: initialValue?.name || "",
    name_en: initialValue?.name_en || initialValue?.name || "",
    name_cn: "",
    name_bm: "",
    category_id: "",
    category: "",
    uom: "kg",
    min_stock_level: 0,
    storage_location_id: "",
    storage_location: "",
    status: "active",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const activeCategories = categories.filter((category) => category.status === "active" || category.id === form.category_id);
  const categoryOptions = activeCategories.map((category) => ({ value: category.id, label: category.name, helper: category.description || category.status }));
  const activeStorageLocations = storageLocations.filter((location) => location.status === "active" || location.id === form.storage_location_id);
  const storageLocationOptions = [
    { value: "", label: "No Storage Location", helper: "Leave blank" },
    ...activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") || location.status })),
  ];

  async function submit(event) {
    event.preventDefault();
    setError("");
    const nextErrors = {
      category_id: !form.category_id ? "Category is required." : "",
      material_code: !String(form.material_code || "").trim() ? "SKU Code is required." : "",
      name_en: !String(form.name_en || "").trim() ? "Raw Material Name (EN) is required." : "",
      uom: !String(form.uom || "").trim() ? "Default UOM is required." : "",
      status: !String(form.status || "").trim() ? "Status is required." : "",
    };
    const activeErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message));
    setFieldErrors(activeErrors);
    const firstError = Object.keys(activeErrors)[0];
    if (firstError) {
      setError("Please complete required fields.");
      focusFirstInvalid(fieldRefs, firstError);
      return;
    }
    setSaving(true);
    try {
      const selectedCategory = categories.find((category) => category.id === form.category_id);
      await onSave({ ...form, name: form.name_en, category: selectedCategory?.name || "" });
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!onArchive || !initialValue?.id) return;
    setSaving(true);
    try {
      await onArchive(initialValue);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Raw Material" : "Create Raw Material"}
      description="Raw Material Master defines valid materials for receiving, recipes and production usage."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          {initialValue?.id && initialValue.status !== "archived" ? <button className="btn-danger" type="button" disabled={saving} onClick={archive}>Archive</button> : <span />}
          <div className="flex gap-2">
            {error ? <div className="self-center text-sm font-semibold text-rose-600">{error}</div> : null}
            <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="submit" form="factory-raw-material-form" disabled={saving}>{saving ? "Saving..." : "Save Raw Material"}</button>
          </div>
        </>
      )}
    >
      <form id="factory-raw-material-form" className="space-y-4" onSubmit={submit}>
        <Field label="Category *" error={fieldErrors.category_id}>
          <SearchableSelect
            value={form.category_id || ""}
            options={categoryOptions}
            placeholder="Select Category"
            error={Boolean(fieldErrors.category_id)}
            buttonRef={(node) => { fieldRefs.current.category_id = node; }}
            onChange={(categoryId) => {
              setFieldErrors((current) => ({ ...current, category_id: "" }));
              setForm((current) => ({ ...current, category_id: categoryId }));
            }}
          />
        </Field>
        <Field label="SKU Code *" error={fieldErrors.material_code}>
          <input ref={(node) => { fieldRefs.current.material_code = node; }} className={inputClass(fieldErrors.material_code)} value={form.material_code || ""} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, material_code: "" }));
            setForm((current) => ({ ...current, material_code: event.target.value }));
          }} />
        </Field>
        <Field label="Raw Material Name (EN) *" error={fieldErrors.name_en}>
          <input ref={(node) => { fieldRefs.current.name_en = node; }} className={inputClass(fieldErrors.name_en)} value={form.name_en || ""} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, name_en: "" }));
            setForm((current) => ({ ...current, name_en: event.target.value, name: event.target.value }));
          }} />
        </Field>
        <Field label="Default UOM *" error={fieldErrors.uom}>
          <select ref={(node) => { fieldRefs.current.uom = node; }} className={inputClass(fieldErrors.uom)} value={form.uom} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, uom: "" }));
            setForm((current) => ({ ...current, uom: event.target.value }));
          }}>
            {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
          </select>
        </Field>
        <Field label="Storage Location">
          <SearchableSelect
            value={form.storage_location_id || ""}
            options={storageLocationOptions}
            placeholder="Select Storage Location"
            searchPlaceholder="Search locations"
            emptyText="No storage locations"
            onChange={(locationId) => setForm((current) => ({ ...current, storage_location_id: locationId }))}
          />
        </Field>
        <Field label="Status *" error={fieldErrors.status}>
          <select ref={(node) => { fieldRefs.current.status = node; }} className={inputClass(fieldErrors.status)} value={form.status} onChange={(event) => {
            setFieldErrors((current) => ({ ...current, status: "" }));
            setForm((current) => ({ ...current, status: event.target.value }));
          }}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function RawMaterialCategoryModal({ categories, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    name: "",
    description: "",
    status: "active",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  function edit(category) {
    setForm({ id: category.id, name: category.name || "", description: category.description || "", status: category.status || "active" });
    setError("");
  }

  async function archive(category) {
    setSaving(true);
    try {
      await onArchive(category);
      if (form.id === category.id) setForm({ name: "", description: "", status: "active" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Raw Material Categories"
      description="Group raw material master records for warehouse visibility and setup."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <form id="factory-raw-material-category-form" className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <Field label="Category Name">
            <input className={inputClass()} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className={inputClass()} rows={3} value={form.description || ""} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Category" : "Create Category"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm({ name: "", description: "", status: "active" })}>New</button> : null}
          </div>
        </form>
        <div className="max-h-[460px] overflow-y-auto rounded-xl border border-border bg-white">
          {categories.length ? categories.map((category) => (
            <div key={category.id} className="flex items-start justify-between gap-3 border-b border-border p-4 last:border-0">
              <div>
                <div className="font-bold text-text-primary">{category.name}</div>
                <div className="mt-1 text-sm text-text-secondary">{category.description || "No description"}</div>
                <div className="mt-2"><Badge tone={category.status === "active" ? "success" : "neutral"}>{category.status}</Badge></div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(category)}>Edit</button>
                {category.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(category)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No categories" description="Create a category before saving raw material master records." />}
        </div>
      </div>
    </Modal>
  );
}

function StorageLocationModal({ locations, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    location_name: "",
    location_code: "",
    location_type: storageLocationTypes[0],
    status: "active",
    remarks: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.location_name || "").trim()) {
      setError("Location name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ location_name: "", location_code: "", location_type: storageLocationTypes[0], status: "active", remarks: "" });
    } finally {
      setSaving(false);
    }
  }

  function edit(location) {
    setForm({
      id: location.id,
      location_name: location.location_name || "",
      location_code: location.location_code || "",
      location_type: location.location_type || storageLocationTypes[0],
      status: location.status || "active",
      remarks: location.remarks || "",
    });
    setError("");
  }

  async function archive(location) {
    setSaving(true);
    try {
      await onArchive(location);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Storage Locations"
      description="Manage Factory storage locations used by raw material and finished goods master records."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <form id="factory-storage-location-form" className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Location Name *">
              <input className={inputClass()} value={form.location_name || ""} onChange={(event) => setForm((current) => ({ ...current, location_name: event.target.value }))} />
            </Field>
            <Field label="Location Code">
              <input className={inputClass()} value={form.location_code || ""} onChange={(event) => setForm((current) => ({ ...current, location_code: event.target.value }))} />
            </Field>
            <Field label="Location Type">
              <select className={inputClass()} value={form.location_type || ""} onChange={(event) => setForm((current) => ({ ...current, location_type: event.target.value }))}>
                {storageLocationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Location" : "Create Location"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm({ location_name: "", location_code: "", location_type: storageLocationTypes[0], status: "active", remarks: "" })}>New</button> : null}
          </div>
        </form>

        <div className="space-y-2">
          {locations.length ? locations.map((location) => (
            <div key={location.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
              <div>
                <div className="font-semibold text-text-primary">{location.location_name}</div>
                <div className="text-xs text-text-secondary">{[location.location_code, location.location_type, location.status].filter(Boolean).join(" · ")}</div>
                {location.remarks ? <div className="mt-1 text-xs text-text-secondary">{location.remarks}</div> : null}
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(location)}>Edit</button>
                {location.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(location)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No storage locations" description="Create storage locations before assigning warehouse locations to Factory master records." />}
        </div>
      </div>
    </Modal>
  );
}

function CompletedJobOrderResultModal({ job, production, recipes = [], onClose }) {
  const matchingRecipe = production
    ? recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id && recipe.product_family_id === production.product_family_id)
      || recipes.find((recipe) => recipe.status === "active" && recipe.finished_good_id && recipe.finished_good_id === production.finished_good_id)
      || recipes.find((recipe) => String(recipe.product_name || "").toLowerCase() === String(production.product_family_name || production.product_name || job?.product_name || "").toLowerCase())
    : null;
  const outputQty = Number(production?.actual_output_qty || production?.good_output_qty || production?.actual_produced_qty || production?.produced_quantity || 0);
  const recipeBaseQty = Number(matchingRecipe?.yield_quantity || 0);
  const scaleFactor = production && recipeBaseQty ? outputQty / recipeBaseQty : null;
  const materialRows = production?.material_usage || [];
  const summaryItems = [
    ["JO No", job?.job_order_no || "—"],
    ["Finished Good", jobFinishedGoodName(job || production || {})],
    ["Packaging SKU", jobPackagingSkuLabel(job || production || {})],
    ["Target Production Qty", quantity(job?.target_production_qty || job?.target_quantity, job?.uom)],
    ["Estimated Pack Qty", quantity(job?.target_pack_qty || 0, "packs")],
    ["Planned Date", job?.planned_date || "—"],
    ["Due Date", job?.due_date || "—"],
    ["Priority", job?.priority || "—"],
  ];
  const resultItems = production ? [
    ["Batch No", production.batch_no || "—"],
    ["Production Date", production.production_date || "—"],
    ["Operator", production.operator_name || "—"],
    ["Start Time", factoryTimeLabel(production.start_time)],
    ["End Time", factoryTimeLabel(production.end_time)],
    ["Actual Pack Qty", quantity(production.actual_pack_qty || production.good_output_qty, "packs")],
    ["Actual Output Qty", quantity(outputQty, production.uom)],
    ["Production Notes", production.notes || "—"],
  ] : [];

  return (
    <Modal
      title="Completed Job Order Result"
      description="Read-only production completion record for this Job Order."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <Card title="Job Order Summary" description="Original production planning details.">
          <div className="grid gap-3 p-4 md:grid-cols-4">
            {summaryItems.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-bold text-text-primary">{value || "—"}</div>
              </div>
            ))}
          </div>
        </Card>

        {!production ? (
          <Card title="Production Result" description="No completed production record is linked to this Job Order.">
            <EmptyState title="No completed production record found for this job order." description="Legacy completed Job Orders may not have a saved production completion record." />
          </Card>
        ) : (
          <>
            <Card title="Production Result" description="Saved production completion output.">
              <div className="grid gap-3 p-4 md:grid-cols-4">
                {resultItems.map(([label, value]) => (
                  <div key={label} className={`rounded-xl border border-border bg-white px-3 py-2 ${label === "Production Notes" ? "md:col-span-4" : ""}`}>
                    <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{value || "—"}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Production Standard Used" description="Standard reference available for this completed production.">
              <div className="grid gap-3 p-4 md:grid-cols-4">
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 md:col-span-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Production Standard</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">
                    {matchingRecipe ? `${matchingRecipe.recipe_name || matchingRecipe.product_name || "Production Standard"} ${matchingRecipe.version || ""}`.trim() : "Not recorded"}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Base Recipe Qty</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{matchingRecipe ? quantity(matchingRecipe.yield_quantity, matchingRecipe.uom) : "—"}</div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold text-text-muted">Scale Factor</div>
                  <div className="mt-1 text-sm font-bold text-text-primary">{scaleFactor == null ? "—" : `${scaleFactor.toLocaleString("en-MY", { maximumFractionDigits: 2 })}x`}</div>
                </div>
              </div>
            </Card>

            <Card title="Actual Material Usage" description="Saved standard-vs-actual material usage from production completion.">
              {materialRows.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                    <thead>
                      <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                        <th className="px-4 py-2.5">Raw Material</th>
                        <th className="px-4 py-2.5">Standard Qty</th>
                        <th className="px-4 py-2.5">Actual Used</th>
                        <th className="px-4 py-2.5">Difference</th>
                        <th className="px-4 py-2.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialRows.map((row) => {
                        const diff = Number(row.actual_usage || 0) - Number(row.standard_usage || 0);
                        return (
                          <tr key={row.id || row.raw_material_id} className="border-b border-border last:border-0">
                            <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.raw_material_name || "Raw Material"}</div></td>
                            <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.standard_usage, row.uom)}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-text-primary">{quantity(row.actual_usage, row.uom)}</td>
                            <td className={`px-4 py-3 text-sm font-bold ${Math.abs(diff) > 0.000001 ? "text-amber-700" : "text-emerald-700"}`}>{diff > 0 ? "+" : ""}{quantity(diff, row.uom)}</td>
                            <td className="px-4 py-3 text-sm text-text-secondary">{row.variance_reason || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No material usage rows" description="This completed production record has no saved material usage rows." />
              )}
            </Card>
          </>
        )}
      </div>
    </Modal>
  );
}

function FinishedGoodDispatchModal({ initialValue, finishedGoods = [], customers = [], onClose, onSave, embedded = false }) {
  const makeItem = () => ({ row_id: Math.random().toString(36).slice(2), finished_good_id: "", quantity: "", batch_no: "", remarks: "" });
  const [form, setForm] = useState(() => ({
    dispatch_date: todayInput(),
    customer_id: "",
    customer_name: "",
    reference_no: "",
    status: "draft",
    remarks: "",
    ...initialValue,
    items: initialValue?.items?.length ? initialValue.items.map((item) => ({ ...item, row_id: item.id || Math.random().toString(36).slice(2) })) : [makeItem()],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isReadOnly = Boolean(initialValue?.id) && initialValue.status !== "draft";
  const activeSkus = finishedGoods.filter((sku) => sku.status === "active" || form.items.some((item) => item.finished_good_id === sku.id));
  const activeCustomers = customers.filter((customer) => customer.status === "active" || customer.id === form.customer_id);
  const customerOptions = activeCustomers.map((customer) => ({
    value: customer.id,
    label: customer.customer_name,
    helper: [customer.customer_code, customer.customer_type, customer.phone].filter(Boolean).join(" · ") || customer.status,
  }));
  const skuOptions = activeSkus.map((sku) => ({
    value: sku.id,
    label: [sku.product_code || "No SKU", sku.product_family_name || sku.product_name_en || sku.product_name, sku.variant_name || packSizeText(sku)].filter(Boolean).join(" · "),
    helper: `${skuBalanceLabel(sku)} available · ${packSizeText(sku) || "No pack size"}`,
  }));

  function updateItem(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.row_id === rowId ? { ...item, ...patch } : item),
    }));
  }

  function addItem() {
    setForm((current) => ({ ...current, items: [...current.items, makeItem()] }));
  }

  function removeItem(rowId) {
    setForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((item) => item.row_id !== rowId) : current.items }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isReadOnly) return;
    if (!form.customer_id) {
      setError("Select a Customer.");
      return;
    }
    if (!form.dispatch_date) {
      setError("Dispatch Date is required.");
      return;
    }
    const rows = form.items.filter((item) => item.finished_good_id || item.quantity || item.batch_no || item.remarks);
    if (!rows.length) {
      setError("Add at least one dispatch item.");
      return;
    }
    const invalid = rows.find((item) => !item.finished_good_id || Number(item.quantity || 0) <= 0);
    if (invalid) {
      setError("Every dispatch item needs a Packaging SKU and quantity greater than 0.");
      return;
    }
    const overBalance = rows.find((item) => {
      const sku = activeSkus.find((row) => row.id === item.finished_good_id);
      return sku && Number(item.quantity || 0) > Number(sku.current_balance || 0);
    });
    if (overBalance) {
      setError("Dispatch quantity cannot exceed available balance.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...form, items: rows });
      if (embedded) {
        setForm({
          dispatch_date: todayInput(),
          customer_id: "",
          customer_name: "",
          reference_no: "",
          status: "draft",
          remarks: "",
          items: [makeItem()],
        });
      }
    } finally {
      setSaving(false);
    }
  }

  const formContent = (
    <form id={embedded ? undefined : "factory-finished-good-dispatch-form"} className="space-y-4" onSubmit={submit}>
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
          <div className="text-[10.5px] font-semibold text-text-muted">Dispatch No.</div>
          <div className="mt-1 text-sm font-bold text-text-primary">{form.dispatch_no || "DYYMMDD-01"}</div>
          {!form.dispatch_no ? <div className="text-[11px] font-semibold text-text-muted">Generated on save</div> : null}
        </div>
        <Field label="Dispatch Date *">
          <input className={inputClass()} type="date" value={form.dispatch_date || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, dispatch_date: event.target.value }))} />
        </Field>
        <Field label="Customer *">
          {isReadOnly && !form.customer_id ? (
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-semibold text-text-primary">{form.customer_name || "—"}</div>
          ) : (
            <SearchableSelect
              value={form.customer_id || ""}
              options={customerOptions}
              placeholder={customerOptions.length ? "Select Customer" : "Create a Customer first"}
              searchPlaceholder="Search customers"
              emptyText="No customers"
              disabled={isReadOnly}
              onChange={(value) => {
                const customer = activeCustomers.find((row) => row.id === value);
                setForm((current) => ({ ...current, customer_id: value, customer_name: customer?.customer_name || "" }));
              }}
            />
          )}
        </Field>
        <Field label="Reference / DO No.">
          <input className={inputClass()} value={form.reference_no || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, reference_no: event.target.value }))} />
        </Field>
      </div>

      <div className="rounded-2xl border border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <div className="font-bold text-text-primary">Dispatch Lines</div>
          <div className="text-sm text-text-secondary">Quantities are Packaging SKU counts. Completion deducts finished goods balance.</div>
        </div>
        <div className="space-y-3 p-4">
          <div className="space-y-3 md:hidden">
            {form.items.map((item) => {
              const sku = activeSkus.find((row) => row.id === item.finished_good_id);
              return (
                <div key={item.row_id} className="space-y-3 rounded-2xl border border-border bg-white p-3">
                  <Field label="Packaging SKU">
                    <SearchableSelect
                      value={item.finished_good_id || ""}
                      options={skuOptions}
                      placeholder="Select Packaging SKU"
                      searchPlaceholder="Search SKU"
                      emptyText="No packaging SKUs"
                      disabled={isReadOnly}
                      onChange={(value) => updateItem(item.row_id, { finished_good_id: value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <div className="text-[10.5px] font-semibold text-text-muted">Available</div>
                      <div className="mt-1 text-sm font-bold text-text-primary">{sku ? skuBalanceLabel(sku) : "—"}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                      <div className="text-[10.5px] font-semibold text-text-muted">Pack Size</div>
                      <div className="mt-1 text-sm font-bold text-text-primary">{sku ? packSizeText(sku) || "—" : "—"}</div>
                    </div>
                  </div>
                  <Field label="Qty">
                    <div className="flex items-center gap-2">
                      <input className={inputClass()} type="number" min="0" step="0.01" value={item.quantity || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { quantity: event.target.value })} />
                      <span className="shrink-0 text-xs font-bold text-text-muted">{pluralizePackagingType(packagingTypeLabel(sku), item.quantity || 0)}</span>
                    </div>
                  </Field>
                  <Field label="Batch">
                    <input className={inputClass()} value={item.batch_no || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { batch_no: event.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label="Remarks">
                    <input className={inputClass()} value={item.remarks || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { remarks: event.target.value })} />
                  </Field>
                  {!isReadOnly ? <button className="btn-secondary w-full justify-center px-3 py-1.5 text-xs" type="button" onClick={() => removeItem(item.row_id)}>Remove Line</button> : null}
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold text-text-muted">
                  <th className="px-3 py-2.5">Packaging SKU</th>
                  <th className="px-3 py-2.5">Available</th>
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">Pack Size</th>
                  <th className="px-3 py-2.5">Batch</th>
                  <th className="px-3 py-2.5">Remarks</th>
                  <th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item) => {
                  const sku = activeSkus.find((row) => row.id === item.finished_good_id);
                  return (
                    <tr key={item.row_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-3">
                        <SearchableSelect
                          value={item.finished_good_id || ""}
                          options={skuOptions}
                          placeholder="Select Packaging SKU"
                          searchPlaceholder="Search SKU"
                          emptyText="No packaging SKUs"
                          disabled={isReadOnly}
                          onChange={(value) => updateItem(item.row_id, { finished_good_id: value })}
                        />
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-text-secondary">{sku ? skuBalanceLabel(sku) : "—"}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <input className={inputClass()} type="number" min="0" step="0.01" value={item.quantity || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { quantity: event.target.value })} />
                          <span className="text-xs font-bold text-text-muted">{pluralizePackagingType(packagingTypeLabel(sku), item.quantity || 0)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-text-secondary">{sku ? packSizeText(sku) || "—" : "—"}</td>
                      <td className="px-3 py-3"><input className={inputClass()} value={item.batch_no || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { batch_no: event.target.value })} placeholder="Optional" /></td>
                      <td className="px-3 py-3"><input className={inputClass()} value={item.remarks || ""} disabled={isReadOnly} onChange={(event) => updateItem(item.row_id, { remarks: event.target.value })} /></td>
                      <td className="px-3 py-3 text-right">
                        {!isReadOnly ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => removeItem(item.row_id)}>Remove</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!isReadOnly ? <button className="btn-secondary" type="button" onClick={addItem}><PackageCheck size={15} /> Add Line</button> : null}
        </div>
      </div>

      <Field label="Remarks">
        <textarea className={inputClass()} rows={3} value={form.remarks || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
      </Field>
      {embedded && !isReadOnly ? (
        <div className="flex justify-end">
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Dispatch Draft"}</button>
        </div>
      ) : null}
    </form>
  );

  if (embedded) {
    return formContent;
  }

  return (
    <Modal
      title={isReadOnly ? "View Finished Goods Dispatch" : initialValue?.id ? "Edit Finished Goods Dispatch" : "Create Finished Goods Dispatch"}
      description="Record outbound Packaging SKU dispatch from Factory warehouse."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>{isReadOnly ? "Close" : "Cancel"}</button>
          {!isReadOnly ? <button className="btn-primary" type="submit" form="factory-finished-good-dispatch-form" disabled={saving}>{saving ? "Saving..." : "Save Draft"}</button> : null}
        </>
      )}
    >
      {formContent}
    </Modal>
  );
}

function JobOrderModal({ initialValue, finishedGoods, rawMaterials = [], recipes = [], onClose, onSave }) {
  const initialSku = finishedGoods.find((product) => product.id === initialValue?.finished_good_id);
  const initialParentKey = initialSku ? finishedGoodParentKey(initialSku) : "";
  const [form, setForm] = useState(() => ({
    product_family_key: initialParentKey,
    finished_good_id: "",
    product_name: "",
    target_pack_qty: "",
    target_production_qty: "",
    target_quantity: "",
    produced_quantity: 0,
    uom: "",
    planned_date: todayInput(),
    due_date: "",
    priority: "Normal",
    status: "draft",
    assigned_team: "",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedStatus = form.status === "planned" ? "released" : form.status;
  const isDraft = normalizedStatus === "draft";
  const isReadOnly = Boolean(initialValue?.id) && !isDraft;
  const activeFinishedGoods = finishedGoods.filter((product) => product.status === "active" || product.id === form.finished_good_id);
  const finishedGoodParents = Array.from(activeFinishedGoods.reduce((map, product) => {
    const key = finishedGoodParentKey(product);
    if (!key || map.has(key)) return map;
    map.set(key, {
      key,
      product_family_id: product.product_family_id || "",
      legacy_sku_id: product.product_family_id ? "" : product.id,
      name: product.product_family_name || product.product_name_en || product.product_name || "Finished Good",
      category: product.category_name || product.category || "",
      status: product.status || "active",
    });
    return map;
  }, new Map()).values());
  const finishedGoodOptions = finishedGoodParents.map((product) => ({
    value: product.key,
    label: product.name,
    helper: [product.category || "No category", product.product_family_id ? "Finished Good" : "Legacy SKU"].join(" · "),
  }));
  const selectedParent = finishedGoodParents.find((product) => product.key === form.product_family_key);
  const parentSkus = selectedParent ? activeFinishedGoods.filter((product) => finishedGoodParentKey(product) === selectedParent.key) : [];
  const packagingSkuOptions = parentSkus.map((product) => ({
    value: product.id,
    label: [product.product_code || "No SKU", product.product_family_name || product.product_name_en || product.product_name, product.variant_name || packSizeText(product)].filter(Boolean).join(" · "),
    helper: `Pack size ${packSizeText(product) || "not set"} · Balance ${skuBalanceLabel(product)}`,
  }));
  const selectedProduct = parentSkus.find((product) => product.id === form.finished_good_id) || activeFinishedGoods.find((product) => product.id === form.finished_good_id);
  const parentRecipe = selectedParent?.product_family_id ? recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id === selectedParent.product_family_id) : null;
  const legacyRecipe = selectedProduct ? activeRecipeForSku(recipes, selectedProduct, selectedParent?.name || form.product_name) : null;
  const matchingRecipe = parentRecipe || legacyRecipe;
  const targetProductionQty = Number(form.target_production_qty || form.target_quantity || 0);
  const productionUom = form.uom || matchingRecipe?.uom || "";
  const productionPlan = selectedProduct ? packagingPackEstimate(targetProductionQty, productionUom, selectedProduct, matchingRecipe?.uom) : null;
  const estimatedPackQty = productionPlan && !productionPlan.error ? productionPlan.target_pack_qty : null;
  const normalizedPreviewProductionQty = productionPlan && !productionPlan.error ? productionPlan.target_production_qty : targetProductionQty;
  const normalizedPreviewProductionUom = productionPlan && !productionPlan.error ? productionPlan.production_uom : productionUom;
  const packSizeMissing = selectedProduct && productionPlan?.error === "Packaging SKU needs Pack Size before creating Job Order.";
  const recipeUomMismatch = selectedProduct && (productionPlan?.error === "Production UOM must match the active recipe UOM." || productionPlan?.error === "Production UOM cannot convert to the selected Packaging SKU Pack Size.");
  const bomRows = matchingRecipe?.items?.length ? matchingRecipe.items.map((item) => {
    const material = rawMaterials.find((row) => row.id === item.raw_material_id);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    const requiredQty = (Number(item.quantity_used || 0) * Number(normalizedPreviewProductionQty || 0)) / recipeYield;
    const balance = Number(material?.current_balance || 0);
    return {
      ...item,
      material_name: rawMaterialLabel(material) || "Raw Material",
      material_code: material?.material_code || "",
      required_qty: requiredQty,
      balance,
      enough: balance >= requiredQty,
      uom: item.uom || material?.uom || "",
    };
  }) : [];

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isReadOnly) {
      return;
    }
    if (!form.product_family_key) {
      setError("Select a Finished Good.");
      return;
    }
    if (Number(form.target_production_qty || form.target_quantity || 0) <= 0) {
      setError("Target Production Qty must be greater than 0.");
      return;
    }
    if (!String(form.uom || "").trim()) {
      setError("Production UOM is required.");
      return;
    }
    if (!form.finished_good_id) {
      setError("Select an active Packaging SKU.");
      return;
    }
    if (productionPlan?.error) {
      setError(productionPlan.error);
      return;
    }
    if (!productionPlan?.target_pack_qty || !productionPlan.target_production_qty || !productionPlan.production_uom) {
      setError("Packaging SKU Pack Size UOM cannot be used for production quantity.");
      return;
    }
    setSaving(true);
    try {
      const selectedProduct = activeFinishedGoods.find((product) => product.id === form.finished_good_id);
      await onSave({
        ...form,
        product_name: selectedProduct?.product_name || form.product_name,
        target_pack_qty: productionPlan.target_pack_qty,
        target_production_qty: productionPlan.target_production_qty,
        target_quantity: productionPlan.target_production_qty,
        uom: productionPlan.production_uom,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isReadOnly ? "View Job Order" : initialValue?.id ? "Edit Job Order" : "Create Job Order"}
      description="Plan factory production demand before production execution."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>{isReadOnly ? "Close" : "Cancel"}</button>
          {!isReadOnly ? <button className="btn-primary" type="submit" form="factory-job-order-form" disabled={saving}>{saving ? "Saving..." : "Save Draft"}</button> : null}
        </>
      )}
    >
      <form id="factory-job-order-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {isReadOnly ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">This Job Order is {jobStatusLabel(normalizedStatus)} and is read-only. Use the production lifecycle actions for the next step.</div> : null}
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Finished Good *" error={!form.product_family_key && error.includes("Finished Good") ? "Finished Good is required." : ""}>
            <SearchableSelect
              value={form.product_family_key || ""}
              options={finishedGoodOptions}
              placeholder={finishedGoodOptions.length ? "Select Finished Good" : "Create a Finished Good first"}
              searchPlaceholder="Search finished goods"
              emptyText="No matching Finished Goods"
              error={!form.product_family_key && error.includes("Finished Good")}
              disabled={isReadOnly}
              onChange={(parentKey) => {
                const parent = finishedGoodParents.find((item) => item.key === parentKey);
                const recipe = parent?.product_family_id ? recipes.find((item) => item.status === "active" && item.product_family_id === parent.product_family_id) : null;
                setForm((current) => ({
                  ...current,
                  product_family_key: parentKey,
                  finished_good_id: "",
                  product_name: parent?.name || "",
                  uom: recipe?.uom || current.uom,
                }));
              }}
            />
          </Field>
          <Field label="Target Production Qty *">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.target_production_qty || form.target_quantity || ""} disabled={isReadOnly} onChange={(event) => {
              const nextQty = event.target.value;
              setForm((current) => ({ ...current, target_production_qty: nextQty, target_quantity: nextQty }));
            }} />
          </Field>
          <Field label="Production UOM *">
            <input className={inputClass()} value={form.uom || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))} placeholder={matchingRecipe?.uom || "kg / L"} />
          </Field>
          <Field label="Packaging SKU *" error={!form.finished_good_id && error.includes("Packaging SKU") ? "Packaging SKU is required." : ""}>
            <SearchableSelect
              value={form.finished_good_id || ""}
              options={packagingSkuOptions}
              placeholder={selectedParent ? "Select Packaging SKU" : "Select Finished Good first"}
              searchPlaceholder="Search packaging SKUs"
              emptyText="No matching packaging SKUs"
              error={!form.finished_good_id && error.includes("Packaging SKU")}
              disabled={isReadOnly || !selectedParent}
              onChange={(finishedGoodId) => {
                const product = parentSkus.find((item) => item.id === finishedGoodId);
                setForm((current) => ({
                  ...current,
                  finished_good_id: finishedGoodId,
                  product_name: product?.product_name || selectedParent?.name || "",
                }));
              }}
            />
          </Field>
          <Field label="Estimated Pack Qty">
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">
              {selectedProduct && targetProductionQty > 0 && estimatedPackQty != null ? quantity(estimatedPackQty, "packs") : "—"}
            </div>
          </Field>
          <Field label="Planned Date">
            <input className={inputClass()} type="date" value={form.planned_date || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, planned_date: event.target.value }))} />
          </Field>
          <Field label="Due Date">
            <input className={inputClass()} type="date" value={form.due_date || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} />
          </Field>
          <Field label="Priority">
            <select className={inputClass()} value={form.priority} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}>
              {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="Assigned Team">
            <input className={inputClass()} value={form.assigned_team || ""} disabled={isReadOnly} onChange={(event) => setForm((current) => ({ ...current, assigned_team: event.target.value }))} />
          </Field>
        </div>
        {selectedProduct ? (
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard icon={PackageCheck} label="Finished Good" value={selectedProduct.product_family_name || selectedProduct.product_name_en || selectedProduct.product_name} helper={selectedProduct.product_code || "Packaging SKU"} />
            <MetricCard icon={Package} label="Pack Size" value={packSizeText(selectedProduct) || "Missing"} helper={selectedProduct.variant_name || "Packaging variant"} tone={packSizeMissing ? "warning" : "neutral"} />
            <MetricCard icon={Factory} label="Estimated Pack Qty" value={estimatedPackQty == null ? "—" : quantity(estimatedPackQty, "packs")} helper={quantity(normalizedPreviewProductionQty, normalizedPreviewProductionUom)} tone={recipeUomMismatch ? "warning" : "neutral"} />
            <MetricCard icon={BookOpen} label="Active Recipe" value={matchingRecipe ? matchingRecipe.version || "Active" : "—"} helper={matchingRecipe ? productionTimeLabel(matchingRecipe.estimated_production_time_minutes) : "No active recipe"} tone={matchingRecipe ? "success" : "warning"} />
          </div>
        ) : null}
        <Card title="BOM / Recipe Requirement Preview" description="This preview uses the current active recipe. Actual production usage remains captured during completion.">
          {selectedParent && matchingRecipe ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                {matchingRecipe.recipe_name || matchingRecipe.recipe_code} · {matchingRecipe.version || "v1"} · Production Quantity {quantity(matchingRecipe.yield_quantity, matchingRecipe.uom)}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      <th className="px-4 py-2.5">Material</th>
                      <th className="px-4 py-2.5">Required Qty</th>
                      <th className="px-4 py-2.5">Available Balance</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.material_name}</div><div className="text-xs text-text-secondary">{row.material_code || "Raw material"}</div></td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.required_qty, row.uom)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.balance, row.uom)}</td>
                        <td className="px-4 py-3"><Badge tone={row.enough ? "success" : "danger"}>{row.enough ? "Enough" : "Shortage"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : selectedParent ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              No active recipe found. You can still create the job order, but material usage must be entered manually during production.
            </div>
          ) : (
            <EmptyState title="Select a Finished Good" description="Choose a Finished Good and production quantity to preview active recipe requirements." />
          )}
        </Card>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function FactorySupplierModal({ suppliers, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(() => ({
    supplier_name: "",
    supplier_code: "",
    contact_person: "",
    phone: "",
    email: "",
    status: "active",
    remarks: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.supplier_name || "").trim()) {
      setError("Supplier name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ supplier_name: "", supplier_code: "", contact_person: "", phone: "", email: "", status: "active", remarks: "" });
    } finally {
      setSaving(false);
    }
  }

  function edit(supplier) {
    setForm({
      id: supplier.id,
      supplier_name: supplier.supplier_name || "",
      supplier_code: supplier.supplier_code || "",
      contact_person: supplier.contact_person || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      status: supplier.status || "active",
      remarks: supplier.remarks || "",
    });
    setError("");
  }

  async function archive(supplier) {
    setSaving(true);
    try {
      await onArchive(supplier);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Factory Suppliers"
      description="Manage Factory suppliers used by raw material receiving documents."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <form className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Supplier Name *">
              <input className={inputClass(error && !form.supplier_name)} value={form.supplier_name || ""} onChange={(event) => setForm((current) => ({ ...current, supplier_name: event.target.value }))} />
            </Field>
            <Field label="Supplier Code">
              <input className={inputClass()} value={form.supplier_code || ""} onChange={(event) => setForm((current) => ({ ...current, supplier_code: event.target.value }))} />
            </Field>
            <Field label="Contact Person">
              <input className={inputClass()} value={form.contact_person || ""} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className={inputClass()} value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
            <Field label="Email">
              <input className={inputClass()} type="email" value={form.email || ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </Field>
            <Field label="Status">
              <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Supplier" : "Create Supplier"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm({ supplier_name: "", supplier_code: "", contact_person: "", phone: "", email: "", status: "active", remarks: "" })}>New</button> : null}
          </div>
        </form>

        <div className="space-y-2">
          {suppliers.length ? suppliers.map((supplier) => (
            <div key={supplier.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
              <div>
                <div className="font-bold text-text-primary">{supplier.supplier_name}</div>
                <div className="text-sm text-text-secondary">{[supplier.supplier_code, supplier.contact_person, supplier.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
                {supplier.remarks ? <div className="mt-1 text-xs text-text-muted">{supplier.remarks}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={supplier.status === "active" ? "success" : "neutral"}>{supplier.status}</Badge>
                <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(supplier)}>Edit</button>
                {supplier.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(supplier)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No suppliers" description="Create a Factory supplier before recording supplier receiving documents." />}
        </div>
      </div>
    </Modal>
  );
}

function FactoryCustomerModal({ customers, onClose, onSave, onArchive }) {
  const emptyForm = { customer_name: "", customer_code: "", customer_type: "Outlet", contact_person: "", phone: "", email: "", address: "", status: "active", remarks: "" };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.customer_name || "").trim()) {
      setError("Customer name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm(emptyForm);
    } finally {
      setSaving(false);
    }
  }

  function edit(customer) {
    setForm({
      id: customer.id,
      customer_name: customer.customer_name || "",
      customer_code: customer.customer_code || "",
      customer_type: customer.customer_type || "Other",
      contact_person: customer.contact_person || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      status: customer.status || "active",
      remarks: customer.remarks || "",
    });
    setError("");
  }

  async function archive(customer) {
    setSaving(true);
    try {
      await onArchive(customer);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Factory Customers"
      description="Manage customers and destinations used by finished goods dispatch documents."
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}
    >
      <div className="space-y-4">
        <form className="space-y-4 rounded-xl border border-border bg-slate-50 p-4" onSubmit={submit}>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Customer Name *">
              <input className={inputClass(error && !form.customer_name)} value={form.customer_name || ""} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
            </Field>
            <Field label="Customer Code">
              <input className={inputClass()} value={form.customer_code || ""} onChange={(event) => setForm((current) => ({ ...current, customer_code: event.target.value }))} />
            </Field>
            <Field label="Customer Type">
              <select className={inputClass()} value={form.customer_type || "Other"} onChange={(event) => setForm((current) => ({ ...current, customer_type: event.target.value }))}>
                {factoryCustomerTypes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="Contact Person">
              <input className={inputClass()} value={form.contact_person || ""} onChange={(event) => setForm((current) => ({ ...current, contact_person: event.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className={inputClass()} value={form.phone || ""} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </Field>
            <Field label="Email">
              <input className={inputClass()} type="email" value={form.email || ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </Field>
            <Field label="Status">
              <select className={inputClass()} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </div>
          <Field label="Address">
            <textarea className={inputClass()} rows={2} value={form.address || ""} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
          </Field>
          <Field label="Remarks">
            <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Update Customer" : "Create Customer"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={() => setForm(emptyForm)}>New</button> : null}
          </div>
        </form>

        <div className="space-y-2">
          {customers.length ? customers.map((customer) => (
            <div key={customer.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
              <div>
                <div className="font-bold text-text-primary">{customer.customer_name}</div>
                <div className="text-sm text-text-secondary">{[customer.customer_code, customer.customer_type, customer.contact_person, customer.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
                {customer.address ? <div className="mt-1 text-xs text-text-muted">{customer.address}</div> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={customer.status === "active" ? "success" : "neutral"}>{customer.status}</Badge>
                <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => edit(customer)}>Edit</button>
                {customer.status !== "archived" ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => archive(customer)}>Archive</button> : null}
              </div>
            </div>
          )) : <EmptyState title="No customers" description="Create a Factory customer before recording finished goods dispatches." />}
        </div>
      </div>
    </Modal>
  );
}

function RawReceivingEntryPanel({ rawMaterials, suppliers = [], storageLocations = [], onSave }) {
  const fieldRefs = useRef({});
  const qtyRefs = useRef({});
  const makeRow = () => ({ row_id: Math.random().toString(36).slice(2), raw_material_id: "", batch_no: "", received_qty: "", uom: "", storage_location_id: "", storage_location: "", expiry_date: "" });
  const [form, setForm] = useState(() => ({
    supplier_id: "",
    reference_no: "",
    received_date: todayInput(),
    remarks: "",
    items: [makeRow()],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [openMaterialRowId, setOpenMaterialRowId] = useState(null);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "active" || supplier.id === form.supplier_id);
  const activeRawMaterials = rawMaterials.filter((material) => material.status === "active");
  const supplierOptions = activeSuppliers.map((supplier) => ({ value: supplier.id, label: supplier.supplier_name, helper: [supplier.supplier_code, supplier.phone].filter(Boolean).join(" · ") || supplier.status }));
  const activeStorageLocations = storageLocations.filter((location) => location.status === "active");
  const storageLocationOptions = [
    { value: "", label: "Select Storage Location", helper: "Optional" },
    ...activeStorageLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") || location.status })),
  ];

  function updateItem(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.row_id === rowId ? { ...item, ...patch } : item),
    }));
  }

  function addRow() {
    setForm((current) => ({ ...current, items: [...current.items, makeRow()] }));
  }

  function removeRow(rowId) {
    setForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((item) => item.row_id !== rowId) : current.items }));
  }

  function focusQtyByOffset(rowId, offset) {
    const index = form.items.findIndex((item) => item.row_id === rowId);
    const target = form.items[index + offset];
    if (target) qtyRefs.current[target.row_id]?.focus?.();
  }

  function focusNextRowMaterial(rowId) {
    const index = form.items.findIndex((item) => item.row_id === rowId);
    const target = form.items[index + 1];
    if (target) fieldRefs.current[`${target.row_id}.raw_material_id`]?.focus?.();
  }

  function selectRawMaterial(rowId, rawMaterialId) {
    const material = activeRawMaterials.find((row) => row.id === rawMaterialId);
    setFieldErrors((current) => ({ ...current, [`${rowId}.raw_material_id`]: "", [`${rowId}.uom`]: "" }));
    updateItem(rowId, {
      raw_material_id: rawMaterialId,
      uom: material?.uom || "",
      storage_location_id: material?.storage_location_id || "",
      storage_location: material?.storage_location || "",
    });
    setOpenMaterialRowId(null);
  }

  function selectStorageLocation(rowId, locationId) {
    const location = activeStorageLocations.find((row) => row.id === locationId);
    updateItem(rowId, {
      storage_location_id: locationId || "",
      storage_location: location?.location_name || "",
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    const nextErrors = {
      supplier_id: !form.supplier_id ? "Supplier is required." : "",
      received_date: !form.received_date ? "Received Date is required." : "",
    };
    form.items.forEach((item) => {
      nextErrors[`${item.row_id}.raw_material_id`] = !item.raw_material_id ? "Raw Material is required." : "";
      nextErrors[`${item.row_id}.received_qty`] = Number(item.received_qty || 0) <= 0 ? "Qty must be greater than 0." : "";
      nextErrors[`${item.row_id}.uom`] = !String(item.uom || "").trim() ? "UOM is required." : "";
    });
    const activeErrors = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message));
    setFieldErrors(activeErrors);
    const firstError = Object.keys(activeErrors)[0];
    if (firstError) {
      setError("Please complete required fields.");
      focusFirstInvalid(fieldRefs, firstError);
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm({ supplier_id: "", reference_no: "", received_date: todayInput(), remarks: "", items: [makeRow()] });
      setFieldErrors({});
      setError("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Receive Raw Material" description="Record one supplier delivery with multiple raw material item rows.">
      <form className="space-y-5 p-5" onSubmit={submit}>
        <div className="grid gap-3 lg:grid-cols-3">
          <Field label="Supplier *" error={fieldErrors.supplier_id}>
            <SearchableSelect
              value={form.supplier_id}
              options={supplierOptions}
              placeholder={activeSuppliers.length ? "Select Supplier" : "Create an active Factory Supplier first"}
              searchPlaceholder="Search suppliers"
              emptyText="No matching suppliers"
              error={Boolean(fieldErrors.supplier_id)}
              buttonRef={(node) => { fieldRefs.current.supplier_id = node; }}
              onChange={(supplierId) => {
                setFieldErrors((current) => ({ ...current, supplier_id: "" }));
                setForm((current) => ({ ...current, supplier_id: supplierId }));
              }}
            />
          </Field>
          <Field label="Reference No.">
            <input className={inputClass()} value={form.reference_no} onChange={(event) => setForm((current) => ({ ...current, reference_no: event.target.value }))} />
          </Field>
          <Field label="Received Date *" error={fieldErrors.received_date}>
            <FeedXDatePicker
              value={form.received_date}
              required
              error={Boolean(fieldErrors.received_date)}
              buttonRef={(node) => { fieldRefs.current.received_date = node; }}
              onChange={(nextDate) => {
                setFieldErrors((current) => ({ ...current, received_date: "" }));
                setForm((current) => ({ ...current, received_date: nextDate }));
              }}
            />
          </Field>
        </div>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={2} value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>

        <div className="rounded-xl border border-border bg-white p-4 pb-48">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-slate-50 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-text-primary">Receiving Items</div>
              <div className="text-xs text-text-secondary">UOM and storage location default from the selected raw material.</div>
            </div>
            <button className="btn-secondary px-3 py-2 text-sm" type="button" onClick={addRow}><Package size={15} /> Add Item Row</button>
          </div>
          <div className="mt-4 overflow-visible rounded-xl border border-border">
          <table className="min-w-[1080px] w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[27%]" />
              <col className="w-[15%]" />
              <col className="w-[13%]" />
              <col className="w-[22%]" />
              <col className="w-[15%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              <tr>
                <th className="px-4 py-3">Raw Material *</th>
                <th className="px-4 py-3">Batch No.</th>
                <th className="px-4 py-3">Qty *</th>
                <th className="px-4 py-3">Storage Location</th>
                <th className="px-4 py-3">Expiry Date</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, index) => (
                <tr key={item.row_id} className="border-b border-border last:border-0 align-top transition hover:bg-slate-50/70">
                  <td className="px-4 py-3 overflow-visible">
                    <RawMaterialCellPicker
                      value={item.raw_material_id}
                      materials={activeRawMaterials}
                      placeholder="Select Raw Material"
                      open={openMaterialRowId === item.row_id}
                      openUpward={index >= Math.max(0, form.items.length - 2)}
                      error={Boolean(fieldErrors[`${item.row_id}.raw_material_id`])}
                      buttonRef={(node) => {
                        fieldRefs.current[`${item.row_id}.raw_material_id`] = node;
                        fieldRefs.current[`${item.row_id}.uom`] = node;
                      }}
                      onToggle={() => setOpenMaterialRowId((current) => current === item.row_id ? null : item.row_id)}
                      onClose={() => setOpenMaterialRowId(null)}
                      onSelect={(rawMaterialId) => selectRawMaterial(item.row_id, rawMaterialId)}
                    />
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {item.storage_location ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">{item.storage_location}</span> : null}
                    </div>
                    {fieldErrors[`${item.row_id}.raw_material_id`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.raw_material_id`]}</div> : null}
                    {fieldErrors[`${item.row_id}.uom`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.uom`]}</div> : null}
                  </td>
                  <td className="px-4 py-3"><input className={inputClass()} value={item.batch_no} onChange={(event) => updateItem(item.row_id, { batch_no: event.target.value })} /></td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <input
                        ref={(node) => {
                          fieldRefs.current[`${item.row_id}.received_qty`] = node;
                          qtyRefs.current[item.row_id] = node;
                        }}
                        className={`${inputClass(fieldErrors[`${item.row_id}.received_qty`])} ${item.uom ? "pr-16" : ""} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={item.received_qty}
                        onFocus={(event) => event.target.select()}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            focusQtyByOffset(item.row_id, 1);
                          }
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            focusQtyByOffset(item.row_id, -1);
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            focusNextRowMaterial(item.row_id);
                          }
                        }}
                        onChange={(event) => {
                        setFieldErrors((current) => ({ ...current, [`${item.row_id}.received_qty`]: "" }));
                        updateItem(item.row_id, { received_qty: event.target.value });
                      }}
                      />
                      {item.uom ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-text-muted">{item.uom}</span> : null}
                    </div>
                    {fieldErrors[`${item.row_id}.received_qty`] ? <div className="mt-1 text-xs font-semibold text-rose-600">{fieldErrors[`${item.row_id}.received_qty`]}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <SearchableSelect
                      value={item.storage_location_id || ""}
                      options={storageLocationOptions}
                      placeholder="Select Storage Location"
                      searchPlaceholder="Search locations"
                      emptyText="No matching locations"
                      onChange={(locationId) => selectStorageLocation(item.row_id, locationId)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <FeedXDatePicker
                      value={item.expiry_date || ""}
                      placeholder="Expiry date"
                      onChange={(nextDate) => updateItem(item.row_id, { expiry_date: nextDate })}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => removeRow(item.row_id)} disabled={form.items.length === 1}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-slate-50 px-4 py-3">
          {error ? <div className="text-sm font-semibold text-rose-600">{error}</div> : null}
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Receiving"}</button>
        </div>
      </form>
    </Card>
  );
}

function ReceivingBatchDetailModal({ batch, onClose }) {
  return (
    <Modal title={batch.batch_no || "Receiving Detail"} description={`${batch.supplier_name || "No supplier"} · ${batch.received_date || "No date"}`} onClose={onClose} size="2xl">
      <FactoryTable
        columns={[
          { key: "raw_material_name", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{row.raw_material_name}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
          { key: "qty", label: "Qty", render: (row) => quantity(row.received_qty, row.uom) },
          { key: "storage_location", label: "Storage Location", render: (row) => row.storage_location || "—" },
          { key: "expiry_date", label: "Expiry Date", render: (row) => row.expiry_date || "—" },
        ]}
        rows={batch.items || []}
        emptyTitle="No receiving items"
        emptyDescription="This receiving document has no item rows."
      />
    </Modal>
  );
}

function buildInitialUsageRows(job, rawMaterials, recipes) {
  const matchingRecipe = activeRecipeForSku(recipes, job.finished_good || job, job.product_name);
  if (matchingRecipe?.items?.length) {
    const targetQuantity = Number(job.actual_output_qty || job.target_production_qty || job.actual_produced_qty || job.target_quantity || 0);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    return matchingRecipe.items.map((item) => {
      const standardUsage = (Number(item.quantity_used || 0) * targetQuantity) / recipeYield;
      return {
        id: `recipe-${item.id}`,
        recipe_item_id: item.id,
        raw_material_id: item.raw_material_id,
        standard_usage: Number(standardUsage.toFixed(4)),
        actual_usage: Number(standardUsage.toFixed(4)),
        raw_material_receiving_id: "",
        raw_material_lot_no: "",
        uom: item.uom || rawMaterials.find((material) => material.id === item.raw_material_id)?.uom || "",
        variance_reason: "",
        notes: item.notes || "",
      };
    });
  }
  return [];
}

function ProductRecipeModal({ initialValue, productFamilies = [], finishedGoods = [], rawMaterials, onClose, onSave }) {
  const legacyFinishedGood = finishedGoods.find((product) => product.id === initialValue?.finished_good_id);
  const [form, setForm] = useState(() => ({
    recipe_code: "",
    finished_good_id: "",
    product_family_id: legacyFinishedGood?.product_family_id || "",
    recipe_name: "",
    version: "v1",
    yield_quantity: "",
    uom: "kg",
    estimated_production_time_minutes: "",
    status: "draft",
    remarks: "",
    ...initialValue,
    items: initialValue?.items?.length ? initialValue.items.map((item, index) => ({ ...item, remarks: item.remarks || item.notes || "", sort_order: item.sort_order || index + 1 })) : [
      { id: "item-1", raw_material_id: "", quantity_used: "", uom: "kg", wastage_percent: 0, remarks: "", sort_order: 1 },
    ],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isLocked = initialValue?.status && initialValue.status !== "draft";
  const activeProductFamilies = productFamilies.filter((family) => family.status === "active" || family.id === form.product_family_id);
  const productFamilyOptions = activeProductFamilies.map((family) => ({ value: family.id, label: family.name_en, helper: [family.category, family.status].filter(Boolean).join(" · ") || "Finished Good" }));

  function updateItem(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === rowId ? { ...item, ...patch } : item)),
    }));
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        { id: `item-${Date.now()}`, raw_material_id: "", quantity_used: "", uom: "kg", wastage_percent: 0, remarks: "", sort_order: current.items.length + 1 },
      ],
    }));
  }

  function removeItem(rowId) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== rowId).map((item, index) => ({ ...item, sort_order: index + 1 })),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isLocked) {
      setError("Only draft recipes can be edited.");
      return;
    }
    if (!form.product_family_id) {
      setError("Finished Good is required.");
      return;
    }
    if (!String(form.recipe_name || "").trim()) {
      setError("Production standard name is required.");
      return;
    }
    if (Number(form.yield_quantity || 0) <= 0) {
      setError("Production quantity must be greater than 0.");
      return;
    }
    const validItems = form.items.filter((item) => item.raw_material_id || Number(item.quantity_used || 0) > 0);
    if (!validItems.length || validItems.some((item) => !item.raw_material_id || Number(item.quantity_used || 0) <= 0)) {
      setError("Every material row needs a raw material and standard quantity greater than 0.");
      return;
    }
    setSaving(true);
    try {
      const productFamily = activeProductFamilies.find((family) => family.id === form.product_family_id);
      await onSave({
        ...form,
        finished_good_id: form.finished_good_id || null,
        product_family_id: productFamily?.id || form.product_family_id,
        product_name: productFamily?.name_en || form.product_name,
        uom: form.uom || "",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Production Standard / BOM" : "Create Production Standard / BOM"}
      description="Production standards define the finished good output quantity and raw material BOM. Actual production usage remains adjustable."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-product-recipe-form" disabled={saving || isLocked}>{saving ? "Saving..." : "Save Standard"}</button>
        </>
      )}
    >
      <form id="factory-product-recipe-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {isLocked ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Only draft standards can be edited. Active and archived standards remain readable for history.</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Finished Good">
            <SearchableSelect
              value={form.product_family_id || ""}
              options={productFamilyOptions}
              placeholder="Select Finished Good"
              searchPlaceholder="Search finished goods"
              emptyText="No matching finished goods"
              disabled={isLocked}
              onChange={(productFamilyId) => {
                const productFamily = activeProductFamilies.find((item) => item.id === productFamilyId);
                setForm((current) => ({
                  ...current,
                  product_family_id: productFamilyId,
                  finished_good_id: "",
                  product_name: productFamily?.name_en || "",
                }));
              }}
            />
          </Field>
          <Field label="Production Standard Name">
            <input className={inputClass()} value={form.recipe_name || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, recipe_name: event.target.value }))} />
          </Field>
          <Field label="Version">
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">{form.version || "v1"}</div>
          </Field>
          <Field label="Production Quantity">
            <input className={inputClass()} type="number" min="0" step="0.01" value={form.yield_quantity || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, yield_quantity: event.target.value }))} />
          </Field>
          <Field label="UOM">
            <select className={inputClass()} value={form.uom || "kg"} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, uom: event.target.value }))}>
              {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
            </select>
          </Field>
          <Field label="Estimated Production Time">
            <input className={inputClass()} type="number" min="0" step="1" placeholder="Minutes" value={form.estimated_production_time_minutes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, estimated_production_time_minutes: event.target.value }))} />
          </Field>
          <Field label="Status">
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3">
              <Badge tone={form.status === "active" ? "success" : form.status === "draft" ? "info" : "neutral"}>{form.status || "draft"}</Badge>
            </div>
          </Field>
        </div>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
        <Card
          title="BOM Materials"
          description="Standard quantities are scaled into production material usage. Operators can adjust actual usage during completion."
          action={!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addItem}><Package size={14} /> Add Material</button> : null}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Raw Material</th>
                  <th className="px-4 py-2.5">Required Qty</th>
                  <th className="px-4 py-2.5">UOM</th>
                  <th className="px-4 py-2.5">Wastage %</th>
                  <th className="px-4 py-2.5">Remarks</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item) => {
                  const material = rawMaterials.find((row) => row.id === item.raw_material_id);
                  return (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <select
                          className={inputClass()}
                          value={item.raw_material_id || ""}
                          disabled={isLocked}
                          onChange={(event) => {
                            const nextMaterial = rawMaterials.find((row) => row.id === event.target.value);
                            updateItem(item.id, { raw_material_id: event.target.value, uom: nextMaterial?.uom || item.uom });
                          }}
                        >
                          <option value="">Select raw material</option>
                          {rawMaterials.filter((row) => row.status === "active" || row.id === item.raw_material_id).map((materialOption) => (
                            <option key={materialOption.id} value={materialOption.id}>{rawMaterialLabel(materialOption)} · {quantity(materialOption.current_balance, materialOption.uom)}</option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-text-secondary">{material?.category || "Raw material BOM item"}</div>
                      </td>
                      <td className="px-4 py-3"><input className={inputClass()} type="number" min="0" step="0.0001" value={item.quantity_used || ""} disabled={isLocked} onChange={(event) => updateItem(item.id, { quantity_used: event.target.value })} /></td>
                      <td className="px-4 py-3">
                        <select className={inputClass()} value={item.uom || material?.uom || "kg"} disabled={isLocked} onChange={(event) => updateItem(item.id, { uom: event.target.value })}>
                          {commonUoms.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3"><input className={inputClass()} type="number" min="0" step="0.01" value={item.wastage_percent || 0} disabled={isLocked} onChange={(event) => updateItem(item.id, { wastage_percent: event.target.value })} /></td>
                      <td className="px-4 py-3"><input className={inputClass()} value={item.remarks || ""} disabled={isLocked} onChange={(event) => updateItem(item.id, { remarks: event.target.value })} /></td>
                      <td className="px-4 py-3 text-right">
                        {!isLocked ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeItem(item.id)}>Remove</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </form>
    </Modal>
  );
}

function ProductRecipeDetailModal({ recipe, onClose, onEdit, onNewVersion, onActivate, onArchive, onDelete, canCreateRecipe, canEditRecipe, canManageRecipe, canDeleteRecipe }) {
  const status = String(recipe.status || "draft").toLowerCase();
  return (
    <Modal
      title={recipe.recipe_name || "Production Standard / BOM"}
      description={`${recipe.product_name} · ${recipe.version || "v1"}`}
      size="2xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          {canEditRecipe && status === "draft" ? <button className="btn-secondary" type="button" onClick={() => onEdit(recipe)}>Edit</button> : null}
          {canManageRecipe && status === "draft" ? <button className="btn-primary" type="button" onClick={() => onActivate(recipe)}>Activate</button> : null}
          {canDeleteRecipe && status === "draft" ? <button className="btn-danger" type="button" onClick={() => onDelete(recipe)}>Delete</button> : null}
          {canCreateRecipe && status === "active" ? <button className="btn-secondary" type="button" onClick={() => onNewVersion(recipe)}>New Version</button> : null}
          {canDeleteRecipe && status === "active" ? <button className="btn-danger" type="button" onClick={() => onArchive(recipe)}>Archive</button> : null}
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Production Quantity" value={quantity(recipe.yield_quantity, recipe.uom)} helper="Standard output" />
          <MetricCard icon={Clock3} label="Estimated Time" value={productionTimeLabel(recipe.estimated_production_time_minutes)} helper="Production standard" />
          <MetricCard icon={Package} label="Materials" value={recipe.items?.length || 0} helper="BOM rows" />
          <MetricCard icon={CheckCircle2} label="Status" value={jobStatusLabel(recipe.status)} helper={recipe.updated_at ? `Updated ${String(recipe.updated_at).slice(0, 10)}` : "Not updated"} />
        </div>
        <Card title="BOM Materials" description="Standard raw material requirements for this production quantity.">
          <FactoryTable
            columns={[
              { key: "raw_material", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{row.raw_material_name}</div><div className="text-xs text-text-secondary">BOM item</div></div> },
              { key: "required_qty", label: "Required Qty", render: (row) => quantity(row.quantity_used, row.uom) },
              { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
              { key: "wastage_percent", label: "Wastage %", render: (row) => percent(row.wastage_percent) },
              { key: "remarks", label: "Remarks", render: (row) => row.remarks || row.notes || "—" },
            ]}
            rows={recipe.items || []}
            emptyTitle="No BOM materials"
            emptyDescription="Add raw material rows before activating this production standard."
          />
        </Card>
        {recipe.remarks || recipe.notes ? (
          <Card title="Remarks">
            <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-text-secondary">{recipe.remarks || recipe.notes}</p>
          </Card>
        ) : null}
      </div>
    </Modal>
  );
}

function StartProductionModal({ job, auth, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    operator_id: auth?.profile?.id || "",
    operator_name: employeeDisplayName(auth),
    production_date: todayInput(),
    start_time: timeInput(),
    remarks: "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.production_date) {
      setError("Production date is required.");
      return;
    }
    if (!form.start_time) {
      setError("Start time is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Start Production"
      description={`${job.job_order_no} · ${job.product_name}`}
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-start-production-form" disabled={saving}>{saving ? "Starting..." : "Start Production"}</button>
        </>
      )}
    >
      <form id="factory-start-production-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="text-sm font-semibold text-primary">Job Order Summary</div>
          <div className="mt-1 text-lg font-bold text-text-primary">{job.job_order_no} · {job.product_name}</div>
          <div className="mt-1 text-sm font-semibold text-text-secondary">Target {quantity(job.target_quantity, job.uom)} · Due {job.due_date || "No due date"} · Team {job.assigned_team || "Unassigned"}</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Operator">
            <input className={inputClass()} value={form.operator_name || ""} onChange={(event) => setForm((current) => ({ ...current, operator_name: event.target.value }))} />
          </Field>
          <Field label="Production Date">
            <input className={inputClass()} type="date" value={form.production_date || ""} onChange={(event) => setForm((current) => ({ ...current, production_date: event.target.value }))} />
          </Field>
          <Field label="Start Time">
            <input className={inputClass()} type="time" value={form.start_time || ""} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
          </Field>
        </div>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function ProductionExecutionModal({ job, rawMaterials, receivings, recipes, sops, finishedGoods = [], auth, onClose, onSave }) {
  const activeFinishedGoods = finishedGoods.filter((product) => product.status === "active");
  const matchingFinishedGood = activeFinishedGoods.find((product) => product.id === job.finished_good_id) || activeFinishedGoods.find((product) => product.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
  const matchingRecipe = activeRecipeForSku(recipes, matchingFinishedGood || job, job.product_name);
  const initialPackQty = job.actual_pack_qty || job.target_pack_qty || job.good_output_qty || job.target_quantity || "";
  const initialProductionPlan = packagingProductionPlan(initialPackQty, matchingFinishedGood, matchingRecipe?.uom || job.uom);
  const initialProductionUom = initialProductionPlan.production_uom || matchingRecipe?.uom || job.uom || "";
  const initialOutputQty = initialProductionPlan.error ? Number(job.actual_output_qty || job.target_production_qty || job.target_quantity || 0) : initialProductionPlan.target_production_qty;
  const [form, setForm] = useState(() => ({
    job_order_id: job.id,
    finished_good_id: matchingFinishedGood?.id || job.finished_good_id || "",
    production_no: "",
    product_name: matchingFinishedGood?.product_name || job.product_name || "",
    batch_no: "",
    production_date: job.production_date || todayInput(),
    operator_id: job.production_operator_id || auth?.profile?.id || "",
    operator_name: job.production_operator_name || employeeDisplayName(auth),
    start_time: job.start_time || timeInput(),
    end_time: "",
    actual_pack_qty: initialPackQty,
    actual_output_qty: initialOutputQty || "",
    actual_produced_qty: initialOutputQty || "",
    good_output_qty: initialOutputQty || "",
    wastage_qty: 0,
    uom: initialProductionUom,
    qc_status: "Pending",
    production_sop_id: "",
    sop_version: "",
    notes: "",
    material_usage: buildInitialUsageRows({ ...job, finished_good: matchingFinishedGood, actual_output_qty: initialOutputQty }, rawMaterials, recipes),
  }));
  const [saving, setSaving] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState("");

  function addUsageRow() {
    setForm((current) => ({
      ...current,
      material_usage: [
        ...current.material_usage,
        {
          id: `manual-${Date.now()}`,
          raw_material_id: "",
          raw_material_receiving_id: "",
          raw_material_lot_no: "",
          standard_usage: 0,
          actual_usage: "",
          uom: "",
          variance_reason: "",
          notes: "",
        },
      ],
    }));
  }

  function updateUsageRow(rowId, patch) {
    setForm((current) => ({
      ...current,
      material_usage: current.material_usage.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function removeUsageRow(rowId) {
    setForm((current) => ({
      ...current,
      material_usage: current.material_usage.filter((row) => row.id !== rowId),
    }));
  }

  function validate() {
    if (!form.job_order_id) return "Select a job order before completing production.";
    const finishedGood = activeFinishedGoods.find((product) => product.id === form.finished_good_id);
    if (!finishedGood) return "Production must start from a job order linked to an active finished good.";
    if (Number(form.actual_pack_qty || 0) <= 0) return "Actual Pack Qty must be greater than 0.";
    if (!form.material_usage.length) return "At least one material usage row is required.";
    const invalidRow = form.material_usage.find((row) => !row.raw_material_id || row.actual_usage === "" || row.actual_usage === null || row.actual_usage === undefined || Number(row.actual_usage) < 0);
    if (invalidRow) return "Every material usage row needs a raw material and actual usage.";
    const missingReason = form.material_usage.find((row) => {
      const { variance } = varianceFor(row.standard_usage, row.actual_usage);
      return Math.abs(variance) > varianceReasonTolerance && !String(row.variance_reason || "").trim();
    });
    if (missingReason) return "Reason is required when actual usage differs from standard usage.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitAttempted(true);
    const validationError = validate();
    setError(validationError);
    if (validationError) return;
    setSaving(true);
    try {
      await onSave({
        ...form,
        actual_produced_qty: form.actual_output_qty || form.good_output_qty,
        good_output_qty: form.actual_output_qty || form.good_output_qty,
      });
    } finally {
      setSaving(false);
    }
  }

  const hasRecipeBom = Boolean(matchingRecipe?.items?.length);
  const recipeYieldQty = Number(matchingRecipe?.yield_quantity || 0);
  const currentProductionQty = Number(form.actual_output_qty || form.good_output_qty || 0);
  const scaleFactor = matchingRecipe && recipeYieldQty > 0 ? currentProductionQty / recipeYieldQty : 0;
  const estimatedPackQty = Number(job.target_pack_qty || job.target_quantity || 0);
  const actualPackQty = Number(form.actual_pack_qty || 0);
  const packDifference = actualPackQty - estimatedPackQty;
  const formatSignedQuantity = (value, unit) => {
    const numericValue = Number(value || 0);
    const prefix = numericValue > 0 ? "+" : "";
    return `${prefix}${quantity(numericValue, unit)}`;
  };

  return (
    <Modal
      title="Complete Production"
      description={`${job.job_order_no} · ${job.product_name}`}
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-production-form" disabled={saving}>{saving ? "Completing..." : "Complete Production"}</button>
        </>
      )}
    >
      <form id="factory-production-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="text-sm font-bold text-text-primary">Production Information</div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Field label="Batch No.">
              <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="font-mono text-sm font-black text-text-primary">{previewProductionBatchNo(form.production_date)}</div>
                <div className="mt-0.5 text-[10.5px] font-semibold text-text-secondary">Preview only</div>
              </div>
            </Field>
            <Field label="Production Date">
              <input className={inputClass()} type="date" value={form.production_date || ""} readOnly={Boolean(job.started_at)} onChange={(event) => setForm((current) => ({ ...current, production_date: event.target.value }))} />
            </Field>
            <Field label="Operator">
              <input className={inputClass()} value={form.operator_name || ""} readOnly={Boolean(job.started_at)} onChange={(event) => setForm((current) => ({ ...current, operator_name: event.target.value }))} />
            </Field>
            <Field label="Start Time">
              <input className={inputClass()} type="time" value={form.start_time || ""} readOnly={Boolean(job.started_at)} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
            </Field>
            <Field label="End Time">
              <input className={inputClass()} type="time" value={form.end_time || ""} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
            </Field>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="text-sm font-bold text-text-primary">Job Order Summary</div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <MetricCard icon={PackageCheck} label="Finished Good" value={matchingFinishedGood?.product_family_name || matchingFinishedGood?.product_name_en || job.product_name} helper={job.job_order_no} />
            <MetricCard icon={Package} label="Packaging SKU" value={matchingFinishedGood?.product_code || "No SKU"} helper={matchingFinishedGood?.variant_name || packSizeText(matchingFinishedGood) || "Packaging SKU"} />
            <MetricCard icon={ClipboardCheck} label="Target Production Qty" value={quantity(job.target_production_qty || job.target_quantity, job.uom)} helper="Planned output" />
            <MetricCard icon={Factory} label="Estimated Pack Qty" value={quantity(estimatedPackQty, "packs")} helper="Planned stock-in" />
          </div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="text-sm font-bold text-primary">Actual Packaging Output</div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Estimated Pack Qty</div>
              <div className="mt-1 text-lg font-bold text-text-primary">{quantity(estimatedPackQty, "packs")}</div>
            </div>
            <Field label="Actual Pack Qty *">
              <input className={`${inputClass(submitAttempted && Number(form.actual_pack_qty || 0) <= 0)} border-primary/40 bg-white text-xl font-black shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/15`} type="number" min="0" step="0.01" value={form.actual_pack_qty} onChange={(event) => {
                const nextPackQty = event.target.value;
                const nextPlan = packagingProductionPlan(nextPackQty, matchingFinishedGood, matchingRecipe?.uom || form.uom);
                setForm((current) => {
                  const outputQty = nextPlan.error ? current.actual_output_qty : nextPlan.target_production_qty;
                  const recipeYield = Number(matchingRecipe?.yield_quantity || 1) || 1;
                  const nextUsage = matchingRecipe?.items?.length
                    ? current.material_usage.map((row) => {
                      const recipeItem = matchingRecipe.items.find((item) => item.raw_material_id === row.raw_material_id);
                      if (!recipeItem) return row;
                      const standardUsage = (Number(recipeItem.quantity_used || 0) * Number(outputQty || 0)) / recipeYield;
                      return { ...row, standard_usage: Number(standardUsage.toFixed(4)), actual_usage: row.actual_usage === row.standard_usage ? Number(standardUsage.toFixed(4)) : row.actual_usage };
                    })
                    : current.material_usage;
                  return {
                    ...current,
                    actual_pack_qty: nextPackQty,
                    actual_output_qty: outputQty,
                    actual_produced_qty: outputQty,
                    good_output_qty: outputQty,
                    uom: nextPlan.production_uom || current.uom,
                    material_usage: nextUsage,
                  };
                });
              }} />
            </Field>
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Difference from Estimate</div>
              <div className={`mt-1 text-lg font-bold ${packDifference > 0 ? "text-amber-700" : packDifference < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatSignedQuantity(packDifference, "packs")}</div>
            </div>
            <div className="rounded-xl border border-primary/20 bg-white px-3 py-3">
              <div className="text-[10.5px] font-semibold text-text-muted">Calculated Output</div>
              <div className="mt-1 text-lg font-bold text-text-primary">{quantity(form.actual_output_qty || form.good_output_qty, form.uom)}</div>
              <div className="mt-1 text-xs font-semibold text-text-secondary">Based on actual packs × pack size</div>
            </div>
          </div>
        </div>
        {matchingRecipe ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-bold text-emerald-800">Production Standard: {matchingRecipe.product_name || finishedGoodLabel(matchingFinishedGood) || job.product_name} {matchingRecipe.version || "v1"}</div>
            <div className="mt-2 grid gap-2 text-sm font-semibold text-emerald-800 md:grid-cols-3">
              <div>Base Recipe Qty: {quantity(matchingRecipe.yield_quantity, matchingRecipe.uom)}</div>
              <div>Current Production Qty: {quantity(currentProductionQty, form.uom)}</div>
              <div>Scale Factor: {scaleFactor ? `${Number(scaleFactor.toFixed(4))}x` : "—"}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            No active recipe found. Manual material usage is allowed for this completion, but create a Production Standard / BOM before future production if possible.
          </div>
        )}
        <Card
          title="Actual Material Usage"
          description={hasRecipeBom ? "Rows are locked to the active Production Standard / BOM. Actual usage is the raw material stock deduction source." : "No active recipe found. Add manual material usage rows for this completion only."}
          action={!hasRecipeBom ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addUsageRow}><Package size={14} /> Add Material</button> : null}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Raw Material</th>
                  <th className="px-4 py-2.5">Standard</th>
                  <th className="px-4 py-2.5">Actual Used</th>
                  <th className="px-4 py-2.5">Difference</th>
                  <th className="px-4 py-2.5">Reason</th>
                  {!hasRecipeBom ? <th className="px-4 py-2.5 text-right">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {form.material_usage.map((row) => {
                  const material = rawMaterials.find((item) => item.id === row.raw_material_id);
                  const { variance } = varianceFor(row.standard_usage, row.actual_usage);
                  const needsReason = Math.abs(variance) > varianceReasonTolerance;
                  const showReasonError = submitAttempted && needsReason && !String(row.variance_reason || "").trim();
                  const rowUom = row.uom || material?.uom || "";
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        {hasRecipeBom ? (
                          <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">
                            {material ? rawMaterialLabel(material) : "Raw material"}
                          </div>
                        ) : (
                          <select
                            className={inputClass(submitAttempted && !row.raw_material_id)}
                            value={row.raw_material_id}
                            onChange={(event) => {
                              const nextMaterial = rawMaterials.find((item) => item.id === event.target.value);
                              updateUsageRow(row.id, { raw_material_id: event.target.value, raw_material_receiving_id: "", raw_material_lot_no: "", uom: nextMaterial?.uom || row.uom });
                            }}
                          >
                            <option value="">Select material</option>
                            {rawMaterials.filter((item) => item.status === "active" || item.id === row.raw_material_id).map((item) => (
                              <option key={item.id} value={item.id}>{rawMaterialLabel(item)}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex min-h-[38px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">{quantity(row.standard_usage, rowUom)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="relative">
                          <input className={`${inputClass()} pr-14 font-bold`} type="number" min="0" step="0.0001" value={row.actual_usage} onChange={(event) => updateUsageRow(row.id, { actual_usage: event.target.value })} />
                          {rowUom ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-text-secondary">{rowUom}</span> : null}
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance > 0 ? "text-amber-600" : variance < 0 ? "text-emerald-600" : "text-text-secondary"}`}>
                        {formatSignedQuantity(variance, rowUom)}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          placeholder={needsReason ? "Required if different" : "Optional"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateUsageRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">Required when actual differs from standard.</div> : null}
                      </td>
                      {!hasRecipeBom ? (
                        <td className="px-4 py-3 text-right">
                          <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeUsageRow(row.id)}>Remove</button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!form.material_usage.length ? (
            <EmptyState title="No material usage rows" description="Add raw material usage before completing production." />
          ) : null}
        </Card>
        <Card title="Production Summary" description="Review before confirming completion.">
          <div className="grid gap-3 text-sm font-semibold text-text-secondary md:grid-cols-2">
            {[
              ["Finished Good", matchingFinishedGood?.product_family_name || matchingFinishedGood?.product_name_en || job.product_name],
              ["Packaging SKU", `${matchingFinishedGood?.product_code || "No SKU"} · ${matchingFinishedGood?.variant_name || packSizeText(matchingFinishedGood) || "Packaging SKU"}`],
              ["Target Production", quantity(job.target_production_qty || job.target_quantity, job.uom)],
              ["Actual Output", quantity(form.actual_output_qty || form.good_output_qty, form.uom)],
              ["Estimated Packs", quantity(job.target_pack_qty || job.target_quantity, "packs")],
              ["Actual Packs", quantity(form.actual_pack_qty, "packs")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="text-[10.5px] font-semibold text-text-muted">{label}</div>
                <div className="mt-1 font-bold text-text-primary">{value}</div>
              </div>
            ))}
          </div>
        </Card>
        <Field label="Production Notes">
          <textarea className={inputClass()} rows={3} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function ProductionSopModal({ initialValue, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    sop_code: "",
    title: "",
    product_name: "",
    version: "v1",
    effective_date: todayInput(),
    equipment: "",
    status: "active",
    notes: "",
    steps: [
      {
        id: "step-1",
        step_no: 1,
        process_name: "",
        description: "",
        control_point: "",
        materials: "",
        equipment: "",
        estimated_time_minutes: "",
        is_qc_checkpoint: false,
      },
    ],
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateStep(rowId, patch) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === rowId ? { ...step, ...patch } : step)),
    }));
  }

  function addStep() {
    setForm((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          id: `step-${Date.now()}`,
          step_no: current.steps.length + 1,
          process_name: "",
          description: "",
          control_point: "",
          materials: "",
          equipment: "",
          estimated_time_minutes: "",
          is_qc_checkpoint: false,
        },
      ],
    }));
  }

  function removeStep(rowId) {
    setForm((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== rowId).map((step, index) => ({ ...step, step_no: index + 1 })),
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.title || "").trim()) {
      setError("SOP title is required.");
      return;
    }
    if (!String(form.product_name || "").trim()) {
      setError("Product name is required.");
      return;
    }
    if (!form.steps.some((step) => String(step.process_name || step.description || "").trim())) {
      setError("At least one SOP step is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={initialValue?.id ? "Edit Production SOP" : "Create Production SOP"}
      description="SOP is the standard process reference. Actual production records can reference the SOP version used."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="submit" form="factory-sop-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button>
        </>
      )}
    >
      <form id="factory-sop-form" className="space-y-5" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="SOP Title">
            <input className={inputClass()} value={form.title || ""} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </Field>
          <Field label="Product">
            <input className={inputClass()} value={form.product_name || ""} onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))} />
          </Field>
          <Field label="Version">
            <input className={inputClass()} value={form.version || ""} onChange={(event) => setForm((current) => ({ ...current, version: event.target.value }))} />
          </Field>
          <Field label="SOP Code">
            <input className={inputClass()} value={form.sop_code || "Generated on save"} onChange={(event) => setForm((current) => ({ ...current, sop_code: event.target.value }))} />
          </Field>
          <Field label="Effective Date">
            <input className={inputClass()} type="date" value={form.effective_date || ""} onChange={(event) => setForm((current) => ({ ...current, effective_date: event.target.value }))} />
          </Field>
          <Field label="Status">
            <select className={inputClass()} value={form.status || "active"} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </Field>
        </div>
        <Field label="Default Equipment">
          <input className={inputClass()} value={form.equipment || ""} onChange={(event) => setForm((current) => ({ ...current, equipment: event.target.value }))} />
        </Field>
        <Card
          title="SOP Steps"
          description="QC checkpoint flags create production QC checkpoint snapshots when this SOP is attached to a batch."
          action={<button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addStep}><FileText size={14} /> Add Step</button>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">Step</th>
                  <th className="px-4 py-2.5">Process Name</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Control Point</th>
                  <th className="px-4 py-2.5">Materials</th>
                  <th className="px-4 py-2.5">Equipment</th>
                  <th className="px-4 py-2.5">Est. Time</th>
                  <th className="px-4 py-2.5">QC</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.steps.map((step) => (
                  <tr key={step.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="1" value={step.step_no} onChange={(event) => updateStep(step.id, { step_no: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.process_name || ""} onChange={(event) => updateStep(step.id, { process_name: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.description || ""} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.control_point || ""} onChange={(event) => updateStep(step.id, { control_point: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.materials || ""} onChange={(event) => updateStep(step.id, { materials: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} value={step.equipment || ""} onChange={(event) => updateStep(step.id, { equipment: event.target.value })} /></td>
                    <td className="px-4 py-3"><input className={inputClass()} type="number" min="0" value={step.estimated_time_minutes || ""} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} /></td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary">
                        <input type="checkbox" checked={Boolean(step.is_qc_checkpoint)} onChange={(event) => updateStep(step.id, { is_qc_checkpoint: event.target.checked })} />
                        Checkpoint
                      </label>
                    </td>
                    <td className="px-4 py-3 text-right"><button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => removeStep(step.id)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Field label="Notes">
          <textarea className={inputClass()} rows={3} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

function buildStockCheckRows(stockType, stockItems, initialValue, categoryId = "") {
  if (initialValue?.items?.length) {
    return initialValue.items.map((item) => ({
      id: item.id,
      raw_material_id: item.raw_material_id || "",
      finished_good_id: item.finished_good_id || "",
      item_name: item.item_name || "",
      system_qty: initialValue.status === "draft"
        ? Number(stockItems.find((stockItem) => stockItem.id === item.raw_material_id || stockItem.id === item.finished_good_id)?.current_balance ?? item.system_qty ?? 0)
        : item.system_qty,
      physical_qty: item.variance_status === "Skipped" || item.count_status === "pending" ? "" : item.physical_qty,
      count_status: item.variance_status === "Skipped" ? "skip" : item.count_status === "pending" ? "pending" : "counted",
      variance_reason: item.variance_reason || "",
      uom: item.uom || "",
    }));
  }
  return stockItems.filter((item) => item.status === "active" && (stockType !== "raw" || item.category_id === categoryId)).map((item) => ({
    id: `${stockType}-${item.id}`,
    raw_material_id: stockType === "raw" ? item.id : "",
    finished_good_id: stockType === "product" ? item.id : "",
    item_name: stockType === "raw" ? rawMaterialLabel(item) : item.product_name,
    system_qty: Number(item.current_balance || 0),
    physical_qty: "",
    count_status: "counted",
    variance_reason: "",
    uom: item.uom || "",
  }));
}

function StockCheckModal({ stockType, title, initialValue, stockItems, rawMaterialCategories = [], onClose, onSave }) {
  const inferredCategoryId = initialValue?.category_id || (stockType === "raw" ? stockItems.find((item) => item.id === initialValue?.items?.[0]?.raw_material_id)?.category_id || "" : "");
  const [form, setForm] = useState(() => ({
    check_date: todayInput(),
    status: "draft",
    notes: "",
    ...initialValue,
    category_id: initialValue?.category_id || inferredCategoryId,
    items: buildStockCheckRows(stockType, stockItems, initialValue, inferredCategoryId),
  }));
  const [savingAction, setSavingAction] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [lastSubmitAction, setLastSubmitAction] = useState("");
  const [error, setError] = useState("");
  const itemIdKey = stockType === "raw" ? "raw_material_id" : "finished_good_id";
  const itemLabel = stockType === "raw" ? "Raw Material" : "Finished Good";
  const isRaw = stockType === "raw";

  function updateRow(rowId, patch) {
    setForm((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function selectCategory(categoryId) {
    setForm((current) => ({
      ...current,
      category_id: categoryId,
      items: categoryId ? buildStockCheckRows(stockType, stockItems, null, categoryId) : [],
    }));
    setError("");
  }

  function validate(nextStatus) {
    if (isRaw && !form.category_id) return "Select a category to start stock check.";
    if (!form.items.length) return "Stock check requires at least one counted item.";
    const invalidRow = form.items.find((row) => !row[itemIdKey]);
    if (invalidRow) return "Every row needs an item.";
    if (nextStatus === "submitted") {
      const missingCount = form.items.find((row) => row.count_status !== "skip" && (row.physical_qty === "" || row.physical_qty == null || Number(row.physical_qty) < 0));
      if (missingCount) return "Submit requires every row to be counted or skipped.";
      const missingSkipReason = form.items.find((row) => row.count_status === "skip" && !String(row.variance_reason || "").trim());
      if (missingSkipReason) return "Skip reason is required for skipped rows.";
    } else {
      const invalidCount = form.items.find((row) => row.count_status !== "skip" && row.physical_qty !== "" && row.physical_qty != null && Number(row.physical_qty) < 0);
      if (invalidCount) return "Physical count cannot be negative.";
    }
    if (nextStatus === "submitted") {
      const missingReason = form.items.find((row) => {
        if (row.count_status === "skip" || row.physical_qty === "" || row.physical_qty == null) return false;
        const variance = stockCheckVariance(row.system_qty, row.physical_qty);
        return variance.status !== "Normal" && !String(row.variance_reason || "").trim();
      });
      if (missingReason) return "Variance reason is required for Warning and Critical rows.";
    }
    return "";
  }

  async function submit(nextStatus) {
    setSubmitAttempted(true);
    setLastSubmitAction(nextStatus);
    const validationError = validate(nextStatus);
    setError(validationError);
    if (validationError) return;
    setSavingAction(nextStatus);
    try {
      await onSave({ ...form, status: nextStatus });
    } finally {
      setSavingAction("");
    }
  }

  const varianceRows = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && stockCheckVariance(row.system_qty, row.physical_qty).status !== "Normal");
  const criticalRows = form.items.filter((row) => row.count_status !== "skip" && row.physical_qty !== "" && stockCheckVariance(row.system_qty, row.physical_qty).status === "Critical");
  const skippedRows = form.items.filter((row) => row.count_status === "skip");
  const isLocked = ["submitted", "approved"].includes(form.status);
  const categoryOptions = rawMaterialCategories
    .filter((category) => category.status === "active" || category.id === form.category_id)
    .map((category) => ({ value: category.id, label: category.name, helper: category.status }));

  return (
    <Modal
      title={initialValue?.id ? `View ${title}` : `Create ${title}`}
      description="Draft and submitted stock checks do not adjust inventory. Approval creates the adjustment movement."
      size="xl"
      onClose={savingAction ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={Boolean(savingAction)} onClick={onClose}>Close</button>
          {!isLocked ? <button className="btn-secondary" type="button" disabled={Boolean(savingAction)} onClick={() => submit("draft")}>{savingAction === "draft" ? "Saving..." : "Save Draft"}</button> : null}
          {!isLocked ? <button className="btn-primary" type="button" disabled={Boolean(savingAction)} onClick={() => submit("submitted")}>{savingAction === "submitted" ? "Submitting..." : "Submit Check"}</button> : null}
        </>
      )}
    >
      <div className="space-y-5">
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Counted Items" value={form.items.length} helper={itemLabel} />
          <MetricCard icon={Activity} label="Variance Rows" value={varianceRows.length} helper="Above 2%" tone={varianceRows.length ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Critical Rows" value={criticalRows.length} helper="Above 5%" tone={criticalRows.length ? "danger" : "success"} />
          <MetricCard icon={CheckCircle2} label="Status" value={form.status} helper={form.check_no || "System generated"} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {isRaw ? (
            <Field label="Category *">
              <SearchableSelect
                value={form.category_id || ""}
                options={categoryOptions}
                placeholder="Select category"
                searchPlaceholder="Search categories"
                emptyText="No raw material categories"
                error={submitAttempted && !form.category_id}
                disabled={isLocked || Boolean(initialValue?.id)}
                onChange={selectCategory}
              />
            </Field>
          ) : null}
          <Field label="Check Date">
            <input className={inputClass()} type="date" value={form.check_date || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, check_date: event.target.value }))} />
          </Field>
          <Field label="Reference">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{form.check_no || "Generated on save"}</div>
          </Field>
        </div>
        <Card title={`${itemLabel} Count`} description={isLocked ? "Submitted and approved checks are locked snapshots." : "Draft system quantity refreshes from current stock before submission. Submit locks the snapshot for approval."}>
          {isRaw && !form.category_id ? <EmptyState title="Select a category to start stock check." description="Choose a raw material category before loading items to count." /> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                  <th className="px-4 py-2.5">{itemLabel}</th>
                  <th className="px-4 py-2.5">System Qty</th>
                  <th className="px-4 py-2.5">Count Status</th>
                  <th className="px-4 py-2.5">Physical Count</th>
                  <th className="px-4 py-2.5">Variance Qty</th>
                  <th className="px-4 py-2.5">Variance %</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Reason</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((row) => {
                  const isSkipped = row.count_status === "skip";
                  const hasCount = row.physical_qty !== "" && row.physical_qty != null;
                  const variance = isSkipped || !hasCount ? { variance: 0, variancePercent: 0, status: isSkipped ? "Skipped" : "Normal" } : stockCheckVariance(row.system_qty, row.physical_qty);
                  const showReasonError = submitAttempted && lastSubmitAction === "submitted" && ((variance.status !== "Normal" && !isSkipped) || isSkipped) && !String(row.variance_reason || "").trim();
                  const showCountError = submitAttempted && lastSubmitAction === "submitted" && !isSkipped && !hasCount;
                  return (
                    <tr key={row.id} className={`border-b border-border last:border-0 ${showReasonError ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-text-primary">{row.item_name || "Item"}</div>
                        <div className="text-xs text-text-secondary">{row.uom || "uom"}</div>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.system_qty, row.uom)}</td>
                      <td className="px-4 py-3">
                        <div className="inline-flex rounded-lg border border-border bg-white p-1">
                          <button className={`rounded-md px-2 py-1 text-xs font-semibold ${!isSkipped ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" disabled={isLocked} onClick={() => updateRow(row.id, { count_status: "counted" })}>Counted</button>
                          <button className={`rounded-md px-2 py-1 text-xs font-semibold ${isSkipped ? "bg-amber-500 text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" disabled={isLocked} onClick={() => updateRow(row.id, { count_status: "skip", physical_qty: "" })}>Skip</button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showCountError || (submitAttempted && Number(row.physical_qty || 0) < 0))}
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={isLocked || isSkipped}
                          placeholder={isSkipped ? "Skipped" : "Count qty"}
                          value={row.physical_qty}
                          onChange={(event) => updateRow(row.id, { physical_qty: event.target.value })}
                        />
                        {showCountError ? <div className="mt-1 text-xs font-semibold text-rose-600">Required before submit.</div> : null}
                      </td>
                      <td className={`px-4 py-3 text-sm font-semibold ${variance.variance > 0 ? "text-amber-600" : variance.variance < 0 ? "text-rose-600" : "text-text-secondary"}`}>
                        {quantity(variance.variance, row.uom)}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{percent(variance.variancePercent)}</td>
                      <td className="px-4 py-3"><Badge tone={variance.status === "Skipped" ? "neutral" : stockVarianceTone(variance.status)}>{variance.status}</Badge></td>
                      <td className="px-4 py-3">
                        <input
                          className={inputClass(showReasonError)}
                          disabled={isLocked}
                          placeholder={isSkipped ? "Skip reason required" : variance.status === "Normal" ? "Optional" : "Reason required"}
                          value={row.variance_reason || ""}
                          onChange={(event) => updateRow(row.id, { variance_reason: event.target.value })}
                        />
                        {showReasonError ? <div className="mt-1 text-xs font-semibold text-amber-700">{isSkipped ? "Required when skipped." : "Required for Warning/Critical."}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!form.items.length ? <EmptyState title="No stock items" description="Create inventory records before running stock check." /> : null}
        </Card>
        <Field label="Notes">
          <textarea className={inputClass()} rows={3} disabled={isLocked} value={form.notes || ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}

export default function FactoryWorkspacePage({ initialTab = "dashboard", ui, auth }) {
  const [data, setData] = useState({ jobOrders: [], rawMaterials: [], rawMaterialCategories: [], rawMaterialMovements: [], receivings: [], receivingBatches: [], factorySuppliers: [], factoryCustomers: [], productions: [], finishedGoods: [], finishedGoodCategories: [], productFamilies: [], productMovements: [], finishedGoodDispatches: [], rawStockChecks: [], productStockChecks: [], recipes: [], sops: [], accessIssues: [] });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [receivingTab, setReceivingTab] = useState("history");
  const [dispatchTab, setDispatchTab] = useState("history");
  const [expandedProductGroups, setExpandedProductGroups] = useState({});
  const [finishedGoodActionMenu, setFinishedGoodActionMenu] = useState(null);
  const [packagingSkuActionMenu, setPackagingSkuActionMenu] = useState(null);
  const [warehouseFilters, setWarehouseFilters] = useState({ product: "", family: "", category: "", status: "", batch: "", movementType: "" });
  const [rawMaterialFilters, setRawMaterialFilters] = useState({ material: "", status: "", category: "" });
  const [rawMovementFilters, setRawMovementFilters] = useState({ material: "", movementType: "", storageLocation: "", dateFrom: "", dateTo: "", search: "" });
  const can = (code) => Boolean(auth?.hasPermission?.(code));

  async function loadData() {
    setLoading(true);
    try {
      const nextData = await factoryService.listFactoryData({
        scope: initialTab,
        hasPermission: (code) => auth?.hasPermission?.(code),
      });
      setData(nextData);
    } catch (error) {
      ui?.notify?.({ title: "Failed to load Factory data", message: error.message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [initialTab, auth?.permissions?.length]);

  const metrics = useMemo(() => {
    const openJobs = data.jobOrders.filter((job) => !["completed", "cancelled"].includes(job.status));
    const draftJobs = data.jobOrders.filter((job) => job.status === "draft");
    const releasedJobs = data.jobOrders.filter((job) => job.status === "released" || job.status === "planned");
    const inProgressJobs = data.jobOrders.filter((job) => job.status === "in_progress");
    const today = todayInput();
    const overdueJobs = data.jobOrders.filter((job) => job.due_date && job.due_date < today && !["completed", "cancelled"].includes(job.status));
    const completedJobs = data.jobOrders.filter((job) => job.status === "completed");
    const completedTodayJobs = data.jobOrders.filter((job) => job.status === "completed" && (job.completed_at || job.updated_at || "").slice(0, 10) === today);
    const lowStock = data.rawMaterials.filter((item) => item.status === "active" && Number(item.current_balance || 0) > 0 && Number(item.current_balance || 0) <= Number(item.min_stock_level || 0));
    const receivingValue = data.receivings.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
    const completedProductions = data.productions.filter((production) => production.status === "completed");
    const totalGoodOutput = completedProductions.reduce((sum, row) => sum + Number(row.good_output_qty || row.produced_quantity || 0), 0);
    const totalWastage = completedProductions.reduce((sum, row) => sum + Number(row.wastage_qty || 0), 0);
    const highVarianceUsage = completedProductions.flatMap((production) => production.material_usage || []).filter((row) => Math.abs(Number(row.variance_percent || 0)) > varianceThresholdPercent);
    const allStockChecks = [
      ...data.rawStockChecks.map((check) => ({ ...check, stockType: "raw" })),
      ...data.productStockChecks.map((check) => ({ ...check, stockType: "product" })),
    ];
    const submittedStockChecks = allStockChecks.filter((check) => check.status === "submitted");
    const approvedStockChecks = allStockChecks.filter((check) => check.status === "approved");
    const stockCheckVarianceRows = allStockChecks.flatMap((check) => (check.items || []).map((item) => ({ ...item, check }))).filter((item) => item.variance_status !== "Normal" && item.variance_status !== "Skipped");
    const criticalStockCheckRows = stockCheckVarianceRows.filter((item) => item.variance_status === "Critical");
    const qcAlertBatches = completedProductions.filter((production) => ["Pending", "Hold", "Failed"].includes(production.qc_status));
    const totalActualProduced = completedProductions.reduce((sum, row) => sum + Number(row.actual_produced_qty || row.produced_quantity || 0), 0);
    const productionYield = totalActualProduced ? (totalGoodOutput / totalActualProduced) * 100 : 0;
    const materialVariancePercent = weightedMaterialVariancePercent(completedProductions);
    const estimatedProductionCost = completedProductions.reduce((sum, row) => sum + productionCost(row, data.receivings), 0);
    const recipeCostRows = data.recipes.filter((recipe) => recipe.status === "active").map((recipe) => {
      const cost = recipeCostInfo(recipe, data.receivings);
      return { ...recipe, ...cost };
    });
    const recipeByFinishedGood = new Map(recipeCostRows.filter((recipe) => recipe.finished_good_id).map((recipe) => [recipe.finished_good_id, recipe]));
    const recipeByProductFamily = new Map(recipeCostRows.filter((recipe) => recipe.product_family_id).map((recipe) => [recipe.product_family_id, recipe]));
    const recipeByProduct = new Map(recipeCostRows.map((recipe) => [String(recipe.product_name || "").toLowerCase(), recipe]));
    const productionCostRows = completedProductions.map((production) => {
      const recipe = recipeByProductFamily.get(production.product_family_id) || recipeByFinishedGood.get(production.finished_good_id) || recipeByProduct.get(String(production.product_name || "").toLowerCase());
      const actualCost = productionCostInfo(production, data.receivings);
      const standardCost = recipe ? Number(recipe.costPerUnit || 0) * Number(production.good_output_qty || production.actual_produced_qty || production.produced_quantity || 0) : 0;
      const variance = costVarianceInfo(standardCost, actualCost.cost);
      return {
        ...production,
        recipe_code: recipe?.recipe_code || "",
        standard_cost: standardCost,
        actual_cost: actualCost.cost,
        variance_rm: variance.variance,
        variance_percent: variance.variancePercent,
        missing_cost_rows: actualCost.missingCostRows + (recipe?.missingCostRows || 0),
      };
    });
    const totalStandardCost = productionCostRows.reduce((sum, row) => sum + Number(row.standard_cost || 0), 0);
    const totalActualCost = productionCostRows.reduce((sum, row) => sum + Number(row.actual_cost || 0), 0);
    const totalMissingCostRows = productionCostRows.reduce((sum, row) => sum + Number(row.missing_cost_rows || 0), 0);
    const costVariance = costVarianceInfo(totalStandardCost, totalActualCost);
    const mostExpensiveRecipe = [...recipeCostRows].sort((a, b) => Number(b.standardCost || 0) - Number(a.standardCost || 0))[0] || null;
    const receivingByMaterial = new Map();
    data.receivings.forEach((row) => {
      if (Number(row.unit_cost || 0) <= 0) return;
      const rows = receivingByMaterial.get(row.raw_material_id) || [];
      rows.push(row);
      receivingByMaterial.set(row.raw_material_id, rows);
    });
    const costIncreaseRows = [...receivingByMaterial.entries()].map(([rawMaterialId, rows]) => {
      const sorted = rows.sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0));
      const latest = sorted[0];
      const previous = sorted[1];
      const increase = previous ? Number(latest.unit_cost || 0) - Number(previous.unit_cost || 0) : 0;
      const increasePercent = previous && Number(previous.unit_cost || 0) ? (increase / Number(previous.unit_cost || 0)) * 100 : 0;
      return {
        id: rawMaterialId,
        raw_material_name: latest?.raw_material_name || "Raw material",
        latest_cost: Number(latest?.unit_cost || 0),
        previous_cost: Number(previous?.unit_cost || 0),
        increase,
        increase_percent: increasePercent,
        supplier_name: latest?.supplier_name || "",
        received_date: latest?.received_date || "",
      };
    }).filter((row) => row.increase > 0);
    const highestCostIncreaseMaterial = costIncreaseRows.sort((a, b) => b.increase_percent - a.increase_percent || b.increase - a.increase)[0] || null;
    const varianceByMaterial = new Map();
    completedProductions.forEach((production) => {
      (production.material_usage || []).forEach((usage) => {
        const current = varianceByMaterial.get(usage.raw_material_id) || { id: usage.raw_material_id, raw_material_name: usage.raw_material_name || "Raw material", variance_qty: 0, variance_cost: 0, uom: usage.uom || "" };
        current.variance_qty += Number(usage.variance_qty || 0);
        current.variance_cost += Number(usage.variance_qty || 0) * usageUnitCost(usage, data.receivings);
        if (!current.uom) current.uom = usage.uom || "";
        varianceByMaterial.set(usage.raw_material_id, current);
      });
    });
    const topVarianceRawMaterials = [...varianceByMaterial.values()].sort((a, b) => Math.abs(b.variance_qty) - Math.abs(a.variance_qty)).slice(0, 5);
    return {
      openJobs,
      draftJobs,
      releasedJobs,
      inProgressJobs,
      overdueJobs,
      completedJobs,
      completedTodayJobs,
      lowStock,
      receivingValue,
      completedProductions,
      totalGoodOutput,
      totalWastage,
      highVarianceUsage,
      allStockChecks,
      submittedStockChecks,
      approvedStockChecks,
      stockCheckVarianceRows,
      criticalStockCheckRows,
      qcAlertBatches,
      productionYield,
      materialVariancePercent,
      estimatedProductionCost,
      topVarianceRawMaterials,
      recipeCostRows,
      productionCostRows,
      totalStandardCost,
      totalActualCost,
      totalMissingCostRows,
      costVariance,
      mostExpensiveRecipe,
      highestCostIncreaseMaterial,
    };
  }, [data]);

  async function saveJobOrder(form) {
    try {
      await factoryService.saveJobOrder(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Job order updated" : "Job order created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save job order", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function deleteJobOrder(order) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Job Order?",
      message: `${order.job_order_no || order.product_name} will be removed. This action cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteJobOrder(order);
      ui?.notify?.({ title: "Job order deleted", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete job order", message: error.message, tone: "error" });
    }
  }

  async function releaseJobOrder(order) {
    const confirmed = await ui?.confirm?.({
      title: "Release Job Order?",
      message: `${order.job_order_no} will become available for production start. Inventory will not be adjusted.`,
      confirmLabel: "Release",
      tone: "info",
    });
    if (!confirmed) return;
    try {
      await factoryService.releaseJobOrder(order, auth?.profile?.id);
      ui?.notify?.({ title: "Job order released", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to release job order", message: error.message, tone: "error" });
    }
  }

  async function startJobOrder(order, form) {
    try {
      await factoryService.startJobOrder(order, form, auth?.profile?.id);
      ui?.notify?.({ title: "Production started", message: `${order.job_order_no} is now in progress.`, tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to start production", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function viewCompletedJobOrder(order) {
    try {
      const production = await factoryService.getProductionByJobOrder(order.id);
      setModal({ type: "completed-job-result", job: order, production });
    } catch (error) {
      ui?.notify?.({ title: "Unable to load production result", message: error.message, tone: "error" });
    }
  }

  async function saveReceivingBatch(form) {
    try {
      await factoryService.saveRawMaterialReceivingBatch(form, auth?.profile?.id);
      ui?.notify?.({ title: "Raw material receiving saved", message: "Supplier delivery items were recorded into raw material stock.", tone: "success" });
      setReceivingTab("history");
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material receiving", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveRawMaterial(form) {
    try {
      await factoryService.saveRawMaterial(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Raw material updated" : "Raw material created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveRawMaterial(material) {
    if (Number(material.current_balance || 0) > 0) {
      ui?.notify?.({ title: "Cannot archive raw material", message: "Cannot archive while stock balance is greater than zero.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Raw Material?",
      message: `${rawMaterialLabel(material)} will no longer be available for receiving, recipe BOM setup or production usage.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveRawMaterial(material);
      ui?.notify?.({ title: "Raw material archived", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive raw material", message: error.message, tone: "error" });
    }
  }

  async function saveRawMaterialCategory(form, options = {}) {
    try {
      await factoryService.saveRawMaterialCategory(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Raw material category updated" : "Raw material category created", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save raw material category", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveRawMaterialCategory(category, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Raw Material Category?",
      message: `${category.name} will remain on existing raw materials but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveRawMaterialCategory(category);
      ui?.notify?.({ title: "Raw material category archived", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive raw material category", message: error.message, tone: "error" });
    }
  }

  async function saveStorageLocation(form, options = {}) {
    try {
      await factoryService.saveStorageLocation(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Storage location updated" : "Storage location created", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save storage location", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveStorageLocation(location, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Storage Location?",
      message: `${location.location_name} will remain on existing records but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveStorageLocation(location);
      ui?.notify?.({ title: "Storage location archived", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive storage location", message: error.message, tone: "error" });
    }
  }

  async function saveFactorySupplier(form, options = {}) {
    try {
      await factoryService.saveFactorySupplier(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Factory supplier updated" : "Factory supplier created", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Factory supplier", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveFactorySupplier(supplier, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Factory Supplier?",
      message: `${supplier.supplier_name} will remain on historical receiving documents but cannot be selected for new receiving.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFactorySupplier(supplier);
      ui?.notify?.({ title: "Factory supplier archived", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Factory supplier", message: error.message, tone: "error" });
    }
  }

  async function saveFactoryCustomer(form, options = {}) {
    try {
      await factoryService.saveFactoryCustomer(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Factory customer updated" : "Factory customer created", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Factory customer", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveFactoryCustomer(customer, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Factory Customer?",
      message: `${customer.customer_name} will remain on historical dispatch documents but cannot be selected for new dispatch.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFactoryCustomer(customer);
      ui?.notify?.({ title: "Factory customer archived", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Factory customer", message: error.message, tone: "error" });
    }
  }

  async function completeProduction(form) {
    try {
      await factoryService.completeProduction(form, auth?.profile?.id);
      ui?.notify?.({ title: "Production completed", message: "Raw materials deducted and finished goods stocked in.", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to complete production", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveStockCheck(stockType, form) {
    try {
      await factoryService.saveStockCheck(stockType, form, auth?.profile?.id);
      ui?.notify?.({ title: form.status === "submitted" ? "Stock check submitted" : "Stock check draft saved", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save stock check", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveProductionSop(form) {
    try {
      await factoryService.saveProductionSop(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Production SOP updated" : "Production SOP created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Production SOP", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function saveProductRecipe(form) {
    try {
      await factoryService.saveProductRecipe(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Production standard updated" : "Production standard created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save production standard", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function openNewRecipeVersion(recipe) {
    try {
      const draftCopy = await factoryService.createProductRecipeNewVersion(recipe);
      ui?.notify?.({ title: "Draft version created", tone: "success" });
      setModal({ type: "recipe", value: draftCopy });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to create new version", message: error.message, tone: "error" });
    }
  }

  async function activateProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Activate Product Recipe?",
      message: `${recipe.recipe_name || recipe.recipe_code} will become the production default for ${recipe.product_name}.`,
      confirmLabel: "Activate",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.activateProductRecipe(recipe);
      ui?.notify?.({ title: "Product recipe activated", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to activate product recipe", message: error.message, tone: "error" });
    }
  }

  async function archiveProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Product Recipe?",
      message: `${recipe.recipe_name || recipe.recipe_code} will remain readable for history but will not prefill production usage.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveProductRecipe(recipe);
      ui?.notify?.({ title: "Product recipe archived", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive product recipe", message: error.message, tone: "error" });
    }
  }

  async function deleteProductRecipe(recipe) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Draft Standard?",
      message: `${recipe.recipe_name || recipe.recipe_code} is still a draft and will be removed with its BOM rows.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteProductRecipe(recipe);
      ui?.notify?.({ title: "Draft production standard deleted", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete draft standard", message: error.message, tone: "error" });
    }
  }

  async function saveFinishedGood(form) {
    try {
      await factoryService.saveFinishedGood(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Packaging SKU updated" : "Packaging SKU created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Packaging SKU", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveFinishedGood(product) {
    if (Number(product.current_balance || 0) > 0) {
      ui?.notify?.({ title: "Cannot archive Packaging SKU", message: "Cannot archive while stock balance is greater than zero.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Packaging SKU?",
      message: `${product.product_code || product.product_name} will no longer be available for production stock-in.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFinishedGood(product);
      ui?.notify?.({ title: "Packaging SKU archived", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Packaging SKU", message: error.message, tone: "error" });
    }
  }

  async function saveFinishedGoodDispatch(form) {
    try {
      await factoryService.saveFinishedGoodDispatch(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Dispatch updated" : "Dispatch draft created", tone: "success" });
      setModal(null);
      if (!form.id) setDispatchTab("history");
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save dispatch", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function completeFinishedGoodDispatch(dispatch) {
    const confirmed = await ui?.confirm?.({
      title: "Complete Finished Goods Dispatch?",
      message: `${dispatch.dispatch_no} will deduct finished goods stock and create Product Movement stock-out rows.`,
      confirmLabel: "Complete Dispatch",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.completeFinishedGoodDispatch(dispatch);
      ui?.notify?.({ title: "Dispatch completed", message: "Finished goods stock-out movement created.", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to complete dispatch", message: error.message, tone: "error" });
    }
  }

  async function cancelFinishedGoodDispatch(dispatch) {
    const confirmed = await ui?.confirm?.({
      title: "Cancel Finished Goods Dispatch?",
      message: `${dispatch.dispatch_no} will be marked cancelled. Stock will not be adjusted.`,
      confirmLabel: "Cancel Dispatch",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.cancelFinishedGoodDispatch(dispatch);
      ui?.notify?.({ title: "Dispatch cancelled", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to cancel dispatch", message: error.message, tone: "error" });
    }
  }

  async function saveProductGroup(form) {
    try {
      await factoryService.saveProductFamily(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Finished Good updated" : "Finished Good created", tone: "success" });
      setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save Finished Good", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveProductGroup(group) {
    const activeSkus = data.finishedGoods.filter((product) => product.product_family_id === group.id && product.status === "active");
    if (activeSkus.length) {
      ui?.notify?.({ title: "Cannot archive Finished Good", message: "Archive or move active Packaging SKUs before archiving this Finished Good.", tone: "error" });
      return;
    }
    const confirmed = await ui?.confirm?.({
      title: "Archive Finished Good?",
      message: `${group.name_en} will remain on existing Packaging SKUs but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveProductFamily(group);
      ui?.notify?.({ title: "Finished Good archived", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive Finished Good", message: error.message, tone: "error" });
    }
  }

  function openPackagingSkuModal(group, sku) {
    const category = data.finishedGoodCategories.find((item) => item.id === group?.category_id);
    setModal({
      type: "finished-good",
      value: sku || {
        product_family_id: group?.id || "",
        product_family_name: group?.name_en || "",
        product_name: group?.name_en || "",
        product_name_en: group?.name_en || "",
        product_name_cn: group?.name_cn || "",
        product_name_bm: group?.name_bm || "",
        category_id: group?.category_id || "",
        category: category?.name || group?.category || "",
        status: "active",
      },
    });
  }

  async function saveFinishedGoodCategory(form, options = {}) {
    try {
      await factoryService.saveFinishedGoodCategory(form, auth?.profile?.id);
      ui?.notify?.({ title: form.id ? "Finished good category updated" : "Finished good category created", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to save finished good category", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function archiveFinishedGoodCategory(category, options = {}) {
    const confirmed = await ui?.confirm?.({
      title: "Archive Finished Good Category?",
      message: `${category.name} will remain on existing products but cannot be selected for new active setup.`,
      confirmLabel: "Archive",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.archiveFinishedGoodCategory(category);
      ui?.notify?.({ title: "Finished good category archived", tone: "success" });
      if (!options.keepOpen) setModal(null);
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to archive finished good category", message: error.message, tone: "error" });
    }
  }

  async function approveStockCheck(stockType, check) {
    const label = stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check";
    const confirmed = await ui?.confirm?.({
      title: `Approve ${label}?`,
      message: `${check.check_no} will adjust inventory balances and create movement logs. Draft and submitted checks do not adjust stock until this approval.`,
      confirmLabel: "Approve",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      await factoryService.approveStockCheck(stockType, check, auth?.profile?.id);
      ui?.notify?.({ title: "Stock check approved", message: "Inventory adjustment movement created.", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to approve stock check", message: error.message, tone: "error" });
    }
  }

  async function deleteStockCheck(stockType, check) {
    const confirmed = await ui?.confirm?.({
      title: "Delete Draft Stock Check?",
      message: `${check.check_no || "Draft stock check"} will be removed. Submitted and approved stock checks cannot be deleted.`,
      confirmLabel: "Delete Draft",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await factoryService.deleteStockCheck(stockType, check);
      ui?.notify?.({ title: "Draft stock check deleted", tone: "success" });
      await loadData();
    } catch (error) {
      ui?.notify?.({ title: "Failed to delete stock check", message: error.message, tone: "error" });
    }
  }

  const dashboardActions = (
    <>
      <button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>
      {can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><ClipboardList size={15} /> Job Order</button> : null}
      {can("factory_raw_receiving.create") ? <a className="btn-secondary" href="/factory/raw-receiving"><Truck size={15} /> Receive Raw Material</a> : null}
      {can("factory_raw_stock_check.create") ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "raw" })}><ClipboardCheck size={15} /> Raw Check</button> : null}
    </>
  );

  const jobColumns = [
    { key: "job_order_no", label: "JO No", render: (row) => <div className="font-bold text-text-primary">{row.job_order_no}</div> },
    { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{jobFinishedGoodName(row)}</div><div className="text-xs text-text-secondary">{row.product_name_cn || row.product_name_bm || "Finished Good"}</div></div> },
    { key: "product_code", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{row.variant_name || packSizeText(row) || "Packaging SKU"}</div><div className="text-xs text-text-secondary">{row.product_code || "No SKU"}</div></div> },
    { key: "target", label: "Target Production", render: (row) => <div><div className="font-semibold text-text-primary">{quantity(row.target_production_qty || row.target_quantity, row.uom)}</div><div className="text-xs text-text-secondary">{quantity(row.target_pack_qty || 0, "packs")}</div></div> },
    { key: "planned_date", label: "Planned Date", render: (row) => row.planned_date || "—" },
    { key: "due_date", label: "Due Date", render: (row) => row.due_date || "—" },
    { key: "progress", label: "Progress", render: (row) => {
      const progress = jobProgressPercent(row);
      return (
        <div className="min-w-[110px]">
          <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
            <span>{progress}%</span>
            <span>{jobStatusLabel(row.status)}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${progressToneClass(progress)}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      );
    } },
    { key: "priority", label: "Priority", render: (row) => <Badge tone={row.priority === "Urgent" || row.priority === "High" ? "warning" : "neutral"}>{row.priority}</Badge> },
    { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        {row.status === "draft" && can("factory_job_orders.edit") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => releaseJobOrder(row)}>Release</button>
        ) : null}
        {row.status === "released" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "start-production", job: row })}><Play size={13} /> Start Production</button>
        ) : null}
        {row.status === "in_progress" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}>Complete</button>
        ) : null}
        {row.status === "draft" && can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row })}>Edit</button> : null}
        {row.status === "completed" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => viewCompletedJobOrder(row)}>View</button> : null}
        {row.status === "cancelled" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "job", value: row })}>View</button> : null}
        {row.status === "draft" && can("factory_job_orders.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteJobOrder(row)}>Delete</button> : null}
      </div>
    ) },
  ];

  const receivingBatchColumns = [
    { key: "received_date", label: "Received Date", render: (row) => row.received_date || "—" },
    { key: "reference_no", label: "Reference No.", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || row.batch_no}</div><div className="text-xs text-text-secondary">{row.batch_no}</div></div> },
    { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
    { key: "items_count", label: "Items Count", render: (row) => Number(row.items_count || 0).toLocaleString("en-MY") },
    { key: "total_qty", label: "Total Qty", render: (row) => quantity(row.total_qty, "") },
    { key: "created_by", label: "Created By", render: (row) => row.created_by_name || row.created_by || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "receiving-batch-detail", value: row })}>View Details</button>
      </div>
    ) },
  ];

  const factorySupplierColumns = [
    { key: "supplier_name", label: "Supplier", render: (row) => <div><div className="font-semibold text-text-primary">{row.supplier_name}</div><div className="text-xs text-text-secondary">{row.supplier_code || "No code"}</div></div> },
    { key: "contact_person", label: "Contact Person", render: (row) => row.contact_person || "—" },
    { key: "phone", label: "Phone", render: (row) => row.phone || "—" },
    { key: "email", label: "Email", render: (row) => row.email || "—" },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "remarks", label: "Remarks", render: (row) => row.remarks || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-2">
        {can("factory_suppliers.edit") || can("factory_suppliers.manage") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "factory-suppliers", value: row })}>Manage</button> : null}
      </div>
    ) },
  ];

  const factoryCustomerColumns = [
    { key: "customer_name", label: "Customer", render: (row) => <div><div className="font-semibold text-text-primary">{row.customer_name}</div><div className="text-xs text-text-secondary">{row.customer_code || "No code"}</div></div> },
    { key: "customer_type", label: "Type", render: (row) => row.customer_type || "Other" },
    { key: "contact_person", label: "Contact Person", render: (row) => row.contact_person || "—" },
    { key: "phone", label: "Phone", render: (row) => row.phone || "—" },
    { key: "email", label: "Email", render: (row) => row.email || "—" },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-2">
        {can("factory_customers.edit") || can("factory_customers.manage") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "factory-customers", value: row })}>Manage</button> : null}
      </div>
    ) },
  ];

  const rawMaterialInventoryColumns = [
    { key: "name", label: "Raw Material", render: (row) => <div><div className="font-bold text-text-primary">{rawMaterialLabel(row)}</div><div className="text-xs text-text-secondary">{[row.name_cn, row.name_bm].filter(Boolean).join(" · ") || "No CN/BM name"}</div></div> },
    { key: "material_code", label: "Code", render: (row) => row.material_code || "—" },
    { key: "category", label: "Category", render: (row) => row.category || "No category" },
    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
    { key: "current_balance", label: "Current Balance", render: (row) => quantity(row.current_balance, row.uom) },
    { key: "min_stock_level", label: "Min Stock", render: (row) => quantity(row.min_stock_level, row.uom) },
    { key: "last_receiving_date", label: "Last Receiving", render: (row) => row.last_receiving_date || "—" },
    { key: "last_consumption_date", label: "Last Consumption", render: (row) => row.last_consumption_date || "—" },
    { key: "status", label: "Status", render: (row) => (
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge>
        <Badge tone={row.stock_status === "Out of Stock" ? "danger" : row.stock_status === "Low Stock" ? "warning" : "success"}>{row.stock_status}</Badge>
      </div>
    ) },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "raw-material-detail", material: row })}>Detail</button>
        {can("factory_raw_inventory.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "raw-material", value: row })}>Edit</button> : null}
      </div>
    ) },
  ];

  const storageLocationColumns = [
    { key: "location_name", label: "Location", render: (row) => <div><div className="font-semibold text-text-primary">{row.location_name}</div><div className="text-xs text-text-secondary">{row.location_code || "No code"}</div></div> },
    { key: "location_type", label: "Type", render: (row) => row.location_type || "—" },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "remarks", label: "Remarks", render: (row) => row.remarks || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex justify-end gap-2">
        {can("factory_storage_locations.edit") || can("factory_storage_locations.manage") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "storage-locations", value: row })}>Manage</button> : null}
      </div>
    ) },
  ];

  const lowStockColumns = [
    { key: "name", label: "Raw Material", render: (row) => <div><div className="font-semibold text-text-primary">{rawMaterialLabel(row)}</div><div className="text-xs text-text-secondary">{row.category || "Uncategorized"} · {row.storage_location || "No location"}</div></div> },
    { key: "current_balance", label: "On Hand", render: (row) => quantity(row.current_balance, row.uom) },
    { key: "min_stock_level", label: "Min Stock", render: (row) => quantity(row.min_stock_level, row.uom) },
    { key: "status", label: "Status", render: () => <Badge tone="warning">Low Stock</Badge> },
  ];

  const productionColumns = [
    { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.product_name} · {row.batch_no || "No batch"}</div></div> },
    { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
    { key: "operator", label: "Operator", render: (row) => row.operator_name || "—" },
    { key: "output", label: "Output", render: (row) => <div><div className="font-semibold text-text-primary">{quantity(row.good_output_qty, row.uom)}</div><div className="text-xs text-text-secondary">Waste {quantity(row.wastage_qty, row.uom)}</div></div> },
    { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
    { key: "variance", label: "Variance", render: (row) => {
      const count = (row.material_usage || []).filter((item) => Math.abs(Number(item.variance_percent || 0)) > varianceThresholdPercent).length;
      return <Badge tone={count ? "warning" : "success"}>{count ? `${count} high` : "Normal"}</Badge>;
    } },
  ];

  const finishedGoodsColumns = [
    { key: "product_name", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_name}</div><div className="text-xs text-text-secondary">{row.category || "Uncategorized"}</div></div> },
    { key: "current_balance", label: "On Hand", render: (row) => skuBalanceLabel(row) },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
  ];

  const sopColumns = [
    { key: "sop", label: "SOP", render: (row) => <div><div className="font-bold text-text-primary">{row.sop_code}</div><div className="text-xs text-text-secondary">{row.title}</div></div> },
    { key: "product_name", label: "Product", render: (row) => row.product_name },
    { key: "version", label: "Version", render: (row) => <Badge tone="info">{row.version}</Badge> },
    { key: "steps", label: "Steps", render: (row) => row.steps?.length || 0 },
    { key: "qc", label: "QC Checkpoints", render: (row) => <Badge tone={row.steps?.some((step) => step.is_qc_checkpoint) ? "warning" : "neutral"}>{(row.steps || []).filter((step) => step.is_qc_checkpoint).length}</Badge> },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => can("factory_production_sop.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "sop", value: row })}>Edit</button> : null },
  ];

  const recipeColumns = [
    { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_name}</div><div className="text-xs text-text-secondary">{row.product_code || row.recipe_name || "Production Standard"}</div></div> },
    { key: "version", label: "Version", render: (row) => <Badge tone="info">{row.version || "v1"}</Badge> },
    { key: "production_quantity", label: "Production Quantity", render: (row) => quantity(row.yield_quantity, row.uom) },
    { key: "items", label: "Material Count", render: (row) => row.items?.length || 0 },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : row.status === "draft" ? "info" : "neutral"}>{row.status}</Badge> },
    { key: "updated_at", label: "Updated Date", render: (row) => row.updated_at ? String(row.updated_at).slice(0, 10) : "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "recipe-detail", value: row })}>View</button>
        {row.status === "draft" && can("factory_product_recipes.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "recipe", value: row })}>Edit</button> : null}
        {row.status === "draft" && can("factory_product_recipes.manage") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => activateProductRecipe(row)}>Activate</button> : null}
        {row.status === "draft" && can("factory_product_recipes.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteProductRecipe(row)}>Delete</button> : null}
        {row.status === "active" && can("factory_product_recipes.create") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => openNewRecipeVersion(row)}>New Version</button> : null}
        {row.status === "active" && can("factory_product_recipes.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => archiveProductRecipe(row)}>Archive</button> : null}
      </div>
    ) },
  ];

  function stockCheckColumns(stockType) {
    return [
      { key: "check", label: "Check", render: (row) => <div><div className="font-bold text-text-primary">{row.check_no}</div><div className="text-xs text-text-secondary">{row.check_date}</div></div> },
      { key: "items", label: "Items", render: (row) => row.items?.length || 0 },
      { key: "variance", label: "Variance", render: (row) => {
        const warningCount = (row.items || []).filter((item) => item.variance_status === "Warning").length;
        const criticalCount = (row.items || []).filter((item) => item.variance_status === "Critical").length;
        const skippedCount = (row.items || []).filter((item) => item.variance_status === "Skipped").length;
        if (criticalCount) return <Badge tone="danger">{criticalCount} critical</Badge>;
        if (warningCount) return <Badge tone="warning">{warningCount} warning</Badge>;
        if (skippedCount) return <Badge tone="neutral">{skippedCount} skipped</Badge>;
        return <Badge tone="success">Normal</Badge>;
      } },
      { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
      { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
      { key: "actions", label: "Actions", align: "right", render: (row) => (
        <div className="flex justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "stock-check", stockType, value: row })}>{row.status === "draft" ? "Edit" : "View"}</button>
          {row.status === "submitted" && can(stockType === "raw" ? "factory_raw_stock_check.approve" : "factory_product_stock_check.approve") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => approveStockCheck(stockType, row)}>Approve</button> : null}
          {row.status === "draft" && can(stockType === "raw" ? "factory_raw_stock_check.delete" : "factory_product_stock_check.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => deleteStockCheck(stockType, row)}>Delete</button> : null}
        </div>
      ) },
    ];
  }

  function finishedGoodRows() {
    return data.finishedGoods.map((product) => {
      const productKey = String(product.product_name || "").toLowerCase();
      const productProductions = data.productions.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
      const productMovements = data.productMovements.filter((row) => row.finished_good_id === product.id || String(row.product_name || "").toLowerCase() === productKey);
      const lastProduction = [...productProductions].sort((a, b) => new Date(b.production_date || b.created_at || 0) - new Date(a.production_date || a.created_at || 0))[0];
      const lastMovement = [...productMovements].sort((a, b) => new Date(b.movement_date || b.created_at || 0) - new Date(a.movement_date || a.created_at || 0))[0];
      return {
        ...product,
        last_production_date: lastProduction?.production_date || "",
        last_movement_date: lastMovement?.movement_date || "",
        production_count: productProductions.length,
        movement_count: productMovements.length,
        batch_count: new Set(productProductions.map((production) => production.batch_no).filter(Boolean)).size,
        latest_batch_no: lastProduction?.batch_no || "",
      };
    });
  }

  function filteredFinishedGoodRows() {
    return finishedGoodRows().filter((row) => {
      const productKey = String(row.product_name || "").toLowerCase();
      const productProductions = data.productions.filter((production) => String(production.product_name || "").toLowerCase() === productKey);
      const productMovements = data.productMovements.filter((movement) => movement.finished_good_id === row.id || String(movement.product_name || "").toLowerCase() === productKey);
      const batchMatch = !warehouseFilters.batch || productProductions.some((production) => includesText(production.batch_no, warehouseFilters.batch));
      const movementTypeMatch = !warehouseFilters.movementType || productMovements.some((movement) => movement.movement_type === warehouseFilters.movementType);
      const productText = `${row.product_family_name} ${row.product_name} ${row.product_name_en} ${row.product_name_cn} ${row.product_name_bm} ${row.product_code} ${row.variant_name}`;
      return includesText(productText, warehouseFilters.product)
        && (!warehouseFilters.family || row.product_family_id === warehouseFilters.family)
        && (!warehouseFilters.category || row.category_id === warehouseFilters.category)
        && (!warehouseFilters.status || row.status === warehouseFilters.status)
        && batchMatch
        && movementTypeMatch;
    });
  }

  function finishedGoodProductGroups() {
    const rows = filteredFinishedGoodRows();
    const categoryById = new Map(data.finishedGoodCategories.map((category) => [category.id, category]));
    const groups = data.productFamilies.map((family) => {
      const skus = rows.filter((row) => row.product_family_id === family.id);
      const baseBalance = packagingBaseBalanceInfo(skus);
      return {
        ...family,
        groupKey: family.id,
        product_group_name: family.name_en,
        category: family.category || categoryById.get(family.category_id)?.name || "No category",
        skus,
        active_sku_count: skus.filter((sku) => sku.status === "active").length,
        total_base_balance: baseBalance,
      };
    });
    rows.filter((row) => !row.product_family_id).forEach((sku) => {
      const baseBalance = packagingBaseBalanceInfo([sku]);
      groups.push({
        id: `__sku_${sku.id}`,
        groupKey: `__sku_${sku.id}`,
        product_group_name: sku.product_name_en || sku.product_name || sku.product_code || "Unassigned Finished Good",
        category: sku.category || "No category",
        category_id: sku.category_id || "",
        status: sku.status || "active",
        skus: [sku],
        active_sku_count: sku.status === "active" ? 1 : 0,
        total_base_balance: baseBalance,
        isStandalone: true,
      });
    });
    return groups.filter((group) => {
      const groupText = `${group.product_group_name} ${group.name_cn || ""} ${group.name_bm || ""}`;
      const groupNameMatches = includesText(groupText, warehouseFilters.product);
      const matchesProductSearch = groupNameMatches || group.skus.length > 0;
      const matchesFamily = !warehouseFilters.family || group.id === warehouseFilters.family;
      const matchesCategory = !warehouseFilters.category || group.category_id === warehouseFilters.category || group.skus.some((sku) => sku.category_id === warehouseFilters.category);
      const matchesStatus = !warehouseFilters.status || group.status === warehouseFilters.status || group.skus.some((sku) => sku.status === warehouseFilters.status);
      const canShowEmptyGroup = !warehouseFilters.batch && !warehouseFilters.movementType && (!warehouseFilters.product || groupNameMatches);
      return matchesProductSearch && matchesFamily && matchesCategory && matchesStatus && (group.skus.length > 0 || canShowEmptyGroup);
    });
  }

  function filteredProductMovements() {
    return data.productMovements.filter((row) => {
      const linkedProduction = data.productions.find((production) => production.id === row.reference_id || production.production_no === row.reference_no);
      const batchMatch = !warehouseFilters.batch || includesText(linkedProduction?.batch_no, warehouseFilters.batch) || includesText(row.reference_no, warehouseFilters.batch);
      return includesText(row.product_name, warehouseFilters.product)
        && (!warehouseFilters.movementType || row.movement_type === warehouseFilters.movementType)
        && batchMatch;
    });
  }

  function warehouseFilterControls({ showStatus = true } = {}) {
    const statuses = [...new Set(data.finishedGoods.map((row) => row.status).filter(Boolean))];
    const movementTypes = [...new Set(data.productMovements.map((row) => row.movement_type).filter(Boolean))];
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 md:grid-cols-6">
        <Field label="Product">
          <input className={inputClass()} value={warehouseFilters.product} onChange={(event) => setWarehouseFilters((current) => ({ ...current, product: event.target.value }))} placeholder="Search product" />
        </Field>
        <Field label="Finished Good">
          <select className={inputClass()} value={warehouseFilters.family} onChange={(event) => setWarehouseFilters((current) => ({ ...current, family: event.target.value }))}>
            <option value="">All finished goods</option>
            {data.productFamilies.map((family) => <option key={family.id} value={family.id}>{family.name_en}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputClass()} value={warehouseFilters.category} onChange={(event) => setWarehouseFilters((current) => ({ ...current, category: event.target.value }))}>
            <option value="">All categories</option>
            {data.finishedGoodCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        {showStatus ? (
          <Field label="Status">
            <select className={inputClass()} value={warehouseFilters.status} onChange={(event) => setWarehouseFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Batch">
          <input className={inputClass()} value={warehouseFilters.batch} onChange={(event) => setWarehouseFilters((current) => ({ ...current, batch: event.target.value }))} placeholder="Search batch/source" />
        </Field>
        <Field label="Movement Type">
          <select className={inputClass()} value={warehouseFilters.movementType} onChange={(event) => setWarehouseFilters((current) => ({ ...current, movementType: event.target.value }))}>
            <option value="">All movements</option>
            {movementTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button className="btn-secondary w-full" type="button" onClick={() => setWarehouseFilters({ product: "", family: "", category: "", status: "", batch: "", movementType: "" })}>Clear</button>
        </div>
      </div>
    );
  }

  function rawMaterialRows() {
    return data.rawMaterials.map((material) => {
      const materialReceivings = data.receivings.filter((row) => row.raw_material_id === material.id);
      const materialMovements = data.rawMaterialMovements.filter((row) => row.raw_material_id === material.id);
      const consumptionRows = materialMovements.filter((row) => Number(row.quantity || 0) < 0 || String(row.movement_type || "").toLowerCase().includes("production"));
      const lastReceiving = [...materialReceivings].sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0))[0];
      const lastConsumption = [...consumptionRows].sort((a, b) => new Date(b.movement_date || b.created_at || 0) - new Date(a.movement_date || a.created_at || 0))[0];
      const balance = Number(material.current_balance || 0);
      const minStock = Number(material.min_stock_level || 0);
      return {
        ...material,
        last_receiving_date: lastReceiving?.received_date || "",
        last_consumption_date: lastConsumption?.movement_date || "",
        stock_status: balance <= 0 ? "Out of Stock" : minStock > 0 && balance <= minStock ? "Low Stock" : "In Stock",
      };
    });
  }

  function filteredRawMaterialRows() {
    return rawMaterialRows().filter((row) => includesText(`${row.name} ${row.name_en} ${row.name_cn} ${row.name_bm} ${row.material_code}`, rawMaterialFilters.material)
      && (!rawMaterialFilters.status || row.status === rawMaterialFilters.status)
      && (!rawMaterialFilters.category || row.category_id === rawMaterialFilters.category || row.category === rawMaterialFilters.category));
  }

  function rawMaterialMovementRows() {
    return data.rawMaterialMovements.map((movement) => {
      const material = data.rawMaterials.find((row) => row.id === movement.raw_material_id);
      const receiving = data.receivings.find((row) => row.id === movement.reference_id || row.receipt_no === movement.reference_no);
      return {
        ...movement,
        raw_material_code: material?.material_code || movement.raw_material_code || "",
        raw_material_name: movement.raw_material_name || rawMaterialLabel(material) || "",
        storage_location: receiving?.storage_location || movement.storage_location || material?.storage_location || "",
        batch_no: receiving?.batch_no || movement.batch_no || "",
        remarks: movement.remarks || movement.notes || "",
        created_by_name: movement.created_by_name || movement.created_by || "",
      };
    });
  }

  function filteredRawMaterialMovements() {
    return rawMaterialMovementRows().filter((row) => {
      const movementDate = row.movement_date || "";
      const searchText = `${row.reference_no} ${row.reference_type} ${row.batch_no} ${row.remarks} ${row.notes}`;
      return (!rawMovementFilters.material || row.raw_material_id === rawMovementFilters.material)
        && (!rawMovementFilters.movementType || row.movement_type === rawMovementFilters.movementType)
        && (!rawMovementFilters.storageLocation || row.storage_location === rawMovementFilters.storageLocation)
        && (!rawMovementFilters.dateFrom || movementDate >= rawMovementFilters.dateFrom)
        && (!rawMovementFilters.dateTo || movementDate <= rawMovementFilters.dateTo)
        && (!rawMovementFilters.search || includesText(searchText, rawMovementFilters.search));
    });
  }

  function rawMovementFilterControls() {
    const movementTypes = [...new Set(data.rawMaterialMovements.map((row) => row.movement_type).filter(Boolean))];
    const storageLocations = [...new Set(rawMaterialMovementRows().map((row) => row.storage_location).filter(Boolean))];
    const materialOptions = data.rawMaterials.map((material) => ({ value: material.id, label: rawMaterialLabel(material), helper: rawMaterialSummary(material) }));
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 lg:grid-cols-6">
        <Field label="Raw Material">
          <SearchableSelect
            value={rawMovementFilters.material}
            options={[{ value: "", label: "All Raw Materials", helper: "No material filter" }, ...materialOptions]}
            placeholder="All Raw Materials"
            searchPlaceholder="Search material"
            emptyText="No matching materials"
            onChange={(material) => setRawMovementFilters((current) => ({ ...current, material }))}
          />
        </Field>
        <Field label="Movement Type">
          <select className={inputClass()} value={rawMovementFilters.movementType} onChange={(event) => setRawMovementFilters((current) => ({ ...current, movementType: event.target.value }))}>
            <option value="">All movements</option>
            {movementTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>
        <Field label="Storage Location">
          <select className={inputClass()} value={rawMovementFilters.storageLocation} onChange={(event) => setRawMovementFilters((current) => ({ ...current, storageLocation: event.target.value }))}>
            <option value="">All locations</option>
            {storageLocations.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </Field>
        <Field label="Date From">
          <input className={inputClass()} type="date" value={rawMovementFilters.dateFrom} onChange={(event) => setRawMovementFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
        </Field>
        <Field label="Date To">
          <input className={inputClass()} type="date" value={rawMovementFilters.dateTo} onChange={(event) => setRawMovementFilters((current) => ({ ...current, dateTo: event.target.value }))} />
        </Field>
        <Field label="Search">
          <input className={inputClass()} value={rawMovementFilters.search} onChange={(event) => setRawMovementFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Reference, batch, remarks" />
        </Field>
        <div className="flex items-end lg:col-span-6">
          <button className="btn-secondary" type="button" onClick={() => setRawMovementFilters({ material: "", movementType: "", storageLocation: "", dateFrom: "", dateTo: "", search: "" })}>Clear Filters</button>
        </div>
      </div>
    );
  }

  function rawMaterialFilterControls() {
    const statuses = [...new Set(data.rawMaterials.map((row) => row.status).filter(Boolean))];
    const categories = data.rawMaterialCategories.length
      ? data.rawMaterialCategories
      : [...new Set(data.rawMaterials.map((row) => row.category).filter(Boolean))].map((name) => ({ id: name, name }));
    return (
      <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 md:grid-cols-4">
        <Field label="Raw Material">
          <input className={inputClass()} value={rawMaterialFilters.material} onChange={(event) => setRawMaterialFilters((current) => ({ ...current, material: event.target.value }))} placeholder="Search material/code" />
        </Field>
        <Field label="Status">
          <select className={inputClass()} value={rawMaterialFilters.status} onChange={(event) => setRawMaterialFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </Field>
        <Field label="Category">
          <select className={inputClass()} value={rawMaterialFilters.category} onChange={(event) => setRawMaterialFilters((current) => ({ ...current, category: event.target.value }))}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id || category.name} value={category.id || category.name}>{category.name}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <button className="btn-secondary w-full" type="button" onClick={() => setRawMaterialFilters({ material: "", status: "", category: "" })}>Clear</button>
        </div>
      </div>
    );
  }

  const recentActivity = useMemo(() => {
    const productionRows = data.productions.map((row) => ({
      id: `production-${row.id}`,
      title: "Production Completed",
      description: `${row.production_no || "Production"} · ${row.product_name}`,
      timestamp: row.completed_at || row.created_at,
      tone: "success",
    }));
    const receivingRows = data.receivings.map((row) => ({
      id: `receiving-${row.id}`,
      title: "Raw Material Received",
      description: `${row.receipt_no} · ${row.raw_material_name}`,
      timestamp: row.created_at,
      tone: "info",
    }));
    const jobRows = data.jobOrders.map((row) => ({
      id: `job-${row.id}`,
      title: row.status === "completed" ? "Job Order Completed" : "Job Order Updated",
      description: `${row.job_order_no} · ${row.product_name}`,
      timestamp: row.updated_at || row.created_at,
      tone: row.status === "completed" ? "success" : "neutral",
    }));
    const rawStockRows = data.rawStockChecks.flatMap((row) => [
      row.submitted_at ? {
        id: `raw-stock-submitted-${row.id}`,
        title: "Raw Stock Check Submitted",
        description: `${row.check_no} · ${row.items?.length || 0} item(s)`,
        timestamp: row.submitted_at,
        tone: "info",
      } : null,
      row.approved_at ? {
        id: `raw-stock-approved-${row.id}`,
        title: "Raw Stock Check Approved",
        description: `${row.check_no} · adjustment movement created`,
        timestamp: row.approved_at,
        tone: "success",
      } : null,
    ].filter(Boolean));
    const productStockRows = data.productStockChecks.flatMap((row) => [
      row.submitted_at ? {
        id: `product-stock-submitted-${row.id}`,
        title: "Finished Goods Check Submitted",
        description: `${row.check_no} · ${row.items?.length || 0} item(s)`,
        timestamp: row.submitted_at,
        tone: "info",
      } : null,
      row.approved_at ? {
        id: `product-stock-approved-${row.id}`,
        title: "Finished Goods Check Approved",
        description: `${row.check_no} · adjustment movement created`,
        timestamp: row.approved_at,
        tone: "success",
      } : null,
    ].filter(Boolean));
    return [...productionRows, ...receivingRows, ...jobRows, ...rawStockRows, ...productStockRows]
      .filter((row) => row.timestamp)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 8);
  }, [data.jobOrders, data.productions, data.productStockChecks, data.rawStockChecks, data.receivings]);

  function renderDashboard() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Factory Dashboard"
          description="Monitor production job orders, raw material receiving and warehouse readiness."
          actions={dashboardActions}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={CheckCircle2} label="Production Yield" value={percent(metrics.productionYield)} helper={`${quantity(metrics.totalGoodOutput, "")} good output`} tone={metrics.productionYield >= 90 ? "success" : "warning"} />
          <MetricCard icon={Activity} label="Material Variance" value={percent(metrics.materialVariancePercent)} helper="Usage-row variance; review UOM mix" tone={Math.abs(metrics.materialVariancePercent) > 5 ? "warning" : "success"} />
          <MetricCard icon={PackageCheck} label="Est. Production Cost" value={money(metrics.estimatedProductionCost)} helper="Actual usage cost" />
          <MetricCard icon={AlertTriangle} label="QC Alerts" value={metrics.qcAlertBatches.length} helper="Pending, hold or failed batches" tone={metrics.qcAlertBatches.length ? "danger" : "success"} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard
            icon={Truck}
            label="Highest Cost Increase"
            value={metrics.highestCostIncreaseMaterial ? percent(metrics.highestCostIncreaseMaterial.increase_percent) : "None"}
            helper={metrics.highestCostIncreaseMaterial?.raw_material_name || "No supplier cost increase"}
            tone={metrics.highestCostIncreaseMaterial ? "warning" : "success"}
          />
          <MetricCard
            icon={PackageCheck}
            label="Most Expensive Recipe"
            value={metrics.mostExpensiveRecipe ? costDisplay(metrics.mostExpensiveRecipe.standardCost, metrics.mostExpensiveRecipe.missingCostRows) : "Missing Cost"}
            helper={metrics.mostExpensiveRecipe?.product_name || "No active recipe cost"}
          />
          <MetricCard
            icon={Activity}
            label="Actual vs Standard"
            value={metrics.totalMissingCostRows ? "Missing Cost" : money(metrics.costVariance?.variance || 0)}
            helper={metrics.totalMissingCostRows ? "Complete receiving costs" : `${percent(metrics.costVariance?.variancePercent || 0)} cost variance`}
            tone={Math.abs(metrics.costVariance?.variancePercent || 0) > 5 ? "warning" : "success"}
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Open Job Orders" description="Factory production work that still needs action.">
            <FactoryTable columns={jobColumns.slice(0, 5)} rows={metrics.openJobs.slice(0, 6)} emptyTitle="No open job orders" emptyDescription="Create a job order to start production planning." />
          </Card>
          <Card title="Raw Material Low Stock" description="Materials that need attention before production.">
            <FactoryTable columns={lowStockColumns} rows={metrics.lowStock.slice(0, 6)} emptyTitle="No low stock raw materials" emptyDescription="Raw material stock is currently healthy." />
          </Card>
        </div>
        <Card title="Factory Smart Alerts" description="Operational signals from production, receiving and stock check approval.">
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <Factory size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Production Planning</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.openJobs.length ? `${metrics.openJobs.length} open job order(s) need follow-up.` : "No pending production demand."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <Warehouse size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Warehouse Readiness</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.lowStock.length ? `${metrics.lowStock.length} raw material(s) are at low stock.` : "Raw material stock is ready."}</p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <PackageCheck size={18} className="text-primary" />
              <div className="mt-3 text-sm font-bold text-text-primary">Stock Check Approval</div>
              <p className="mt-1 text-sm text-text-secondary">{metrics.submittedStockChecks.length ? `${metrics.submittedStockChecks.length} submitted stock check(s) awaiting approval.` : "No stock checks awaiting approval."}</p>
            </div>
          </div>
        </Card>
        <Card title="Batch QC Alerts" description="Batches with Pending, Hold or Failed QC status need follow-up outside stock check workflows.">
          <FactoryTable
            columns={[
              { key: "batch", label: "Batch", render: (row) => <div><div className="font-bold text-text-primary">{row.batch_no || "No batch"}</div><div className="text-xs text-text-secondary">{row.production_no}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "production_date", label: "Date", render: (row) => row.production_date || "—" },
              { key: "operator", label: "Operator", render: (row) => row.operator_name || "—" },
              { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
            ]}
            rows={metrics.qcAlertBatches.slice(0, 8)}
            emptyTitle="No batch QC alerts"
            emptyDescription="Completed production batches with QC Pass are clear."
          />
        </Card>
        <Card title="Top Variance Raw Materials" description="Ranked by absolute actual-vs-standard usage variance per material. Costing uses actual usage and receiving cost where available.">
          <FactoryTable
            columns={[
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "variance_qty", label: "Variance Qty", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_cost", label: "Variance Cost", align: "right", render: (row) => money(row.variance_cost) },
            ]}
            rows={metrics.topVarianceRawMaterials}
            emptyTitle="No material variance yet"
            emptyDescription="Complete production with material usage to see variance analytics."
          />
        </Card>
        <Card title="Stock Check Variance Alerts" description="Physical count variance is separate from production recipe variance and actual usage.">
          <FactoryTable
            columns={[
              { key: "check", label: "Check", render: (row) => <div><div className="font-bold text-text-primary">{row.check.check_no}</div><div className="text-xs text-text-secondary">{row.check.stockType === "raw" ? "Raw Material" : "Finished Goods"}</div></div> },
              { key: "item_name", label: "Item", render: (row) => row.item_name },
              { key: "variance_qty", label: "Variance Qty", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_percent", label: "Variance %", render: (row) => percent(row.variance_percent) },
              { key: "variance_status", label: "Status", render: (row) => <Badge tone={stockVarianceTone(row.variance_status)}>{row.variance_status}</Badge> },
              { key: "variance_reason", label: "Reason", render: (row) => row.variance_reason || "—" },
            ]}
            rows={metrics.stockCheckVarianceRows.slice(0, 8)}
            emptyTitle="No stock check variance alerts"
            emptyDescription="Submitted and approved stock checks with variance above 2% will appear here."
          />
        </Card>
        <Card title="Recent Factory Activity" description="Latest job orders, raw receiving and production completion activity.">
          <div className="divide-y divide-border">
            {recentActivity.length ? recentActivity.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-4 py-3">
                <div className={`mt-0.5 rounded-full p-1.5 ${item.tone === "success" ? "bg-emerald-100 text-emerald-700" : item.tone === "info" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                  <Clock3 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-text-primary">{item.title}</div>
                  <div className="text-xs text-text-secondary">{item.description}</div>
                </div>
                <div className="text-xs font-semibold text-text-muted">{new Date(item.timestamp).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
            )) : <EmptyState title="No factory activity yet" description="Create job orders, receive raw materials or complete production to see activity." />}
          </div>
        </Card>
      </div>
    );
  }

  function renderJobOrders() {
    const today = todayInput();
    const productionByJobId = new Map(data.productions.map((production) => [production.job_order_id, production]));
    const completedTodayProductions = data.productions.filter((production) => {
      const completionDate = (production.completed_at || production.production_date || production.created_at || "").slice(0, 10);
      return production.status === "completed" && completionDate === today;
    });
    const outputTodayLabel = aggregateProductionOutput(completedTodayProductions);
    const plannedTodayJobs = data.jobOrders.filter((job) => (job.planned_date || job.due_date || "").slice(0, 10) === today && !["cancelled"].includes(job.status));
    const completedVsPlannedCount = plannedTodayJobs.length || metrics.completedTodayJobs.length;
    const completionRate = completedVsPlannedCount ? (metrics.completedTodayJobs.length / completedVsPlannedCount) * 100 : 0;
    const releasedBoardJobs = metrics.releasedJobs;
    const inProgressBoardJobs = metrics.inProgressJobs;
    const completedBoardJobs = metrics.completedTodayJobs;
    const productionActivity = [
      ...data.jobOrders.filter((job) => job.status === "in_progress" && (job.started_at || job.start_time)).map((job) => ({
        id: `start-${job.id}`,
        time: job.started_at || job.start_time,
        title: "Started Production",
        product: jobFinishedGoodName(job),
        tone: "warning",
      })),
      ...completedTodayProductions.map((production) => ({
        id: `complete-${production.id}`,
        time: production.completed_at || production.end_time || production.production_date,
        title: "Completed Production",
        product: production.product_name || data.jobOrders.find((job) => job.id === production.job_order_id)?.product_name || "Production",
        tone: "success",
      })),
    ]
      .filter((activity) => activity.time)
      .sort((a, b) => factoryActivitySortValue(b.time, today) - factoryActivitySortValue(a.time, today))
      .slice(0, 8);
    const overviewCards = [
      { label: "Released", value: releasedBoardJobs.length, helper: "Ready to start", tone: "border-blue-200 bg-blue-50 text-blue-800" },
      { label: "In Progress", value: inProgressBoardJobs.length, helper: "Currently running", tone: "border-amber-200 bg-amber-50 text-amber-800" },
      { label: "Completed Today", value: completedBoardJobs.length, helper: "Finished today", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
      { label: "Output Today", value: outputTodayLabel, helper: "Total kg/L produced today", tone: "border-slate-200 bg-white text-text-primary" },
      { label: "Completion Rate", value: percent(completionRate), helper: "Completed vs planned", tone: "border-primary/20 bg-primary/5 text-primary" },
    ];
    const boardColumns = [
      { key: "released", title: "Released", helper: "Ready to start", jobs: releasedBoardJobs, accent: "border-blue-200 bg-blue-50", badge: "info" },
      { key: "in_progress", title: "In Progress", helper: "Currently running", jobs: inProgressBoardJobs, accent: "border-amber-200 bg-amber-50", badge: "warning" },
      { key: "completed", title: "Completed Today", helper: "Finished today", jobs: completedBoardJobs, accent: "border-emerald-200 bg-emerald-50", badge: "success" },
    ];
    const renderBoardAction = (job) => {
      if (job.status === "released" && can("factory_production.complete")) {
        return <button className="btn-primary w-full justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "start-production", job })}><Play size={13} /> Start Production</button>;
      }
      if (job.status === "in_progress" && can("factory_production.complete")) {
        return <button className="btn-primary w-full justify-center px-3 py-2 text-xs" type="button" onClick={() => setModal({ type: "production", job })}>Complete Production</button>;
      }
      return null;
    };
    const renderJobCard = (job, columnKey) => {
      const progress = jobProgressPercent(job);
      const production = productionByJobId.get(job.id);
      return (
        <div key={job.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-xs font-black text-text-primary">{job.job_order_no}</div>
              <div className="mt-1 text-sm font-bold text-text-primary">{jobFinishedGoodName(job)}</div>
            </div>
            <Badge tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-[10.5px] font-semibold text-text-muted">Packaging SKU</div>
            <div className="mt-0.5 text-sm font-bold text-text-primary">{jobPackagingSkuLabel(job)}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
            <div className="rounded-xl border border-border px-3 py-2">
              <div className="text-text-muted">Target Production</div>
              <div className="mt-1 text-sm font-black text-text-primary">{quantity(job.target_production_qty || job.target_quantity, job.uom)}</div>
            </div>
            {columnKey === "completed" ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Output Qty</div>
                <div className="mt-1 text-sm font-black text-text-primary">{production ? productionOutputLabel(production) : quantity(job.produced_quantity || job.target_production_qty || job.target_quantity, job.uom)}</div>
              </div>
            ) : columnKey === "in_progress" ? (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Started Time</div>
                <div className="mt-1 text-sm font-black text-text-primary">{factoryTimeLabel(job.started_at || job.start_time)}</div>
              </div>
            ) : (
              <div className="rounded-xl border border-border px-3 py-2">
                <div className="text-text-muted">Status</div>
                <div className="mt-1 text-sm font-black text-blue-700">Ready to start</div>
              </div>
            )}
          </div>
          {columnKey === "completed" ? (
            <div className="mt-3 text-xs font-semibold text-text-secondary">Completed {factoryTimeLabel(job.completed_at || production?.completed_at || production?.end_time)}</div>
          ) : (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs font-bold text-text-secondary">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${progressToneClass(progress)}`} style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          <div className="mt-3">{renderBoardAction(job)}</div>
        </div>
      );
    };

    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Control Center"
          description="Plan, release, start and complete factory production job orders from one operational board."
          actions={can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "job" })}><ClipboardList size={15} /> Create Job Order</button> : null}
        />
        <div className="grid gap-3 lg:grid-cols-5">
          {overviewCards.map((card) => (
            <div key={card.label} className={`rounded-2xl border p-4 shadow-sm ${card.tone}`}>
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] opacity-80">{card.label}</div>
              <div className="mt-2 text-3xl font-black">{card.value}</div>
              <div className="mt-1 text-sm font-semibold opacity-85">{card.helper}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card title="Production Pipeline" description="Released jobs can start production. In-progress jobs are ready for completion confirmation.">
            <div className="grid gap-4 p-4 lg:grid-cols-3">
              {boardColumns.map((column) => (
                <div key={column.key} className={`rounded-2xl border p-3 ${column.accent}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-text-primary">{column.title}</div>
                      <div className="text-xs font-semibold text-text-secondary">{column.helper}</div>
                    </div>
                    <Badge tone={column.badge}>{column.jobs.length}</Badge>
                  </div>
                  <div className="space-y-3">
                    {column.jobs.length ? column.jobs.map((job) => renderJobCard(job, column.key)) : (
                      <div className="rounded-2xl border border-dashed border-border bg-white/80 px-3 py-6 text-center text-sm font-semibold text-text-secondary">
                        No {column.title.toLowerCase()} jobs.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Recent Production Activity" description="Latest start and completion events from job order and production records.">
            <div className="space-y-3 p-4">
              {productionActivity.length ? productionActivity.map((activity) => (
                <div key={activity.id} className="flex gap-3 rounded-2xl border border-border bg-white px-3 py-3">
                  <div className={`flex h-10 w-14 shrink-0 items-center justify-center rounded-xl text-xs font-black ${activity.tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {factoryTimeLabel(activity.time)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-text-primary">{activity.title}</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-text-secondary">{activity.product}</div>
                  </div>
                </div>
              )) : (
                <EmptyState title="No production activity today" description="Started and completed production events will appear here." />
              )}
            </div>
          </Card>
        </div>
        <Card title="Job Order Records" description={`Historical and current job order records. Showing ${data.jobOrders.length} job order(s).`}>
          <FactoryTable columns={jobColumns} rows={data.jobOrders} emptyTitle="No job orders" emptyDescription="Create a finished good product first, then plan production demand with a job order." />
        </Card>
      </div>
    );
  }

  function renderRawReceiving() {
    const activeSuppliers = data.factorySuppliers.filter((supplier) => supplier.status === "active");
    const totalItems = data.receivingBatches.reduce((sum, batch) => sum + Number(batch.items_count || 0), 0);
    const totalQty = data.receivingBatches.reduce((sum, batch) => sum + Number(batch.total_qty || 0), 0);
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Receiving"
          description="Record supplier delivery documents with multiple raw material item rows."
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Truck} label="Receiving Documents" value={data.receivingBatches.length} helper="Supplier delivery batches" />
          <MetricCard icon={PackageCheck} label="Items Received" value={totalItems} helper="Total item rows" />
          <MetricCard icon={Warehouse} label="Total Qty" value={quantity(totalQty, "")} helper="Across received items" />
          <MetricCard icon={Tag} label="Active Suppliers" value={activeSuppliers.length} helper="Available for receiving" />
        </div>

        <div className="inline-flex rounded-xl border border-border bg-white p-1">
          <button className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${receivingTab === "history" ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setReceivingTab("history")}>Receiving History</button>
          <button className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${receivingTab === "receive" ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setReceivingTab("receive")}>Receive Raw Material</button>
        </div>

        {receivingTab === "receive" ? (
          <RawReceivingEntryPanel
            rawMaterials={data.rawMaterials}
            suppliers={data.factorySuppliers}
            storageLocations={data.storageLocations}
            onSave={saveReceivingBatch}
          />
        ) : (
          <Card title="Receiving History" description={`Showing ${data.receivingBatches.length} receiving document(s).`}>
            <FactoryTable
              columns={receivingBatchColumns}
              rows={data.receivingBatches}
              emptyTitle="No raw material receiving"
              emptyDescription="Use Receive Raw Material to record a supplier delivery with one or more item rows."
            />
          </Card>
        )}
      </div>
    );
  }

  function renderSuppliers() {
    const activeSuppliers = data.factorySuppliers.filter((supplier) => supplier.status === "active");
    const archivedSuppliers = data.factorySuppliers.filter((supplier) => supplier.status === "archived");
    const withContact = data.factorySuppliers.filter((supplier) => supplier.contact_person || supplier.phone || supplier.email);
    return (
      <div className="space-y-5">
        <PageHeader
          section="System"
          title="Suppliers"
          description="Manage Factory supplier master data used by raw material receiving documents."
          actions={can("factory_suppliers.create") || can("factory_suppliers.manage") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "factory-suppliers" })}><Truck size={15} /> Supplier</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Truck} label="Total Suppliers" value={data.factorySuppliers.length} helper="Active and archived" />
          <MetricCard icon={CheckCircle2} label="Active" value={activeSuppliers.length} helper="Available for receiving" tone="success" />
          <MetricCard icon={Clock3} label="Archived" value={archivedSuppliers.length} helper="Historical suppliers" />
          <MetricCard icon={Tag} label="With Contact" value={withContact.length} helper="Phone, email or contact person" />
        </div>
        <Card title="Factory Supplier Master" description="Create, edit and archive suppliers for Factory raw material receiving.">
          <FactoryTable
            columns={factorySupplierColumns}
            rows={data.factorySuppliers}
            emptyTitle="No Factory suppliers"
            emptyDescription="Create a Factory supplier before recording raw material receiving documents."
          />
        </Card>
      </div>
    );
  }

  function renderCustomers() {
    const activeCustomers = data.factoryCustomers.filter((customer) => customer.status === "active");
    const archivedCustomers = data.factoryCustomers.filter((customer) => customer.status === "archived");
    const withContact = data.factoryCustomers.filter((customer) => customer.contact_person || customer.phone || customer.email);
    const customerTypes = new Set(data.factoryCustomers.map((customer) => customer.customer_type).filter(Boolean));
    return (
      <div className="space-y-5">
        <PageHeader
          section="System"
          title="Customers"
          description="Manage Factory customers and destinations used by finished goods dispatch documents."
          actions={can("factory_customers.create") || can("factory_customers.manage") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "factory-customers" })}><Truck size={15} /> Customer</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Truck} label="Total Customers" value={data.factoryCustomers.length} helper="Active and archived" />
          <MetricCard icon={CheckCircle2} label="Active" value={activeCustomers.length} helper="Available for dispatch" tone="success" />
          <MetricCard icon={Clock3} label="Archived" value={archivedCustomers.length} helper="Historical customers" />
          <MetricCard icon={Tag} label="Customer Types" value={customerTypes.size} helper={`${withContact.length} with contact details`} />
        </div>
        <Card title="Factory Customer Master" description="Create, edit and archive customers for Factory finished goods dispatch.">
          <FactoryTable
            columns={factoryCustomerColumns}
            rows={data.factoryCustomers}
            emptyTitle="No Factory customers"
            emptyDescription="Create a Factory customer before recording finished goods dispatch documents."
          />
        </Card>
      </div>
    );
  }

  function renderStorageLocations() {
    const activeLocations = data.storageLocations.filter((location) => location.status === "active");
    const archivedLocations = data.storageLocations.filter((location) => location.status === "archived");
    const byType = storageLocationTypes.map((type) => ({
      type,
      count: activeLocations.filter((location) => location.location_type === type).length,
    })).filter((row) => row.count > 0);
    return (
      <div className="space-y-5">
        <PageHeader
          section="System"
          title="Storage Locations"
          description="Manage Factory warehouse and production storage locations used by raw material and finished goods master records."
          actions={can("factory_storage_locations.create") || can("factory_storage_locations.manage") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "storage-locations" })}><Warehouse size={15} /> Storage Location</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Total Locations" value={data.storageLocations.length} helper="Active and archived" />
          <MetricCard icon={CheckCircle2} label="Active" value={activeLocations.length} helper="Available for selection" tone="success" />
          <MetricCard icon={Clock3} label="Archived" value={archivedLocations.length} helper="Historical locations" />
          <MetricCard icon={Tag} label="Location Types" value={byType.length} helper="Active type coverage" />
        </div>
        <Card title="Storage Location Master" description="Create, edit and archive storage locations for Factory master data.">
          <FactoryTable
            columns={storageLocationColumns}
            rows={data.storageLocations}
            emptyTitle="No storage locations"
            emptyDescription="Create storage locations before assigning warehouse locations to raw materials or finished goods."
          />
        </Card>
      </div>
    );
  }

  function renderRawMaterialMovements() {
    const rows = filteredRawMaterialMovements();
    const stockInRows = rows.filter((row) => Number(row.quantity || 0) > 0);
    const stockOutRows = rows.filter((row) => Number(row.quantity || 0) < 0);
    const movementColumns = [
      { key: "raw_material", label: "Raw Material", render: (row) => <div><div className="font-bold text-text-primary">{row.raw_material_name || "Raw Material"}</div><div className="text-xs text-text-secondary">{row.raw_material_code || "No SKU"}</div></div> },
      { key: "movement_type", label: "Movement Type", render: (row) => <Badge tone={Number(row.quantity || 0) >= 0 ? "success" : "warning"}>{row.movement_type || "Movement"}</Badge> },
      { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
      { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
      { key: "storage_location", label: "Storage Location", render: (row) => row.storage_location || "—" },
      { key: "batch_no", label: "Batch No.", render: (row) => row.batch_no || "—" },
      { key: "reference", label: "Reference / Source", render: (row) => <div><div className="font-semibold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.reference_type || "—"}</div></div> },
      { key: "movement_date", label: "Movement Date", render: (row) => row.movement_date || "—" },
      { key: "created_by", label: "Created By", render: (row) => row.created_by_name || "—" },
      { key: "remarks", label: "Remarks", render: (row) => row.remarks || "—" },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Movements"
          description="View raw material stock-in, stock-out and approved adjustment movement logs."
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={RefreshCw} label="Movements" value={rows.length} helper="Filtered movement rows" />
          <MetricCard icon={PackageCheck} label="Stock In" value={quantity(stockInRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), "")} helper="Positive movement qty" tone="success" />
          <MetricCard icon={Factory} label="Stock Out" value={quantity(Math.abs(stockOutRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)), "")} helper="Negative movement qty" tone={stockOutRows.length ? "warning" : "success"} />
          <MetricCard icon={Warehouse} label="Locations" value={new Set(rows.map((row) => row.storage_location).filter(Boolean)).size} helper="Locations in filtered rows" />
        </div>
        {rawMovementFilterControls()}
        <Card title="Raw Material Movement History" description="Read-only movement log from receiving, production usage and approved stock checks.">
          <FactoryTable
            columns={movementColumns}
            rows={rows}
            emptyTitle="No raw material movements"
            emptyDescription="Receiving, production actual usage and approved stock checks will create raw material movement rows."
          />
        </Card>
      </div>
    );
  }

  function renderRawInventory() {
    const rows = filteredRawMaterialRows();
    const activeRows = data.rawMaterials.filter((item) => item.status === "active");
    const totalStock = activeRows.reduce((sum, item) => sum + Number(item.current_balance || 0), 0);
    const lowStockItems = activeRows.filter((item) => Number(item.current_balance || 0) > 0 && Number(item.current_balance || 0) <= Number(item.min_stock_level || 0));
    const outOfStockItems = activeRows.filter((item) => Number(item.current_balance || 0) <= 0);
    const lowStockRows = rawMaterialRows().filter((item) => item.status === "active" && item.stock_status !== "In Stock").slice(0, 8);
    const recentReceiving = [...data.receivings].sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0)).slice(0, 8);
    const recentConsumption = data.rawMaterialMovements
      .filter((movement) => Number(movement.quantity || 0) < 0 || String(movement.movement_type || "").toLowerCase().includes("production"))
      .slice(0, 8);
    const canProduceRows = data.recipes.filter((recipe) => recipe.status === "active" && recipe.items?.length).map((recipe) => {
      const possibleUnits = recipe.items.map((item) => {
        const material = data.rawMaterials.find((raw) => raw.id === item.raw_material_id);
        const perRecipe = Number(item.quantity_used || 0) * (1 + Number(item.wastage_percent || 0) / 100);
        if (!material || perRecipe <= 0) return Infinity;
        return Math.floor(Number(material.current_balance || 0) / perRecipe) * Number(recipe.yield_quantity || 1);
      });
      const estimated = Math.max(0, Math.min(...possibleUnits.filter(Number.isFinite)));
      return { id: recipe.id, recipe_name: recipe.recipe_name || recipe.recipe_code, product_name: recipe.product_name, can_produce_qty: estimated, uom: recipe.uom };
    }).sort((a, b) => Number(a.can_produce_qty || 0) - Number(b.can_produce_qty || 0)).slice(0, 8);
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Inventory"
          description="Manage raw material master data and monitor live factory raw material balances."
          actions={(
            <div className="flex flex-wrap gap-2">
              {can("factory_raw_inventory.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "raw-material" })}><Package size={15} /> Raw Material</button> : null}
              {can("factory_raw_inventory.create") || can("factory_raw_inventory.edit") ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "raw-material-category" })}><Tag size={15} /> Category</button> : null}
            </div>
          )}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Total Raw Materials" value={activeRows.length} helper="Active master records" />
          <MetricCard icon={PackageCheck} label="Total Stock Qty" value={quantity(totalStock, "")} helper="Current balance total" />
          <MetricCard icon={AlertTriangle} label="Low Stock Items" value={lowStockItems.length} helper="Above zero, at or below min" tone={lowStockItems.length ? "warning" : "success"} />
          <MetricCard icon={Clock3} label="Out of Stock" value={outOfStockItems.length} helper="Current balance zero" tone={outOfStockItems.length ? "danger" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-4">
          <Card title="Low Stock List" description="Materials needing replenishment before production.">
            <FactoryTable columns={lowStockColumns} rows={lowStockRows} emptyTitle="No low stock raw materials" emptyDescription="Raw material stock is currently healthy." />
          </Card>
          <Card title="Recent Receiving" description="Latest supplier stock-in rows.">
            <FactoryTable
              columns={[
                { key: "receipt_no", label: "Receipt", render: (row) => <div><div className="font-bold text-text-primary">{row.receipt_no}</div><div className="text-xs text-text-secondary">{row.received_date}</div></div> },
                { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
                { key: "qty", label: "Qty", render: (row) => quantity(row.received_qty, row.uom) },
              ]}
              rows={recentReceiving}
              emptyTitle="No receiving yet"
              emptyDescription="Record receiving by selecting a Raw Material master record."
            />
          </Card>
          <Card title="Recent Consumption" description="Latest production usage and stock-out movements.">
            <FactoryTable
              columns={[
                { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.movement_date}</div></div> },
                { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
                { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
              ]}
              rows={recentConsumption}
              emptyTitle="No consumption yet"
              emptyDescription="Production actual usage deductions will appear here."
            />
          </Card>
          <Card title="Can Produce Estimate" description="Estimated output from active recipes and current raw stock.">
            <FactoryTable
              columns={[
                { key: "recipe_name", label: "Recipe", render: (row) => <div><div className="font-bold text-text-primary">{row.recipe_name}</div><div className="text-xs text-text-secondary">{row.product_name}</div></div> },
                { key: "can_produce_qty", label: "Estimate", render: (row) => quantity(row.can_produce_qty, row.uom) },
              ]}
              rows={canProduceRows}
              emptyTitle="No recipe estimate"
              emptyDescription="Create active Product Recipes to estimate production capacity from raw stock."
            />
          </Card>
        </div>
        {rawMaterialFilterControls()}
        <Card title="Raw Material Master and Inventory" description="Master records define valid materials. Balances are updated by receiving, production actual usage and approved stock checks.">
          <FactoryTable
            columns={rawMaterialInventoryColumns}
            rows={rows}
            emptyTitle="No raw materials"
            emptyDescription="Create a raw material before receiving stock or building Product Recipes."
          />
        </Card>
      </div>
    );
  }

  function renderRawStockCheck() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Raw Material"
          title="Raw Material Stock Check"
          description="Count raw material stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_raw_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "raw" })}><ClipboardCheck size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Raw Materials" value={data.rawMaterials.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={data.rawStockChecks.length} helper="Raw material checks" />
          <MetricCard icon={Clock3} label="Submitted" value={data.rawStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={data.rawStockChecks.some((row) => row.status === "submitted") ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Variance Rows" value={data.rawStockChecks.flatMap((row) => row.items || []).filter((item) => item.variance_status !== "Normal" && item.variance_status !== "Skipped").length} helper="Above 2%" tone="warning" />
        </div>
        <Card title="Raw Material Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          <FactoryTable columns={stockCheckColumns("raw")} rows={data.rawStockChecks} emptyTitle="No raw material stock checks" emptyDescription="Create a stock check to capture physical counts." />
        </Card>
      </div>
    );
  }

  function renderProductionSop() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Master Data"
          title="Production SOP"
          description="Manage standard process references, product steps and QC checkpoint flags."
          actions={can("factory_production_sop.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "sop" })}><FileText size={15} /> Create SOP</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="SOPs" value={data.sops.length} helper="Standard process references" />
          <MetricCard icon={Factory} label="Products" value={new Set(data.sops.map((sop) => sop.product_name)).size} helper="With SOP coverage" />
          <MetricCard icon={Activity} label="QC Checkpoints" value={data.sops.flatMap((sop) => sop.steps || []).filter((step) => step.is_qc_checkpoint).length} helper="Flagged SOP steps" />
          <MetricCard icon={CheckCircle2} label="Active SOPs" value={data.sops.filter((sop) => sop.status === "active").length} helper="Available for production" />
        </div>
        <Card title="Production SOP Records" description="SOPs are standard process references and do not represent actual production results.">
          <FactoryTable columns={sopColumns} rows={data.sops} emptyTitle="No Production SOPs" emptyDescription="Create SOP steps before attaching a standard process to production batches." />
        </Card>
      </div>
    );
  }

  function renderProductRecipes() {
    const draftRecipes = data.recipes.filter((recipe) => recipe.status === "draft");
    const activeRecipes = data.recipes.filter((recipe) => recipe.status === "active");
    const archivedRecipes = data.recipes.filter((recipe) => recipe.status === "archived");
    const familiesWithActiveRecipe = new Set(activeRecipes.map((recipe) => recipe.product_family_id).filter(Boolean));
    const activeFinishedGoodsWithoutRecipe = data.productFamilies.filter((product) => product.status === "active" && !familiesWithActiveRecipe.has(product.id));
    return (
      <div className="space-y-5">
        <PageHeader
          section="Master Data"
          title="Production Standards / BOM"
          description="Manage standard finished good output quantities, production time and raw material BOMs. Production uses active standards as default material usage."
          actions={can("factory_product_recipes.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "recipe" })}><BookOpen size={15} /> Create Standard</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Draft" value={draftRecipes.length} helper="Editable standard versions" />
          <MetricCard icon={CheckCircle2} label="Active" value={activeRecipes.length} helper="Production defaults" tone="success" />
          <MetricCard icon={PackageCheck} label="FG Without Recipe" value={activeFinishedGoodsWithoutRecipe.length} helper="Active Finished Goods needing BOM" tone={activeFinishedGoodsWithoutRecipe.length ? "warning" : "success"} />
          <MetricCard icon={Clock3} label="Archived" value={archivedRecipes.length} helper="Historical versions" />
        </div>
        <Card title="Production Standard Records" description="One Finished Good can have one active standard version. Drafts can be edited before activation. Click a row to view BOM details.">
          <FactoryTable
            columns={recipeColumns}
            rows={data.recipes}
            emptyTitle="No Production Standards"
            emptyDescription="Create a Production Standard / BOM to prefill production material usage."
            onRowClick={(row) => setModal({ type: "recipe-detail", value: row })}
          />
        </Card>
      </div>
    );
  }

  function renderProduction() {
    const recipeForJob = (job) => activeRecipeForSku(data.recipes, job.finished_good || job, job.product_name);
    const sopForJob = (job) => data.sops.find((sop) => sop.status !== "inactive" && sop.product_name.toLowerCase() === String(job.product_name || "").toLowerCase());
    const readinessForJob = (job) => {
      const recipe = recipeForJob(job);
      if (!recipe?.items?.length) return { label: "No recipe", tone: "warning" };
      const shortages = recipe.items.filter((item) => {
        const material = data.rawMaterials.find((raw) => raw.id === item.raw_material_id);
        const required = (Number(item.quantity_used || 0) * Number(job.target_production_qty || job.target_quantity || 0)) / (Number(recipe.yield_quantity || 1) || 1);
        return Number(material?.current_balance || 0) < required;
      });
      if (shortages.length) return { label: `${shortages.length} shortage`, tone: "danger" };
      return { label: "Ready", tone: "success" };
    };
    const readyJobs = data.jobOrders.filter((job) => ["released", "planned", "in_progress"].includes(job.status));
    const productionReadyJobColumns = [
      { key: "job", label: "Job Order", render: (row) => <div><div className="font-bold text-text-primary">{row.job_order_no}</div><div className="text-xs text-text-secondary">{row.priority} · {jobStatusLabel(row.status)}</div></div> },
      { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_name}</div><div className="text-xs text-text-secondary">{row.product_code || "No SKU"}</div></div> },
      { key: "target", label: "Target", render: (row) => <div><div className="font-semibold text-text-primary">{quantity(row.target_pack_qty || row.target_quantity, "packs")}</div><div className="text-xs text-text-secondary">{quantity(row.target_production_qty || row.target_quantity, row.uom)}</div></div> },
      { key: "due_date", label: "Due Date", render: (row) => row.due_date || "—" },
      { key: "recipe", label: "Recipe", render: (row) => {
        const recipe = recipeForJob(row);
        return <Badge tone={recipe ? "success" : "warning"}>{recipe ? recipe.recipe_code || "Available" : "Missing"}</Badge>;
      } },
      { key: "sop", label: "SOP", render: (row) => {
        const sop = sopForJob(row);
        return <Badge tone={sop ? "success" : "neutral"}>{sop ? sop.version || "Available" : "No SOP"}</Badge>;
      } },
      { key: "readiness", label: "RM Readiness", render: (row) => {
        const readiness = readinessForJob(row);
        return <Badge tone={readiness.tone}>{readiness.label}</Badge>;
      } },
      { key: "actions", label: "Actions", align: "right", render: (row) => can("factory_production.complete") ? (
        row.status === "in_progress"
          ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "production", job: row })}>Complete</button>
          : <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "start-production", job: row })}><Play size={13} /> Start</button>
      ) : null },
    ];
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Production Records"
          description="Execute job orders, capture actual material usage, deduct raw stock and stock in finished goods."
          actions={readyJobs[0] && can("factory_production.complete") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: readyJobs[0].status === "in_progress" ? "production" : "start-production", job: readyJobs[0] })}><Play size={15} /> Next Production Step</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Completed Runs" value={metrics.completedProductions.length} helper="Production completions" />
          <MetricCard icon={PackageCheck} label="Good Output" value={quantity(metrics.totalGoodOutput, "")} helper="Finished goods stocked in" />
          <MetricCard icon={AlertTriangle} label="Wastage Qty" value={quantity(metrics.totalWastage, "")} helper="Reported production wastage" tone={metrics.totalWastage ? "warning" : "success"} />
          <MetricCard icon={Activity} label="High Variance" value={metrics.highVarianceUsage.length} helper="Material rows above 5%" tone={metrics.highVarianceUsage.length ? "warning" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card title="Production Queue" description="Released jobs can be started. In Progress jobs can be completed.">
            <FactoryTable columns={productionReadyJobColumns} rows={readyJobs} emptyTitle="No jobs ready for production" emptyDescription="Release a draft job order before starting production." />
          </Card>
          <Card title="Finished Goods Stock" description="Balances created from completed production stock-in movements.">
            <FactoryTable columns={finishedGoodsColumns} rows={data.finishedGoods.slice(0, 8)} emptyTitle="No finished goods stock" emptyDescription="Complete production to stock in finished goods." />
          </Card>
        </div>
        <Card title="Production Completion History" description={`Showing ${data.productions.length} completed production record(s).`}>
          <FactoryTable columns={productionColumns} rows={data.productions} emptyTitle="No production records" emptyDescription="Start production from a job order to create the first record." />
        </Card>
        <Card title="Finished Goods Movements" description="Stock-in movements created by production completion.">
          <FactoryTable
            columns={[
              { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.movement_date}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "movement_type", label: "Movement", render: (row) => <Badge tone="success">{row.movement_type}</Badge> },
              { key: "quantity", label: "Quantity", render: (row) => quantity(row.quantity, row.uom) },
              { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
            ]}
            rows={data.productMovements}
            emptyTitle="No finished goods movements"
            emptyDescription="Completed production will create finished goods stock-in movements."
          />
        </Card>
      </div>
    );
  }

  function renderBatchTraceability() {
    const rows = data.productions.map((production) => {
      const job = data.jobOrders.find((item) => item.id === production.job_order_id);
      const stockInMovements = data.productMovements.filter((movement) => movement.reference_type === "production" && movement.reference_id === production.id);
      return { ...production, job, stockInMovements };
    });
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Batch Traceability"
          description="Trace a production batch across job order, SOP, raw material lots, QC and finished goods stock-in."
          actions={<button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Batches" value={rows.length} helper="Completed production runs" />
          <MetricCard icon={PackageCheck} label="Stock-In Links" value={rows.reduce((sum, row) => sum + row.stockInMovements.length, 0)} helper="Finished goods movements" />
          <MetricCard icon={Truck} label="Material Lots" value={rows.flatMap((row) => row.material_usage || []).filter((item) => item.raw_material_lot_no).length} helper="Lot-tagged usage rows" />
          <MetricCard icon={AlertTriangle} label="QC Alerts" value={metrics.qcAlertBatches.length} helper="Pending, hold or failed" tone={metrics.qcAlertBatches.length ? "danger" : "success"} />
        </div>
        <Card title="Batch Traceability Records" description="Batch traceability connects product, production, raw material usage and finished goods movement.">
          <div className="space-y-4 p-4">
            {rows.length ? rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">Batch No</div>
                    <div className="mt-1 text-lg font-bold text-text-primary">{row.batch_no || "No batch"}</div>
                    <div className="text-sm text-text-secondary">{row.product_name} · {row.production_no}</div>
                  </div>
                  <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div><div className="text-xs font-semibold text-text-muted">Job Order</div><div className="text-sm font-semibold text-text-primary">{row.job?.job_order_no || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">Production Date</div><div className="text-sm font-semibold text-text-primary">{row.production_date || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">Operator</div><div className="text-sm font-semibold text-text-primary">{row.operator_name || "—"}</div></div>
                  <div><div className="text-xs font-semibold text-text-muted">SOP Used</div><div className="text-sm font-semibold text-text-primary">{row.sop_title ? `${row.sop_title} ${row.sop_version}` : row.sop_version || "—"}</div></div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">Raw Material Lots Used</div>
                    <div className="mt-2 space-y-2">
                      {(row.material_usage || []).length ? row.material_usage.map((item) => (
                        <div key={item.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">{item.raw_material_name}</span> · {quantity(item.actual_usage, item.uom)} · Lot {item.raw_material_lot_no || "—"} {item.receiving_ref ? `· ${item.receiving_ref}` : ""}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No material usage rows.</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">Finished Goods Stock-In</div>
                    <div className="mt-2 space-y-2">
                      {row.stockInMovements.length ? row.stockInMovements.map((movement) => (
                        <div key={movement.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">{movement.reference_no}</span> · {quantity(movement.quantity, movement.uom)} · {movement.movement_date}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No finished goods movement linked.</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="text-sm font-bold text-text-primary">QC Checkpoints</div>
                    <div className="mt-2 space-y-2">
                      {(row.qc_checkpoints || []).length ? row.qc_checkpoints.map((checkpoint) => (
                        <div key={checkpoint.id} className="text-xs text-text-secondary">
                          <span className="font-semibold text-text-primary">Step {checkpoint.step_no}: {checkpoint.process_name}</span> · {checkpoint.control_point || "No control point"} · {checkpoint.qc_status}
                        </div>
                      )) : <div className="text-xs text-text-secondary">No SOP QC checkpoints attached.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )) : <EmptyState title="No batch traceability records" description="Complete production to create batch traceability records." />}
          </div>
        </Card>
      </div>
    );
  }

  function renderReports() {
    const productionRows = data.productions.map((production) => {
      const cost = productionCostInfo(production, data.receivings);
      const goodOutput = Number(production.good_output_qty || 0);
      return {
        ...production,
        cost_per_batch: cost.cost,
        cost_per_unit: goodOutput ? cost.cost / goodOutput : 0,
        missing_cost_rows: cost.missingCostRows,
        yield_percent: productionYieldPercent(production),
        material_variance_percent: weightedMaterialVariancePercent([production]),
      };
    });
    const usageRows = data.productions.flatMap((production) => (production.material_usage || []).map((usage) => {
      const unitCost = usageUnitCostInfo(usage, data.receivings);
      return {
        id: `${production.id}-${usage.id}`,
        production_no: production.production_no,
        batch_no: production.batch_no,
        production_date: production.production_date,
        product_name: production.product_name,
        raw_material_name: usage.raw_material_name,
        standard_usage: usage.standard_usage,
        actual_usage: usage.actual_usage,
        variance_qty: usage.variance_qty,
        variance_percent: usage.variance_percent,
        unit_cost: unitCost.unitCost,
        actual_usage_cost: Number(usage.actual_usage || 0) * unitCost.unitCost,
        missing_cost: unitCost.missingCost,
        uom: usage.uom,
      };
    }));
    const yieldRows = productionRows.map((row) => ({
      id: `yield-${row.id}`,
      production_no: row.production_no,
      batch_no: row.batch_no,
      product_name: row.product_name,
      actual_produced_qty: row.actual_produced_qty,
      good_output_qty: row.good_output_qty,
      wastage_qty: row.wastage_qty,
      yield_percent: row.yield_percent,
      uom: row.uom,
    }));
    const movementRows = data.productMovements.map((movement) => ({
      ...movement,
      id: `movement-${movement.id}`,
    }));
    const recipeRows = metrics.recipeCostRows || [];
    const productionCostRows = metrics.productionCostRows || [];
    const costTrendRows = data.receivings.map((row) => {
      const materialReceivings = data.receivings
        .filter((item) => item.raw_material_id === row.raw_material_id && Number(item.unit_cost || 0) > 0)
        .sort((a, b) => new Date(a.received_date || a.created_at || 0) - new Date(b.received_date || b.created_at || 0));
      const index = materialReceivings.findIndex((item) => item.id === row.id);
      const previous = index > 0 ? materialReceivings[index - 1] : null;
      const change = previous ? Number(row.unit_cost || 0) - Number(previous.unit_cost || 0) : 0;
      const changePercent = previous && Number(previous.unit_cost || 0) ? (change / Number(previous.unit_cost || 0)) * 100 : 0;
      return {
        ...row,
        previous_cost: previous ? Number(previous.unit_cost || 0) : null,
        cost_change: change,
        cost_change_percent: changePercent,
      };
    });
    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Factory Reports"
          description="Read-only production, material usage, costing, yield and finished goods movement reports."
          actions={<button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Factory} label="Production Runs" value={productionRows.length} helper="Completed records" />
          <MetricCard icon={CheckCircle2} label="Production Yield" value={percent(metrics.productionYield)} helper="Good output / actual produced" tone={metrics.productionYield >= 90 ? "success" : "warning"} />
          <MetricCard icon={Activity} label="Material Variance" value={percent(metrics.materialVariancePercent)} helper="Usage-row variance; review UOM mix" tone={Math.abs(metrics.materialVariancePercent) > 5 ? "warning" : "success"} />
          <MetricCard icon={PackageCheck} label="Actual Cost" value={money(metrics.estimatedProductionCost)} helper="Known-cost actual usage" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Recipe Costing Report" description="Standard recipe cost is a read-only reference based on recipe quantities and latest receiving cost.">
            <FactoryTable
              columns={[
                { key: "recipe", label: "Recipe", render: (row) => <div><div className="font-bold text-text-primary">{row.recipe_code}</div><div className="text-xs text-text-secondary">{row.product_name}</div></div> },
                { key: "yield", label: "Production Quantity", render: (row) => quantity(row.yield_quantity, row.uom) },
                { key: "items", label: "Items", render: (row) => row.items?.length || 0 },
                { key: "standardCost", label: "Standard Cost", align: "right", render: (row) => costDisplay(row.standardCost, row.missingCostRows) },
                { key: "costPerUnit", label: "Cost / Unit", align: "right", render: (row) => costDisplay(row.costPerUnit, row.missingCostRows) },
              ]}
              rows={recipeRows}
              emptyTitle="No active recipe costing"
              emptyDescription="Active recipes with item quantities and receiving costs will appear here."
            />
          </Card>
          <Card title="Actual vs Standard Cost Variance" description="Actual production cost remains based on actual material usage; standard cost is recipe reference scaled to output.">
            <FactoryTable
              columns={[
                { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "standard_cost", label: "Standard", align: "right", render: (row) => costDisplay(row.standard_cost, row.missing_cost_rows) },
                { key: "actual_cost", label: "Actual", align: "right", render: (row) => costDisplay(row.actual_cost, row.missing_cost_rows) },
                { key: "variance_rm", label: "Variance", align: "right", render: (row) => costDisplay(row.variance_rm, row.missing_cost_rows) },
                { key: "variance_percent", label: "Variance %", render: (row) => row.missing_cost_rows ? "Missing Cost" : percent(row.variance_percent) },
              ]}
              rows={productionCostRows}
              emptyTitle="No production cost variance"
              emptyDescription="Complete production for products with active recipes to compare standard and actual cost."
            />
          </Card>
        </div>
        <Card title="Raw Material Cost Trend Report" description="Receiving records provide raw material cost history and supplier cost trend by material.">
          <FactoryTable
            columns={[
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
              { key: "received_date", label: "Received", render: (row) => row.received_date || "—" },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => Number(row.unit_cost || 0) > 0 ? money(row.unit_cost) : "Missing Cost" },
              { key: "previous_cost", label: "Previous", align: "right", render: (row) => row.previous_cost == null ? "—" : money(row.previous_cost) },
              { key: "cost_change", label: "Change", align: "right", render: (row) => row.previous_cost == null ? "—" : money(row.cost_change) },
              { key: "cost_change_percent", label: "Change %", render: (row) => row.previous_cost == null ? "—" : percent(row.cost_change_percent) },
            ]}
            rows={costTrendRows}
            emptyTitle="No raw material cost history"
            emptyDescription="Raw material receiving records with unit cost will populate this trend report."
          />
        </Card>
        <Card title="Production Summary Report" description="Completed production totals with actual usage costing. Missing receiving cost is shown instead of RM0 where the cost source is unavailable.">
          <FactoryTable
            columns={[
              { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"} · {row.production_date}</div></div> },
              { key: "product_name", label: "Product", render: (row) => row.product_name },
              { key: "output", label: "Good Output", render: (row) => quantity(row.good_output_qty, row.uom) },
              { key: "yield_percent", label: "Yield", render: (row) => percent(row.yield_percent) },
              { key: "cost_per_batch", label: "Batch Cost", align: "right", render: (row) => costDisplay(row.cost_per_batch, row.missing_cost_rows) },
              { key: "cost_per_unit", label: "Cost / Unit", align: "right", render: (row) => costDisplay(row.cost_per_unit, row.missing_cost_rows) },
            ]}
            rows={productionRows}
            emptyTitle="No production summary"
            emptyDescription="Complete production to populate this read-only report."
          />
        </Card>
        <Card title="Raw Material Usage Report" description="Actual material usage cost uses recorded receiving unit cost when available, otherwise latest receiving cost by raw material. Missing cost is shown when no cost source exists.">
          <FactoryTable
            columns={[
              { key: "production_no", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{row.production_no}</div><div className="text-xs text-text-secondary">{row.batch_no || "No batch"}</div></div> },
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "actual_usage", label: "Actual Usage", render: (row) => quantity(row.actual_usage, row.uom) },
              { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => row.missing_cost ? "Missing Cost" : money(row.unit_cost) },
              { key: "actual_usage_cost", label: "Actual Usage Cost", align: "right", render: (row) => row.missing_cost ? "Missing Cost" : money(row.actual_usage_cost) },
            ]}
            rows={usageRows}
            emptyTitle="No raw material usage"
            emptyDescription="Complete production with actual material usage to populate this report."
          />
        </Card>
        <Card title="Recipe Standard vs Actual Usage Report" description="Recipe remains the standard reference; compare variance by material/UOM to avoid mixed-unit interpretation.">
          <FactoryTable
            columns={[
              { key: "production_no", label: "Production", render: (row) => row.production_no },
              { key: "raw_material_name", label: "Raw Material", render: (row) => row.raw_material_name },
              { key: "standard_usage", label: "Standard", render: (row) => quantity(row.standard_usage, row.uom) },
              { key: "actual_usage", label: "Actual", render: (row) => quantity(row.actual_usage, row.uom) },
              { key: "variance_qty", label: "Variance", render: (row) => quantity(row.variance_qty, row.uom) },
              { key: "variance_percent", label: "Variance %", render: (row) => percent(row.variance_percent) },
            ]}
            rows={usageRows}
            emptyTitle="No standard vs actual usage"
            emptyDescription="Production material usage rows will appear here."
          />
        </Card>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Production Yield Report" description="Yield is good output divided by actual produced quantity.">
            <FactoryTable
              columns={[
                { key: "production_no", label: "Production", render: (row) => row.production_no },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "actual_produced_qty", label: "Actual Produced", render: (row) => quantity(row.actual_produced_qty, row.uom) },
                { key: "good_output_qty", label: "Good Output", render: (row) => quantity(row.good_output_qty, row.uom) },
                { key: "yield_percent", label: "Yield", render: (row) => percent(row.yield_percent) },
              ]}
              rows={yieldRows}
              emptyTitle="No yield records"
              emptyDescription="Complete production to populate yield reporting."
            />
          </Card>
          <Card title="Finished Goods Stock Movement Report" description="Read-only finished goods stock movement history.">
            <FactoryTable
              columns={[
                { key: "reference_no", label: "Reference", render: (row) => row.reference_no || "—" },
                { key: "product_name", label: "Product", render: (row) => row.product_name },
                { key: "movement_type", label: "Movement", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
                { key: "quantity", label: "Qty", render: (row) => quantity(row.quantity, row.uom) },
                { key: "movement_date", label: "Date", render: (row) => row.movement_date || "—" },
              ]}
              rows={movementRows}
              emptyTitle="No finished goods movements"
              emptyDescription="Production stock-in and future product movements will appear here."
            />
          </Card>
        </div>
      </div>
    );
  }

  function renderFinishedGoods() {
    const productGroups = finishedGoodProductGroups();
    const outOfStockItems = data.finishedGoods.filter((row) => Number(row.current_balance || 0) <= 0);
    const canManageFinishedGoods = can("factory_finished_goods.create") || can("factory_finished_goods.edit");
    const activeRecipeCount = data.recipes.filter((recipe) => recipe.status === "active").length;
    const showVariantColumn = data.finishedGoods.some((sku) => !variantIsPackSize(sku));
    const actionItemClass = "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-text-primary transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
    const dangerActionItemClass = "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50";
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentProductions = data.productions.filter((production) => new Date(production.production_date || production.created_at || 0) >= thirtyDaysAgo);
    const producedByProduct = [...recentProductions.reduce((map, production) => {
      const key = production.product_name || "Unknown product";
      const current = map.get(key) || { id: key, label: key, value: 0, helper: "Last 30 days" };
      current.value += Number(production.good_output_qty || production.produced_quantity || 0);
      map.set(key, current);
      return map;
    }, new Map()).values()].sort((a, b) => b.value - a.value).slice(0, 5);
    const stockDistribution = [...data.finishedGoods]
      .sort((a, b) => Number(b.current_balance || 0) - Number(a.current_balance || 0))
      .slice(0, 6)
      .map((product) => ({ id: product.id, label: product.product_name_en || product.product_name, value: Number(product.current_balance || 0), helper: product.uom }));
    const recentMovements = data.productMovements.filter((movement) => new Date(movement.movement_date || movement.created_at || 0) >= thirtyDaysAgo);
    const productionInQty = recentMovements.filter((movement) => Number(movement.quantity || 0) > 0 && String(movement.movement_type || "").toLowerCase().includes("production")).reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
    const stockOutQty = Math.abs(recentMovements.filter((movement) => Number(movement.quantity || 0) < 0).reduce((sum, movement) => sum + Number(movement.quantity || 0), 0));
    const latestBatch = [...data.productions].filter((production) => production.batch_no).sort((a, b) => new Date(b.production_date || b.created_at || 0) - new Date(a.production_date || a.created_at || 0))[0];
    const batchCount = new Set(data.productions.map((production) => production.batch_no).filter(Boolean)).size;
    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Finished Goods"
          description="Finished goods master setup with live warehouse balances, production history, batches and stock movements."
          actions={(
            <div className="flex flex-wrap gap-2">
              {can("factory_finished_goods.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "product-group" })}><Package size={15} /> Create Finished Good</button> : null}
              {canManageFinishedGoods ? <button className="btn-secondary" type="button" onClick={() => setModal({ type: "finished-good-category" })}><Tag size={15} /> Category</button> : null}
            </div>
          )}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Finished Goods" value={productGroups.length} helper="Product identities" />
          <MetricCard icon={Warehouse} label="Packaging SKUs" value={data.finishedGoods.length} helper="Inventory SKUs" />
          <MetricCard icon={BookOpen} label="Active Recipes" value={activeRecipeCount} helper="Production standards" tone={activeRecipeCount ? "success" : "warning"} />
          <MetricCard icon={Clock3} label="Out of Stock SKUs" value={outOfStockItems.length} helper="Current balance zero" tone={outOfStockItems.length ? "danger" : "success"} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card title="Stock Distribution by Product" description="Current finished goods balance by SKU.">
            <WarehouseBarList rows={stockDistribution} valueLabel={(value, row) => quantity(value, row.helper)} />
          </Card>
          <Card title="Top Produced Products" description="Good output from completed production in the last 30 days.">
            <WarehouseBarList rows={producedByProduct} valueLabel={(value) => quantity(value, "")} />
          </Card>
          <Card title="Movement and Batch Summary" description="Production stock-in versus stock-out movement signals.">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {[
                { label: "Production In", value: quantity(productionInQty, ""), helper: "Last 30 days" },
                { label: "Stock Out", value: quantity(stockOutQty, ""), helper: "Last 30 days" },
                { label: "Batch Count", value: batchCount, helper: "Total tracked batches" },
                { label: "Latest Batch", value: latestBatch?.batch_no || "—", helper: latestBatch?.production_date || "No batches yet" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-border bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">{item.label}</div>
                  <div className="mt-1 text-lg font-bold text-text-primary">{item.value}</div>
                  <div className="mt-1 text-xs text-text-secondary">{item.helper}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        {warehouseFilterControls()}
        <Card title="Finished Goods and Packaging SKUs" description="Each Finished Good can have one or more packaging SKUs. Inventory balances are tracked per SKU.">
          {!productGroups.length ? (
            <EmptyState title="No Finished Goods" description="Create a Finished Good, then add Packaging SKUs for production stock-in." />
          ) : (
            <div className="space-y-4 p-4">
              <div className="hidden rounded-xl border border-border bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted md:grid md:grid-cols-[minmax(260px,1.5fr)_1fr_140px_130px_140px_48px]">
                <div>Finished Good</div>
                <div>Category</div>
                <div>Packaging SKUs</div>
                <div>Total Base Balance</div>
                <div>Status</div>
                <div />
              </div>
              {productGroups.map((group) => {
                const groupKey = group.groupKey;
                const isExpanded = expandedProductGroups[groupKey] ?? false;
                const skuCountLabel = `${group.skus.length} Packaging SKU${group.skus.length === 1 ? "" : "s"}`;
                const activeSkuLabel = `${group.active_sku_count} Active SKU${group.active_sku_count === 1 ? "" : "s"}`;
                return (
                  <div key={groupKey} className="overflow-visible rounded-2xl border border-border bg-white shadow-sm">
                    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(260px,1.5fr)_1fr_140px_130px_140px_48px] md:items-center">
                      <button
                        className="flex items-start gap-3 rounded-xl text-left transition hover:text-primary"
                        type="button"
                        onClick={() => setExpandedProductGroups((current) => ({ ...current, [groupKey]: !isExpanded }))}
                      >
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-slate-50 text-sm font-bold text-text-secondary">{isExpanded ? "▼" : "▶"}</span>
                        <span>
                          <span className="block text-base font-bold text-text-primary">{group.product_group_name}</span>
                          <span className="mt-0.5 block text-xs font-semibold text-text-secondary md:hidden">{skuCountLabel}</span>
                        </span>
                      </button>
                      <div className="text-sm font-semibold text-text-secondary">{group.category || "No category"}</div>
                      <div className="text-sm font-bold text-text-primary">{skuCountLabel}</div>
                      <div className="text-sm font-bold text-text-primary">{group.total_base_balance?.label || "—"}</div>
                      <div className="text-sm font-bold text-text-primary">
                        {activeSkuLabel}
                        {group.status === "archived" ? <div className="mt-0.5 text-xs font-semibold text-text-secondary">Archived Finished Good</div> : null}
                      </div>
                      <div className="flex justify-start md:justify-end">
                        {!group.isStandalone && canManageFinishedGoods ? (
                          <ActionMenu
                            open={finishedGoodActionMenu === groupKey}
                            onOpenChange={(open) => setFinishedGoodActionMenu(open ? groupKey : null)}
                            width={220}
                            trigger={({ toggle, ariaLabel }) => (
                              <button className="icon-btn h-9 w-9" type="button" onClick={toggle} aria-label={ariaLabel}>⋮</button>
                            )}
                          >
                            {can("factory_finished_goods.create") ? <button className={actionItemClass} type="button" onClick={() => { setFinishedGoodActionMenu(null); openPackagingSkuModal(group); }}>Add Packaging SKU</button> : null}
                            {can("factory_finished_goods.edit") ? <button className={actionItemClass} type="button" onClick={() => { setFinishedGoodActionMenu(null); setModal({ type: "product-group", value: group }); }}>Edit Finished Good</button> : null}
                            {can("factory_finished_goods.edit") && group.status !== "archived" ? <button className={dangerActionItemClass} type="button" onClick={() => { setFinishedGoodActionMenu(null); archiveProductGroup(group); }}>Archive Finished Good</button> : null}
                          </ActionMenu>
                        ) : null}
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="border-t border-border bg-slate-50/70 px-5 py-4">
                        {!group.skus.length ? (
                          <EmptyState title="No Packaging SKUs" description="Add a Packaging SKU before production stock-in." />
                        ) : (
                          <div className="ml-3 overflow-x-auto rounded-xl border border-border bg-white shadow-inner">
                            <table className={`w-full text-left ${showVariantColumn ? "min-w-[820px]" : "min-w-[720px]"}`}>
                              <thead>
                                <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                                  <th className="px-4 py-2.5">SKU</th>
                                  {showVariantColumn ? <th className="px-4 py-2.5">Variant</th> : null}
                                  <th className="px-4 py-2.5">Pack Size</th>
                                  <th className="px-4 py-2.5">Balance</th>
                                  <th className="px-4 py-2.5">Recipe</th>
                                  <th className="px-4 py-2.5">Status</th>
                                  <th className="px-4 py-2.5 text-right" />
                                </tr>
                              </thead>
                              <tbody>
                                {group.skus.map((sku) => {
                                  const packSize = packSizeText(sku) || "—";
                                  const activeStandard = activeRecipeForSku(data.recipes, sku, group.product_group_name);
                                  const skuMenuKey = `${groupKey}:${sku.id}`;
                                  return (
                                    <tr key={sku.id} className="border-b border-border text-sm last:border-0">
                                      <td className="px-4 py-2.5">
                                        <div className="font-bold text-text-primary">{sku.product_code || "No SKU"}</div>
                                        <div className="text-xs text-text-secondary">{sku.product_name_en || sku.product_name || group.product_group_name}</div>
                                      </td>
                                      {showVariantColumn ? <td className="px-4 py-2.5 font-semibold text-text-primary">{sku.variant_name || "Default SKU"}</td> : null}
                                      <td className="px-4 py-2.5">
                                        <div className="font-semibold text-text-primary">{packSize}</div>
                                      </td>
                                      <td className="px-4 py-2.5 font-bold text-text-primary">{skuBalanceLabel(sku)}</td>
                                      <td className="px-4 py-2.5 font-semibold text-text-secondary">{activeStandard ? activeStandard.version || activeStandard.recipe_name || "Active" : "—"}</td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex flex-wrap gap-1.5">
                                          <Badge tone={sku.status === "active" ? "success" : "neutral"}>{sku.status}</Badge>
                                          <Badge tone={Number(sku.current_balance || 0) <= 0 ? "danger" : "success"}>{Number(sku.current_balance || 0) <= 0 ? "out of stock" : "in stock"}</Badge>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2.5 text-right">
                                        <ActionMenu
                                          open={packagingSkuActionMenu === skuMenuKey}
                                          onOpenChange={(open) => setPackagingSkuActionMenu(open ? skuMenuKey : null)}
                                          width={188}
                                          trigger={({ toggle, ariaLabel }) => (
                                            <button className="icon-btn h-8 w-8" type="button" onClick={toggle} aria-label={ariaLabel}>⋮</button>
                                          )}
                                        >
                                          <button className={actionItemClass} type="button" onClick={() => { setPackagingSkuActionMenu(null); setModal({ type: "finished-good-detail", product: sku }); }}>View SKU</button>
                                          {can("factory_finished_goods.edit") ? <button className={actionItemClass} type="button" onClick={() => { setPackagingSkuActionMenu(null); openPackagingSkuModal(group.isStandalone ? null : group, sku); }}>Edit SKU</button> : null}
                                          {can("factory_finished_goods.edit") && sku.status !== "archived" ? <button className={dangerActionItemClass} type="button" onClick={() => { setPackagingSkuActionMenu(null); archiveFinishedGood(sku); }}>Archive SKU</button> : null}
                                        </ActionMenu>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  }

  function renderFinishedGoodsDispatch() {
    const today = todayInput();
    const draftRows = data.finishedGoodDispatches.filter((row) => row.status === "draft");
    const completedToday = data.finishedGoodDispatches.filter((row) => row.status === "completed" && String(row.completed_at || row.dispatch_date || "").slice(0, 10) === today);
    const customersToday = new Set(completedToday.map((row) => row.customer_id || row.customer_name).filter(Boolean)).size;
    const dispatchColumns = [
      { key: "dispatch_no", label: "Dispatch No.", render: (row) => <div><div className="font-bold text-text-primary">{row.dispatch_no}</div><div className="text-xs text-text-secondary">{row.reference_no || "No reference"}</div></div> },
      { key: "customer_name", label: "Customer", render: (row) => <div><div className="font-semibold text-text-primary">{row.customer_name || "—"}</div><div className="text-xs text-text-secondary">{row.customer_code || row.customer_type || "Dispatch destination"}</div></div> },
      { key: "items_count", label: "Items", render: (row) => Number(row.items_count || 0).toLocaleString("en-MY") },
      { key: "total_qty", label: "Total Dispatch", render: (row) => dispatchTotalLabel(row) },
      { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "completed" ? "success" : row.status === "cancelled" ? "neutral" : "warning"}>{jobStatusLabel(row.status)}</Badge> },
      { key: "dispatch_date", label: "Date", render: (row) => row.dispatch_date || "—" },
      { key: "actions", label: "Actions", align: "right", render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "finished-good-dispatch", value: row })}>View</button>
          {row.status === "draft" && can("factory_finished_goods_dispatch.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setModal({ type: "finished-good-dispatch", value: row })}>Edit</button> : null}
          {row.status === "draft" && can("factory_finished_goods_dispatch.complete") ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => completeFinishedGoodDispatch(row)}>Complete</button> : null}
          {row.status === "draft" && can("factory_finished_goods_dispatch.delete") ? <button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => cancelFinishedGoodDispatch(row)}>Cancel</button> : null}
        </div>
      ) },
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Finished Goods Dispatch"
          description="Record outbound Packaging SKU dispatches to customers or outlets. Completion creates finished goods stock-out movements."
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={ClipboardCheck} label="Draft" value={draftRows.length} helper="Awaiting completion" tone={draftRows.length ? "warning" : "success"} />
          <MetricCard icon={CheckCircle2} label="Completed Today" value={completedToday.length} helper="Finished dispatches" tone="success" />
          <MetricCard icon={PackageCheck} label="Dispatched Today" value={completedToday.length} helper="Completed dispatch records" />
          <MetricCard icon={Truck} label="Customers Today" value={customersToday} helper="Unique dispatch customers" />
        </div>
        <Card title="Finished Goods Dispatch" description="Create drafts first, then complete them to deduct Packaging SKU stock and create Product Movement rows.">
          <div className="space-y-4 p-4">
            <div className="inline-flex rounded-xl border border-border bg-white p-1">
              <button className={`rounded-lg px-4 py-2 text-sm font-bold ${dispatchTab === "history" ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setDispatchTab("history")}>Dispatch History</button>
              <button className={`rounded-lg px-4 py-2 text-sm font-bold ${dispatchTab === "create" ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setDispatchTab("create")} disabled={!can("factory_finished_goods_dispatch.create")}>Create Dispatch</button>
            </div>
            {dispatchTab === "create" ? (
              can("factory_finished_goods_dispatch.create") ? (
                <FinishedGoodDispatchModal
                  finishedGoods={data.finishedGoods}
                  customers={data.factoryCustomers}
                  onClose={() => setDispatchTab("history")}
                  onSave={saveFinishedGoodDispatch}
                  embedded
                />
              ) : (
                <EmptyState title="Create permission required" description="Your role can view dispatch history but cannot create new dispatch drafts." />
              )
            ) : (
              <FactoryTable
                columns={dispatchColumns}
                rows={data.finishedGoodDispatches}
                emptyTitle="No finished goods dispatches"
                emptyDescription="Create a dispatch draft to record outbound Packaging SKU delivery."
              />
            )}
          </div>
        </Card>
      </div>
    );
  }

  function renderProductMovements() {
    const rows = filteredProductMovements().map((movement) => {
      const linkedProduction = data.productions.find((production) => production.id === movement.reference_id || production.production_no === movement.reference_no);
      return { ...movement, batch_no: linkedProduction?.batch_no || "", source_label: movementSourceLabel(movement), movement_type_label: movementTypeLabel(movement) };
    });
    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Product Movements"
          description="Read-only finished goods movement history from production stock-in and approved adjustments."
          actions={<button className="btn-secondary" type="button" onClick={loadData}><RefreshCw size={15} /> Refresh</button>}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Activity} label="Movements" value={data.productMovements.length} helper="Finished goods movement rows" />
          <MetricCard icon={PackageCheck} label="Stock In" value={data.productMovements.filter((row) => Number(row.quantity || 0) > 0).length} helper="Positive movement rows" tone="success" />
          <MetricCard icon={AlertTriangle} label="Stock Out" value={data.productMovements.filter((row) => Number(row.quantity || 0) < 0).length} helper="Negative movement rows" tone="warning" />
          <MetricCard icon={Factory} label="Production Sources" value={data.productMovements.filter((row) => row.reference_type === "production").length} helper="Created by production" />
        </div>
        {warehouseFilterControls({ showStatus: false })}
        <Card title="Finished Goods Movement History" description="Movement logs are read-only here; stock balance remains managed by production completion and approved stock checks.">
          <FactoryTable
            columns={[
              { key: "movement_date", label: "Date", render: (row) => row.movement_date || "—" },
              { key: "movement_type", label: "Type", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type_label}</Badge> },
              { key: "product_name", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_family_name || row.product_name || "Finished Good"}</div><div className="text-xs text-text-secondary">{row.sku_product_name && row.sku_product_name !== row.product_name ? row.sku_product_name : "Packaging SKU movement"}</div></div> },
              { key: "packaging_sku", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{[row.product_code || "No SKU", row.variant_name || packSizeText(row) || "Packaging SKU"].filter(Boolean).join(" · ")}</div><div className="text-xs text-text-secondary">{row.reference_no ? `Ref: ${row.reference_no}` : "No movement ref"}</div></div> },
              { key: "quantity", label: "Qty", render: (row) => <div className="font-bold text-text-primary">{movementPackagingQtyLabel(row)}</div> },
              { key: "pack_size", label: "Pack Size", render: (row) => packSizeText(row) || "—" },
              { key: "base_equivalent", label: "Base Equivalent", render: (row) => movementBaseEquivalentLabel(row) },
              { key: "batch_no", label: "Batch", render: (row) => row.batch_no || "—" },
              { key: "source", label: "Source", render: (row) => <div><div className="font-semibold text-text-primary">{row.source_label}</div>{row.notes ? <div className="text-xs text-text-secondary">{row.notes}</div> : null}</div> },
            ]}
            rows={rows}
            emptyTitle="No finished goods movements"
            emptyDescription="Complete production first to create finished goods stock-in movement history."
          />
        </Card>
      </div>
    );
  }

  function renderProductStockCheck() {
    return (
      <div className="space-y-5">
        <PageHeader
          section="Warehouse"
          title="Product Stock Check"
          description="Count finished goods stock, submit variance for review and approve inventory adjustments."
          actions={can("factory_product_stock_check.create") ? <button className="btn-primary" type="button" onClick={() => setModal({ type: "stock-check", stockType: "product" })}><ClipboardCheck size={15} /> New Stock Check</button> : null}
        />
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Finished Goods" value={data.finishedGoods.length} helper="Available for count" />
          <MetricCard icon={ClipboardCheck} label="Checks" value={data.productStockChecks.length} helper="Finished goods checks" />
          <MetricCard icon={Clock3} label="Submitted" value={data.productStockChecks.filter((row) => row.status === "submitted").length} helper="Awaiting approval" tone={data.productStockChecks.some((row) => row.status === "submitted") ? "warning" : "success"} />
          <MetricCard icon={AlertTriangle} label="Variance Rows" value={data.productStockChecks.flatMap((row) => row.items || []).filter((item) => item.variance_status !== "Normal").length} helper="Above 2%" tone="warning" />
        </div>
        <Card title="Finished Goods Stock Checks" description="Draft and submitted checks do not adjust stock. Approval applies the variance adjustment.">
          <FactoryTable columns={stockCheckColumns("product")} rows={data.productStockChecks} emptyTitle="No finished goods stock checks" emptyDescription="Create a stock check to capture physical counts." />
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="card p-6 text-sm font-semibold text-text-secondary">Loading Factory workspace...</div>;
  }

  return (
    <>
      <AccessIssueNotice issues={data.accessIssues} />
      {initialTab === "job-orders" ? renderJobOrders() : initialTab === "raw-inventory" ? renderRawInventory() : initialTab === "raw-receiving" ? renderRawReceiving() : initialTab === "raw-movements" ? renderRawMaterialMovements() : initialTab === "raw-stock-check" ? renderRawStockCheck() : initialTab === "production" ? renderProduction() : initialTab === "reports" ? renderReports() : initialTab === "batch-traceability" ? renderBatchTraceability() : initialTab === "finished-goods" ? renderFinishedGoods() : initialTab === "finished-goods-dispatch" ? renderFinishedGoodsDispatch() : initialTab === "product-movements" ? renderProductMovements() : initialTab === "product-stock-check" ? renderProductStockCheck() : initialTab === "product-recipes" ? renderProductRecipes() : initialTab === "production-sop" ? renderProductionSop() : initialTab === "storage-locations" ? renderStorageLocations() : initialTab === "suppliers" ? renderSuppliers() : initialTab === "customers" ? renderCustomers() : renderDashboard()}
      {modal?.type === "job" ? (
        <JobOrderModal
          initialValue={modal.value}
          finishedGoods={data.finishedGoods}
          rawMaterials={data.rawMaterials}
          recipes={data.recipes}
          onClose={() => setModal(null)}
          onSave={saveJobOrder}
        />
      ) : null}
      {modal?.type === "completed-job-result" ? (
        <CompletedJobOrderResultModal
          job={modal.job}
          production={modal.production}
          recipes={data.recipes}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "finished-good-dispatch" ? (
        <FinishedGoodDispatchModal
          initialValue={modal.value}
          finishedGoods={data.finishedGoods}
          customers={data.factoryCustomers}
          onClose={() => setModal(null)}
          onSave={saveFinishedGoodDispatch}
        />
      ) : null}
      {modal?.type === "receiving-batch-detail" ? (
        <ReceivingBatchDetailModal
          batch={modal.value}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "raw-material-detail" ? (
        <RawMaterialDetailModal
          material={modal.material}
          receivings={data.receivings}
          movements={data.rawMaterialMovements}
          stockChecks={data.rawStockChecks}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "raw-material" ? (
        <RawMaterialMasterModal
          initialValue={modal.value}
          categories={data.rawMaterialCategories}
          storageLocations={data.storageLocations}
          onClose={() => setModal(null)}
          onSave={saveRawMaterial}
          onArchive={archiveRawMaterial}
        />
      ) : null}
      {modal?.type === "raw-material-category" ? (
        <RawMaterialCategoryModal
          categories={data.rawMaterialCategories}
          onClose={() => setModal(null)}
          onSave={(form) => saveRawMaterialCategory(form, { keepOpen: true })}
          onArchive={(category) => archiveRawMaterialCategory(category, { keepOpen: true })}
        />
      ) : null}
      {modal?.type === "storage-locations" ? (
        <StorageLocationModal
          locations={data.storageLocations}
          onClose={() => setModal(null)}
          onSave={(form) => saveStorageLocation(form, { keepOpen: true })}
          onArchive={(location) => archiveStorageLocation(location, { keepOpen: true })}
        />
      ) : null}
      {modal?.type === "factory-suppliers" ? (
        <FactorySupplierModal
          suppliers={data.factorySuppliers}
          onClose={() => setModal(null)}
          onSave={(form) => saveFactorySupplier(form, { keepOpen: true })}
          onArchive={(supplier) => archiveFactorySupplier(supplier, { keepOpen: true })}
        />
      ) : null}
      {modal?.type === "factory-customers" ? (
        <FactoryCustomerModal
          customers={data.factoryCustomers}
          onClose={() => setModal(null)}
          onSave={(form) => saveFactoryCustomer(form, { keepOpen: true })}
          onArchive={(customer) => archiveFactoryCustomer(customer, { keepOpen: true })}
        />
      ) : null}
      {modal?.type === "production" ? (
        <ProductionExecutionModal
          job={modal.job}
          rawMaterials={data.rawMaterials}
          receivings={data.receivings}
          recipes={data.recipes}
          sops={data.sops}
          finishedGoods={data.finishedGoods}
          auth={auth}
          onClose={() => setModal(null)}
          onSave={completeProduction}
        />
      ) : null}
      {modal?.type === "start-production" ? (
        <StartProductionModal
          job={modal.job}
          auth={auth}
          onClose={() => setModal(null)}
          onSave={(form) => startJobOrder(modal.job, form)}
        />
      ) : null}
      {modal?.type === "sop" ? (
        <ProductionSopModal
          initialValue={modal.value}
          onClose={() => setModal(null)}
          onSave={saveProductionSop}
        />
      ) : null}
      {modal?.type === "recipe" ? (
        <ProductRecipeModal
          initialValue={modal.value}
          productFamilies={data.productFamilies}
          finishedGoods={data.finishedGoods}
          rawMaterials={data.rawMaterials}
          onClose={() => setModal(null)}
          onSave={saveProductRecipe}
        />
      ) : null}
      {modal?.type === "recipe-detail" ? (
        <ProductRecipeDetailModal
          recipe={modal.value}
          onClose={() => setModal(null)}
          onEdit={(recipe) => setModal({ type: "recipe", value: recipe })}
          onNewVersion={openNewRecipeVersion}
          onActivate={async (recipe) => {
            setModal(null);
            await activateProductRecipe(recipe);
          }}
          onArchive={async (recipe) => {
            setModal(null);
            await archiveProductRecipe(recipe);
          }}
          onDelete={async (recipe) => {
            setModal(null);
            await deleteProductRecipe(recipe);
          }}
          canCreateRecipe={can("factory_product_recipes.create")}
          canEditRecipe={can("factory_product_recipes.edit")}
          canManageRecipe={can("factory_product_recipes.manage")}
          canDeleteRecipe={can("factory_product_recipes.delete")}
        />
      ) : null}
      {modal?.type === "stock-check" ? (
        <StockCheckModal
          stockType={modal.stockType}
          title={modal.stockType === "raw" ? "Raw Material Stock Check" : "Finished Goods Stock Check"}
          initialValue={modal.value}
          stockItems={modal.stockType === "raw" ? data.rawMaterials : data.finishedGoods}
          rawMaterialCategories={data.rawMaterialCategories}
          onClose={() => setModal(null)}
          onSave={(form) => saveStockCheck(modal.stockType, form)}
        />
      ) : null}
      {modal?.type === "finished-good-detail" ? (
        <FinishedGoodDetailModal
          product={modal.product}
          productions={data.productions}
          movements={data.productMovements}
          productionCosts={metrics.productionCostRows}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.type === "product-group" ? (
        <ProductGroupModal
          initialValue={modal.value}
          categories={data.finishedGoodCategories}
          onClose={() => setModal(null)}
          onSave={saveProductGroup}
          onArchive={archiveProductGroup}
        />
      ) : null}
      {modal?.type === "finished-good" ? (
        <FinishedGoodMasterModal
          initialValue={modal.value}
          categories={data.finishedGoodCategories}
          storageLocations={data.storageLocations}
          productFamilies={data.productFamilies}
          onClose={() => setModal(null)}
          onSave={saveFinishedGood}
          onArchive={archiveFinishedGood}
        />
      ) : null}
      {modal?.type === "finished-good-category" ? (
        <FinishedGoodCategoryModal
          categories={data.finishedGoodCategories}
          onClose={() => setModal(null)}
          onSave={(form) => saveFinishedGoodCategory(form, { keepOpen: true })}
          onArchive={(category) => archiveFinishedGoodCategory(category, { keepOpen: true })}
        />
      ) : null}
    </>
  );
}
