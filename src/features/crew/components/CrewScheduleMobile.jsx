import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { crewLocale, formatCrewDate } from "../utils/crewI18n.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewStatusBadge } from "./CrewMobileUI.jsx";

const parseDate = (value) => new Date(`${value}T00:00:00`);
const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const formatRosterTime = (value) => {
  if (!value) return "—";
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(crewLocale(), { hour: "numeric", minute: "2-digit" });
};
const entryLabel = (entry, t) => ({ working: t("schedule.working"), off: t("schedule.off"), leave: t("schedule.annualLeave"), medical: "MC", annual_leave: t("schedule.annualLeave"), medical_leave: t("schedule.medicalLeave"), unpaid_leave: t("schedule.unpaidLeave"), other_leave: t("schedule.otherLeave") }[entry?.entry_type] || entry?.template?.name || t("schedule.working"));
const entryOutlet = (entry, t) => entry?.outlet?.name || entry?.outlet_name || t("home.yourOutlet");
const entryRole = (entry, employee, t) => entry?.position || employee?.position || t("home.crewMember");
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

export default function CrewScheduleMobile({ roster, employee, onBack }) {
  const from = roster?.from || dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(from);
  const entries = roster?.entries || [];
  const entryByDate = useMemo(() => new Map(entries.map((entry) => [entry.date, entry])), [entries]);
  const selectedEntry = entryByDate.get(selectedDate) || (roster?.today?.date === selectedDate ? roster.today : null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = parseDate(from);
    date.setDate(date.getDate() + index);
    const key = dateKey(date);
    return { key, date, entry: entryByDate.get(key) || (roster?.today?.date === key ? roster.today : null) };
  }), [entryByDate, from, roster?.today]);
  const upcoming = entries.filter((entry) => entry.date > from);

  function selectDay(key) {
    setSelectedDate(key);
  }

  return (
    <section className="crew-schedule-final">
      <CrewScheduleHeader onBack={onBack} />
      <CrewScheduleWeekStrip days={days} selectedDate={selectedDate} onSelect={selectDay} />
      <CrewScheduleDayCard date={selectedDate} entry={selectedEntry} employee={employee} today={from} />
      <CrewScheduleList entries={upcoming} employee={employee} selectedDate={selectedDate} />
    </section>
  );
}

export function CrewScheduleHeader({ onBack }) {
  const { t } = useTranslation();
  return <CrewMobileDetailHeader className="crew-schedule-final-header" title={t("schedule.title")} onBack={onBack} />;
}

export function CrewScheduleWeekStrip({ days, selectedDate, onSelect }) {
  const { t } = useTranslation();
  return <div className="crew-ui-segmented crew-ui-segmented--mint crew-schedule-final-week" aria-label={t("schedule.title")}>{days.map(({ key, date, entry }) => <button key={key} type="button" className={selectedDate === key ? "is-selected" : ""} onClick={() => onSelect(key)} aria-label={`${formatCrewDate(date, { weekday: "long", day: "numeric", month: "long" })}, ${entry ? entryLabel(entry, t) : t("schedule.noSchedule")}`} aria-pressed={selectedDate === key}><span className="crew-schedule-final-date-block"><small>{formatCrewDate(date, { weekday: "short" })}</small><strong>{date.getDate()}</strong></span><i className={`is-${entryTone(entry)}`} /></button>)}</div>;
}

export function CrewScheduleDayCard({ date, entry, employee, today }) {
  const { t } = useTranslation();
  const value = parseDate(date);
  const working = entry?.entry_type === "working";
  const hours = durationHours(entry);
  const title = entry ? working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry, t) : t("schedule.noSchedule");
  const contextLabel = `${date === today ? `${t("common.today")}, ` : ""}${formatCrewDate(value, { weekday: "short", day: "numeric", month: "short" })}`;
  return <article className={`crew-schedule-final-day is-${entryTone(entry)}`}><div className="crew-schedule-final-day-copy"><span className="crew-schedule-final-date-label">{contextLabel}</span><h2>{title}</h2>{entry ? <p><MapPin size={15} /> <span>{entryOutlet(entry, t)} · {entryRole(entry, employee, t)}{working && hours !== null ? ` · ${t("schedule.hours", { count: hours })}` : ""}</span></p> : <p>{t("schedule.noScheduleBody")}</p>}</div>{entry ? <CrewScheduleStatusBadge entry={entry} label={working ? t("schedule.upcomingStatus") : entryLabel(entry, t)} /> : null}</article>;
}

export function CrewScheduleList({ entries, employee, selectedDate }) {
  const { t } = useTranslation();
  return <section className="crew-schedule-final-upcoming"><header><h2>{t("schedule.upcoming")}</h2><span>{t("schedule.nextDays")}</span></header>{entries.length ? <div className="crew-schedule-final-list">{entries.map((entry) => <CrewScheduleListItem key={entry.id} entry={entry} employee={employee} selected={entry.date === selectedDate} />)}</div> : <div className="crew-schedule-final-empty"><strong>{t("schedule.noSchedule")}</strong><span>{t("schedule.noScheduleBody")}</span></div>}</section>;
}

export function CrewScheduleListItem({ entry, employee, selected }) {
  const { t } = useTranslation();
  const date = parseDate(entry.date);
  const working = entry.entry_type === "working";
  const hours = durationHours(entry);
  return <article className={`crew-schedule-final-row is-${entryTone(entry)} ${selected ? "is-selected" : ""}`}><time dateTime={entry.date}><strong>{formatCrewDate(date, { weekday: "short" })}</strong><small>{formatCrewDate(date, { day: "numeric", month: "short" })}</small></time><i className="crew-schedule-final-timeline" /><div className="crew-schedule-final-row-copy"><strong>{working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry, t)}</strong><small>{working && <MapPin size={13} />}{entryOutlet(entry, t)}{working ? <><span>{entryRole(entry, employee, t)} · {t("schedule.hours", { count: hours ?? "—" })}</span></> : ` · ${entryRole(entry, employee, t)}`}</small></div><CrewScheduleStatusBadge entry={entry} label={working ? t("schedule.upcomingStatus") : entryLabel(entry, t)} /></article>;
}

export function CrewScheduleStatusBadge({ entry, label }) {
  const tone = entryTone(entry);
  return <CrewStatusBadge tone={tone === "working" ? "success" : tone === "leave" || tone === "medical" ? "warning" : "neutral"}>{label}</CrewStatusBadge>;
}
