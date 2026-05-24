import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Power, Search, Trash2 } from "lucide-react";
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
import { employeeService } from "../../../services/employeeService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";
import { canCreate, canDelete, canEdit, notifyPermissionDenied } from "../../../utils/accessControl.js";

function statusTone(status) {
  return status === "active" ? "success" : "neutral";
}

function createEmptyPosition() {
  return {
    id: "",
    name: "",
    department: "",
    active_users: 0,
    status: "active",
    description: "",
    updated_at: "",
  };
}

function ReadOnlyField({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-text-primary">{children || "Not provided"}</div>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="rounded-2xl border border-border bg-slate-50/70 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">{title}</div>
      {children}
    </section>
  );
}

function formatEmploymentStatus(status) {
  const labels = {
    full_time: "Full Time",
    part_time: "Part Time",
    resigned: "Resigned",
  };
  return labels[status] ?? "Active";
}

function formatEmployeeName(employee) {
  if (employee.nickname && employee.full_name) return `${employee.full_name} (${employee.nickname})`;
  return employee.full_name || employee.nickname || "Unnamed employee";
}

function activeEmployeeCountForPosition(employees, positionName) {
  return employees.filter((employee) => employee.position === positionName && employee.employment_status !== "resigned").length;
}

function getPositionAudit(position, isNew = false) {
  if (isNew || !position?.id) {
    return {
      createdBy: "—",
      createdDate: "—",
      updatedBy: "—",
      updatedDate: "—",
    };
  }
  const updatedAt = position?.updated_at || "";
  return {
    createdBy: position?.created_by_name || "—",
    createdDate: position?.created_at || "—",
    updatedBy: position?.updated_by_name || "—",
    updatedDate: updatedAt || "—",
  };
}

