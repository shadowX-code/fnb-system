import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, ListChecks, MoreHorizontal, ShieldCheck, SunMedium, UserCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminScopeSwitcher from "../../../components/layout/AdminScopeSwitcher.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminDateTimeCell from "../../../components/tables/AdminDateTimeCell.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";
import CrewAccessManagerModal from "../components/CrewAccessManagerModal.jsx";
import CrewDisableAccessModal from "../components/CrewDisableAccessModal.jsx";
import CrewSpecialAccessModal from "../components/CrewSpecialAccessModal.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { crewAccessState, crewService, CREW_ACCESS_STATE_LABEL } from "../../../services/crewService.js";
import { formatOperationalDateTime } from "../../../lib/dateTime.js";
import { canonicalAdminUrlForRoute } from "../../../app/routeOwnership.js";

function adminHref(id, params = {}, query = {}) {
  return canonicalAdminUrlForRoute(id, params, query, window.location.search);
}

export default function CrewWorkspacePage({ auth, ui, store, initialTab = "dashboard" }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [request, setRequest] = useState(null);
  const [specialAccessEmployee, setSpecialAccessEmployee] = useState(null);
  const [disableEmployee, setDisableEmployee] = useState(null);
  const [employeeMenuId, setEmployeeMenuId] = useState(null);
  const [query, setQuery] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("all");
  const canManage = auth.hasPermission("crew_employees.manage");
  const accessFilters = useMemo(() => ({ query, employment_status: employmentStatus }), [employmentStatus, query]);
  const accessSignature = useMemo(() => JSON.stringify({ outletId, accessFilters }), [accessFilters, outletId]);
  const isEmployees = initialTab === "employees";
  const [listing, listingActions] = useAdminPagedQuery({
    storageKey: "crew-access",
    enabled: Boolean(isEmployees && outletId),
    querySignature: accessSignature,
    loadPage: ({ page, pageSize }) => employeeService.crewAccessAdminPage({ outletId, filters: accessFilters, page, pageSize }),
  });
  const employees = listing.rows;
  const refresh = listingActions.refreshNow;
  const outletControl = <AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

  if (isEmployees) return <div className="space-y-4">
    <PageHeader section="Crew · People" title="Crew Access" description="Manage mobile Crew access separately from existing FeedX Admin Access." />
    <AdminFilterToolbar
      outlet={outletControl}
      search={<AdminSearchField label="Search Crew" value={query} onChange={setQuery} placeholder="Name, position or employee code" />}
      filters={<SelectField label="Employment Status" ariaLabel="Employment Status" value={employmentStatus} onChange={setEmploymentStatus} options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "resigned", label: "Resigned" }, { value: "terminated", label: "Terminated" }]} />}
      activeFilters={employmentStatus !== "all" ? [{ key: "employment-status", label: "Employment Status", value: employmentStatus[0].toUpperCase() + employmentStatus.slice(1), onRemove: () => setEmploymentStatus("all") }] : []}
      onClear={() => { setQuery(""); setEmploymentStatus("all"); }}
    />
    <Card>
      <AsyncDataSurface loading={listing.loading} error={listing.error} hasData={employees.length > 0} isEmpty={listing.hasLoaded && !employees.length} emptyTitle={listing.loadedTotal ? "No Crew match this search" : "No Crew access records"} emptyDescription={listing.loadedTotal ? "Clear or adjust the search to see more Crew." : "Crew access records for this outlet will appear here."} onRetry={listingActions.retry}><DataTable tableClassName="min-w-[1120px]" rows={employees} getRowKey={(row) => row.id} columns={employeeColumns(canManage, setRequest, setSpecialAccessEmployee, setDisableEmployee, employeeMenuId, setEmployeeMenuId)} /><AdminPagination {...listing} onPageChange={listingActions.requestPage} onPageSizeChange={listingActions.requestPageSize} noun="Crew members" /></AsyncDataSurface>
    </Card>
    {request ? <CrewAccessManagerModal employee={request.employee} mode={request.mode} onClose={() => setRequest(null)} onSaved={refresh} /> : null}
    {specialAccessEmployee ? <CrewSpecialAccessModal employee={specialAccessEmployee} onClose={() => setSpecialAccessEmployee(null)} onSaved={refresh} /> : null}
    {disableEmployee ? <CrewDisableAccessModal employee={disableEmployee} onClose={() => setDisableEmployee(null)} onSaved={refresh} /> : null}
  </div>;

  return <CrewDashboard outletId={outletId} outlets={outlets} setOutletId={setOutletId} ui={ui} />;
}

