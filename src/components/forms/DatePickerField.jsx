import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import SelectField from "./SelectField.jsx";

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDisplayDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

function toInputDate(displayValue) {
  const match = String(displayValue || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return "";
  }
  return `${year}-${month}-${day}`;
}

function getMonthDays(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return [
    ...Array.from({ length: startOffset }, (_, index) => ({ key: `blank-${index}`, blank: true })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      key: index + 1,
      day: index + 1,
      value: `${year}-${pad(monthIndex + 1)}-${pad(index + 1)}`,
    })),
  ];
}

export default function DatePickerField({ label, required = false, value, onChange, onBlur, error, helper }) {
  const [open, setOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(toDisplayDate(value));
  const wrapperRef = useRef(null);
  const selectedDate = value ? new Date(`${value}T00:00:00`) : new Date();
  const [visibleYear, setVisibleYear] = useState(selectedDate.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(selectedDate.getMonth());
  const monthDays = useMemo(() => getMonthDays(visibleYear, visibleMonth), [visibleMonth, visibleYear]);

  useEffect(() => {
    setDisplayValue(toDisplayDate(value));
    if (value) {
      const nextDate = new Date(`${value}T00:00:00`);
      setVisibleYear(nextDate.getFullYear());
      setVisibleMonth(nextDate.getMonth());
    }
  }, [value]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleManualInput(nextValue) {
    const cleaned = nextValue.replace(/[^\d/]/g, "").slice(0, 10);
    setDisplayValue(cleaned);
    if (!cleaned) {
      onChange("");
      return;
    }
    if (cleaned.length === 10) {
      const parsed = toInputDate(cleaned);
      if (parsed) onChange(parsed);
    }
  }

  function moveMonth(delta) {
    const nextDate = new Date(visibleYear, visibleMonth + delta, 1);
    setVisibleYear(nextDate.getFullYear());
    setVisibleMonth(nextDate.getMonth());
  }

  function selectDate(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  function selectToday() {
    const today = new Date();
    selectDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  }

  return (
    <label className="relative flex flex-col gap-1" ref={wrapperRef}>
      <span className="text-xs font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
        <input
          className={`control w-full pl-9 pr-10 ${error ? "border-rose-200 focus:border-rose-300 focus:ring-rose-50" : ""}`}
          inputMode="numeric"
          placeholder="DD/MM/YYYY"
          value={displayValue}
          onChange={(event) => handleManualInput(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
        />
        <button className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-slate-50 hover:text-primary" type="button" onClick={() => setOpen((current) => !current)} aria-label="Open calendar">
          <CalendarDays size={15} />
        </button>
      </div>
      {error ? <span className="text-[11px] font-medium text-rose-600">{error}</span> : null}
      {!error && helper ? <span className="text-[11px] text-text-muted">{helper}</span> : null}

      {open ? (
        <div className="absolute left-0 top-[68px] z-50 w-[310px] rounded-2xl border border-border bg-white p-3 shadow-xl animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button className="icon-btn h-8 w-8" type="button" onClick={() => moveMonth(-1)}>
              <ChevronLeft size={14} />
            </button>
            <div className="flex items-center gap-2">
              <SelectField
                value={visibleMonth}
                className="w-32"
                buttonClassName="h-8 px-2 text-xs"
                options={Array.from({ length: 12 }, (_, index) => ({ value: index, label: new Date(2026, index, 1).toLocaleString([], { month: "short" }) }))}
                onChange={(nextValue) => setVisibleMonth(Number(nextValue))}
              />
              <SelectField
                value={visibleYear}
                className="w-24"
                buttonClassName="h-8 px-2 text-xs"
                options={Array.from({ length: 70 }, (_, index) => 1970 + index).map((year) => ({ value: year, label: year }))}
                onChange={(nextValue) => setVisibleYear(Number(nextValue))}
              />
            </div>
            <button className="icon-btn h-8 w-8" type="button" onClick={() => moveMonth(1)}>
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-text-muted">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthDays.map((item) => item.blank ? (
              <div key={item.key} />
            ) : (
              <button
                key={item.key}
                className={`h-9 rounded-xl text-sm font-semibold transition ${
                  item.value === value
                    ? "bg-primary text-white"
                    : "text-text-secondary hover:bg-primary/10 hover:text-primary"
                }`}
                type="button"
                onClick={() => selectDate(item.value)}
              >
                {item.day}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-border pt-3">
            <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
            <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={selectToday}>Today</button>
          </div>
        </div>
      ) : null}
    </label>
  );
}