function JobPositionModal({
  mode = "view",
  initialPosition,
  departments,
  linkedEmployees = [],
  outlets = [],
  onClose,
  onModeChange,
  onSubmit,
  onQuickCreateDepartment,
  canEditPosition = false,
}) {
  const [values, setValues] = useState(() => ({ ...createEmptyPosition(), ...initialPosition }));
  const [showAllLinkedEmployees, setShowAllLinkedEmployees] = useState(false);
  const isView = mode === "view";
  const isCreate = mode === "create";
  const activeDepartments = departments.filter((department) => department.status === "active");
  const selectedDepartment = departments.find((department) => department.name === values.department);
  const audit = getPositionAudit(values, isCreate);
  const visibleLinkedEmployees = showAllLinkedEmployees ? linkedEmployees : linkedEmployees.slice(0, 5);

  useEffect(() => {
    setValues({ ...createEmptyPosition(), ...initialPosition });
    setShowAllLinkedEmployees(false);
  }, [initialPosition?.id, initialPosition?.updated_at, mode]);

  function updateValue(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit() {
    if (!canEditPosition) {
      return;
    }
    if (!values.name.trim()) return;
    onSubmit({
      ...values,
      name: values.name.trim(),
      department: values.department.trim(),
      description: values.description?.trim() ?? "",
      created_at: values.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  function handleCancel() {
    if (isCreate) {
      onClose();
      return;
    }
    setValues({ ...createEmptyPosition(), ...initialPosition });
    onModeChange("view");
  }

  const linkedEmployeeCount = linkedEmployees.length || Number(values.active_users || 0);
  const title = isCreate ? "Add Job Position" : "Job Position Detail";
  const description = isCreate
    ? "Create a HR job title used in employee profiles. Roles are managed separately for system permissions."
    : `${values.name || "Position"} · ${values.department || "Unassigned"}`;

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      size="xl"
      bodyClassName="py-4"
      footerClassName="py-3"
      footer={
        isView ? (
          <>
            <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
            {canEditPosition ? <button className="btn-primary" type="button" onClick={() => onModeChange("edit")}>Edit Position</button> : <Badge tone="neutral">Read-only access</Badge>}
          </>
        ) : (
          <>
            <button className="btn-secondary" type="button" onClick={handleCancel}>Cancel</button>
            <button className="btn-primary" type="button" disabled={!canEditPosition} onClick={handleSubmit}>{isCreate ? "Create Position" : "Save Position"}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <DetailSection title="Position Info">
          {isView ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyField label="Position Name">{values.name}</ReadOnlyField>
              <ReadOnlyField label="Department">
                {values.department ? (
                  <span className="inline-flex items-center gap-2">
                    {values.department}
                    {selectedDepartment?.status === "inactive" ? <Badge tone="warning">Disabled</Badge> : null}
                  </span>
                ) : <Badge tone="warning">Unassigned</Badge>}
              </ReadOnlyField>
              <ReadOnlyField label="Status"><Badge tone={statusTone(values.status)}>{values.status === "active" ? "Active" : "Inactive"}</Badge></ReadOnlyField>
              <ReadOnlyField label="Last Updated">{formatLastUpdated(values.updated_at)}</ReadOnlyField>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <FieldLabel label="Position Name">
                <input className="control" value={values.name} onChange={(event) => updateValue("name", event.target.value)} placeholder="Outlet Manager" />
              </FieldLabel>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Department</span>
                  <button className="text-[11px] font-semibold text-primary hover:text-primary-dark" type="button" onClick={onQuickCreateDepartment}>
                    + Create Department
                  </button>
                </div>
                <SelectField
                  value={values.department}
                  placeholder={activeDepartments.length ? "Unassigned" : "No departments yet"}
                  searchable
                  options={[
                    ...activeDepartments.map((department) => ({ value: department.name, label: department.name })),
                    ...(values.department && selectedDepartment?.status === "inactive" ? [{ value: values.department, label: `${values.department} (disabled)` }] : []),
                  ]}
                  onChange={(nextValue) => updateValue("department", nextValue)}
                />
              </div>
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
            </div>
          )}
        </DetailSection>

        <DetailSection title="Linked Employees">
          <div className="space-y-3">
            <div>
              <div className="text-lg font-semibold text-text-primary">{linkedEmployeeCount} {linkedEmployeeCount === 1 ? "employee" : "employees"} linked to this position</div>
              <div className="mt-1 text-xs text-text-secondary">Employees currently or historically using this HR title.</div>
            </div>

            {linkedEmployees.length ? (
              <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
                {visibleLinkedEmployees.map((employee) => {
                  const workplace = outlets.find((outlet) => outlet.id === employee.workplace)?.name || employee.workplace || "No workplace";
                  return (
                    <div key={employee.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1.5fr_1fr] md:items-center">
                      <div>
                        <div className="text-sm font-bold text-text-primary">{formatEmployeeName(employee)}</div>
                        <div className="mt-1 text-xs font-semibold text-text-secondary">
                          {formatEmploymentStatus(employee.employment_status)} · {workplace} · {employee.department || "No department"}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-text-muted md:text-right">{employee.email || employee.contact || "No contact"}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-5 text-sm font-semibold text-text-secondary">
                No employees are currently linked to this position.
              </div>
            )}

            {linkedEmployees.length > 5 ? (
              <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setShowAllLinkedEmployees((current) => !current)}>
                {showAllLinkedEmployees ? "Show first 5" : `Show all ${linkedEmployees.length}`}
              </button>
            ) : null}
          </div>
        </DetailSection>

        <DetailSection title="Audit Info">
          {isCreate ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-semibold text-text-secondary">
              Audit info available after first save.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyField label="Created By">{audit.createdBy}</ReadOnlyField>
              <ReadOnlyField label="Created Date">{audit.createdDate === "—" ? "—" : formatLastUpdated(audit.createdDate)}</ReadOnlyField>
              <ReadOnlyField label="Last Updated By">{audit.updatedBy}</ReadOnlyField>
              <ReadOnlyField label="Last Updated Date">{audit.updatedDate === "—" ? "—" : formatLastUpdated(audit.updatedDate)}</ReadOnlyField>
            </div>
          )}
        </DetailSection>
      </div>
    </Modal>
  );
}

function formatLastUpdated(value) {
  if (!value) return "Not updated";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

export default function JobPositionsPage({ store, ui, auth }) {
  const [positions, setPositions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [positionModal, setPositionModal] = useState({
    open: false,
    mode: null,
    position: null,
  });
  const canCreatePosition = canCreate(auth, "job_positions");
  const canEditPosition = canEdit(auth, "job_positions");
  const canDeletePosition = canDelete(auth, "job_positions");

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [nextPositions, nextDepartments, nextEmployees] = await Promise.all([
          jobPositionService.listJobPositions(),
          departmentService.listDepartments(),
          employeeService.listEmployees(),
        ]);
        if (!ignore) {
          setPositions(nextPositions);
          setDepartments(nextDepartments);
          setEmployees(nextEmployees);
        }
      } catch (loadError) {
        console.error("Unable to load job positions", loadError);
        if (!ignore) setError(loadError.message || "Unable to load job positions.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadData();
    return () => {
      ignore = true;
    };
  }, []);

  const outlets = store?.outlets ?? [];

  const linkedEmployeesByPosition = useMemo(() => {
    const map = new Map();
    employees.forEach((employee) => {
      if (!employee.position) return;
      if (!map.has(employee.position)) map.set(employee.position, []);
      map.get(employee.position).push(employee);
    });
    return map;
  }, [employees]);

  const filteredPositions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return positions.filter((position) => {
      const matchesSearch = !search || [position.name, position.department, position.description].some((value) => String(value).toLowerCase().includes(search));
      const matchesDepartment =
        departmentFilter === "all" ||
        (departmentFilter === "unassigned" ? !position.department : position.department === departmentFilter);
      const matchesStatus = statusFilter === "all" || position.status === statusFilter;
      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }, [departmentFilter, positions, query, statusFilter]);

  const stats = {
    total: positions.length,
    active: positions.filter((position) => position.status === "active").length,
    inactive: positions.filter((position) => position.status === "inactive").length,
    assigned: positions.reduce((sum, position) => sum + Number(position.active_users || 0), 0),
  };

  function closePositionModal() {
    setPositionModal({
      open: false,
      mode: null,
      position: null,
    });
  }

  function openPositionModal(mode, position) {
    setPositionModal({
      open: true,
      mode,
      position,
    });
  }

  function updatePositionModalMode(mode) {
    setPositionModal((current) => (current.open ? { ...current, mode } : current));
  }

  async function savePosition(position) {
    const isNew = !position.id;
    if ((isNew && !canCreatePosition) || (!isNew && !canEditPosition)) {
      notifyPermissionDenied(ui, isNew ? "create job positions" : "edit job positions");
      return;
    }
    try {
      const saved = await jobPositionService.saveJobPosition(position);
      const positionWithCount = {
        ...saved,
        active_users: activeEmployeeCountForPosition(employees, saved.name),
      };
      setPositions((current) => {
        const exists = current.some((item) => item.id === positionWithCount.id);
        return exists ? current.map((item) => (item.id === positionWithCount.id ? positionWithCount : item)) : [positionWithCount, ...current];
      });
      setPositionModal((current) => {
        if (!current.open) return current;
        return current.mode === "create"
          ? { open: false, mode: null, position: null }
          : { open: true, mode: "view", position: positionWithCount };
      });
      ui.notify({ title: positionModal.mode === "create" ? "Position added" : "Position updated", message: saved.name });
    } catch (saveError) {
      console.error("Unable to save job position", saveError);
      ui.notify({ title: "Unable to save position", message: saveError.message || "Please try again.", tone: "error" });
    }
  }

  function quickCreateDepartment() {
    if (!canCreate(auth, "departments")) {
      notifyPermissionDenied(ui, "create departments");
      return;
    }
    const name = window.prompt("New department name");
    if (!name?.trim()) return;
    const departmentName = name.trim();
    const exists = departments.some((department) => department.name.toLowerCase() === departmentName.toLowerCase());
    if (exists) {
      ui.notify({ title: "Department already exists", message: departmentName, tone: "warning" });
      return;
    }
    departmentService.saveDepartment({
      name: departmentName,
      description: "",
      status: "active",
    }).then((saved) => {
      setDepartments((current) => [...current, saved]);
      ui.notify({ title: "Department added", message: departmentName });
    }).catch((saveError) => {
      console.error("Unable to create department", saveError);
      ui.notify({ title: "Unable to create department", message: saveError.message || "Please try again.", tone: "error" });
    });
  }

  async function setPositionStatus(position, status) {
    if (!canEditPosition) {
      notifyPermissionDenied(ui, "edit job positions");
      return;
    }
    closePositionModal();
    await savePosition({ ...position, status, updated_at: new Date().toISOString() });
  }

  async function deletePosition(position) {
    if (!canDeletePosition) {
      notifyPermissionDenied(ui, "delete job positions");
      return;
    }
    const hasAssignedEmployees = Number(position.active_users || 0) > 0;
    if (hasAssignedEmployees) {
      closePositionModal();
      ui.notify({
        title: "Unable to delete position",
        message: "This position is assigned to employees. Reassign employees before deleting.",
        tone: "warning",
      });
      return;
    }
    try {
      closePositionModal();
      await jobPositionService.deleteJobPosition(position);
      setPositions((current) => current.filter((item) => item.id !== position.id));
      ui.notify({ title: "Position deleted", message: position.name });
    } catch (deleteError) {
      console.error("Unable to delete job position", deleteError);
      ui.notify({ title: "Unable to delete position", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  const columns = [
    {
      key: "name",
      header: "Position Name",
      sticky: true,
      width: "260px",
      render: (row) => (
        <div className="text-sm font-bold text-text-primary">{row.name}</div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (row) => {
        if (!row.department) return <Badge tone="warning">Unassigned</Badge>;
        const department = departments.find((item) => item.name === row.department);
        return (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-text-secondary">{row.department}</span>
            {department?.status === "inactive" ? <Badge tone="warning">Disabled department</Badge> : null}
          </div>
        );
      },
    },
    { key: "active_users", header: "Active Employees", align: "right", render: (row) => <span className="text-sm font-bold text-text-primary">{row.active_users}</span> },
    { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status === "active" ? "Active" : "Inactive"}</Badge> },
    { key: "updated_at", header: "Last Updated", render: (row) => <span className="text-xs font-medium text-text-muted">{formatLastUpdated(row.updated_at)}</span> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      width: "300px",
      render: (row) => {
        const hasAssignedEmployees = Number(row.active_users || 0) > 0;
        return (
        <div className="flex justify-end gap-1.5" data-row-action="true" onClick={(event) => event.stopPropagation()}>
          {canEditPosition ? <button
            className="btn-secondary h-8 px-2.5 text-xs"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openPositionModal("edit", row);
            }}
          >
            <Edit3 size={13} /> Edit
          </button> : null}
          {canEditPosition ? <button
            className={`h-8 rounded-xl px-2.5 text-xs font-semibold transition ${
              row.status === "active"
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
            }`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closePositionModal();
              if (row.status === "active" && hasAssignedEmployees) {
                ui.notify({
                  title: "Position assigned to active employees",
                  message: "Existing employees will keep this position, but it will be hidden from new employee forms.",
                  tone: "warning",
                });
              }
              setPositionStatus(row, row.status === "active" ? "inactive" : "active");
            }}
          >
            <span className="inline-flex items-center gap-1.5"><Power size={13} /> {row.status === "active" ? "Disable" : "Enable"}</span>
          </button> : null}
          {canDeletePosition ? <button
            className="h-8 rounded-xl px-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            title={hasAssignedEmployees ? "This position is assigned to employees. Reassign employees before deleting." : "Delete position"}
            disabled={hasAssignedEmployees}
            onClick={(event) => {
              event.stopPropagation();
              closePositionModal();
              deletePosition(row);
            }}
          >
            <span className="inline-flex items-center gap-1.5"><Trash2 size={13} /> Delete</span>
          </button> : null}
        </div>
      );},
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="People"
        title="Job Positions"
        description="Manage HR job titles used in employee profiles. Position is separate from Role permissions."
        actions={
          canCreatePosition ? <button className="btn-primary" type="button" onClick={() => openPositionModal("create", createEmptyPosition())}>
            <Plus size={16} /> Add Position
          </button> : <Badge tone="neutral">Read-only access</Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Positions" value={stats.total} helper="Configured HR titles" />
        <StatCard label="Active Positions" value={stats.active} helper="Available for new users" tone="success" />
        <StatCard label="Assigned Users" value={stats.assigned} helper="Current active assignments" />
        <StatCard label="Inactive Positions" value={stats.inactive} helper="Hidden from new user forms" tone={stats.inactive ? "warning" : "neutral"} />
      </div>

      <FilterBar compact>
        <FieldLabel label="Search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
            <input className="control h-9 min-w-[260px] pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search position or department..." />
          </div>
        </FieldLabel>
        <FieldLabel label="Department">
          <FilterPopover
            value={departmentFilter === "all" ? "" : departmentFilter}
            placeholder="All Departments"
            className="min-w-44"
            options={[
              { value: "unassigned", label: "Unassigned" },
              ...departments.map((department) => ({ value: department.name, label: department.name })),
            ]}
            onApply={(nextValue) => setDepartmentFilter(nextValue || "all")}
          />
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
      {!canCreatePosition && !canEditPosition && !canDeletePosition ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Read-only access. You need Job Positions create, edit, or delete permission to change records.
        </div>
      ) : null}

      <Card
        title="Position Catalog"
        description="Job positions are used for employee profiles and HR grouping. They are separate from system roles."
      >
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading job positions...</div>
        ) : error ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{error}</div>
        ) : filteredPositions.length ? (
          <DataTable
            columns={columns}
            rows={filteredPositions}
            getRowKey={(row) => row.id}
            density="compact"
            tableClassName="min-w-[1040px]"
            getRowClassName={(row) => (row.status === "inactive" ? "opacity-70" : "")}
            onRowClick={(row) => openPositionModal("view", row)}
          />
        ) : (
          <div className="p-8 text-center">
            <div className="text-sm font-bold text-text-primary">No job positions found. Add your first job position.</div>
          </div>
        )}
      </Card>

      {positionModal.open ? (
        <JobPositionModal
          mode={positionModal.mode}
          initialPosition={positionModal.position}
          departments={departments}
          linkedEmployees={linkedEmployeesByPosition.get(positionModal.position?.name) ?? []}
          outlets={outlets}
          onQuickCreateDepartment={quickCreateDepartment}
          canEditPosition={positionModal.mode === "create" ? canCreatePosition : canEditPosition}
          onModeChange={updatePositionModalMode}
          onClose={closePositionModal}
          onSubmit={savePosition}
        />
      ) : null}
    </div>
  );
}
