import { useEffect, useMemo, useState } from "react";
import { Edit3, Eye, MoreHorizontal, Plus, Power, Search, Trash2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import FilterPopover from "../../../components/forms/FilterPopover.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { departmentService } from "../../../services/departmentService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";

function statusTone(status) {
  return status === "active" ? "success" : "neutral";
}

function createEmptyDepartment() {
  return {
    id: "",
    name: "",
    description: "",
    status: "active",
    updated_at: "",
  };
}

function DepartmentModal({ mode, initialDepartment, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({ ...createEmptyDepartment(), ...initialDepartment }));

  function updateValue(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit() {
    if (!values.name.trim()) return;
    onSubmit({
      ...values,
      name: values.name.trim(),
      description: values.description.trim(),
      updated_at: new Date().toISOString(),
    });
  }

  return (
    <Modal
      title={mode === "add" ? "Add Department" : "Edit Department"}
      description="Departments organize employee job positions and company structure."
      onClose={onClose}
      size="md"
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" onClick={handleSubmit}>Save Department</button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FieldLabel label="Department Name">
          <input className="control" value={values.name} onChange={(event) => updateValue("name", event.target.value)} placeholder="Operations" />
        </FieldLabel>
        <FieldLabel label="Status">
          <SelectField
            value={values.status}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            onChange={(nextValue) => updateValue("status", nextValue)}
          />
        </FieldLabel>
        <FieldLabel label="Description optional">
          <textarea
            className="control min-h-24 resize-none md:col-span-2"
            value={values.description}
            onChange={(event) => updateValue("description", event.target.value)}
            placeholder="What this department is responsible for"
          />
        </FieldLabel>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, helper, tone = "neutral" }) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : "text-text-primary";
  return (
    <Card className="p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-text-secondary">{helper}</div>
    </Card>
  );
}

export default function DepartmentsPage({ ui, auth }) {
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formState, setFormState] = useState(null);
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [actionMenuDepartmentId, setActionMenuDepartmentId] = useState(null);
  const canManage = auth?.hasPermission?.("departments.create") || auth?.hasPermission?.("departments.edit") || auth?.hasPermission?.("departments.delete") || false;

  useEffect(() => {
    let ignore = false;
    async function loadDepartments() {
      setLoading(true);
      setError("");
      try {
        const rows = await departmentService.listDepartments();
        const jobPositions = await jobPositionService.listJobPositions().catch(() => []);
        if (!ignore) {
          setDepartments(rows);
          setPositions(jobPositions);
        }
      } catch (loadError) {
        console.error("Unable to load departments", loadError);
        if (!ignore) setError(loadError.message || "Unable to load departments.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadDepartments();
    return () => {
      ignore = true;
    };
  }, []);

  const departmentUsage = useMemo(() => {
    const usage = new Map();
    departments.forEach((department) => usage.set(department.name, { activePositions: 0, activeUsers: 0 }));
    positions.forEach((position) => {
      if (!position.department || position.status !== "active") return;
      const item = usage.get(position.department) ?? { activePositions: 0, activeUsers: 0 };
      item.activePositions += 1;
      item.activeUsers += Number(position.active_users || 0);
      usage.set(position.department, item);
    });
    return usage;
  }, [departments, positions]);

  const filteredDepartments = useMemo(() => {
    const search = query.trim().toLowerCase();
    return departments.filter((department) => {
      const matchesSearch = !search || [department.name, department.description].some((value) => String(value || "").toLowerCase().includes(search));
      const matchesStatus = statusFilter === "all" || department.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [departments, query, statusFilter]);

  const stats = {
    total: departments.length,
    active: departments.filter((department) => department.status === "active").length,
    assignedPositions: [...departmentUsage.values()].reduce((sum, item) => sum + item.activePositions, 0),
    assignedUsers: [...departmentUsage.values()].reduce((sum, item) => sum + item.activeUsers, 0),
  };

  async function saveDepartment(department) {
    try {
      const saved = await departmentService.saveDepartment(department);
      setDepartments((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current];
      });
      setFormState(null);
      ui.notify({ title: formState?.mode === "add" ? "Department added" : "Department updated", message: saved.name });
    } catch (saveError) {
      console.error("Unable to save department", saveError);
      ui.notify({ title: "Unable to save department", message: saveError.message || "Please try again.", tone: "error" });
    }
  }

  async function disableDepartment(department) {
    await saveDepartment({ ...department, status: "inactive", updated_at: new Date().toISOString() });
  }

  async function deleteDepartment(department) {
    const usage = departmentUsage.get(department.name);
    if ((usage?.activePositions ?? 0) || (usage?.activeUsers ?? 0)) return;
    try {
      await departmentService.deleteDepartment(department.id);
      setDepartments((current) => current.filter((item) => item.id !== department.id));
      ui.notify({ title: "Department deleted", message: department.name });
    } catch (deleteError) {
      console.error("Unable to delete department", deleteError);
      ui.notify({ title: "Unable to delete department", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  const columns = [
    {
      key: "name",
      header: "Department",
      sticky: true,
      width: "300px",
      render: (row) => (
        <div>
          <div className="text-sm font-bold text-text-primary">{row.name}</div>
          <div className="line-clamp-1 text-xs text-text-secondary">{row.description || "Employee grouping master data"}</div>
        </div>
      ),
    },
    {
      key: "positions",
      header: "Active Positions",
      align: "right",
      render: (row) => <span className="text-sm font-bold text-text-primary">{departmentUsage.get(row.name)?.activePositions ?? 0}</span>,
    },
    {
      key: "users",
      header: "Active Users",
      align: "right",
      render: (row) => <span className="text-sm font-bold text-text-primary">{departmentUsage.get(row.name)?.activeUsers ?? 0}</span>,
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status === "active" ? "Active" : "Inactive"}</Badge> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "76px",
      render: (row) => (
        <div className="relative flex justify-end" onClick={(event) => event.stopPropagation()}>
          <button className="icon-btn" type="button" aria-label="Department actions" onClick={() => setActionMenuDepartmentId((value) => (value === row.id ? null : row.id))}>
            <MoreHorizontal size={15} />
          </button>
          {actionMenuDepartmentId === row.id ? (
            <div className="absolute right-0 top-9 z-50 w-48 rounded-2xl border border-border bg-white p-1.5 text-sm shadow-xl">
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setSelectedDepartment(row); setActionMenuDepartmentId(null); }}>
                <Eye size={14} /> View
              </button>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!canManage} onClick={() => { setFormState({ mode: "edit", department: row }); setActionMenuDepartmentId(null); }}>
                <Edit3 size={14} /> Edit
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!canManage || row.status === "inactive"}
                onClick={() => {
                  const usage = departmentUsage.get(row.name);
                  if ((usage?.activePositions ?? 0) || (usage?.activeUsers ?? 0)) {
                    ui.notify({
                      title: "Department disabled with linked records",
                      message: "Existing users and positions remain linked. This department will not appear for new selections.",
                      tone: "warning",
                    });
                  }
                  disableDepartment(row);
                  setActionMenuDepartmentId(null);
                }}
              >
                <Power size={14} /> Disable
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!canManage || Boolean(departmentUsage.get(row.name)?.activePositions || departmentUsage.get(row.name)?.activeUsers)}
                onClick={() => { deleteDepartment(row); setActionMenuDepartmentId(null); }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="People"
        title="Departments"
        description="Manage company departments used for employee profiles and job positions."
        actions={
          <button className="btn-primary" type="button" disabled={!canManage} onClick={() => setFormState({ mode: "add", department: createEmptyDepartment() })}>
            <Plus size={16} /> Add Department
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Departments" value={stats.total} helper="Company grouping structure" />
        <StatCard label="Active Departments" value={stats.active} helper="Available for positions" tone="success" />
        <StatCard label="Assigned Positions" value={stats.assignedPositions} helper="Job titles linked" />
        <StatCard label="Assigned Users" value={stats.assignedUsers} helper="Employees linked" />
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
        Departments organize employee job positions and company structure.
      </div>

      <FilterBar compact>
        <FieldLabel label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input className="control h-9 min-w-[260px] pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search department..." />
          </div>
        </FieldLabel>
        <FieldLabel label="Status">
          <FilterPopover
            value={statusFilter === "all" ? "" : statusFilter}
            placeholder="All Status"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            onApply={(nextValue) => setStatusFilter(nextValue || "all")}
          />
        </FieldLabel>
      </FilterBar>

      {!canManage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          You can view departments, but need departments.create, departments.edit, or departments.delete permission to change them.
        </div>
      ) : null}

      {/* TODO: Reintroduce module dependency mapping when HR/KPI/Payroll modules are implemented. */}
      <Card title="Department Catalog" description="Departments are used to group job positions and employees.">
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading departments...</div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{error}</div>
        ) : filteredDepartments.length ? (
          <DataTable columns={columns} rows={filteredDepartments} getRowKey={(row) => row.id} density="compact" tableClassName="min-w-[980px]" onRowClick={(row) => setSelectedDepartment(row)} />
        ) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">No departments found. Create your first department.</div>
          </div>
        )}
      </Card>

      {selectedDepartment ? (
        <Modal
          title={selectedDepartment.name}
          description="Department overview, linked job positions, users and audit preview."
          onClose={() => setSelectedDepartment(null)}
          size="lg"
          footer={<button className="btn-primary" type="button" onClick={() => setSelectedDepartment(null)}>Done</button>}
        >
          <div className="space-y-4">
            <section className="rounded-2xl border border-border p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Department Overview</div>
              <p className="text-sm text-text-secondary">{selectedDepartment.description || "No description added."}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={statusTone(selectedDepartment.status)}>{selectedDepartment.status === "active" ? "Active" : "Inactive"}</Badge>
              </div>
            </section>
            <section className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-border p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">Linked Job Positions</div>
                <div className="space-y-2">
                  {positions.filter((position) => position.department === selectedDepartment.name).length ? (
                    positions
                      .filter((position) => position.department === selectedDepartment.name)
                      .map((position) => (
                        <div key={position.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                          <span className="text-sm font-semibold text-text-primary">{position.name}</span>
                          <Badge tone={position.status === "active" ? "success" : "neutral"}>{position.status}</Badge>
                        </div>
                      ))
                  ) : (
                    <p className="text-sm text-text-secondary">No linked job positions.</p>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <div className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">Linked Users</div>
                <div className="space-y-2 text-sm text-text-secondary">
                  <div><strong className="text-text-primary">{departmentUsage.get(selectedDepartment.name)?.activeUsers ?? 0}</strong> active users linked through job positions.</div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2">Detailed employee listing will connect once employee profiles are fully linked.</div>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">Audit History</div>
              <p className="text-sm text-text-secondary">Audit history placeholder. Future changes will record creator, editor, disabled action and timestamp.</p>
            </section>
          </div>
        </Modal>
      ) : null}

      {formState ? (
        <DepartmentModal
          mode={formState.mode}
          initialDepartment={formState.department}
          onClose={() => setFormState(null)}
          onSubmit={saveDepartment}
        />
      ) : null}
    </div>
  );
}
