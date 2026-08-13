import { useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import scheduleCalendar from "../../../assets/crew/schedule-calendar.png";

const ENTRY_LABELS = {
  working: "Working Shift",
  off: "OFF",
  leave: "Annual Leave",
  medical: "MC",
  annual_leave: "Annual Leave",
  medical_leave: "Medical Leave",
  unpaid_leave: "Unpaid Leave",
  other_leave: "Other Leave",
};

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
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
};
const entryLabel = (entry) => ENTRY_LABELS[entry?.entry_type] || entry?.template?.name || "Working";
const entryOutlet = (entry) => entry?.outlet?.name || entry?.outlet_name || "Your outlet";
const entryRole = (entry, employee) => entry?.position || employee?.position || "Crew Member";
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
  const rowRefs = useRef(new Map());
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
    requestAnimationFrame(() => rowRefs.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  return (
    <section className="crew-schedule-final">
      <CrewScheduleHeader onBack={onBack} onToday={() => selectDay(from)} />
      <CrewScheduleWeekStrip days={days} selectedDate={selectedDate} onSelect={selectDay} />
      <CrewScheduleDayCard date={selectedDate} entry={selectedEntry} employee={employee} today={from} />
      <CrewScheduleList entries={upcoming} employee={employee} selectedDate={selectedDate} rowRefs={rowRefs} />
    </section>
  );
}

export function CrewScheduleHeader({ onBack, onToday }) {
  return <header className="crew-schedule-final-header"><button type="button" onClick={onBack} aria-label="Back"><ArrowLeft size={20} /></button><h1>My Schedule</h1><button type="button" onClick={onToday} aria-label="Jump to today"><CalendarDays size={20} /></button></header>;
}

export function CrewScheduleWeekStrip({ days, selectedDate, onSelect }) {
  return <div className="crew-schedule-final-week" aria-label="Schedule week">{days.map(({ key, date, entry }) => <button key={key} type="button" className={selectedDate === key ? "is-selected" : ""} onClick={() => onSelect(key)} aria-label={`${date.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long" })}, ${entry ? entryLabel(entry) : "No published schedule"}`} aria-pressed={selectedDate === key}><small>{date.toLocaleDateString("en-MY", { weekday: "short" })}</small><strong>{date.getDate()}</strong><i className={`is-${entryTone(entry)}`} /></button>)}</div>;
}

export function CrewScheduleDayCard({ date, entry, employee, today }) {
  const value = parseDate(date);
  const working = entry?.entry_type === "working";
  const hours = durationHours(entry);
  const title = entry ? working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry) : "No published shift";
  const contextLabel = `${date === today ? "Today, " : ""}${value.toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" })}`;
  return <article className={`crew-schedule-final-day is-${entryTone(entry)}`}><div className="crew-schedule-final-day-copy"><span className="crew-schedule-final-date-label">{contextLabel}</span><h2>{title}</h2>{entry ? <p><MapPin size={15} /> <span>{entryOutlet(entry)} · {entryRole(entry, employee)}{working && hours !== null ? ` · ${hours} hrs` : ""}</span></p> : <p>No roster entry for this day.</p>}</div><CrewScheduleStatusBadge entry={entry} label={entry ? working ? "Upcoming" : entryLabel(entry) : "No Schedule"} /><img src={scheduleCalendar} alt="" aria-hidden="true" /></article>;
}

export function CrewScheduleList({ entries, employee, selectedDate, rowRefs }) {
  return <section className="crew-schedule-final-upcoming"><header><h2>Upcoming Schedule</h2><span>Next 14 days</span></header>{entries.length ? <div className="crew-schedule-final-list">{entries.map((entry) => <CrewScheduleListItem key={entry.id} entry={entry} employee={employee} selected={entry.date === selectedDate} rowRef={(node) => { if (node) rowRefs.current.set(entry.date, node); else rowRefs.current.delete(entry.date); }} />)}</div> : <div className="crew-schedule-final-empty"><strong>No upcoming published schedule</strong><span>Your next published roster will appear here.</span></div>}</section>;
}

export function CrewScheduleListItem({ entry, employee, selected, rowRef }) {
  const date = parseDate(entry.date);
  const working = entry.entry_type === "working";
  const hours = durationHours(entry);
  return <article ref={rowRef} className={`crew-schedule-final-row is-${entryTone(entry)} ${selected ? "is-selected" : ""}`}><time dateTime={entry.date}><strong>{date.toLocaleDateString("en-MY", { weekday: "short" })}</strong><small>{date.toLocaleDateString("en-MY", { day: "numeric", month: "short" })}</small></time><i className="crew-schedule-final-timeline" /><div className="crew-schedule-final-row-copy"><strong>{working ? `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}` : entryLabel(entry)}</strong><small>{working && <MapPin size={13} />}{entryOutlet(entry)}{working ? <><span>{entryRole(entry, employee)} · {hours ?? "—"} hrs</span></> : ` · ${entryRole(entry, employee)}`}</small></div><CrewScheduleStatusBadge entry={entry} label={working ? "Upcoming" : entryLabel(entry)} /></article>;
}

export function CrewScheduleStatusBadge({ entry, label }) {
  return <em className={`crew-schedule-final-badge is-${entryTone(entry)}`}>{label}</em>;
}
