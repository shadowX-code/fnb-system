import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronRight, ClipboardCheck, Clock3, MoreHorizontal, ShieldCheck, UserCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
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
import { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { crewAccessState, crewService, CREW_ACCESS_STATE_LABEL } from "../../../services/crewService.js";
import { formatOperationalDateTime } from "../../../lib/dateTime.js";

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
  const outletControl = <CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

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
  const [data, setData] = useState({ summary: {}, birthdays: [], attention: [], crew_access: {} });
  const [loading, setLoading] = useState(Boolean(outletId));
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  async function refresh() {
    if (!outletId) {
      setLoading(false);
      setHasLoaded(false);
      setError("");
      setData({ summary: {}, birthdays: [], attention: [], crew_access: {} });
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setHasLoaded(false);
    setData({ summary: {}, birthdays: [], attention: [], crew_access: {} });
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
  const access = data.crew_access || {};
  const outletControl = <CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

  return <div className="space-y-4">
    <PageHeader section="Crew · Overview" title="Crew Dashboard" description="What is happening with your Crew today, and what needs attention." />
    <AdminFilterToolbar outlet={outletControl} />
    <AsyncDataSurface loading={loading} error={error} errorTitle="Unable to load Crew Dashboard" hasData={hasLoaded} isEmpty={!outletId} emptyTitle="No outlet selected" emptyDescription="Select an outlet to see its current Crew operations." onRetry={refresh}>
      <AdminDataSection title="Workforce Snapshot" description="Today for the selected outlet.">
        <div className="p-4">
          <AdminSummaryGrid ariaLabel="Workforce snapshot" items={[
            { label: "Active Crew", value: Number(summary.active_crew || 0), helper: "Current active employees", icon: UsersRound },
            { label: "Scheduled Today", value: Number(summary.scheduled_today || 0), helper: "Published working roster", icon: CalendarDays },
            { label: "Present Today", value: Number(summary.present_today || 0), helper: "Attendance recorded", icon: UserCheck, tone: "success" },
            { label: "On Leave Today", value: Number(summary.on_leave_today || 0), helper: "Approved leave", icon: Clock3, tone: Number(summary.on_leave_today || 0) ? "warning" : "neutral" },
          ]} />
        </div>
      </AdminDataSection>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,.82fr)]">
        <AdminDataSection title="Today & Upcoming" description="Upcoming Crew birthdays over the next seven days." actions={<a className="btn-secondary" href="#crew_employees">View Crew</a>}>
          <BirthdayList birthdays={data.birthdays || []} />
        </AdminDataSection>
        <AdminDataSection title="Needs Attention" description="Items that have an owning Crew workflow." actions={attention.length ? <span className="text-xs font-semibold text-text-muted">{attention.length} areas</span> : null}>
          <AttentionList items={attention} />
        </AdminDataSection>
      </div>

      <AdminDataSection title="Crew Access" description="Mobile access status for active Crew." actions={<a className="btn-secondary" href="#crew_employees">Manage</a>}>
        <div className="p-4">
          <AdminSummaryGrid variant="compact" ariaLabel="Crew access summary" items={[
            { label: "Active", value: Number(access.active || 0), helper: "Can use Crew mobile", icon: UsersRound, tone: "success" },
            { label: "Not enabled", value: Number(access.not_enabled || 0), helper: "Need access setup", icon: ShieldCheck, tone: Number(access.not_enabled || 0) ? "warning" : "neutral" },
            { label: "Locked", value: Number(access.locked || 0), helper: "Need access review", icon: ShieldCheck, tone: Number(access.locked || 0) ? "warning" : "neutral" },
          ]} />
        </div>
      </AdminDataSection>
    </AsyncDataSurface>
  </div>;
}

function BirthdayList({ birthdays }) {
  if (!birthdays.length) return <div className="p-5 text-sm text-text-secondary">No active Crew birthdays in the next seven days.</div>;
  return <div className="divide-y divide-border px-4">
    {birthdays.map((birthday) => <a className="flex min-w-0 items-center gap-3 py-3 transition-colors hover:text-primary" href="#crew_employees" key={birthday.employee_id}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-700"><CalendarDays size={15} /></span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-text-primary">{birthday.full_name}</strong><small className="block truncate text-xs text-text-secondary">{birthday.position || "Crew"}</small></span>
      <span className="shrink-0 text-right"><strong className="block text-sm text-text-primary">{formatBirthdayDate(birthday.date)}</strong><small className="block text-xs font-medium text-primary">{relativeBirthdayDay(birthday.days_until)}</small></span>
      <ChevronRight className="shrink-0 text-text-muted" size={16} />
    </a>)}
  </div>;
}

function AttentionList({ items }) {
  if (!items.length) return <div className="p-5 text-sm text-text-secondary">No current Crew items need action.</div>;
  return <div className="divide-y divide-border px-4">
    {items.map((item) => <a className="flex min-w-0 items-center gap-3 py-3 transition-colors hover:text-primary" href={attentionHref(item.key)} key={item.key}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"><AttentionIcon itemKey={item.key} /></span>
      <span className="min-w-0 flex-1"><strong className="block text-sm text-text-primary">{item.title}</strong><small className="block text-xs text-text-secondary">{item.detail}</small></span>
      <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800">{item.count}</span>
      <ChevronRight className="shrink-0 text-text-muted" size={16} />
    </a>)}
  </div>;
}

function AttentionIcon({ itemKey }) {
  if (itemKey === "attendance_exceptions") return <AlertTriangle size={15} />;
  if (itemKey.startsWith("compliance")) return <ClipboardCheck size={15} />;
  if (itemKey === "performance_reviews") return <UserCheck size={15} />;
  return <CalendarDays size={15} />;
}

function attentionHref(key) {
  return {
    leave_requests: "#crew_leave",
    attendance_exceptions: "#crew_attendance",
    compliance_review: "#employee_compliance",
    compliance_status: "#employee_compliance",
    performance_reviews: "#crew_performance",
  }[key] || "#crew_dashboard";
}

function formatBirthdayDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function relativeBirthdayDay(daysUntil) {
  const days = Number(daysUntil || 0);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
