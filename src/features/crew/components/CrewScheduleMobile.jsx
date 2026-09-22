import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { crewLocale, formatCrewDate } from "../utils/crewI18n.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

const parseDate = (value) => new Date(`${value}T00:00:00`);
const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);
const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const weekStartFor = (value) => {
  const date = parseDate(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dateKey(date);
};
const formatRosterTime = (value) => {
  if (!value) return "—";
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(crewLocale(), { hour: "numeric", minute: "2-digit" });
};
const entryLabel = (entry, t) => ({ working: t("schedule.working"), off: t("schedule.off"), leave: t("schedule.annualLeave"), medical: "MC", annual_leave: t("schedule.annualLeave"), medical_leave: t("schedule.medicalLeave"), unpaid_leave: t("schedule.unpaidLeave"), other_leave: t("schedule.otherLeave") }[entry?.entry_type] || entry?.template?.name || t("schedule.working"));
const entryOutlet = (entry, t) => entry?.outlet?.name || entry?.outlet_name || t("home.yourOutlet");
const entryTone = (entry) => {
  if (!entry) return "none";
  if (entry.entry_type === "working") return "working";
  if (entry.entry_type === "off") return "off";
  if (["medical", "medical_leave"].includes(entry.entry_type)) return "medical";
  return "leave";
};
const durationHours = (entry) => {
  if (entry?.entry_type !== "working" || !entry.start_time || !entry.end_time) return null;
  const [startHour, startMinute] = entry.start_time.split(":").map(Number);
  const [endHour, endMinute] = entry.end_time.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - startHour * 60 - startMinute;
  if (minutes < 0) minutes += 24 * 60;
  minutes = Math.max(0, minutes - Number(entry.break_minutes || 0));
  return Math.round((minutes / 60) * 10) / 10;
};

export default function CrewScheduleMobile({ roster, onBack }) {
  const from = roster?.from || dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(from);
  const [weekStart, setWeekStart] = useState(from);
  const [isMonthExpanded, setIsMonthExpanded] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseDate(from)));
  const entries = roster?.entries || [];
  const entryByDate = useMemo(() => new Map(entries.map((entry) => [entry.date, entry])), [entries]);
  const selectedEntry = entryByDate.get(selectedDate) || (roster?.today?.date === selectedDate ? roster.today : null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = parseDate(weekStart);
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    return { key, date, entry: entryByDate.get(key) || (roster?.today?.date === key ? roster.today : null) };
  }), [entryByDate, roster?.today, weekStart]);
  const monthDays = useMemo(() => {
    const first = startOfMonth(visibleMonth);
    const start = new Date(first);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const last = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
    const totalDays = Math.ceil((((last.getDay() + 6) % 7) + last.getDate()) / 7) * 7;
    return Array.from({ length: totalDays }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dateKey(date);
      return { key, date, inMonth: date.getMonth() === visibleMonth.getMonth(), entry: entryByDate.get(key) || (roster?.today?.date === key ? roster.today : null) };
    });
  }, [entryByDate, roster?.today, visibleMonth]);
  const upcoming = entries.filter((entry) => entry.date > from);

  function selectDay(key) {
    setSelectedDate(key);
  }

  function toggleCalendar() {
    if (isMonthExpanded) {
      setWeekStart(weekStartFor(selectedDate));
      setIsMonthExpanded(false);
      return;
    }
    setVisibleMonth(startOfMonth(parseDate(selectedDate)));
    setIsMonthExpanded(true);
  }

  return (
    <section className="crew-schedule-final">
      <CrewScheduleHeader onBack={onBack} expanded={isMonthExpanded} onToggleCalendar={toggleCalendar} />
      <CrewScheduleCalendar expanded={isMonthExpanded} days={days} monthDays={monthDays} visibleMonth={visibleMonth} selectedDate={selectedDate} today={roster?.today?.date || from} onSelect={selectDay} onChangeMonth={(amount) => setVisibleMonth((month) => addMonths(month, amount))} />
      <CrewScheduleDayCard date={selectedDate} entry={selectedEntry} today={from} />
      <CrewScheduleList entries={upcoming} selectedDate={selectedDate} />
    </section>
  );
}

export function CrewScheduleHeader({ onBack, expanded, onToggleCalendar }) {
  const { t } = useTranslation();
  return <CrewMobileDetailHeader className="crew-schedule-final-header" title={t("schedule.title")} onBack={onBack} action={<button type="button" className="crew-mobile-detail-icon-action" onClick={onToggleCalendar} aria-label={expanded ? t("schedule.collapseCalendar") : t("schedule.expandCalendar")}><CalendarDays size={19} /></button>} />;
}

