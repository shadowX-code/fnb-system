import { useTranslation } from "react-i18next";
import { Bell, CalendarCheck, CalendarDays, Check, ChevronRight, ClipboardCheck, Clock3, Fingerprint, MapPin, ShieldCheck } from "lucide-react";
import CrewHomeClockMotion from "../CrewHomeClockMotion.jsx";
import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { formatCrewDate, translateStatus } from "../utils/crewI18n.js";
import { formatTime, malaysiaDateKey, formatRosterTime, rosterEntryLabel, formatHomeDate, formatHomeClock, formatDuration } from "../utils/crewMobile.js";
import crewHomeAttendanceMintBackground from "../assets/crew-home-attendance-mint-background.webp";

function HomeScheduleRow({ entry, label, onClick }) {
  const { t } = useTranslation();
  const away = entry.entry_type !== "working";
  const outlet = entry.outlet_name || entry.outlet?.name || t("home.yourOutlet");
  const dateLabel = label || formatCrewDate(`${entry.date}T12:00:00+08:00`, { weekday: "short", day: "numeric", month: "short" });
  const scheduleLabel = away ? rosterEntryLabel(entry, t) : `${formatRosterTime(entry.start_time)} – ${formatRosterTime(entry.end_time)}`;
  const title = label === "today" ? t("common.today") : dateLabel;
  return <button type="button" className={`crew-home-schedule-row ${away ? "is-away" : "is-working"}`} onClick={onClick} aria-label={`${dateLabel}, ${scheduleLabel}`}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarDays size={19} /></i><span><strong className="crew-list-primary">{title}</strong>{!away && <small className="crew-home-schedule-time">{scheduleLabel}</small>}<small className="crew-list-secondary">{outlet}</small></span>{away && <CrewStatusBadge tone="warning">{scheduleLabel}</CrewStatusBadge>}<ChevronRight size={18} /></button>;
}


