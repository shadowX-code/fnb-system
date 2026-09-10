import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";

const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "short" }));
const longMonthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "long" }));
const pad = (value) => String(value).padStart(2, "0");
const parseMonth = (value) => { const [year, month] = String(value || "").split("-").map(Number); return year && month >= 1 && month <= 12 ? { year, month: month - 1 } : null; };
const toValue = (year, month) => `${year}-${pad(month + 1)}`;

export default function MonthPickerField({ label, value, onChange, disabled = false, unavailable = [], className = "", ariaLabel }) {
  const wrapperRef = useRef(null); const triggerRef = useRef(null); const selected = parseMonth(value) || { year: new Date().getFullYear(), month: new Date().getMonth() };
  const [open, setOpen] = useState(false); const [year, setYear] = useState(selected.year);
  const unavailableMonths = new Set(unavailable.map((item) => String(item).slice(0, 7)));
  useEffect(() => { const next = parseMonth(value); if (next) setYear(next.year); }, [value]);
  function select(month) { const next = toValue(year, month); if (unavailableMonths.has(next)) return; onChange(next); setOpen(false); triggerRef.current?.focus(); }
  function navigate(event, month) { const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }; if (!(event.key in moves)) return; event.preventDefault(); const nextDate = new Date(year, month + moves[event.key], 1); setYear(nextDate.getFullYear()); requestAnimationFrame(() => wrapperRef.current?.querySelector(`[data-month="${nextDate.getMonth()}"]`)?.focus()); }
  const display = `${longMonthNames[selected.month]} ${selected.year}`;
  return <div className={`month-picker-field ${className}`.trim()} ref={wrapperRef}>
    {label ? <span className="month-picker-field-label">{label}</span> : null}
    <button ref={triggerRef} type="button" className="month-picker-field-trigger" aria-label={ariaLabel || label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><CalendarDays size={15} /><span>{display}</span><ChevronRight size={15} className={open ? "is-open" : ""} /></button>
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={wrapperRef} minWidth={296} width={296} align="start" estimatedHeight={270} className="month-picker-popover" focusOnOpen>
      <div className="month-picker-head"><button className="icon-btn" type="button" aria-label="Previous year" onClick={() => setYear((current) => current - 1)}><ChevronLeft size={15} /></button><strong>{year}</strong><button className="icon-btn" type="button" aria-label="Next year" onClick={() => setYear((current) => current + 1)}><ChevronRight size={15} /></button></div>
      <div className="month-picker-grid" role="grid" aria-label={`Months in ${year}`}>{monthNames.map((name, index) => { const next = toValue(year, index); const isSelected = next === String(value || "").slice(0, 7); const isCurrent = year === new Date().getFullYear() && index === new Date().getMonth(); const isUnavailable = unavailableMonths.has(next); return <button key={name} data-month={index} type="button" role="gridcell" disabled={isUnavailable} aria-selected={isSelected} className={`${isSelected ? "is-selected" : ""} ${isCurrent ? "is-current" : ""}`.trim()} onClick={() => select(index)} onKeyDown={(event) => navigate(event, index)}>{name}</button>; })}</div>
    </FloatingLayer>
  </div>;
}
