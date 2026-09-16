import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import FloatingLayer from "./FloatingLayer.jsx";
import "./FeedXDateRangePicker.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (value) => String(value).padStart(2, "0");
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parse = (value) => { const [year, month, day] = String(value || "").split("-").map(Number); return new Date(year, month - 1, day); };
const moveDays = (value, amount) => { const date = parse(value); date.setDate(date.getDate() + amount); return iso(date); };
const monthStart = (value) => { const date = parse(value); return new Date(date.getFullYear(), date.getMonth(), 1); };
const moveMonth = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const MONTHS = Array.from({ length: 12 }, (_, month) => new Date(2020, month, 1).toLocaleDateString("en-MY", { month: "short" }));

function calendarDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return { value: iso(date), day: date.getDate(), outside: date.getMonth() !== month.getMonth() }; });
}

function formatDay(value) { return parse(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }); }
export function rangeLabel(from, to, today) {
  if (from === today && to === today) return "Today";
  if (from === to) return formatDay(from);
  const start = parse(from); const end = parse(to);
  if (start.getFullYear() === end.getFullYear()) return `${start.toLocaleDateString("en-MY", { day: "numeric", month: "short" })} - ${formatDay(to)}`;
  return `${formatDay(from)} - ${formatDay(to)}`;
}

function presetRanges(today) {
  const current = parse(today); const mondayOffset = (current.getDay() + 6) % 7; const thisWeek = moveDays(today, -mondayOffset);
  const firstThisMonth = iso(new Date(current.getFullYear(), current.getMonth(), 1)); const firstLastMonth = iso(new Date(current.getFullYear(), current.getMonth() - 1, 1)); const lastLastMonth = iso(new Date(current.getFullYear(), current.getMonth(), 0));
  return [["Today", today, today], ["Yesterday", moveDays(today, -1), moveDays(today, -1)], ["This week", thisWeek, today], ["Last week", moveDays(thisWeek, -7), moveDays(thisWeek, -1)], ["Last 7 days", moveDays(today, -6), today], ["This month", firstThisMonth, today], ["Last month", firstLastMonth, lastLastMonth]];
}

function MonthYearSelector({ month, onChange, onClose }) {
  const selectedYear = month.getFullYear(); const years = Array.from({ length: 5 }, (_, index) => selectedYear - 2 + index);
  return <div className="crew-attendance-month-selector" aria-label="Choose month and year"><header><button type="button" aria-label="Previous year" onClick={() => onChange(new Date(selectedYear - 1, month.getMonth(), 1))}><ChevronLeft size={14} /></button><strong>{selectedYear}</strong><button type="button" aria-label="Next year" onClick={() => onChange(new Date(selectedYear + 1, month.getMonth(), 1))}><ChevronRight size={14} /></button></header><div className="crew-attendance-year-grid" aria-label="Choose year">{years.map((year) => <button key={year} type="button" className={year === selectedYear ? "is-selected" : ""} aria-pressed={year === selectedYear} onClick={() => onChange(new Date(year, month.getMonth(), 1))}>{year}</button>)}</div><div className="crew-attendance-month-grid">{MONTHS.map((label, monthIndex) => <button key={label} type="button" className={monthIndex === month.getMonth() ? "is-selected" : ""} aria-pressed={monthIndex === month.getMonth()} onClick={() => { onChange(new Date(selectedYear, monthIndex, 1)); onClose(); }}>{label}</button>)}</div></div>;
}

function MonthCalendar({ month, from, to, today, onSelect, onMonthChange, pane }) {
  const cells = useMemo(() => calendarDays(month), [month]); const monthLabel = month.toLocaleDateString("en-MY", { month: "long", year: "numeric" }); const [selectorOpen, setSelectorOpen] = useState(false);
  return <section className="crew-attendance-range-month" aria-label={monthLabel}><header><button className="icon-btn" type="button" aria-label={`Previous month for ${monthLabel}`} onClick={() => onMonthChange(moveMonth(month, -1), pane)}><ChevronLeft size={17} /></button><button className="crew-attendance-month-trigger" type="button" aria-label={`Choose month and year, ${monthLabel}`} aria-expanded={selectorOpen} onClick={() => setSelectorOpen((value) => !value)}><strong>{monthLabel}</strong><ChevronDown size={14} /></button><button className="icon-btn" type="button" aria-label={`Next month for ${monthLabel}`} onClick={() => onMonthChange(moveMonth(month, 1), pane)}><ChevronRight size={17} /></button></header>{selectorOpen ? <MonthYearSelector month={month} onChange={(value) => onMonthChange(value, pane)} onClose={() => setSelectorOpen(false)} /> : null}<div className="crew-attendance-range-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className="crew-attendance-range-grid">{cells.map((cell) => { const start = cell.value === from; const end = cell.value === to; const inRange = cell.value >= from && cell.value <= to; return <button key={`${monthLabel}:${cell.value}`} type="button" aria-label={formatDay(cell.value)} aria-pressed={start || end} aria-hidden={cell.outside} disabled={cell.outside} tabIndex={cell.outside ? -1 : 0} className={`${cell.outside ? "is-outside" : ""} ${inRange ? "is-in-range" : ""} ${start ? "is-start" : ""} ${end ? "is-end" : ""}`.trim()} onClick={() => onSelect(cell.value)}><span>{cell.day}</span>{cell.value === today && !start && !end ? <i /> : null}</button>; })}</div></section>;
}