export default function CrewHomeMobile({ session, attendance, context, roster, operations, clock, navigate, onOpenTask }) {
  const { t } = useTranslation();
  const employee = session.employee || {};
  const firstName = employee.nickname || employee.full_name?.split(" ")[0] || t("auth.crew");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("home.morning") : hour < 18 ? t("home.afternoon") : t("home.evening");
  const { openShift, nowTick, clockTransition, loading, prepareClock } = clock;
  const todayRoster = roster?.today;
  const upcomingRoster = (roster?.entries || []).filter((entry) => entry.date > (todayRoster?.date || roster?.from)).slice(0, 2);
  const homeTasks = (operations?.tasks || []).map((row) => {
    const progress = row.source === "legacy_daily"
      ? row.description || null
      : t("tasks.completedCount", { completed: row.completed_count || 0, total: row.block_count || 0 });
    const deadline = row.due_at
      ? { time: formatTime(row.due_at), overdue: row.status === "overdue" }
      : null;
    return { kind: row.source === "legacy_daily" ? "legacy_task" : "task", row, id: `${row.source || "task"}-${row.id}`, title: row.name || row.title, progress, deadline, status: row.status || "pending" };
  });
  const homeTaskBadgeState = homeTasks.length === 0 ? "empty" : homeTasks.every((task) => task.status === "completed") ? "complete" : "alert";
  const completedToday = attendance.find((item) => item.clock_out_at && malaysiaDateKey(item.clock_in_at) === malaysiaDateKey());
  const attendanceMode = openShift ? "on" : completedToday ? "completed" : "ready";
  const homeClock = formatHomeClock(nowTick);
  const attendanceOutlet = context?.outlet_name || todayRoster?.outlet_name || t("home.yourOutlet");
  const shiftLabel = todayRoster?.entry_type === "working" ? `${formatRosterTime(todayRoster.start_time)} – ${formatRosterTime(todayRoster.end_time)}` : todayRoster ? rosterEntryLabel(todayRoster, t) : t("home.notPublished");
  const locationEvidence = attendanceMode === "on"
    ? openShift?.clock_in_location_verified
      ? { tone: "is-verified", label: t("locationEvidence.verified"), title: t("locationEvidence.verifiedHelp") }
      : openShift?.clock_in_location_exception
        ? { tone: "is-exception", label: t("locationEvidence.exception"), title: t("locationEvidence.exceptionHelp") }
        : { tone: "is-pending", label: t("locationEvidence.unavailable"), title: t("locationEvidence.unavailableHelp") }
    : context?.location_enabled
      ? { tone: "is-pending", label: t("locationEvidence.checkAtClockIn"), title: t("locationEvidence.checkAtClockInHelp") }
      : { tone: "is-pending", label: t("locationEvidence.notConfigured"), title: t("locationEvidence.notConfiguredHelp") };

  return <section className="crew-v2-home">
      <header className="crew-v2-home-header"><div><p>{greeting},</p><h1>{firstName} <Clock3 className="crew-home-shift-status-icon" size={18} aria-hidden="true" /></h1><small>{employee.position || t("home.crewMember")} · {context?.outlet_name || employee.workplace || t("home.yourOutlet")}</small></div><div><button type="button" aria-label={t("me.notifications")}><Bell size={18} /></button><span className="crew-v2-avatar">{firstName.slice(0, 1)}</span></div></header>
      <section className={`crew-home-attendance is-${attendanceMode}`} aria-label={t("locationEvidence.attendanceStatus")}>
        <div className="crew-home-attendance-main">
          <img className="crew-home-attendance-art" src={crewHomeAttendanceMintBackground} alt="" aria-hidden="true" />
          <div className="crew-home-attendance-copy">
            <CrewStatusBadge tone={attendanceMode === "completed" ? "neutral" : "success"}>{attendanceMode === "on" ? t("home.onShift") : attendanceMode === "completed" ? t("home.shiftCompleted") : t("home.ready")}</CrewStatusBadge>
            {attendanceMode === "completed" ? <><div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</strong><small>{t("home.workedDuration")}</small></div><dl><div><dt>{t("home.clockInAt")}</dt><dd>{formatTime(completedToday.clock_in_at)}</dd></div><div><dt>{t("home.clockOutAt")}</dt><dd>{formatTime(completedToday.clock_out_at)}</dd></div></dl></> : attendanceMode === "on" ? <div className="crew-home-attendance-metric"><strong className="crew-home-worked">{formatDuration(openShift.clock_in_at, nowTick)}</strong><small>{t("home.clockedInAt", { time: formatTime(openShift.clock_in_at) })}</small></div> : <div className="crew-home-ready-row"><strong className="crew-home-current-time"><span>{homeClock.time}</span><b>{homeClock.period.toLowerCase()}</b></strong><span className="crew-home-ready-context"><b>{formatHomeDate(nowTick)}</b><small title={attendanceOutlet}><MapPin size={12} /><span>{attendanceOutlet}</span></small></span></div>}
            {attendanceMode !== "ready" && <p title={attendanceOutlet}><MapPin size={15} /> {attendanceOutlet}</p>}
            {attendanceMode === "on" && locationEvidence.tone === "is-exception" && <span className="crew-home-location-exception" title={locationEvidence.title}><MapPin size={13} /><span>{locationEvidence.label}</span></span>}
          </div>
          <CrewHomeClockMotion attendanceMode={attendanceMode} transition={clockTransition} loading={loading} hasException={locationEvidence.tone === "is-exception"}>
            {attendanceMode !== "completed" ? <button type="button" className="crew-home-clock-action" onClick={() => prepareClock(attendanceMode === "on" ? "out" : "in")} disabled={loading || Boolean(clockTransition)} aria-label={attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span>{clockTransition === "confirmed" ? <Check size={28} /> : <Fingerprint size={28} />}<small>{clockTransition === "confirmed" ? t("home.attendanceSecured") : attendanceMode === "on" ? t("home.tapToFinish") : t("home.tapTo")}</small><strong>{clockTransition === "confirmed" ? t("home.confirmed") : loading ? t("home.locating") : attendanceMode === "on" ? t("home.clockOut") : t("home.clockIn")}</strong></span></button> : <div className="crew-home-complete-ring" aria-label={t("home.shiftCompleted")}><i className="crew-home-clock-rings" aria-hidden="true"><span /><b /></i><span><Check size={27} /><strong>{t("status.completed")}</strong><small>{formatDuration(completedToday.clock_in_at, completedToday.clock_out_at)}</small></span></div>}
            {attendanceMode !== "completed" && locationEvidence.tone !== "is-exception" && <em className={`crew-home-gps ${locationEvidence.tone}`} title={locationEvidence.title}><ShieldCheck size={13} /><span>{locationEvidence.label}</span></em>}
          </CrewHomeClockMotion>
        </div>
        <button type="button" className="crew-home-attendance-footer" onClick={() => navigate("attendance")}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck size={18} /></i><small>{t("home.todayShift")}</small><em>{t("home.viewAttendance")} <ChevronRight size={16} /></em><strong>{shiftLabel}</strong></button>
      </section>
      <section className="crew-v2-home-section crew-home-tasks"><CrewSectionHeader density="operational" title={<>{t("home.todaysTasks")}<span className={`crew-home-task-count is-${homeTaskBadgeState}`}>{homeTasks.length}</span></>} action={t("common.viewAll")} actionLabel={t("tasks.title")} onAction={() => onOpenTask(null)} /><div className="crew-home-list">
        {homeTasks.length ? homeTasks.map((task) => <button type="button" key={task.id} className={`crew-home-task is-${task.status}`} onClick={() => onOpenTask({ kind: task.kind, row: task.row, context: { from: "home", scrollY: window.scrollY } })} aria-label={t("learn.openSop", { title: task.title })}><i className="crew-ui-icon-container crew-ui-icon-container--compact">{task.status === "completed" ? <Check size={19} /> : <ClipboardCheck size={18} />}</i><span className="crew-home-task-copy"><strong className="crew-list-dense-primary">{task.title}</strong>{(task.progress || task.deadline) && <small className="crew-list-secondary crew-home-task-meta">{task.progress && <span className="crew-home-task-progress">{task.progress}</span>}{task.deadline && <span className={`crew-home-task-due${task.deadline.overdue ? " is-overdue" : ""}`}><Clock3 size={13} /><b>{t("tasks.dueLabel")}</b><span>{task.deadline.time}</span></span>}</small>}</span><CrewStatusBadge tone={task.status === "completed" ? "success" : task.status === "overdue" || task.status === "exception" ? "danger" : task.status === "in_progress" ? "info" : "warning"}>{translateStatus(task.status, t)}</CrewStatusBadge><ChevronRight size={18} /></button>) : <div className="crew-home-empty"><Check size={20} /><span><strong>{t("home.allClear")}</strong><small>{t("home.noTasks")}</small></span></div>}
      </div></section>
      <section className="crew-v2-home-section crew-home-schedule"><CrewSectionHeader density="operational" title={t("home.mySchedule")} action={t("common.viewAll")} onAction={() => navigate("schedule")} /><div className="crew-home-list">{todayRoster ? <HomeScheduleRow entry={todayRoster} label="today" onClick={() => navigate("schedule")} /> : <div className="crew-home-empty"><CalendarDays size={20} /><span><strong>{t("home.noPublishedShift")}</strong><small>{t("home.scheduleWillAppear")}</small></span></div>}{upcomingRoster.map((entry) => <HomeScheduleRow key={entry.id} entry={entry} onClick={() => navigate("schedule")} />)}</div></section>
    </section>;
}
