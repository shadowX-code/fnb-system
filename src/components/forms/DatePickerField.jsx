import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "short" }));
const fullMonthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "long" }));

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDisplayDate(value) {
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return "";
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toInputDate(displayValue) {
  const value = String(displayValue || "").trim();
  const numericMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const textMatch = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  let day;
  let month;
  let year;
  if (numericMatch) {
    [, day, month, year] = numericMatch;
  } else if (textMatch) {
    const monthIndex = fullMonthNames.findIndex((name) => name.toLowerCase().startsWith(textMatch[2].toLowerCase()));
    if (monthIndex < 0) return "";
    day = textMatch[1];
    month = String(monthIndex + 1);
    year = textMatch[3];
  } else {
    return "";
  }
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return "";
  }
  return `${year}-${pad(month)}-${pad(day)}`;
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

function clampDay(year, monthIndex, day) {
  return Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
}

function getDecadeStart(year) {
  return Math.floor(year / 12) * 12;
}

export default function DatePickerField({ label, required = false, value, onChange, onBlur, error, helper, yearFirst = false }) {
  const [open, setOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(toDisplayDate(value));
  const [viewMode, setViewMode] = useState(yearFirst ? "year" : "day");
  const wrapperRef = useRef(null);
  const selectedDate = value ? new Date(`${value}T00:00:00`) : new Date();
  const [visibleYear, setVisibleYear] = useState(selectedDate.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(selectedDate.getMonth());
  const [decadeStart, setDecadeStart] = useState(getDecadeStart(selectedDate.getFullYear()));
  const monthDays = useMemo(() => getMonthDays(visibleYear, visibleMonth), [visibleMonth, visibleYear]);

  useEffect(() => {
    setDisplayValue(toDisplayDate(value));
    if (value) {
      const nextDate = new Date(`${value}T00:00:00`);
      setVisibleYear(nextDate.getFullYear());
      setVisibleMonth(nextDate.getMonth());
      setDecadeStart(getDecadeStart(nextDate.getFullYear()));
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
    const cleaned = nextValue.replace(/[^A-Za-z0-9/\s]/g, "").slice(0, 14);
    setDisplayValue(cleaned);
    if (!cleaned) {
      onChange("");
      return;
    }
    const parsed = toInputDate(cleaned);
    if (parsed) onChange(parsed);
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

  function updateCalendarView(nextYear, nextMonth) {
    setVisibleYear(nextYear);
    setVisibleMonth(nextMonth);
    setDecadeStart(getDecadeStart(nextYear));
    if (!value) return;
    const currentDate = new Date(`${value}T00:00:00`);
    const nextDay = clampDay(nextYear, nextMonth, currentDate.getDate());
    onChange(`${nextYear}-${pad(nextMonth + 1)}-${pad(nextDay)}`);
  }

  function selectToday() {
    const today = new Date();
    selectDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  }

  function openPicker() {
    setOpen(true);
    if (yearFirst) setViewMode("year");
  }

  function selectYear(year) {
    setVisibleYear(year);
    setDecadeStart(getDecadeStart(year));
    setViewMode("month");
  }

  function selectMonth(monthIndex) {
    setVisibleMonth(monthIndex);
    setViewMode("day");
  }

  const headerTitle = viewMode === "year"
    ? `${decadeStart} - ${decadeStart + 11}`
    : viewMode === "month"
      ? visibleYear
      : `${fullMonthNames[visibleMonth]} ${visibleYear}`;

  return (
    <label className="relative flex flex-col gap-1" ref={wrapperRef}>
      <span className="text-xs font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </span>
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
        <input
          className={`control w-full pl-9 pr-10 ${error ? "border-rose-200 focus:border-rose-300 focus:ring-rose-50" : ""}`}
          inputMode="text"
          placeholder="6 May 1992"
          value={displayValue}
          onChange={(event) => handleManualInput(event.target.value)}
          onFocus={openPicker}
          onBlur={onBlur}
        />
        <button
          className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-slate-50 hover:text-primary"
          type="button"
          onClick={() => {
            setOpen((current) => !current);
            if (yearFirst) setViewMode("year");
          }}
          aria-label="Open calendar"
        >
          <CalendarDays size={15} />
        </button>
      </div>
      {error ? <span className="text-[11px] font-medium text-rose-600">{error}</span> : null}
      {!error && helper ? <span className="text-[11px] text-text-muted">{helper}</span> : null}

      {open ? (
        <div className="absolute left-0 top-[68px] z-50 w-[min(340px,calc(100vw-32px))] rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_rgba(15,23,42,0.16)] animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-1.5">
            <button
              className="icon-btn h-8 w-8"
              type="button"
              onClick={() => {
                if (viewMode === "year") setDecadeStart((current) => current - 12);
                else if (viewMode === "month") setVisibleYear((current) => current - 1);
                else moveMonth(-1);
              }}
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex items-center gap-1">
              <button className={`rounded-xl px-3 py-1.5 text-xs font-black transition ${viewMode === "year" ? "bg-white text-primary shadow-sm" : "text-text-primary hover:bg-white/70"}`} type="button" onClick={() => setViewMode("year")}>
                {headerTitle}
              </button>
              {viewMode === "day" ? (
                <button className="rounded-xl px-2 py-1.5 text-xs font-bold text-text-muted transition hover:bg-white hover:text-primary" type="button" onClick={() => setViewMode("month")}>
                  Change
                </button>
              ) : null}
            </div>
            <button
              className="icon-btn h-8 w-8"
              type="button"
              onClick={() => {
                if (viewMode === "year") setDecadeStart((current) => current + 12);
                else if (viewMode === "month") setVisibleYear((current) => current + 1);
                else moveMonth(1);
              }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {viewMode === "year" ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 12 }, (_, index) => decadeStart + index).map((year) => (
                <button
                  key={year}
                  className={`h-10 rounded-2xl text-sm font-black transition ${
                    year === visibleYear
                      ? "bg-primary text-white shadow-sm"
                      : "bg-slate-50 text-text-secondary hover:bg-primary/10 hover:text-primary"
                  }`}
                  type="button"
                  onClick={() => selectYear(year)}
                >
                  {year}
                </button>
              ))}
            </div>
          ) : null}

          {viewMode === "month" ? (
            <div className="grid grid-cols-3 gap-2">
              {monthNames.map((month, index) => (
                <button
                  key={month}
                  className={`h-10 rounded-2xl text-sm font-black transition ${
                    index === visibleMonth
                      ? "bg-primary text-white shadow-sm"
                      : "bg-slate-50 text-text-secondary hover:bg-primary/10 hover:text-primary"
                  }`}
                  type="button"
                  onClick={() => selectMonth(index)}
                >
                  {month}
                </button>
              ))}
            </div>
          ) : null}

          {viewMode === "day" ? (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wide text-text-muted">
                {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <div key={`${day}-${index}`}>{day}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {monthDays.map((item) => item.blank ? (
                  <div key={item.key} />
                ) : (
                  <button
                    key={item.key}
                    className={`h-8 rounded-xl text-sm font-bold transition ${
                      item.value === value
                        ? "bg-primary text-white shadow-sm"
                        : "text-text-secondary hover:bg-primary/10 hover:text-primary"
                    }`}
                    type="button"
                    onClick={() => selectDate(item.value)}
                  >
                    {item.day}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="mt-3 flex justify-between border-t border-border pt-3">
            <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
            <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={selectToday}>Today</button>
          </div>
        </div>
      ) : null}
    </label>
  );
}
