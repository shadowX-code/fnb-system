import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./CrewDatePicker.css";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewPickerField from "./CrewPickerField.jsx";
import { formatCrewDate } from "../utils/crewI18n.js";

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, month - 1, day);
};
const monthStart = (value) => {
  const date = value ? parseDate(value) : new Date();
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
export default function CrewDatePicker({ label, value, min, disabled = false, onChange, monthOnly = false, placeholder }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dateValue = monthOnly && value ? `${value}-01` : value;
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(dateValue));
  const today = dateKey(new Date());
  const cells = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    if (open) setVisibleMonth(monthStart(dateValue));
  }, [open, dateValue]);

  const display = dateValue ? formatCrewDate(`${dateValue}T12:00:00+08:00`,
    monthOnly ? { month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" })
    : placeholder || t("common.selectDate");
  const year = visibleMonth.getFullYear();
  const periodLabel = monthOnly ? String(year) : formatCrewDate(`${dateKey(visibleMonth)}T12:00:00+08:00`, { month: "long", year: "numeric" });
  const monthOffset = monthOnly ? 12 : 1;
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, index + 1));
  const select = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <CrewPickerField className="crew-date-picker-field" label={label} display={display} open={open} disabled={disabled} onOpen={() => setOpen(true)}>
    <CrewBottomSheet title={label} description={monthOnly ? undefined : t("leave.dates")} onClose={() => setOpen(false)} className="crew-date-picker-sheet" contentClassName="crew-date-picker-sheet-content" headerIcon={<CalendarDays size={18} />}>
      <section className="crew-date-picker-calendar" aria-label={periodLabel}>
        <header>
          <button type="button" className="crew-mobile-detail-icon-action" aria-label={t(monthOnly ? "schedule.previousYear" : "schedule.previousMonth")} onClick={() => setVisibleMonth(current => addMonths(current, -monthOffset))}><ChevronLeft size={19} /></button>
          <strong aria-live="polite">{periodLabel}</strong>
          <button type="button" className="crew-mobile-detail-icon-action" aria-label={t(monthOnly ? "schedule.nextYear" : "schedule.nextMonth")} onClick={() => setVisibleMonth(current => addMonths(current, monthOffset))}><ChevronRight size={19} /></button>
        </header>
        {monthOnly ? <div className="crew-date-picker-grid crew-date-picker-grid--months">
          {Array.from({ length: 12 }, (_, index) => {
            const month = `${year}-${pad(index + 1)}`;
            return <button key={month} type="button" aria-pressed={value === month} onClick={() => select(month)}>
              {formatCrewDate(`${month}-01T12:00:00+08:00`, { month: "short" })}
            </button>;
          })}
        </div> : <>
        <div className="crew-date-picker-weekdays" aria-hidden="true">{weekdays.map((date) => <span key={date.getDay()}>{formatCrewDate(date, { weekday: "short" })}</span>)}</div>
        <div className="crew-date-picker-grid">{cells.map((cell) => {
          const unavailable = cell.outside || Boolean(min && cell.value < min);
          const selected = cell.value === value;
          return <button key={cell.value} type="button" disabled={unavailable} aria-label={formatCrewDate(`${cell.value}T12:00:00+08:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} aria-pressed={selected} aria-current={cell.value === today ? "date" : undefined} className={`${cell.outside ? "is-outside" : ""}${selected ? " is-selected" : ""}${cell.value === today ? " is-today" : ""}`} onClick={() => select(cell.value)}><span>{cell.date.getDate()}</span></button>;
        })}</div>
        </>}
      </section>
    </CrewBottomSheet>
  </CrewPickerField>;
}
