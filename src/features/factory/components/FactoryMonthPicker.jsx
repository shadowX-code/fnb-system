import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import { inputClass } from "./FactoryBulkSelectionModal.jsx";
import { factoryMonthLabel, malaysiaBusinessMonthInput } from "../utils/factoryDates.js";

function shiftMonth(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const next = new Date(year, monthIndex - 1 + offset, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export default function FactoryMonthPicker({ value, onChange, ariaLabel = "Select month" }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(Number(value?.slice(0, 4)) || new Date().getFullYear());

  useEffect(() => setCursor(Number(value?.slice(0, 4)) || new Date().getFullYear()), [value]);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${cursor}-${String(index + 1).padStart(2, "0")}`;
    return { month, label: new Intl.DateTimeFormat("en-MY", { month: "short" }).format(new Date(cursor, index, 1)) };
  });

  return <div>
    <button ref={anchorRef} className={`${inputClass()} flex h-10 w-full items-center justify-between gap-2 text-left`} type="button" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="flex min-w-0 items-center gap-2"><CalendarDays size={15} className="shrink-0 text-text-muted" /> <span className="truncate">{factoryMonthLabel(value || malaysiaBusinessMonthInput())}</span></span>
    </button>
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={288} estimatedHeight={260} focusOnOpen className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <button className="btn-icon" type="button" aria-label="Previous year" onClick={() => setCursor((year) => year - 1)}><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold text-text-primary">{cursor}</span>
        <button className="btn-icon" type="button" aria-label="Next year" onClick={() => setCursor((year) => year + 1)}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-3 gap-1">{months.map(({ month, label }) => <button key={month} className={`rounded-md px-2 py-2 text-sm font-semibold transition ${month === value ? "bg-primary text-white" : "text-text-secondary hover:bg-primary/10 hover:text-text-primary"}`} type="button" onClick={() => { onChange(month); setOpen(false); }}>{label}</button>)}</div>
    </FloatingLayer>
  </div>;
}

export { shiftMonth };