export function CrewScheduleCalendar({ expanded, days, monthDays, visibleMonth, selectedDate, today, onSelect, onChangeMonth }) {
  const { t } = useTranslation();
  if (!expanded) return <CrewScheduleWeekStrip days={days} selectedDate={selectedDate} onSelect={onSelect} />;
  const weekDays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index));
  return <section className="crew-ui-segmented crew-ui-segmented--mint crew-schedule-final-calendar is-expanded" aria-label={t("schedule.title")}>
    <header className="crew-schedule-month-header"><button type="button" className="crew-mobile-detail-icon-action" onClick={() => onChangeMonth(-1)} aria-label={t("schedule.previousMonth")}><ChevronLeft size={18} /></button><strong>{formatCrewDate(visibleMonth, { month: "long", year: "numeric" })}</strong><button type="button" className="crew-mobile-detail-icon-action" onClick={() => onChangeMonth(1)} aria-label={t("schedule.nextMonth")}><ChevronRight size={18} /></button></header>
    <div className="crew-schedule-month-weekdays" aria-hidden="true">{weekDays.map((date) => <span key={date.getDay()}>{formatCrewDate(date, { weekday: "short" })}</span>)}</div>
    <div className="crew-schedule-month-grid">{monthDays.map(({ key, date, inMonth, entry }) => inMonth ? <button key={key} type="button" className={`crew-schedule-month-cell${selectedDate === key ? " is-selected" : ""}${today === key ? " is-today" : ""}`} onClick={() => onSelect(key)} aria-label={`${formatCrewDate(date, { weekday: "long", day: "numeric", month: "long" })}, ${entry ? entryLabel(entry, t) : t("schedule.noSchedule")}`} aria-pressed={selectedDate === key} aria-current={today === key ? "date" : undefined}><span>{date.getDate()}</span>{entry ? <i className={`is-${entryTone(entry)}`} /> : null}</button> : <span key={key} className="crew-schedule-month-placeholder">{date.getDate()}</span>)}</div>
  </section>;
}

export function CrewScheduleWeekStrip({ days, selectedDate, onSelect }) {
  const { t } = useTranslation();
  return <div className="crew-ui-segmented crew-ui-segmented--mint crew-schedule-final-week" aria-label={t("schedule.title")}>{days.map(({ key, date, entry }) => <button key={key} type="button" className={selectedDate === key ? "is-selected" : ""} onClick={() => onSelect(key)} aria-label={`${formatCrewDate(date, { weekday: "long", day: "numeric", month: "long" })}, ${entry ? entryLabel(entry, t) : t("schedule.noSchedule")}`} aria-pressed={selectedDate === key}><span className="crew-schedule-final-date-block"><small>{formatCrewDate(date, { weekday: "short" })}</small><strong>{date.getDate()}</strong></span>{entry ? <i className={`is-${entryTone(entry)}`} /> : null}</button>)}</div>;
}

export function CrewScheduleDayCard({ date, entry, today }) {
  const { t } = useTranslation();
  const value = parseDate(date);
  const working = entry?.entry_type === "working";
  const hours = durationHours(entry);
  const title = entry ? working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry, t) : t("schedule.noSchedule");
  const contextLabel = `${date === today ? `${t("common.today")}, ` : ""}${formatCrewDate(value, { weekday: "short", day: "numeric", month: "short" })}`;
  return <article className={`crew-schedule-final-day is-${entryTone(entry)}${entry ? "" : " is-empty"}`}><div className="crew-schedule-final-day-copy"><span className="crew-schedule-final-date-label">{contextLabel}</span><h2 className={entry ? "crew-type-detail-title" : "crew-type-card-title"}>{title}</h2>{entry ? <div className="crew-schedule-final-day-meta"><p className="crew-type-secondary"><MapPin size={15} /> <span>{entryOutlet(entry, t)}</span></p>{working && hours !== null ? <small className="crew-schedule-final-duration crew-type-helper">{t("schedule.hours", { count: hours })}</small> : null}</div> : <p className="crew-type-helper">{t("schedule.noScheduleBody")}</p>}</div>{entry ? <CrewScheduleStatusBadge entry={entry} label={working ? t("schedule.upcomingStatus") : entryLabel(entry, t)} /> : null}</article>;
}

export function CrewScheduleList({ entries, selectedDate }) {
  const { t } = useTranslation();
  return <section className="crew-schedule-final-upcoming"><CrewSectionHeader density="operational" title={t("schedule.upcoming")} trailing={<CrewStatusBadge tone="neutral">{t("schedule.nextDays")}</CrewStatusBadge>} />{entries.length ? <div className="crew-schedule-final-list">{entries.map((entry) => <CrewScheduleListItem key={entry.id} entry={entry} selected={entry.date === selectedDate} />)}</div> : <div className="crew-schedule-final-empty"><strong>{t("schedule.noSchedule")}</strong><span>{t("schedule.noScheduleBody")}</span></div>}</section>;
}

export function CrewScheduleListItem({ entry, selected }) {
  const { t } = useTranslation();
  const date = parseDate(entry.date);
  const working = entry.entry_type === "working";
  const hours = durationHours(entry);
  return <article className={`crew-schedule-final-row is-${entryTone(entry)} ${selected ? "is-selected" : ""}`}><time dateTime={entry.date}><strong>{formatCrewDate(date, { weekday: "short" })}</strong><small>{formatCrewDate(date, { day: "numeric", month: "short" })}</small></time><i className="crew-schedule-final-timeline" /><div className="crew-schedule-final-row-copy"><strong>{working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry, t)}</strong><div className="crew-schedule-final-row-meta"><small className="crew-type-helper">{working && <MapPin size={13} />}<span>{entryOutlet(entry, t)}</span></small>{working ? <small className="crew-schedule-final-duration crew-type-helper">{t("schedule.hours", { count: hours ?? "—" })}</small> : null}</div></div><CrewScheduleStatusBadge entry={entry} label={working ? t("schedule.upcomingStatus") : entryLabel(entry, t)} /></article>;
}

export function CrewScheduleStatusBadge({ entry, label }) {
  const tone = entryTone(entry);
  return <CrewStatusBadge tone={tone === "working" ? "success" : tone === "leave" || tone === "medical" ? "warning" : "neutral"}>{label}</CrewStatusBadge>;
}
