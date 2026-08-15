import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value) { return String(value).padStart(2, "0"); }
function iso(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function parse(value) { const [year, month, day] = String(value || "").split("-").map(Number); return new Date(year, month - 1, day); }
function moveDays(value, amount) { const date = parse(value); date.setDate(date.getDate() + amount); return iso(date); }
function monthStart(value) { const date = parse(value); return new Date(date.getFullYear(), date.getMonth(), 1); }
function moveMonth(date, amount) { return new Date(date.getFullYear(), date.getMonth() + amount, 1); }

function calendarDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { value: iso(date), day: date.getDate(), outside: date.getMonth() !== month.getMonth() };
  });
}

function formatDay(value) {
  return parse(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

export function rangeLabel(from, to, today) {
  if (from === today && to === today) return "Today";
  if (from === to) return formatDay(from);
  const start = parse(from); const end = parse(to);
  if (start.getFullYear() === end.getFullYear()) {
    const startText = start.toLocaleDateString("en-MY", { day: "numeric", month: "short" });
    return `${startText} – ${formatDay(to)}`;
  }
  return `${formatDay(from)} – ${formatDay(to)}`;
}

function presetRanges(today) {
  const current = parse(today);
  const mondayOffset = (current.getDay() + 6) % 7;
  const thisWeek = moveDays(today, -mondayOffset);
  const firstThisMonth = iso(new Date(current.getFullYear(), current.getMonth(), 1));
  const firstLastMonth = iso(new Date(current.getFullYear(), current.getMonth() - 1, 1));
  const lastLastMonth = iso(new Date(current.getFullYear(), current.getMonth(), 0));
  return [
    ["Today", today, today],
    ["Yesterday", moveDays(today, -1), moveDays(today, -1)],
    ["This week", thisWeek, today],
    ["Last week", moveDays(thisWeek, -7), moveDays(thisWeek, -1)],
    ["Last 7 days", moveDays(today, -6), today],
    ["This month", firstThisMonth, today],
    ["Last month", firstLastMonth, lastLastMonth],
  ];
}

function MonthCalendar({ month, from, to, today, onSelect }) {
  const cells = useMemo(() => calendarDays(month), [month]);
  const monthLabel = month.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
  return <section className="crew-attendance-range-month" aria-label={monthLabel}>
    <h3>{monthLabel}</h3>
    <div className="crew-attendance-range-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="crew-attendance-range-grid">{cells.map((cell) => {
      const start = cell.value === from; const end = cell.value === to;
      const inRange = cell.value >= from && cell.value <= to;
      return <button
        key={`${monthLabel}:${cell.value}`}
        type="button"
        aria-label={formatDay(cell.value)}
        aria-pressed={start || end}
        aria-hidden={cell.outside}
        disabled={cell.outside}
        tabIndex={cell.outside ? -1 : 0}
        className={`${cell.outside ? "is-outside" : ""} ${inRange ? "is-in-range" : ""} ${start ? "is-start" : ""} ${end ? "is-end" : ""}`.trim()}
        onClick={() => onSelect(cell.value)}
      ><span>{cell.day}</span>{cell.value === today && !start && !end ? <i /> : null}</button>;
    })}</div>
  </section>;
}

export default function CrewAttendanceDateRangePicker({ from, to, today, onApply }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(from));
  const presets = useMemo(() => presetRanges(today), [today]);

  useEffect(() => {
    if (!open) return;
    setDraftFrom(from); setDraftTo(to); setSelectingEnd(false); setVisibleMonth(monthStart(from));
  }, [from, open, to]);

  function chooseDate(value) {
    if (!selectingEnd) {
      setDraftFrom(value); setDraftTo(value); setSelectingEnd(true);
      return;
    }
    if (value < draftFrom) { setDraftFrom(value); setDraftTo(draftFrom); }
    else setDraftTo(value);
    setSelectingEnd(false);
  }

  function choosePreset(start, end) {
    setDraftFrom(start); setDraftTo(end); setSelectingEnd(false); setVisibleMonth(monthStart(start));
  }

  function cancel() { setDraftFrom(from); setDraftTo(to); setSelectingEnd(false); setOpen(false); }
  function apply() { onApply({ from: draftFrom, to: draftTo }); setOpen(false); }

  return <div className="crew-attendance-range-field">
    <span>Date Range</span>
    <button ref={anchorRef} type="button" aria-label="Date Range" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <CalendarDays size={16} /><strong>{rangeLabel(from, to, today)}</strong><ChevronDown size={15} />
    </button>
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={760} estimatedHeight={470} maxHeight={620} className="crew-attendance-range-popover" contentClassName="crew-attendance-range-popover-content">
      <div className="crew-attendance-range-layout">
        <aside aria-label="Date range presets">{presets.map(([label, start, end]) => <button key={label} type="button" className={draftFrom === start && draftTo === end ? "is-active" : ""} onClick={() => choosePreset(start, end)}>{label}</button>)}</aside>
        <main>
          <header>
            <button className="icon-btn" type="button" aria-label="Previous month" onClick={() => setVisibleMonth((value) => moveMonth(value, -1))}><ChevronLeft size={17} /></button>
            <p><strong>{rangeLabel(draftFrom, draftTo, today)}</strong><span>{selectingEnd ? "Select an end date" : "Select a start date or use a preset"}</span></p>
            <button className="icon-btn" type="button" aria-label="Next month" onClick={() => setVisibleMonth((value) => moveMonth(value, 1))}><ChevronRight size={17} /></button>
          </header>
          <div className="crew-attendance-range-months"><MonthCalendar month={visibleMonth} from={draftFrom} to={draftTo} today={today} onSelect={chooseDate} /><MonthCalendar month={moveMonth(visibleMonth, 1)} from={draftFrom} to={draftTo} today={today} onSelect={chooseDate} /></div>
        </main>
      </div>
      <footer><button className="btn-secondary" type="button" onClick={cancel}>Cancel</button><button className="btn-primary" type="button" onClick={apply}>Apply</button></footer>
    </FloatingLayer>
  </div>;
}
