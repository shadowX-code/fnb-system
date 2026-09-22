import { useTranslation } from "react-i18next";
import { BriefcaseBusiness, CalendarCheck, Check, ChevronRight, Clock3, FileText, LockKeyhole, MapPin, Navigation, TriangleAlert } from "lucide-react";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import { CrewEmptyState, CrewStatusBadge } from "./CrewMobileUI.jsx";
import { formatCrewDate, formatCrewTime } from "../utils/crewI18n.js";
import { malaysiaDateKey, formatTime } from "../utils/crewMobile.js";
import { reasonValues, clockInOptions, clockOutOptions } from "../utils/crewClockReasons.js";

export default function CrewAttendanceMobile({ rows, loading, selectedMonth, onMonthChange, onBack, t }) {
  const months = [0, 1, 2].map((offset) => {
    const date = new Date();
    date.setMonth(date.getMonth() - offset, 1);
    return { value: malaysiaDateKey(date).slice(0, 7), label: formatCrewDate(date, { month: "short", year: "numeric" }) };
  });
  const totalMinutes = rows.reduce((total, row) => total + (row.clock_in_at && row.clock_out_at ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0), 0);
  const exceptions = rows.filter((row) => row.clock_in_location_exception || row.status === "open").length;
  const formatMonthDate = (value) => formatCrewDate(value, { day: "2-digit", month: "2-digit", year: "numeric" });
  const formatAttendanceTime = (value) => formatCrewTime(value, { hour: "numeric", minute: "2-digit" }).replace(/\b(am|pm)\b/gi, (meridiem) => meridiem.toUpperCase());
  const durationLabel = (minutes) => `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return <section className="crew-v2-attendance crew-attendance-history-page">
    <CrewMobileDetailHeader title={t("attendance.title")} subtitle={t("attendance.subtitle")} variant="page" onBack={onBack} />
    <nav className="crew-ui-segmented crew-ui-segmented--mint crew-attendance-month-select" aria-label={t("attendance.month")}>
      {months.map((month) => <button className={selectedMonth === month.value ? "is-active" : ""} type="button" key={month.value} aria-pressed={selectedMonth === month.value} onClick={() => onMonthChange(month.value)}><span>{month.label}</span>{selectedMonth === month.value && <CalendarCheck size={20} aria-hidden="true" />}</button>)}
    </nav>
    <section className="crew-attendance-month-summary" aria-label={t("attendance.monthSummary")}>
      <div><span className="crew-ui-icon-container crew-ui-icon-container--compact"><CalendarCheck size={18} /></span><small>{t("attendance.worked")}</small><strong>{rows.length}</strong><em>{t("common.shifts")}</em></div>
      <div><span className="crew-ui-icon-container crew-ui-icon-container--compact"><Clock3 size={18} /></span><small>{t("attendance.totalHours")}</small><strong>{durationLabel(totalMinutes)}</strong></div>
      <div className={exceptions ? "is-warning" : ""}><span className={`crew-ui-icon-container crew-ui-icon-container--compact${exceptions ? " is-warning" : ""}`}><TriangleAlert size={18} /></span><small>{t("attendance.exceptions")}</small><strong>{exceptions}</strong><em>{exceptions ? t("attendance.requiresReview") : t("status.completed")}</em></div>
    </section>
    <section className="crew-attendance-history"><header><div><h2 className="crew-type-section-title">{t("attendance.history")}</h2><p>{t("attendance.recentRecords")}</p></div><span className="crew-ui-count">{rows.length} {t("common.shifts")}</span></header><div className="crew-attendance-history-list">{loading ? <div className="crew-attendance-loading">{t("common.loading")}</div> : rows.length ? rows.map((row) => {
      const completed = Boolean(row.clock_out_at);
      const minutes = completed ? Math.max(0, (new Date(row.clock_out_at) - new Date(row.clock_in_at)) / 60000) : 0;
      const exception = Boolean(row.clock_in_location_exception);
      const evidence = exception ? t("attendance.exception") : row.clock_in_location_verified ? t("attendance.verified") : t("attendance.locationUnavailable");
      return <article className={`crew-attendance-history-row${exception ? " is-warning" : ""}`} key={row.id}><time className="crew-attendance-date-block"><small>{formatCrewDate(row.clock_in_at, { month: "short" }).toUpperCase()}</small><strong>{formatCrewDate(row.clock_in_at, { day: "2-digit" })}</strong></time><div className="crew-attendance-history-main"><strong>{formatMonthDate(row.clock_in_at)}</strong><small className={`crew-attendance-location-status${exception ? " is-warning" : row.clock_in_location_verified ? " is-verified" : ""}`}><MapPin size={16} aria-hidden="true" />{evidence}</small>{exception && <CrewStatusBadge tone="warning">{t("attendance.requiresReview")}</CrewStatusBadge>}</div><div className="crew-attendance-history-time"><strong>{formatAttendanceTime(row.clock_in_at)} – {completed ? formatAttendanceTime(row.clock_out_at) : t("common.now")}</strong><span>{completed ? <><small>{durationLabel(minutes)}</small><i>·</i><CrewStatusBadge tone="success">{t("status.completed")}</CrewStatusBadge></> : <CrewStatusBadge tone="info">{t("home.onShift")}</CrewStatusBadge>}</span></div></article>;
    }) : <CrewEmptyState title={t("attendance.noShifts")} body={t("attendance.completedAppear")} />}</div></section>
  </section>;
}

function ClockReasonSheet({ options, selectedReason, onSelect, onClose }) {
  const { t } = useTranslation();
  const reasonIcons = {
    outlet_gps: MapPin,
    off_site: BriefcaseBusiness,
    another_location: Navigation,
    accuracy: TriangleAlert,
    permission: LockKeyhole,
    unavailable: TriangleAlert,
    forgot_clock_out: Clock3,
    other: FileText,
  };
  return <CrewBottomSheet title={t("attendance.selectReasonTitle")} description={t("attendance.selectReasonHelp")} onClose={onClose} className="crew-clock-reason-sheet" contentClassName="crew-clock-reason-sheet-content">
    <div className="crew-clock-reason-options" role="listbox" aria-label={t("attendance.reason")}>
      {options.map((option) => {
        const Icon = reasonIcons[option] || FileText;
        const selected = selectedReason === reasonValues[option];
        return <button key={option} type="button" role="option" aria-selected={selected} className={selected ? "is-selected" : ""} onClick={() => { onSelect(reasonValues[option]); onClose(); }}><Icon size={18} aria-hidden="true" /><span>{t(`attendanceReasons.${option}`)}</span>{selected ? <Check size={18} aria-hidden="true" /> : null}</button>;
      })}
    </div>
  </CrewBottomSheet>;
}


export function CrewClockDialogs({ clock, context, navigate }) {
  const { t } = useTranslation();
  const { clockDraft, setClockDraft, reasonSheetOpen, setReasonSheetOpen, exception, setException, otherReason, setOtherReason, reasonTriggerRef, loading, error, submitClock, clockSuccess, setClockSuccess } = clock;
  const exceptionRequired = Boolean(context?.location_enabled && (!clockDraft?.location || clockDraft?.distance > Number(context.radius_meters)));
  const outside = Boolean(clockDraft?.location && clockDraft?.distance > Number(context?.radius_meters));
  const options = clockDraft?.action === "out" ? clockOutOptions : clockInOptions;
  return <>
    {clockDraft && !reasonSheetOpen && <CrewBottomSheet title={t("attendance.confirmClock", { action: clockDraft.action === "out" ? t("home.clockOut") : t("home.clockIn") })} description={context?.outlet_name || t("common.outlet")} headerIcon={<Navigation size={19} />} onClose={() => setClockDraft(null)} closeDisabled={loading} allowBackdropClose={!loading} initialFocusRef={exceptionRequired ? reasonTriggerRef : undefined} className="crew-clock-confirm-sheet" contentClassName="crew-clock-confirm-content" footer={<><button type="button" className="crew-mobile-ghost" onClick={() => setClockDraft(null)} disabled={loading}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" onClick={submitClock} disabled={loading || (exceptionRequired && (!exception || (exception === reasonValues.other && !otherReason.trim())))}>{loading ? t("common.saving") : clockDraft.action === "out" ? t("home.clockOut") : t("common.confirm")}</button></>}>
      {!exceptionRequired && <div className="crew-clock-location-callout is-verified"><Check size={17} /><span>{t("attendance.locationVerified")}</span></div>}
      {outside && <div className="crew-clock-location-callout is-warning"><MapPin size={17} /><span><strong>{t("attendance.locationDistance", { distance: Math.round(clockDraft.distance) })}</strong><small>{t("attendance.locationAllowed", { meters: context.radius_meters })}</small></span></div>}
      {!clockDraft.location && <div className="crew-clock-location-callout is-warning"><TriangleAlert size={17} /><span>{t("attendance.locationUnavailable")}</span></div>}
      {exceptionRequired && <label className="crew-clock-reason-field"><span>{t("attendance.reason")}</span><button ref={reasonTriggerRef} type="button" onClick={() => setReasonSheetOpen(true)} aria-label={exception || t("attendance.selectReason")} aria-haspopup="dialog" aria-expanded={reasonSheetOpen}><strong>{exception || t("attendance.selectReason")}</strong><ChevronRight size={18} /></button></label>}
      {exception === reasonValues.other && <label className="crew-clock-other-reason"><span>{t("attendance.briefReason")}</span><input value={otherReason} maxLength="280" onChange={(event) => setOtherReason(event.target.value)} placeholder={t("attendance.briefReason")} /></label>}
      {error && <div className="crew-v2-error">{error}</div>}
    </CrewBottomSheet>}
    {clockDraft && reasonSheetOpen ? <ClockReasonSheet options={options} selectedReason={exception} onSelect={setException} onClose={() => setReasonSheetOpen(false)} /> : null}
    {clockSuccess && <CrewMobileModal title={t("home.clockedInSuccess")} onClose={() => setClockSuccess(null)} contentClassName="crew-home-success-content" footer={<><button type="button" className="crew-mobile-secondary" onClick={() => { setClockSuccess(null); navigate("home"); }}>{t("home.goHome")}</button><button type="button" className="crew-mobile-primary" onClick={() => { setClockSuccess(null); navigate("attendance"); }}>{t("home.viewAttendance")}</button></>}><span className="crew-ui-icon-container is-success"><Check size={23} /></span><dl><div><dt>{t("home.clockInTime")}</dt><dd>{formatTime(clockSuccess.time)}</dd></div><div><dt>{t("common.outlet")}</dt><dd>{clockSuccess.outlet}</dd></div><div><dt>{t("common.role")}</dt><dd>{clockSuccess.role}</dd></div></dl></CrewMobileModal>}
  </>;
}