function employmentLabel(row) {
  const type = { full_time: "Full-Time", part_time: "Part-Time", contract: "Contract", probation: "Probation", intern: "Intern" }[row.employment_type] || row.employment_type || "—";
  const status = row.is_active === false ? "Inactive" : { active: "Active", inactive: "Inactive", resigned: "Resigned", terminated: "Terminated" }[row.employment_status] || row.employment_status || "Active";
  return <div><div className="font-medium text-text-primary">{type}</div><div className="text-xs text-text-secondary">{status}</div></div>;
}

function specialAccessSummary(access) {
  const permissions = [
    access?.can_initiate_handover && "Hand Over Cash",
    access?.can_add_assets && "Add Assets",
    access?.can_manage_asset_details && "Manage Asset Details",
    access?.can_adjust_assets && "Adjust Assets",
    access?.can_perform_asset_inspections && "Asset Inspections",
  ].filter(Boolean);
  if (!permissions.length) return "None";
  return permissions.length === 1 ? permissions[0] : `${permissions.length} permissions`;
}

function lastLoginCell(value) {
  if (!value) return <span className="text-text-muted">Never</span>;
  const formatted = formatOperationalDateTime(value);
  if (formatted === "—") return <span className="text-text-muted">—</span>;
  const [date, ...time] = formatted.split(" ");
  return <AdminDateTimeCell date={date} time={time.join(" ")} />;
}

