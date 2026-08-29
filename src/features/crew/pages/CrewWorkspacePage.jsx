import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, ShieldCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import CrewAccessManagerModal from "../components/CrewAccessManagerModal.jsx";
import CrewDisableAccessModal from "../components/CrewDisableAccessModal.jsx";
import CrewSpecialAccessModal from "../components/CrewSpecialAccessModal.jsx";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { crewAccessState, CREW_ACCESS_STATE_LABEL } from "../../../services/crewService.js";

export default function CrewWorkspacePage({ auth, ui, store, initialTab = "dashboard" }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [specialAccessEmployee, setSpecialAccessEmployee] = useState(null);
  const [disableEmployee, setDisableEmployee] = useState(null);
  const [query, setQuery] = useState("");
  const refreshGeneration = useRef(0);
  const canManage = auth.hasPermission("crew_employees.manage");
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    if (!outletId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const nextEmployees = await employeeService.listCrewAccessEmployees(outletId);
      if (generation === refreshGeneration.current) setEmployees(nextEmployees);
    } catch (error) {
      if (generation === refreshGeneration.current) {
        ui.notify({ title: "Unable to load Crew access", message: error.message, tone: "error" });
      }
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [outletId, ui]);
  useEffect(() => {
    refresh();
    return () => { refreshGeneration.current += 1; };
  }, [refresh]);
  const scopedEmployees = useMemo(() => employees.filter((employee) => {
    const searchMatches = !query || `${employee.full_name} ${employee.position || ""} ${employee.employee_code || ""}`.toLowerCase().includes(query.toLowerCase());
    return searchMatches;
  }), [employees, query]);
  const active = useMemo(() => scopedEmployees.filter((employee) => crewAccessState(employee.crew_access) === "active"), [scopedEmployees]);
  const locked = useMemo(() => scopedEmployees.filter((employee) => crewAccessState(employee.crew_access) === "locked"), [scopedEmployees]);
  const outletControl = <CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

  if (initialTab === "employees") return <div className="space-y-4">
    <PageHeader section="Crew · People" title="Crew Access" description="Manage mobile Crew access separately from existing FeedX Admin Access." />
    <CrewAdminToolbar outlet={outletControl} search={<label className="field"><span>Search Crew</span><input className="control w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, position or employee code" /></label>} />
    <Card title="Employee Crew Access" description="Passcodes are never stored or shown again after generation.">
      {loading ? <div className="p-8 text-sm font-semibold text-text-secondary">Loading employees…</div> : <DataTable tableClassName="min-w-[1120px]" rows={scopedEmployees} getRowKey={(row) => row.id} columns={employeeColumns(canManage, setRequest, setSpecialAccessEmployee, setDisableEmployee)} />}
    </Card>
    {request ? <CrewAccessManagerModal employee={request.employee} mode={request.mode} onClose={() => setRequest(null)} onSaved={refresh} /> : null}
    {specialAccessEmployee ? <CrewSpecialAccessModal employee={specialAccessEmployee} onClose={() => setSpecialAccessEmployee(null)} onSaved={refresh} /> : null}
    {disableEmployee ? <CrewDisableAccessModal employee={disableEmployee} onClose={() => setDisableEmployee(null)} onSaved={refresh} /> : null}
  </div>;

  return <div className="space-y-4">
    <PageHeader section="Crew · Overview" title="Crew Foundation" description="Mobile access and attendance are now a dedicated workforce workspace." />
    <CrewAdminToolbar outlet={outletControl} />
    <div className="grid gap-4 md:grid-cols-3"><Metric icon={UsersRound} label="Crew Access Active" value={active.length} helper="Employees able to use Crew mobile" /><Metric icon={Clock3} label="Open shifts" value="—" helper="Attendance control is available in Crew" /><Metric icon={ShieldCheck} label="Access review" value={locked.length} helper="Locked Crew accounts need attention" tone="amber" /></div>
    <Card title="Crew Workspace" description="Crew access remains independent from Admin access."><div className="grid gap-3 md:grid-cols-2"><p className="rounded-xl bg-slate-50 p-4 text-sm text-text-secondary">Employees retain their existing role, Admin access state and Admin login history.</p><p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Mobile Crew access, attendance, learning, operations, performance and rewards remain scoped to the selected Outlet.</p></div></Card>
  </div>;
}

function employmentLabel(row) {
  const type = { full_time: "Full-Time", part_time: "Part-Time", contract: "Contract", probation: "Probation", intern: "Intern" }[row.employment_type] || row.employment_type || "—";
  const status = row.is_active === false ? "Inactive" : { active: "Active", inactive: "Inactive", resigned: "Resigned", terminated: "Terminated" }[row.employment_status] || row.employment_status || "Active";
  return <div><div className="font-medium text-text-primary">{type}</div><div className="text-xs text-text-secondary">{status}</div></div>;
}

function employeeColumns(canManage, setRequest, setSpecialAccessEmployee, setDisableEmployee) { return [
  { key: "employee", header: "Employee", render: (row) => <div><div className="font-bold text-text-primary">{row.full_name}</div><div className="text-xs text-text-secondary">{row.position || "No position"} · {row.workplace || "No workplace"}</div></div> },
  { key: "employment", header: "Employment", render: employmentLabel },
  { key: "mobile", header: "Mobile", render: (row) => row.crew_access?.mobile_number || row.contact || "—" },
  { key: "crew", header: "Crew Access", render: (row) => { const state = crewAccessState(row.crew_access); return <Badge tone={state === "active" ? "success" : state === "locked" ? "warning" : "neutral"}>{CREW_ACCESS_STATE_LABEL[state]}</Badge>; } },
  { key: "special", header: "Special Access", render: (row) => row.crew_access?.access_state === "active" ? <span className="text-sm text-text-secondary">{row.crew_access?.can_initiate_handover ? "Hand Over Cash" : "None"}</span> : <span className="text-sm text-text-muted">Enable Crew Access first</span> },
  { key: "last", header: "Last login", render: (row) => row.crew_access?.last_login_at ? new Date(row.crew_access.last_login_at).toLocaleString("en-MY") : "—" },
  { key: "action", header: "Actions", align: "right", render: (row) => {
    if (!canManage) return null;
    const activeAccess = row.crew_access?.access_state === "active";
    return <div className="flex justify-end gap-2">{activeAccess ? <><button className="btn-secondary whitespace-nowrap" type="button" onClick={() => setSpecialAccessEmployee(row)}>Special Access</button><button className="btn-secondary whitespace-nowrap" type="button" onClick={() => setRequest({ employee: row, mode: "reset" })}>Reset Passcode</button><button className="btn-secondary whitespace-nowrap text-rose-700" type="button" onClick={() => setDisableEmployee(row)}>Disable</button></> : <><button className="btn-secondary whitespace-nowrap" type="button" disabled>Special Access</button><button className="btn-primary whitespace-nowrap" type="button" onClick={() => setRequest({ employee: row, mode: "enable" })}>Activate</button></>}</div>;
  } },
]; }

function Metric({ icon: Icon, label, value, helper, tone = "green" }) { return <div className={`rounded-2xl border p-5 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-border bg-surface"}`}><Icon size={18} className={tone === "amber" ? "text-amber-700" : "text-primary"} /><div className="mt-5 text-3xl font-bold text-text-primary">{value}</div><div className="mt-1 font-semibold text-text-primary">{label}</div><div className="mt-1 text-xs text-text-secondary">{helper}</div></div>; }
