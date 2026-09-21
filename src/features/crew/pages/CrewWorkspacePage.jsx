import { useMemo, useState } from "react";
import { MoreHorizontal, ShieldCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
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
import { crewAccessState, CREW_ACCESS_STATE_LABEL } from "../../../services/crewService.js";
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
  const [listing, listingActions] = useAdminPagedQuery({
    storageKey: "crew-access",
    enabled: Boolean(outletId),
    querySignature: accessSignature,
    loadPage: ({ page, pageSize }) => employeeService.crewAccessAdminPage({ outletId, filters: accessFilters, page, pageSize }),
  });
  const employees = listing.rows;
  const accessSummary = listing.summary || {};
  const refresh = listingActions.refreshNow;
  const outletControl = <CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

  if (initialTab === "employees") return <div className="space-y-4">
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

  return <div className="space-y-4">
    <PageHeader section="Crew · Overview" title="Crew Dashboard" description="A concise readiness view for the selected outlet's Crew mobile access." />
    <AdminFilterToolbar outlet={outletControl} />
    <AsyncDataSurface loading={listing.loading} error={listing.error} hasData={listing.hasLoaded} isEmpty={listing.hasLoaded && !listing.loadedTotal} emptyTitle="No Crew access records" emptyDescription="Crew access records for this outlet will appear here." onRetry={listingActions.retry}>
      <section className="overflow-hidden rounded-lg border border-border bg-surface" aria-label="Crew access readiness">
        <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <DashboardMetric icon={UsersRound} label="Active Crew access" value={Number(accessSummary.active || 0)} helper="Able to use Crew mobile" />
          <DashboardMetric icon={ShieldCheck} label="Not enabled" value={Number(accessSummary.not_enabled || 0)} helper="Require Crew access setup" />
          <DashboardMetric icon={ShieldCheck} label="Locked" value={Number(accessSummary.locked || 0)} helper="Require access review" tone="warning" />
        </div>
      </section>
      <section className="border-t border-border pt-4">
        <h2 className="text-sm font-semibold text-text-primary">Operational shortcuts</h2>
        <p className="mt-1 text-sm text-text-secondary">Use the dedicated workforce, operations, learning, performance, and reward workspaces for their canonical evidence and decisions.</p>
      </section>
    </AsyncDataSurface>
  </div>;
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

function DashboardMetric({ icon: Icon, label, value, helper, tone = "neutral" }) { return <article className={`flex items-center gap-3 p-4 ${tone === "warning" ? "bg-amber-50/60" : ""}`}><span className={`grid h-9 w-9 place-items-center rounded-md ${tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary"}`}><Icon size={17} /></span><span className="min-w-0"><strong className="block text-xl text-text-primary">{value}</strong><span className="block text-sm font-semibold text-text-primary">{label}</span><small className="block text-xs text-text-secondary">{helper}</small></span></article>; }
