import { useEffect, useId, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./CrewDatePicker.css";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import { formatCrewDate } from "../utils/crewI18n.js";

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, month - 1, day);
};
const monthStart = (value) => {
  const date = parseDate(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
};
const addMonths = (value, amount) => new Date(value.getFullYear(), value.getMonth() + amount, 1);

function calendarDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, value: dateKey(date), outside: date.getMonth() !== month.getMonth() };
  });
}

/**
 * Canonical Crew date field and mobile calendar. It intentionally selects one
 * operational date at a time; workflows compose Start and End fields instead
 * of inventing a second range-selection contract.
 */
export default function CrewDatePicker({ label, value, min, disabled = false, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(value));
  const today = dateKey(new Date());
  const labelId = useId();
  const cells = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    if (open) setVisibleMonth(monthStart(value));
  }, [open, value]);

  const monthLabel = formatCrewDate(visibleMonth, { month: "long", year: "numeric" });
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, index + 1));
  const select = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className="crew-ui-form-field crew-date-picker-field">
    <span id={labelId}>{label}</span>
    <button type="button" className="crew-date-picker-trigger" aria-labelledby={labelId} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <CalendarDays size={18} aria-hidden="true" />
      <strong>{formatCrewDate(`${value}T12:00:00+08:00`, { day: "numeric", month: "short", year: "numeric" })}</strong>
    </button>
    {open ? <CrewBottomSheet title={label} description={t("leave.dates")} onClose={() => setOpen(false)} className="crew-date-picker-sheet" contentClassName="crew-date-picker-sheet-content" headerIcon={<CalendarDays size={18} />}>
      <section className="crew-date-picker-calendar" aria-label={monthLabel}>
        <header>
          <button type="button" aria-label={t("schedule.previousMonth")} onClick={() => setVisibleMonth((current) => addMonths(current, -1))}><ChevronLeft size={19} /></button>
          <strong>{monthLabel}</strong>
          <button type="button" aria-label={t("schedule.nextMonth")} onClick={() => setVisibleMonth((current) => addMonths(current, 1))}><ChevronRight size={19} /></button>
        </header>
        <div className="crew-date-picker-weekdays" aria-hidden="true">{weekdays.map((date) => <span key={date.getDay()}>{formatCrewDate(date, { weekday: "short" })}</span>)}</div>
        <div className="crew-date-picker-grid">{cells.map((cell) => {
          const unavailable = cell.outside || Boolean(min && cell.value < min);
          const selected = cell.value === value;
          return <button key={cell.value} type="button" disabled={unavailable} aria-label={formatCrewDate(cell.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} aria-pressed={selected} aria-current={cell.value === today ? "date" : undefined} className={`${cell.outside ? "is-outside" : ""}${selected ? " is-selected" : ""}${cell.value === today ? " is-today" : ""}`} onClick={() => select(cell.value)}><span>{cell.date.getDate()}</span></button>;
        })}</div>
      </section>
    </CrewBottomSheet> : null}
  </div>;
}