function employeeColumns(canManage, setRequest, setSpecialAccessEmployee, setDisableEmployee, employeeMenuId, setEmployeeMenuId) { return [
  { key: "employee", header: "Employee", render: (row) => <div><div className="font-bold text-text-primary">{row.full_name}</div><div className="text-xs text-text-secondary">{row.position || "No position"} · {row.workplace || "No workplace"}</div></div> },
  { key: "employment", header: "Employment", render: employmentLabel },
  { key: "mobile", header: "Mobile", render: (row) => row.crew_access?.mobile_number || row.contact || "—" },
  { key: "crew", header: "Crew Access", render: (row) => { const state = crewAccessState(row.crew_access); return <Badge tone={semanticStatusTone(state)}>{CREW_ACCESS_STATE_LABEL[state]}</Badge>; } },
  { key: "special", header: "Special Access", render: (row) => row.crew_access?.access_state === "active" ? <span className="text-sm text-text-secondary">{specialAccessSummary(row.crew_access)}</span> : <span className="text-sm text-text-muted">Enable Crew Access first</span> },
  { key: "last", header: "Last login", render: (row) => lastLoginCell(row.crew_access?.last_login_at) },
  { key: "action", header: "Actions", align: "right", render: (row) => {
    if (!canManage) return null;
    const activeAccess = row.crew_access?.access_state === "active";
    return <div className="flex justify-end gap-2">{activeAccess ? <><button className="btn-secondary whitespace-nowrap" type="button" onClick={() => setSpecialAccessEmployee(row)}>Special Access</button><ActionMenu open={employeeMenuId === row.id} onOpenChange={(open) => setEmployeeMenuId(open ? row.id : null)} ariaLabel={`More actions for ${row.full_name}`} trigger={({ toggle, ariaLabel }) => <button className="icon-btn" type="button" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={16} /></button>}><button className="w-full rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-background" type="button" onClick={() => { setEmployeeMenuId(null); setRequest({ employee: row, mode: "reset" }); }}>Reset Passcode</button><button className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-rose-50" type="button" onClick={() => { setEmployeeMenuId(null); setDisableEmployee(row); }}>Disable</button></ActionMenu></> : <button className="btn-primary whitespace-nowrap" type="button" onClick={() => setRequest({ employee: row, mode: "enable" })}>Activate</button>}</div>;
  } },
]; }

function CrewDashboard({ outletId, outlets, setOutletId, ui }) {
  const [data, setData] = useState({ summary: {}, upcoming: [], attention: [] });
  const [loading, setLoading] = useState(Boolean(outletId));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  async function refresh() {
    if (!outletId) {
      setLoading(false);
      setHasLoaded(false);
      setError("");
      setData({ summary: {}, upcoming: [], attention: [] });
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setHasLoaded(false);
    setData({ summary: {}, upcoming: [], attention: [] });
    setError("");
    try {
      const next = await crewService.dashboardAdminData(outletId);
      if (currentRequest === requestId.current) {
        setData(next);
        setHasLoaded(true);
      }
    } catch (cause) {
      if (currentRequest === requestId.current) {
        const message = cause.message || "Crew Dashboard could not be loaded.";
        setError(message);
        ui?.notify?.({ title: "Unable to load Crew Dashboard", message, tone: "error" });
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [outletId]);

  const summary = data.summary || {};
  const attention = data.attention || [];
  const upcoming = data.upcoming || [];
  const crewToday = data.crew_today || [];
  const tasksToday = data.tasks_today || [];
  const brief = operationalBrief(summary, attention.length);
  return <div className="space-y-4 crew-dashboard">
    <PageHeader section="Crew · Overview" title="Crew Dashboard" description="What is happening with your Crew today, and what needs attention." />
    <AdminScopeSwitcher ariaLabel="Dashboard outlet" items={outlets} value={outletId} onChange={setOutletId} />
    <AsyncDataSurface loading={loading} error={error} errorTitle="Unable to load Crew Dashboard" hasData={hasLoaded} isEmpty={!outletId} emptyTitle="No outlet selected" emptyDescription="Select an outlet to see its current Crew operations." onRetry={refresh}>
      <DailyBrief brief={brief} date={data.business_date} />
      <TodayMetrics summary={summary} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,.82fr)]">
        <div className="grid content-start gap-4">
          {crewToday.length ? <CrewTodayList rows={crewToday} /> : null}
          <ComingUpSurface items={upcoming} />
        </div>
        <div className="grid content-start gap-4">
          {tasksToday.length ? <TasksTodayList rows={tasksToday} /> : null}
          <AdminDataSection title="Needs Your Attention" description="Prioritized items that need an owning workflow." className="crew-dashboard-attention">
            <AttentionList items={attention} />
          </AdminDataSection>
        </div>
      </div>
    </AsyncDataSurface>
  </div>;
}

function DailyBrief({ brief, date }) {
  return <section className="crew-dashboard-brief" aria-label="Daily brief">
    <span className="crew-dashboard-brief-icon"><SunMedium size={21} /></span>
    <div className="min-w-0"><strong>{brief.headline}</strong>{brief.detail ? <span>{brief.detail}</span> : null}</div>
    {date ? <time dateTime={date}>{formatDashboardDate(date)}</time> : null}
  </section>;
}

function UpcomingList({ items }) {
  return <div className="crew-dashboard-list">
    {items.slice(0, 6).map((item, index) => <a className="crew-dashboard-row" href={upcomingHref(item.type)} key={`${item.type}-${item.name}-${index}`}>
      <PersonAvatar name={item.name} tone={item.type === "birthday" ? "rose" : "mint"} />
      <span className="min-w-0 flex-1"><strong>{item.type === "birthday" ? `${item.name}'s birthday` : item.name}</strong><small>{upcomingContext(item)}</small></span>
      <span className="crew-dashboard-row-meta"><strong>{formatUpcomingDate(item.date)}</strong><small className={Number(item.days_until) <= 7 ? "is-near" : ""}>{relativeUpcomingDay(item.days_until)}</small></span>
      <ChevronRight className="shrink-0 text-text-muted" size={16} aria-hidden="true" />
    </a>)}
  </div>;
}

function ComingUpSurface({ items }) {
  return <AdminDataSection title="Coming Up" description="Next 30 days" className="crew-dashboard-upcoming">
    {items.length ? <UpcomingList items={items} /> : <CompactUpcomingEmpty />}
  </AdminDataSection>;
}

function TodayMetrics({ summary }) {
  const leaveNames = (summary.leave_today || []).slice(0, 2).map((item) => item.name).join(", ");
  const pending = Number(summary.not_checked_in || 0);
  const attendanceIssues = Number(summary.attendance_issues || 0);
  return <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Today">
    <DailyMetric label="Scheduled Today" value={summary.scheduled_today || 0} helper={`${summary.present_today || 0} accounted for${pending ? ` · ${pending} not checked in` : ""}`} icon={UsersRound} tone={pending ? "warning" : "mint"} />
    <DailyMetric label="Tasks Today" value={`${summary.tasks_completed || 0}/${summary.tasks_total || 0}`} helper={Number(summary.tasks_overdue || 0) ? `${summary.tasks_overdue} overdue` : "No overdue tasks"} icon={ListChecks} tone={Number(summary.tasks_overdue || 0) ? "danger" : "mint"} />
    <DailyMetric label="On Leave Today" value={summary.on_leave_today || 0} helper={leaveNames || "No approved leave"} icon={Clock3} tone="neutral" />
    <DailyMetric label="Attendance" value={attendanceIssues} helper={attendanceIssues ? `${attendanceIssues} recorded issue${attendanceIssues === 1 ? "" : "s"}` : "No recorded issues"} icon={UserCheck} tone={attendanceIssues ? "warning" : "neutral"} />
  </section>;
}

function DailyMetric({ label, value, helper, icon: Icon, tone = "mint" }) {
  return <article className={`crew-dashboard-metric is-${tone}`}>
    <span><Icon size={18} /></span>
    <div className="min-w-0"><small>{label}</small><strong>{value}</strong><p>{helper}</p></div>
  </article>;
}

function operationalBrief(summary, attentionAreas) {
  const missing = Number(summary.not_checked_in || 0);
  const overdue = Number(summary.tasks_overdue || 0);
  if (!attentionAreas) return { headline: "Everything looks on track today.", detail: "" };
  const details = [
    missing ? `${missing} Crew ${missing === 1 ? "has" : "have"} not checked in` : "",
    overdue ? `${overdue} task${overdue === 1 ? " is" : "s are"} overdue` : "",
  ].filter(Boolean);
  return {
    headline: `${attentionAreas} ${attentionAreas === 1 ? "area needs" : "areas need"} attention today.`,
    detail: details.length ? `${details.join(" and ")}.` : "",
  };
}

function AttentionList({ items }) {
  if (!items.length) return <div className="crew-dashboard-empty"><CheckCircle2 size={17} />Everything is on track right now.</div>;
  return <div className="crew-dashboard-list">
    {items.map((item) => <a className={`crew-dashboard-row is-${item.priority || "normal"}`} href={attentionHref(item.key)} key={item.key}>
      <span className="crew-dashboard-attention-icon"><AttentionIcon item={item} size={17} /></span>
      <span className="min-w-0 flex-1"><strong>{item.title}</strong><small>{item.detail}</small></span>
      <ChevronRight className="shrink-0 text-text-muted" size={16} />
    </a>)}
  </div>;
}

function CrewTodayList({ rows }) {
  const [filter, setFilter] = useState("all");
  const groups = [
    { key: "on_duty", label: "Currently On Duty" },
    { key: "starting_later", label: "Starting Later" },
    { key: "on_leave", label: "On Leave Today" },
  ];
  const counts = Object.fromEntries(groups.map((group) => [group.key, rows.filter((row) => row.group === group.key).length]));
  const visibleGroups = groups.filter((group) => filter === "all" || filter === group.key).filter((group) => counts[group.key]);
  return <AdminDataSection title="Your Crew Today" description="Published roster and current attendance." actions={<a className="btn-secondary h-8 px-3 text-xs" href={adminHref("crew_roster")}>View roster</a>}>
    {groups.filter((group) => counts[group.key]).length > 1 ? <div className="crew-dashboard-tabs" role="tablist" aria-label="Crew today filter"><button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All <span>{rows.length}</span></button>{groups.filter((group) => counts[group.key]).map((group) => <button type="button" role="tab" aria-selected={filter === group.key} className={filter === group.key ? "is-active" : ""} onClick={() => setFilter(group.key)} key={group.key}>{group.label.replace(" Today", "")} <span>{counts[group.key]}</span></button>)}</div> : null}
    <div className="crew-dashboard-list crew-dashboard-crew-list">{visibleGroups.map((group) => <div key={group.key}><h3>{group.label} <span>· {counts[group.key]}</span></h3>{rows.filter((row) => row.group === group.key).map((row) => <CrewTodayRow row={row} key={row.employee_id} />)}</div>)}</div>
  </AdminDataSection>;
}

function CrewTodayRow({ row }) {
  return <a className="crew-dashboard-row" href={adminHref("crew_roster")}>
    <PersonAvatar name={row.name} />
    <span className="min-w-0 flex-1"><strong>{row.name}</strong><small>{row.position || "Crew"}</small></span>
    <span className="crew-dashboard-shift">{formatShift(row.start_time, row.end_time)}</span>
    <DashboardStatus status={row.status} />
    <ChevronRight className="shrink-0 text-text-muted" size={16} aria-hidden="true" />
  </a>;
}

function TasksTodayList({ rows }) {
  return <AdminDataSection title="Today's Tasks" description="Current task occurrences for this outlet." actions={<a className="btn-secondary h-8 px-3 text-xs" href={adminHref("crew_operations")}>View all</a>}>
    <div className="crew-dashboard-list">{rows.map((row) => <a className="crew-dashboard-row" href={adminHref("crew-operations-instance", { instanceId: row.id })} key={row.id}>
      <span className={`crew-dashboard-task-icon is-${row.status}`}><ListChecks size={17} /></span>
      <span className="min-w-0 flex-1"><strong>{row.name}</strong><small>{row.assignment}</small></span>
      <span className="crew-dashboard-row-meta"><DashboardStatus status={row.status} /><small>{taskTiming(row)}</small></span>
      <ChevronRight className="shrink-0 text-text-muted" size={16} aria-hidden="true" />
    </a>)}</div>
  </AdminDataSection>;
}

function CompactUpcomingEmpty() {
  return <div className="crew-dashboard-upcoming-empty"><CalendarDays size={17} /><span><strong>Nothing coming up in the next 30 days.</strong><small>Confirmed Crew events will appear here.</small></span></div>;
}

function PersonAvatar({ name, tone = "mint" }) {
  const initials = String(name || "Crew").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className={`crew-dashboard-avatar is-${tone}`} aria-hidden="true">{initials}</span>;
}

function DashboardStatus({ status }) {
  const meta = {
    working: ["Working", "success"], not_checked_in: ["Not checked in", "danger"], starting_later: ["Starting later", "neutral"], on_leave: ["On leave", "neutral"], finished: ["Finished", "neutral"], overdue: ["Overdue", "danger"], in_progress: ["In progress", "info"], upcoming: ["Upcoming", "neutral"], completed: ["Completed", "success"],
  }[status] || ["Scheduled", "neutral"];
  return <Badge tone={meta[1]}>{meta[0]}</Badge>;
}

function AttentionIcon({ item, size }) {
  if (item.key === "tasks") return <ListChecks size={size} />;
  if (item.key === "missing_checkin" || item.key === "attendance_exceptions") return <UserCheck size={size} />;
  if (item.key === "leave_requests") return <CalendarDays size={size} />;
  if (item.key?.startsWith("compliance")) return <ClipboardCheck size={size} />;
  return <AlertTriangle size={size} />;
}

function attentionHref(key) {
  return {
    leave_requests: adminHref("crew_leave"),
    attendance_exceptions: adminHref("crew_attendance"),
    compliance_review: adminHref("employee_compliance"),
    compliance_status: adminHref("employee_compliance"),
    performance_reviews: adminHref("crew_performance"),
    tasks: adminHref("crew_operations"),
    missing_checkin: adminHref("crew_attendance"),
    crew_access: adminHref("crew_employees"),
  }[key] || adminHref("crew_dashboard");
}

function upcomingContext(item) {
  if (item.type === "birthday") return item.position || "Crew";
  if (item.type === "compliance") return `Compliance expiry · ${item.requirement_name || "Document"}`;
  return `Approved leave · ${item.position || "Crew"}`;
}

function upcomingHref(type) {
  if (type === "leave") return adminHref("crew_leave");
  if (type === "compliance") return adminHref("employee_compliance");
  return adminHref("crew_employees");
}

function formatUpcomingDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function relativeUpcomingDay(daysUntil) {
  const days = Number(daysUntil || 0);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function formatDashboardDate(value) {
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function formatShift(startTime, endTime) {
  if (!startTime || !endTime) return "—";
  const format = (value) => new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit" }).format(new Date(`1970-01-01T${value}`));
  return `${format(startTime)} – ${format(endTime)}`;
}

function taskTiming(row) {
  if (!row.due_at) return "Today";
  const due = new Date(row.due_at);
  if (Number.isNaN(due.getTime())) return "Today";
  if (row.status === "overdue") {
    const minutes = Math.max(1, Math.round((Date.now() - due.getTime()) / 60000));
    return `${minutes} min overdue`;
  }
  return `Due ${new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit" }).format(due)}`;
}