function FeedXDateRangePicker({ from, to, today, onApply, label = "Date Range", placeholder = "All dates" }) {
  const effectiveFrom = from || today; const effectiveTo = to || effectiveFrom; const anchorRef = useRef(null); const [open, setOpen] = useState(false); const [draftFrom, setDraftFrom] = useState(effectiveFrom); const [draftTo, setDraftTo] = useState(effectiveTo); const [selectingEnd, setSelectingEnd] = useState(false); const [leftMonth, setLeftMonth] = useState(() => monthStart(effectiveFrom)); const [rightMonth, setRightMonth] = useState(() => moveMonth(monthStart(effectiveFrom), 1)); const presets = useMemo(() => presetRanges(today), [today]);
  useEffect(() => { if (!open) return; const initialMonth = monthStart(effectiveFrom); setDraftFrom(effectiveFrom); setDraftTo(effectiveTo); setSelectingEnd(false); setLeftMonth(initialMonth); setRightMonth(moveMonth(initialMonth, 1)); }, [effectiveFrom, effectiveTo, open]);
  function chooseDate(value) { if (!selectingEnd) { setDraftFrom(value); setDraftTo(value); setSelectingEnd(true); return; } if (value < draftFrom) { setDraftFrom(value); setDraftTo(draftFrom); } else setDraftTo(value); setSelectingEnd(false); }
  function choosePreset(start, end) { const initialMonth = monthStart(start); setDraftFrom(start); setDraftTo(end); setSelectingEnd(false); setLeftMonth(initialMonth); setRightMonth(moveMonth(initialMonth, 1)); }
  function chooseDisplayedMonth(value, pane) { const selected = new Date(value.getFullYear(), value.getMonth(), 1); if (pane === "left") setLeftMonth(selected); else setRightMonth(selected); }
  function cancel() { setDraftFrom(effectiveFrom); setDraftTo(effectiveTo); setSelectingEnd(false); setOpen(false); }
  function apply() { onApply({ from: draftFrom, to: draftTo }); setOpen(false); }
  return <div className="crew-attendance-range-field"><span>{label}</span><button ref={anchorRef} type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}><CalendarDays size={16} /><strong>{from && to ? rangeLabel(from, to, today) : placeholder}</strong><ChevronDown size={15} /></button><FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={560} estimatedHeight={360} maxHeight={420} className="crew-attendance-range-popover" contentClassName="crew-attendance-range-popover-content"><div className="crew-attendance-range-layout"><aside aria-label="Date range presets">{presets.map(([presetLabel, start, end]) => <button key={presetLabel} type="button" className={draftFrom === start && draftTo === end ? "is-active" : ""} onClick={() => choosePreset(start, end)}>{presetLabel}</button>)}</aside><main><div className="crew-attendance-range-months"><MonthCalendar month={leftMonth} from={draftFrom} to={draftTo} today={today} onSelect={chooseDate} onMonthChange={chooseDisplayedMonth} pane="left" /><MonthCalendar month={rightMonth} from={draftFrom} to={draftTo} today={today} onSelect={chooseDate} onMonthChange={chooseDisplayedMonth} pane="right" /></div></main></div><footer><button className="btn-secondary" type="button" onClick={cancel}>Cancel</button><button className="btn-primary" type="button" onClick={apply}>Apply</button></footer></FloatingLayer></div>;
}

FeedXDateRangePicker.adminFilterRole = "date-range";
export default FeedXDateRangePicker;
