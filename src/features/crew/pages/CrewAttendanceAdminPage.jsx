import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, Eye, HelpCircle, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";
import "./CrewAttendanceAdminPage.css";

const ALL = "all";
const rosterLabels = {
  off: "OFF",
  leave: "Approved Leave",
  annual_leave: "Annual Leave",
  medical: "MC",
  medical_leave: "Medical Leave",
  unpaid_leave: "Unpaid Leave",
  other_leave: "Other Leave",
};

function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function shiftDate(value) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() - 30);
  return businessDate(date);
}

function locationState(row) {
  if (row.clock_in_location_exception || row.clock_out_location_exception) return "exception";
  if (row.clock_in_location_verified && (!row.clock_out_at || row.clock_out_location_verified)) return "verified";
  return "not_verified";
}

function durationMinutes(row) {
  if (!row.clock_in_at) return null;
  const end = row.clock_out_at ? new Date(row.clock_out_at) : new Date();
  return Math.max(0, Math.round((end - new Date(row.clock_in_at)) / 60000));
}

function formatDuration(minutes) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function formatRosterTime(value) {
  if (!value) return "—";
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" });
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

function rosterContext(row) {
  const schedule = row.schedule;
  if (!schedule) return { kind: "no_roster", title: "No published roster", detail: "Actual attendance only" };
  if (schedule.entry_type !== "working") {
    return {
      kind: "not_required",
      title: rosterLabels[schedule.entry_type] || schedule.template_name || "Non-working day",
      detail: "Attendance not required",
    };
  }
  return {
    kind: "working",
    title: `${formatRosterTime(schedule.start_time)} – ${formatRosterTime(schedule.end_time)}`,
    detail: `${schedule.outlet_name || row.outlet?.name || "Outlet"}${schedule.position ? ` · ${schedule.position}` : ""}`,
  };
}

function varianceContext(row) {
  if (row.clock_in_variance_minutes == null || row.schedule?.entry_type !== "working") return null;
  const minutes = Number(row.clock_in_variance_minutes);
  if (minutes === 0) return { label: "No variance", tone: "success", attention: false };
  const amount = Math.abs(minutes);
  const formatted = amount >= 60 ? `${Math.floor(amount / 60)}h${amount % 60 ? ` ${amount % 60}m` : ""}` : `${amount}m`;
  return { label: `${minutes > 0 ? "Late" : "Early"} ${formatted}`, tone: "warning", attention: amount >= 30 };
}

function attendanceState(row) {
  if (row.roster_evidence_state === "no_roster" || !row.schedule) return "no_roster";
  if (locationState(row) === "exception") return "exception";
  if (row.status === "open" || row.roster_evidence_state === "open") return "on_shift";
  if (row.status === "completed" && row.clock_out_at) return "completed";
  return "incomplete";
}

const attendanceStatus = {
  completed: { label: "Completed", tone: "success" },
  on_shift: { label: "On Shift", tone: "info" },
  incomplete: { label: "Incomplete", tone: "danger" },
  exception: { label: "Exception", tone: "warning" },
  no_roster: { label: "No Roster Match", tone: "neutral" },
};

function rowMatchesStatus(row, filter) {
  if (filter === ALL) return true;
  if (filter === "verified") return locationState(row) === "verified";
  if (filter === "variance") return Number(row.clock_in_variance_minutes || 0) !== 0;
  if (filter === "location_exception") return locationState(row) === "exception";
  if (filter === "incomplete") return attendanceState(row) === "incomplete";
  if (filter === "no_roster") return row.roster_evidence_state === "no_roster" || !row.schedule;
  return true;
}

function issueClass(row) {
  if (attendanceState(row) === "incomplete") return "crew-attendance-row-danger";
  if (locationState(row) === "exception" || varianceContext(row)?.attention) return "crew-attendance-row-warning";
  if (attendanceState(row) === "no_roster") return "crew-attendance-row-neutral";
  return "";
}

export default function CrewAttendanceAdminPage({ ui, store }) {
  const today = useMemo(() => businessDate(), []);
  const [mode, setMode] = useState("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [outletId, setOutletId] = useState(ALL);
  const [employeeId, setEmployeeId] = useState(ALL);
  const [position, setPosition] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [rows, setRows] = useState([]);
  const [outlets, setOutlets] = useState(() => (store?.outlets || []).filter((row) => row.is_active !== false));
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (store?.outlets?.length) return undefined;
    let live = true;
    outletService.listActiveOutlets().then((data) => { if (live) setOutlets(data || []); }).catch((error) => ui.notify({ title: "Unable to load outlets", message: error.message, tone: "error" }));
    return () => { live = false; };
  }, [store?.outlets, ui]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    crewService.listAttendance({ from, to, outletId: outletId === ALL ? null : outletId })
      .then((data) => { if (live) setRows(data || []); })
      .catch((error) => ui.notify({ title: "Unable to load attendance", message: error.message, tone: "error" }))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [from, outletId, to, ui]);

  const employees = useMemo(() => Array.from(new Map(rows.map((row) => [row.employee?.id, row.employee]).filter(([id]) => id)).values()).sort((a, b) => (a.nickname || a.full_name || "").localeCompare(b.nickname || b.full_name || "")), [rows]);
  const positions = useMemo(() => [...new Set(rows.map((row) => row.employee?.position).filter(Boolean))].sort(), [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => (
    (employeeId === ALL || row.employee?.id === employeeId)
    && (position === ALL || row.employee?.position === position)
    && rowMatchesStatus(row, status)
  )), [employeeId, position, rows, status]);

  const summary = useMemo(() => ({
    present: new Set(rows.filter((row) => row.clock_in_at).map((row) => row.employee?.id).filter(Boolean)).size,
    variance: rows.filter((row) => Number(row.clock_in_variance_minutes || 0) !== 0).length,
    exceptions: rows.filter((row) => locationState(row) === "exception").length,
    incomplete: rows.filter((row) => attendanceState(row) === "incomplete").length,
    nonWorking: rows.filter((row) => row.schedule && row.schedule.entry_type !== "working").length,
    noRoster: rows.filter((row) => row.roster_evidence_state === "no_roster" || !row.schedule).length,
    largeVariance: rows.filter((row) => varianceContext(row)?.attention).length,
  }), [rows]);
  const attentionCount = summary.exceptions + summary.incomplete + summary.noRoster + summary.largeVariance;

  function changeMode(nextMode) {
    setMode(nextMode);
    setStatus(ALL);
    if (nextMode === "today") { setFrom(today); setTo(today); }
    else { setFrom(shiftDate(today)); setTo(today); }
  }

  const columns = [
    { key: "employee", header: "Employee", width: "210px", render: (row) => <div><div className="font-bold text-text-primary">{row.employee?.nickname || row.employee?.full_name || "Employee"}</div><div className="mt-0.5 text-xs text-text-secondary">{row.employee?.position || "Crew"} · {row.outlet?.name || row.employee?.workplace || "Outlet"}</div>{row.schedule?.outlet_name && row.outlet?.name && row.schedule.outlet_name !== row.outlet.name ? <div className="mt-1 text-xs font-semibold text-amber-700">Worked at {row.outlet.name}</div> : null}</div> },
    { key: "schedule", header: "Schedule", width: "210px", render: (row) => { const context = rosterContext(row); const variance = varianceContext(row); return <div><div className="font-semibold text-text-primary">{context.title}</div><div className="mt-0.5 text-xs text-text-secondary">{context.detail}</div>{variance ? <div className="mt-1.5"><Badge tone={variance.tone}>{variance.label}</Badge></div> : null}{context.kind === "not_required" ? <div className="mt-1 text-xs font-semibold text-amber-700">Unexpected attendance</div> : null}</div>; } },
    { key: "clock_in", header: "Clock In", width: "112px", render: (row) => <TimeCell value={row.clock_in_at} /> },
    { key: "clock_out", header: "Clock Out", width: "112px", render: (row) => <TimeCell value={row.clock_out_at} /> },
    { key: "duration", header: "Duration", width: "112px", render: (row) => { const minutes = durationMinutes(row); return <div><div className="font-semibold text-text-primary">{formatDuration(minutes)}</div>{minutes > 1440 ? <div className="mt-1"><Badge tone="danger">Potential anomaly</Badge></div> : null}</div>; } },
    { key: "location", header: "Location", width: "150px", render: (row) => <LocationCell row={row} /> },
    { key: "status", header: "Attendance Status", width: "150px", render: (row) => { const state = attendanceStatus[attendanceState(row)]; return <div><Badge tone={state.tone}>{state.label}</Badge>{row.schedule && row.schedule.entry_type !== "working" ? <div className="mt-1 text-xs text-text-secondary">Non-working day</div> : null}</div>; } },
    { key: "actions", header: "Actions", width: "76px", align: "right", render: (row) => <button className="icon-btn" type="button" aria-label={`View attendance for ${row.employee?.nickname || row.employee?.full_name || "employee"}`} title="View attendance" onClick={() => setDetail(row)}><Eye size={16} /></button> },
  ];

  return <div className="space-y-4">
    <PageHeader
      section="Crew · Workforce"
      title="Attendance"
      description="Review actual attendance against published roster and verified location evidence."
      actions={<><div className="inline-flex rounded-xl border border-border bg-white p-1"><button className={mode === "today" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => changeMode("today")}>Today</button><button className={mode === "history" ? "btn-primary" : "btn-ghost"} type="button" onClick={() => changeMode("history")}>History</button></div><button className="icon-btn" type="button" aria-label="About attendance evidence" title="Roster variance is explainable evidence only; it does not directly alter Performance scores."><HelpCircle size={17} /></button></>}
    />

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Attendance summary">
      <MetricCard icon={UsersRound} label={mode === "today" ? "Present Today" : "Present in Range"} value={summary.present} helper="Crew with attendance evidence" size="compact" />
      <MetricCard icon={Clock3} label="Late / Schedule Variance" value={summary.variance} helper="Server-calculated clock-in variance" tone={summary.variance ? "warning" : "neutral"} size="compact" />
      <MetricCard icon={MapPin} label="Location Exceptions" value={summary.exceptions} helper="Location evidence needs review" tone={summary.exceptions ? "warning" : "neutral"} size="compact" />
      <MetricCard icon={AlertTriangle} label="Incomplete Sessions" value={summary.incomplete} helper="Missing a completed session" tone={summary.incomplete ? "danger" : "neutral"} size="compact" />
    </section>

    {summary.nonWorking ? <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-text-secondary"><CalendarDays size={16} /><strong className="text-text-primary">{summary.nonWorking}</strong> attendance record{summary.nonWorking === 1 ? "" : "s"} occurred on OFF or approved leave days. Attendance was not required.</div> : null}

    <section className="card p-4" aria-label="Attendance filters">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SelectField label="Outlet" ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={[{ value: ALL, label: "All" }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} />
        <div className="grid grid-cols-2 gap-2">
          <label className="field-label">From<input className="control mt-1 w-full" type="date" value={from} max={to} onChange={(event) => { setMode("history"); setFrom(event.target.value); }} /></label>
          <label className="field-label">To<input className="control mt-1 w-full" type="date" value={to} min={from} onChange={(event) => { setMode("history"); setTo(event.target.value); }} /></label>
        </div>
        <SelectField label="Employee" ariaLabel="Employee" value={employeeId} onChange={setEmployeeId} searchable options={[{ value: ALL, label: "All" }, ...employees.map((employee) => ({ value: employee.id, label: employee.nickname || employee.full_name }))]} />
        <SelectField label="Position" ariaLabel="Position" value={position} onChange={setPosition} options={[{ value: ALL, label: "All" }, ...positions.map((value) => ({ value, label: value }))]} />
        <SelectField label="Attendance Status" ariaLabel="Attendance Status" value={status} onChange={setStatus} options={[{ value: ALL, label: "All" }, { value: "verified", label: "Verified" }, { value: "variance", label: "Late / Variance" }, { value: "location_exception", label: "Location Exception" }, { value: "incomplete", label: "Incomplete" }, { value: "no_roster", label: "No Published Roster" }]} />
      </div>
    </section>

    {attentionCount ? <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3" aria-label="Needs Attention"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2 font-bold text-text-primary"><AlertTriangle className="text-amber-600" size={17} />{attentionCount} attendance record signal{attentionCount === 1 ? "" : "s"} need review</div><p className="mt-1 text-xs text-text-secondary">Signals remain separate: location, session completion, roster matching, and large clock-in variance.</p></div><div className="flex flex-wrap gap-2">{summary.exceptions ? <button className="btn-secondary" type="button" onClick={() => setStatus("location_exception")}>{summary.exceptions} Location Exception{summary.exceptions === 1 ? "" : "s"}</button> : null}{summary.incomplete ? <button className="btn-secondary" type="button" onClick={() => setStatus("incomplete")}>{summary.incomplete} Incomplete</button> : null}{summary.noRoster ? <button className="btn-secondary" type="button" onClick={() => setStatus("no_roster")}>{summary.noRoster} No Roster</button> : null}{summary.largeVariance ? <button className="btn-secondary" type="button" onClick={() => setStatus("variance")}>{summary.largeVariance} Large Variance</button> : null}</div></div></section> : null}

    <Card title={mode === "today" ? "Today’s Attendance" : "Attendance History"} description={`${visibleRows.length} record${visibleRows.length === 1 ? "" : "s"} shown · Execution and location states are reported separately.`}>
      {loading ? <div className="p-8 text-sm font-semibold text-text-secondary">Loading attendance…</div> : visibleRows.length ? <div className="crew-attendance-table"><DataTable density="compact" tableClassName="min-w-[1100px]" rows={visibleRows} getRowKey={(row) => row.id} getRowClassName={issueClass} onRowClick={setDetail} columns={columns} /></div> : <div className="px-6 py-12 text-center"><ShieldCheck className="mx-auto text-primary" size={28} /><h3 className="mt-3 font-bold text-text-primary">No attendance records</h3><p className="mt-1 text-sm text-text-secondary">No records match the selected date, outlet, or filters.</p></div>}
    </Card>
    {detail ? <AttendanceDetail row={detail} onClose={() => setDetail(null)} /> : null}
  </div>;
}

function TimeCell({ value }) {
  return value ? <div><div className="font-semibold text-text-primary">{formatTime(value)}</div><div className="mt-0.5 text-xs text-text-secondary">{formatDate(value)}</div></div> : <span className="text-text-muted">—</span>;
}

function LocationCell({ row }) {
  const state = locationState(row);
  const distance = row.clock_in_distance_meters == null ? null : Math.round(Number(row.clock_in_distance_meters));
  return <div><Badge tone={state === "verified" ? "success" : state === "exception" ? "warning" : "neutral"}>{state === "verified" ? "Verified" : state === "exception" ? "Location Exception" : "Not Verified"}</Badge><div className="mt-1 text-xs text-text-secondary">{distance == null ? "Location unavailable" : `${distance}m from outlet`}</div></div>;
}

function DetailValue({ label, value }) {
  return <div><dt className="text-xs font-semibold text-text-secondary">{label}</dt><dd className="mt-1 text-sm font-bold text-text-primary">{value || "—"}</dd></div>;
}

function Evidence({ title, at, verified, exception, reason, distance, accuracy }) {
  const state = verified ? "Verified" : exception ? "Location Exception" : "Not Verified";
  return <section className={`rounded-xl border p-4 ${exception ? "border-amber-200 bg-amber-50/60" : "border-border bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><div className="font-bold text-text-primary">{title}</div><Badge tone={verified ? "success" : exception ? "warning" : "neutral"}>{state}</Badge></div><dl className="mt-3 grid gap-3 sm:grid-cols-2"><DetailValue label="Time" value={at ? new Date(at).toLocaleString("en-MY") : "—"} /><DetailValue label="Distance from Outlet" value={distance == null ? "Location unavailable" : `${Math.round(Number(distance))}m`} /><DetailValue label="Accuracy" value={accuracy == null ? "—" : `±${Math.round(Number(accuracy))}m`} />{exception ? <DetailValue label="Exception Reason" value={reason || "No reason supplied"} /> : null}</dl></section>;
}

function AttendanceDetail({ row, onClose }) {
  const schedule = rosterContext(row);
  const variance = varianceContext(row);
  const status = attendanceStatus[attendanceState(row)];
  const minutes = durationMinutes(row);
  return <Modal title="Attendance Details" description={`${row.employee?.nickname || row.employee?.full_name || "Employee"} · ${formatDate(row.clock_in_at)}`} size="xl" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
    <div className="space-y-4">
      <section className="grid gap-4 rounded-xl border border-border bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4"><DetailValue label="Employee" value={row.employee?.full_name || row.employee?.nickname} /><DetailValue label="Position" value={row.employee?.position || row.schedule?.position} /><DetailValue label="Actual Outlet" value={row.outlet?.name || row.employee?.workplace} /><div><dt className="text-xs font-semibold text-text-secondary">Attendance Status</dt><dd className="mt-1"><Badge tone={status.tone}>{status.label}</Badge></dd></div></section>
      <section><h3 className="mb-3 font-bold text-text-primary">Schedule & Actual</h3><dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"><DetailValue label="Scheduled Shift" value={schedule.title} /><DetailValue label="Schedule Context" value={schedule.detail} /><DetailValue label="Actual Clock In" value={row.clock_in_at ? new Date(row.clock_in_at).toLocaleString("en-MY") : "—"} /><DetailValue label="Actual Clock Out" value={row.clock_out_at ? new Date(row.clock_out_at).toLocaleString("en-MY") : "—"} /><DetailValue label="Worked Duration" value={formatDuration(minutes)} /><DetailValue label="Schedule Variance" value={variance?.label || "Not applicable"} /><DetailValue label="Roster Evidence" value={row.evidence_version || "Roster evidence"} />{minutes > 1440 ? <div><dt className="text-xs font-semibold text-text-secondary">Duration Review</dt><dd className="mt-1"><Badge tone="danger">Potential anomaly</Badge></dd></div> : null}</dl>{schedule.kind === "no_roster" ? <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-text-secondary">Attendance was recorded without a published roster for this date.</p> : null}{schedule.kind === "not_required" ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">{schedule.title}: attendance was not required, but an actual attendance record exists.</p> : null}</section>
      <section><h3 className="mb-3 font-bold text-text-primary">Location Verification</h3><div className="grid gap-3 lg:grid-cols-2"><Evidence title="Clock In" at={row.clock_in_at} verified={row.clock_in_location_verified} exception={row.clock_in_location_exception} reason={row.clock_in_exception_reason} distance={row.clock_in_distance_meters} accuracy={row.clock_in_accuracy_meters} /><Evidence title="Clock Out" at={row.clock_out_at} verified={row.clock_out_location_verified} exception={row.clock_out_location_exception} reason={row.clock_out_exception_reason} distance={row.clock_out_distance_meters} accuracy={row.clock_out_accuracy_meters} /></div></section>
      <section><h3 className="mb-3 font-bold text-text-primary">Timeline</h3><ol className="grid gap-2 rounded-xl border border-border p-4"><TimelineItem label="Scheduled" value={schedule.title} muted={schedule.kind !== "working"} /><TimelineItem label="Clock In" value={row.clock_in_at ? new Date(row.clock_in_at).toLocaleString("en-MY") : "Not recorded"} /><TimelineItem label="Clock Out" value={row.clock_out_at ? new Date(row.clock_out_at).toLocaleString("en-MY") : row.status === "open" ? "Shift in progress" : "Not recorded"} /></ol></section>
    </div>
  </Modal>;
}

function TimelineItem({ label, value, muted = false }) {
  return <li className="flex items-start gap-3"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${muted ? "bg-slate-300" : "bg-primary"}`} /><div><div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</div><div className="mt-0.5 text-sm font-semibold text-text-primary">{value}</div></div></li>;
}
