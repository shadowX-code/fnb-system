import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import FloatingLayer from "../ui/FloatingLayer.jsx";

const monthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "short" }));
const fullMonthNames = Array.from({ length: 12 }, (_, index) => new Date(2026, index, 1).toLocaleString("en-MY", { month: "long" }));
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIsoDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function toDisplayDate(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return "";
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
  if (parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) return "";
  return toIsoDate(parsed);
}

function getCalendarCells(year, monthIndex) {
  const firstDay = new Date(year, monthIndex, 1);
  const startOffset = firstDay.getDay();
  const firstCell = new Date(year, monthIndex, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return {
      key: toIsoDate(date),
      day: date.getDate(),
      value: toIsoDate(date),
      outside: date.getMonth() !== monthIndex,
      today: toIsoDate(date) === toIsoDate(new Date()),
    };
  });
}

function clampDay(year, monthIndex, day) {
  return Math.min(day, new Date(year, monthIndex + 1, 0).getDate());
}

function getYearGridStart(year) {
  return Math.floor(year / 12) * 12;
}

export default function DatePickerField({
  label,
  required = false,
  value,
  onChange,
  onBlur,
  error,
  helper,
  yearFirst = false,
  placeholder = "28 May 2026",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(toDisplayDate(value));
  const selectedDate = parseIsoDate(value) || new Date();
  const [visibleYear, setVisibleYear] = useState(selectedDate.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(selectedDate.getMonth());
  const [viewMode, setViewMode] = useState(yearFirst ? "year" : "day");
  const [yearGridStart, setYearGridStart] = useState(getYearGridStart(selectedDate.getFullYear()));
  const wrapperRef = useRef(null);
  const calendarCells = useMemo(() => getCalendarCells(visibleYear, visibleMonth), [visibleMonth, visibleYear]);

  useEffect(() => {
    setDisplayValue(toDisplayDate(value));
    const parsed = parseIsoDate(value);
    if (parsed) {
      setVisibleYear(parsed.getFullYear());
      setVisibleMonth(parsed.getMonth());
      setYearGridStart(getYearGridStart(parsed.getFullYear()));
    }
  }, [value]);

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

  function openPicker(nextMode = viewMode) {
    setOpen(true);
    setViewMode(yearFirst ? "year" : nextMode);
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
    selectDate(toIsoDate(new Date()));
  }

  function clearDate() {
    onChange("");
    setDisplayValue("");
    setOpen(false);
  }

  function selectYear(year) {
    setVisibleYear(year);
    setYearGridStart(getYearGridStart(year));
    setViewMode("month");
  }

  function selectMonth(monthIndex) {
    setVisibleMonth(monthIndex);
    setViewMode("day");
    if (!value) return;
    const currentDate = parseIsoDate(value);
    if (!currentDate) return;
    const nextDay = clampDay(visibleYear, monthIndex, currentDate.getDate());
    onChange(`${visibleYear}-${pad(monthIndex + 1)}-${pad(nextDay)}`);
  }

  function handleInputKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openPicker("day");
    }
    if (event.key === "Escape") setOpen(false);
  }

  function handleCalendarKeyDown(event, dateValue) {
    const current = parseIsoDate(dateValue);
    if (!current) return;
    const deltas = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(event.key in deltas)) return;
    event.preventDefault();
    const next = new Date(current);
    next.setDate(current.getDate() + deltas[event.key]);
    setVisibleYear(next.getFullYear());
    setVisibleMonth(next.getMonth());
    window.requestAnimationFrame(() => {
      wrapperRef.current?.querySelector(`[data-date-cell="${toIsoDate(next)}"]`)?.focus();
    });
  }

  const headerTitle = viewMode === "year"
    ? `${yearGridStart} - ${yearGridStart + 11}`
    : viewMode === "month"
      ? String(visibleYear)
      : `${fullMonthNames[visibleMonth]} ${visibleYear}`;

  return (
    <label className={`relative flex flex-col gap-1 ${className}`} ref={wrapperRef}>
      {label ? (
        <span className="type-caption font-semibold text-text-secondary">
          {label} {required ? <span className="text-rose-500">*</span> : null}
        </span>
      ) : null}
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
        <input
          className={`control h-9 w-full pl-9 pr-10 text-[13px] ${error ? "border-rose-200 focus:border-rose-300 focus:ring-rose-50" : ""}`}
          inputMode="text"
          placeholder={placeholder}
          value={displayValue}
          onChange={(event) => handleManualInput(event.target.value)}
          onFocus={() => openPicker("day")}
          onKeyDown={handleInputKeyDown}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
        />
        <button
          className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-primary/8 hover:text-primary"
          type="button"
          onClick={() => {
            setOpen((current) => !current);
            if (!open) setViewMode(yearFirst ? "year" : "day");
          }}
          aria-label="Open calendar"
        >
          <ChevronRight className={`transition ${open ? "rotate-90 text-primary" : ""}`} size={15} />
        </button>
      </div>
      {error ? <span className="type-caption font-semibold text-rose-600">{error}</span> : null}
      {!error && helper ? <span className="type-caption text-text-muted">{helper}</span> : null}

      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        anchorRef={wrapperRef}
        width={344}
        minWidth={316}
        align="start"
        offset={10}
        estimatedHeight={430}
        className="rounded-3xl border-border bg-surface p-3 shadow-[0_24px_70px_rgba(15,23,42,0.20)] dark:bg-[#111c1f] dark:shadow-[0_24px_70px_rgba(0,0,0,0.45)]"
      >
        <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-border bg-slate-50/80 p-1.5 dark:bg-white/5">
          <button
            className="icon-btn h-8 w-8"
            type="button"
            onClick={() => {
              if (viewMode === "year") setYearGridStart((current) => current - 12);
              else if (viewMode === "month") setVisibleYear((current) => current - 1);
              else moveMonth(-1);
            }}
            aria-label="Previous"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="flex min-w-0 items-center gap-1">
            <button
              className="truncate rounded-xl px-3 py-1.5 type-body-sm font-black text-text-primary transition hover:bg-surface hover:text-primary"
              type="button"
              onClick={() => setViewMode(viewMode === "day" ? "month" : "year")}
            >
              {headerTitle}
            </button>
            {viewMode === "day" ? (
              <button className="rounded-xl px-2 py-1.5 type-caption font-bold text-text-muted transition hover:bg-surface hover:text-primary" type="button" onClick={() => setViewMode("year")}>
                Change
              </button>
            ) : null}
          </div>
          <button
            className="icon-btn h-8 w-8"
            type="button"
            onClick={() => {
              if (viewMode === "year") setYearGridStart((current) => current + 12);
              else if (viewMode === "month") setVisibleYear((current) => current + 1);
              else moveMonth(1);
            }}
            aria-label="Next"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {viewMode === "year" ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 12 }, (_, index) => yearGridStart + index).map((year) => (
              <button
                key={year}
                className={`h-10 rounded-2xl type-body-sm font-black transition ${
                  year === visibleYear
                    ? "bg-primary text-white shadow-sm"
                    : "bg-slate-50 text-text-secondary hover:bg-primary/10 hover:text-primary dark:bg-white/5"
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
                className={`h-10 rounded-2xl type-body-sm font-black transition ${
                  index === visibleMonth
                    ? "bg-primary text-white shadow-sm"
                    : "bg-slate-50 text-text-secondary hover:bg-primary/10 hover:text-primary dark:bg-white/5"
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
            <div className="grid grid-cols-7 gap-1 px-1 text-center type-micro font-black uppercase tracking-wide text-text-muted">
              {weekdayLabels.map((day) => <div key={day} className="py-1">{day}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells.map((item) => {
                const selected = item.value === value;
                return (
                  <button
                    key={item.key}
                    data-date-cell={item.value}
                    className={`relative h-10 rounded-2xl type-body-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-primary/25 ${
                      selected
                        ? "bg-primary text-white shadow-sm"
                        : item.outside
                          ? "text-text-muted/60 hover:bg-primary/8 hover:text-primary"
                          : "text-text-secondary hover:bg-primary/10 hover:text-primary"
                    }`}
                    type="button"
                    onClick={() => selectDate(item.value)}
                    onKeyDown={(event) => handleCalendarKeyDown(event, item.value)}
                    aria-label={toDisplayDate(item.value)}
                  >
                    <span>{item.day}</span>
                    {item.today && !selected ? <span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-primary" /> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={clearDate}>Clear</button>
          <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={selectToday}>Today</button>
        </div>
      </FloatingLayer>
    </label>
  );
}
