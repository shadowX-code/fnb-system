import { useEffect, useMemo, useState } from "react";
import { Clock3, ShieldCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import CrewAccessManagerModal from "../components/CrewAccessManagerModal.jsx";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { crewAccessState, CREW_ACCESS_STATE_LABEL } from "../../../services/crewService.js";

export default function CrewWorkspacePage({ auth, ui, store, initialTab = "dashboard" }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [query, setQuery] = useState("");
  const canManage = auth.hasPermission("crew_employees.manage");
  async function refresh() { setLoading(true); try { setEmployees(await employeeService.listEmployees()); } catch (error) { ui.notify({ title: "Unable to load Crew access", message: error.message, tone: "error" }); } finally { setLoading(false); } }
  useEffect(() => { refresh(); }, []);
  const selectedOutlet = outlets.find((outlet) => outlet.id === outletId);
  const scopedEmployees = useMemo(() => employees.filter((employee) => {
    const outletMatches = !outletId || employee.outlet_id === outletId || employee.workplace === selectedOutlet?.name;
    const searchMatches = !query || `${employee.full_name} ${employee.position || ""} ${employee.employee_code || ""}`.toLowerCase().includes(query.toLowerCase());
    return outletMatches && searchMatches;
  }), [employees, outletId, query, selectedOutlet?.name]);
  const active = useMemo(() => scopedEmployees.filter((employee) => crewAccessState(employee.crew_access) === "active"), [scopedEmployees]);
  const locked = useMemo(() => scopedEmployees.filter((employee) => crewAccessState(employee.crew_access) === "locked"), [scopedEmployees]);
  const outletControl = <CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;

  if (initialTab === "employees") return <div className="space-y-4">
    <PageHeader section="Crew · People" title="Crew Access" description="Manage mobile Crew access separately from existing FeedX Admin Access." />
    <CrewAdminToolbar outlet={outletControl} search={<label className="field"><span>Search Crew</span><input className="control w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, position or employee code" /></label>} />
    <Card title="Employee Crew Access" description="Passcodes are never stored or shown again after generation.">
      {loading ? <div className="p-8 text-sm font-semibold text-text-secondary">Loading employees…</div> : <DataTable tableClassName="min-w-[760px]" rows={scopedEmployees} getRowKey={(row) => row.id} columns={employeeColumns(canManage, setRequest)} />}
    </Card>
    {request ? <CrewAccessManagerModal employee={request.employee} mode={request.mode} onClose={() => setRequest(null)} onSaved={refresh} /> : null}
  </div>;

  return <div className="space-y-4">
    <PageHeader section="Crew · Overview" title="Crew Foundation" description="Mobile access and attendance are now a dedicated workforce workspace." />
    <CrewAdminToolbar outlet={outletControl} />
    <div className="grid gap-4 md:grid-cols-3"><Metric icon={UsersRound} label="Crew Access Active" value={active.length} helper="Employees able to use Crew mobile" /><Metric icon={Clock3} label="Open shifts" value="—" helper="Attendance control is available in Crew" /><Metric icon={ShieldCheck} label="Access review" value={locked.length} helper="Locked Crew accounts need attention" tone="amber" /></div>
    <Card title="Crew Workspace" description="Crew access remains independent from Admin access."><div className="grid gap-3 md:grid-cols-2"><p className="rounded-xl bg-slate-50 p-4 text-sm text-text-secondary">Employees retain their existing role, Admin access state and Admin login history.</p><p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Mobile Crew access, attendance, learning, operations, performance and rewards remain scoped to the selected Outlet.</p></div></Card>
  </div>;
}

function employeeColumns(canManage, setRequest) { return [
  { key: "employee", header: "Employee", render: (row) => <div><div className="font-bold text-text-primary">{row.full_name}</div><div className="text-xs text-text-secondary">{row.position || "No position"} · {row.workplace || "No workplace"}</div></div> },
  { key: "mobile", header: "Mobile", render: (row) => row.crew_access?.mobile_number || row.contact || "—" },
  { key: "crew", header: "Crew Access", render: (row) => { const state = crewAccessState(row.crew_access); return <Badge tone={state === "active" ? "success" : state === "locked" ? "warning" : "neutral"}>{CREW_ACCESS_STATE_LABEL[state]}</Badge>; } },
  { key: "last", header: "Last login", render: (row) => row.crew_access?.last_login_at ? new Date(row.crew_access.last_login_at).toLocaleString("en-MY") : "—" },
  { key: "action", header: "", align: "right", render: (row) => canManage ? <button className="btn-secondary" type="button" onClick={() => setRequest({ employee: row, mode: row.crew_access?.access_state === "active" ? "reset" : "enable" })}>{row.crew_access?.access_state === "active" ? "New passcode" : "Manage access"}</button> : null },
]; }

function Metric({ icon: Icon, label, value, helper, tone = "green" }) { return <div className={`rounded-2xl border p-5 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-border bg-surface"}`}><Icon size={18} className={tone === "amber" ? "text-amber-700" : "text-primary"} /><div className="mt-5 text-3xl font-bold text-text-primary">{value}</div><div className="mt-1 font-semibold text-text-primary">{label}</div><div className="mt-1 text-xs text-text-secondary">{helper}</div></div>; }
