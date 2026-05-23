import { Fragment, useEffect, useMemo, useState } from "react";
import { CalendarX, ChevronLeft, ChevronRight, ClipboardCopy, Clock, Download, HeartPulse, LockKeyhole, Plane, Plus, Send, UnlockKeyhole, Users } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { shiftTemplateService } from "../../../services/shiftTemplateService.js";
import { dutyRosterService } from "../../../services/dutyRosterService.js";
import { rosterPeriodService } from "../../../services/rosterPeriodService.js";
import { canCreate, canDelete, canEdit, canExport, canManage, notifyPermissionDenied } from "../../../utils/accessControl.js";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const nonWorkingCodes = new Set(["OFF", "AL", "MC"]);

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(date);
}

function formatColumnDate(date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(date).toUpperCase();
}

function formatWeekRange(dates) {
  return `${formatDay(dates[0])} - ${formatDay(dates[6])} ${dates[6].getFullYear()}`;
}

function minutesBetween(start, end, breakMinutes = 0) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal < startTotal) endTotal += 24 * 60;
  return Math.max(0, endTotal - startTotal - Number(breakMinutes || 0));
}

function hoursLabel(minutes) {
  return `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)}h`;
}

function classifyDepartment(department) {
  const value = String(department || "").toLowerCase();
  if (value.includes("kitchen")) return "Kitchen Team";
  if (value.includes("service") || value.includes("frontline") || value.includes("floor")) return "Floor Team";
  return department ? `${department} Team` : "Other Team";
}

function coverageBucket(department) {
  return classifyDepartment(department) === "Kitchen Team" ? "Kitchen" : "Floor";
}

function templateTone(template) {
  const color = template?.color || "green";
  const tones = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-rose-200 bg-rose-50 text-rose-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    purple: "border-violet-200 bg-violet-50 text-violet-800",
    gray: "border-slate-200 bg-slate-50 text-slate-600",
  };
  return tones[color] ?? tones.green;
}

function shiftTimeLabel(template) {
  if (!template?.start_time || !template?.end_time) return template?.code || "No time";
  return `${String(template.start_time).slice(0, 5)} - ${String(template.end_time).slice(0, 5)}`;
}

function rosterKey(employeeId, date) {
  return `${employeeId}|${date}`;
}

function CheckIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs font-black">
      ✓
    </span>
  );
}

function isWorkingRoster(roster) {
  const code = roster?.template?.code;
  return roster && !nonWorkingCodes.has(code);
}

function ShiftBlock({ roster, canDeleteShift, locked, onDelete }) {
  if (!roster?.template) {
    return (
      <div className="flex min-h-[44px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/60 text-xs font-bold text-text-muted transition group-hover:border-primary/50 group-hover:bg-primary/5 group-hover:text-primary">
        <Plus size={14} />
        <span className="ml-1">Add Shift</span>
      </div>
    );
  }
  const template = roster.template;
  const isNonWorking = nonWorkingCodes.has(template.code);
  return (
    <div className={`group rounded-xl border px-2.5 py-2 text-left shadow-sm ${templateTone(template)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold">{template.name}</div>
          <div className="mt-1 text-[11px] font-semibold opacity-80">
            {isNonWorking ? template.code : `${String(roster.start_time).slice(0, 5)} - ${String(roster.end_time).slice(0, 5)}`}
          </div>
        </div>
        {canDeleteShift && !locked ? (
          <button
            className="rounded-lg px-1.5 text-xs font-bold opacity-0 transition hover:bg-white/60 group-hover:opacity-100"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Delete shift"
          >
            x
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AddShiftModal({ employee, date, templates, selectedTemplateId, onSelectTemplate, onClose, onSave, saving }) {
  const [templateId, setTemplateId] = useState(selectedTemplateId || templates[0]?.id || "");
  const template = templates.find((item) => item.id === templateId);

  return (
    <Modal
      title="Add Shift"
      description={`${employee.nickname || employee.full_name} · ${formatDay(new Date(`${date}T00:00:00`))}`}
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!template || saving} onClick={() => onSave(template)}>
            {saving ? "Saving..." : "Save Shift"}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Shift Template</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {templates.map((item) => (
              <button
                key={item.id}
                className={`rounded-2xl border p-3 text-left transition ${
                  templateId === item.id ? "border-primary bg-primary/10 ring-2 ring-primary/15" : `${templateTone(item)} hover:shadow-sm`
                }`}
                type="button"
                onClick={() => {
                  setTemplateId(item.id);
                  onSelectTemplate?.(item.id);
                }}
              >
                <div className="text-sm font-bold">{item.name}</div>
                <div className="mt-1 text-xs font-semibold opacity-75">{shiftTimeLabel(item)}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function DutyRosterPage({ store, ui, auth }) {
  const activeOutlets = store.outlets.filter((outlet) => outlet.status === "active" || outlet.is_active);
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [viewMode, setViewMode] = useState("week");
  const [employees, setEmployees] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [period, setPeriod] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [shiftModal, setShiftModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canAddShift = canCreate(auth, "duty_roster");
  const canEditShift = canEdit(auth, "duty_roster");
  const canDeleteShift = canDelete(auth, "duty_roster");
  const canExportRoster = canExport(auth, "duty_roster");
  const canManageRoster = canManage(auth, "duty_roster");
  const canWriteShift = canAddShift || canEditShift;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

  const weekDates = useMemo(() => {
    const start = startOfWeek(`${weekStart}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [weekStart]);
  const weekDateValues = weekDates.map(toDateInputValue);
  const weekEnd = weekDateValues[6];
  const locked = period?.status === "locked";
  const readOnly = locked || !canWriteShift;

  useEffect(() => {
    if (!outletId && activeOutlets[0]?.id) setOutletId(activeOutlets[0].id);
  }, [activeOutlets, outletId]);

  useEffect(() => {
    let ignore = false;
    async function loadRosterData() {
      if (!outletId) return;
      setLoading(true);
      setError("");
      try {
        const [employeeRows, templateRows, rosterRows, nextPeriod] = await Promise.all([
          employeeService.listEmployees(),
          shiftTemplateService.listShiftTemplates(),
          dutyRosterService.listDutyRosters(outletId, weekDateValues[0], weekEnd),
          rosterPeriodService.getOrCreateRosterPeriod(outletId, weekDateValues[0], weekEnd),
        ]);
        if (ignore) return;
        setEmployees(employeeRows.filter((employee) => (
          employee.is_active !== false &&
          employee.employment_status !== "resigned" &&
          (!employee.workplace || employee.workplace === outletId || employee.workplace === activeOutlets.find((outlet) => outlet.id === outletId)?.name)
        )));
        setTemplates(templateRows);
        setRosters(rosterRows);
        setPeriod(nextPeriod);
        setSelectedTemplateId((current) => (templateRows.some((template) => template.id === current) ? current : ""));
      } catch (loadError) {
        console.error("Unable to load duty roster", loadError);
        const setupMissing = loadError?.cause?.code === "42P01" || /shift_templates|duty_rosters|roster_periods/i.test(loadError?.message || "");
        if (!ignore) setError(setupMissing ? "Duty Roster is not ready yet. Please ask admin to apply the latest setup for roster tables and shift templates." : loadError.message || "Unable to load duty roster.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadRosterData();
    return () => {
      ignore = true;
    };
  }, [outletId, weekStart]);

  const rosterByEmployeeDate = useMemo(() => new Map(rosters.map((roster) => [rosterKey(roster.employee_id, roster.roster_date), roster])), [rosters]);
  const departments = useMemo(() => [...new Set(employees.map((employee) => classifyDepartment(employee.department)))].sort(), [employees]);
  const groupedEmployees = useMemo(() => {
    const groups = new Map();
    employees
      .filter((employee) => departmentFilter === "all" || classifyDepartment(employee.department) === departmentFilter)
      .forEach((employee) => {
        const group = classifyDepartment(employee.department);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(employee);
      });
    return [...groups.entries()].map(([group, items]) => ({ group, employees: items }));
  }, [departmentFilter, employees]);

  const coverageByDate = useMemo(() => {
    const result = new Map();
    weekDateValues.forEach((date) => result.set(date, { Kitchen: 0, Floor: 0 }));
    rosters.forEach((roster) => {
      if (!isWorkingRoster(roster)) return;
      const employee = employees.find((item) => item.id === roster.employee_id);
      const bucket = coverageBucket(employee?.department);
      const current = result.get(roster.roster_date) ?? { Kitchen: 0, Floor: 0 };
      current[bucket] += 1;
      result.set(roster.roster_date, current);
    });
    return result;
  }, [employees, rosters, weekDateValues.join("|")]);

  const summary = useMemo(() => {
    const workingRosters = rosters.filter(isWorkingRoster);
    return {
      staff: new Set(workingRosters.map((roster) => roster.employee_id)).size,
      hours: workingRosters.reduce((sum, roster) => sum + minutesBetween(roster.start_time, roster.end_time, roster.break_minutes), 0),
      off: rosters.filter((roster) => roster.template?.code === "OFF").length,
      al: rosters.filter((roster) => roster.template?.code === "AL").length,
      mc: rosters.filter((roster) => roster.template?.code === "MC").length,
    };
  }, [rosters]);

  async function assignShift(employee, date, templateOverride = selectedTemplate) {
    if (locked) {
      ui.notify({ title: "Roster is locked", message: "Unlock this roster before editing.", tone: "warning" });
      return;
    }
    const existing = rosterByEmployeeDate.get(rosterKey(employee.id, date));
    if (existing && !canEditShift) {
      notifyPermissionDenied(ui, "edit duty roster");
      return;
    }
    if (!existing && !canAddShift) {
      notifyPermissionDenied(ui, "add duty roster shifts");
      return;
    }
    if (!templateOverride) {
      const existing = rosterByEmployeeDate.get(rosterKey(employee.id, date));
      if (!existing) setShiftModal({ employee, date });
      return;
    }
    setSaving(true);
    try {
      const saved = await dutyRosterService.saveDutyRoster({
        outletId,
        employeeId: employee.id,
        rosterDate: date,
        template: templateOverride,
        status: period?.status === "published" ? "published" : "draft",
      });
      setRosters((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      setShiftModal(null);
      ui.notify({ title: "Shift saved", message: `${employee.nickname || employee.full_name} · ${templateOverride.name}` });
    } catch (saveError) {
      console.error("Unable to save duty roster shift", saveError);
      ui.notify({ title: "Unable to save shift", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteShift(roster) {
    if (!canDeleteShift) {
      notifyPermissionDenied(ui, "delete duty roster shifts");
      return;
    }
    if (locked) return;
    try {
      await dutyRosterService.deleteDutyRoster(roster.id, { outletId, rosterDate: roster.roster_date, employee_id: roster.employee_id });
      setRosters((current) => current.filter((item) => item.id !== roster.id));
      ui.notify({ title: "Shift removed" });
    } catch (deleteError) {
      console.error("Unable to delete duty roster shift", deleteError);
      ui.notify({ title: "Unable to remove shift", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  async function copyWeek() {
    if (!canAddShift && !canEditShift) {
      notifyPermissionDenied(ui, "copy duty roster weeks");
      return;
    }
    const source = window.prompt("Source week start date (YYYY-MM-DD)");
    if (!source) return;
    const sourceStart = toDateInputValue(startOfWeek(`${source}T00:00:00`));
    const sourceEnd = toDateInputValue(addDays(`${sourceStart}T00:00:00`, 6));
    const overwrite = await ui.confirm({
      title: "Copy week roster",
      message: "Overwrite existing shifts in the selected week?",
      confirmLabel: "Copy Week",
    });
    try {
      const result = await dutyRosterService.copyWeek({
        outletId,
        sourceStartDate: sourceStart,
        sourceEndDate: sourceEnd,
        targetDates: weekDateValues,
        overwrite,
        targetStatus: period?.status === "published" ? "published" : "draft",
      });
      const nextRows = await dutyRosterService.listDutyRosters(outletId, weekDateValues[0], weekEnd);
      setRosters(nextRows);
      ui.notify({ title: "Week copied", message: `${result.created} shifts copied.` });
    } catch (copyError) {
      console.error("Unable to copy week roster", copyError);
      ui.notify({ title: "Unable to copy week", message: copyError.message || "Please try again.", tone: "error" });
    }
  }

  async function setStatus(status) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster status");
      return;
    }
    try {
      const nextPeriod = await rosterPeriodService.setRosterPeriodStatus(period, status);
      const nextRosters = await dutyRosterService.setWeekRosterStatus({
        outletId,
        startDate: weekDateValues[0],
        endDate: weekEnd,
        status,
      });
      setPeriod(nextPeriod);
      setRosters(nextRosters);
      ui.notify({ title: status === "published" ? "Roster published" : status === "locked" ? "Roster locked" : "Roster unlocked" });
    } catch (statusError) {
      console.error("Unable to update roster status", statusError);
      ui.notify({ title: "Unable to update roster", message: statusError.message || "Please try again.", tone: "error" });
    }
  }

  const statusTone = period?.status === "locked" ? "danger" : period?.status === "published" ? "success" : "warning";

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Duty Roster"
        description="Manage weekly outlet scheduling."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary" type="button" disabled={!canExportRoster} onClick={() => ui.notify({ title: "Export prepared", message: "Duty roster export will be connected to the export service." })}>
              <Download size={16} /> Export
            </button>
            {canManageRoster ? (
              <button className="btn-primary" type="button" disabled={!period || period.status === "published" || period.status === "locked"} onClick={() => setStatus("published")}>
                <Send size={16} /> Publish Roster
              </button>
            ) : null}
          </div>
        )}
      />

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1.3fr_1.2fr_1fr_auto_auto] lg:items-end">
          <FieldLabel label="Outlet">
            <SelectField
              value={outletId}
              options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
              onChange={setOutletId}
            />
          </FieldLabel>
          <FieldLabel label="Week">
            <div className="flex items-center gap-2">
              <button className="icon-btn" type="button" onClick={() => setWeekStart(toDateInputValue(addDays(`${weekStart}T00:00:00`, -7)))}><ChevronLeft size={16} /></button>
              <input className="control h-10" type="date" value={weekStart} onChange={(event) => setWeekStart(toDateInputValue(startOfWeek(`${event.target.value}T00:00:00`)))} />
              <button className="icon-btn" type="button" onClick={() => setWeekStart(toDateInputValue(addDays(`${weekStart}T00:00:00`, 7)))}><ChevronRight size={16} /></button>
            </div>
          </FieldLabel>
          <FieldLabel label="Department">
            <SelectField
              value={departmentFilter}
              options={[{ value: "all", label: "All Departments" }, ...departments.map((department) => ({ value: department, label: department }))]}
              onChange={setDepartmentFilter}
            />
          </FieldLabel>
          <div className="flex rounded-2xl border border-border bg-background p-1">
            {["week", "month"].map((mode) => (
              <button key={mode} className={`rounded-xl px-3 py-2 text-xs font-bold capitalize ${viewMode === mode ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary"}`} type="button" onClick={() => setViewMode(mode)}>
                {mode}
              </button>
            ))}
          </div>
          <button className="btn-secondary h-10" type="button" disabled={!canWriteShift || locked} onClick={copyWeek}>
            <ClipboardCopy size={16} /> Copy Week
          </button>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
      {!canWriteShift ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Read-only access. You need Duty Roster create or edit permission to change shifts.</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title={viewMode === "month" ? "Monthly Roster View" : `Weekly Roster · ${formatWeekRange(weekDates)}`}
          description="Employees are grouped by department so outlet managers can review kitchen and floor coverage quickly."
        >
          {loading ? (
            <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading duty roster...</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="table-sticky-cell sticky left-0 z-20 w-[220px] px-3 py-3 text-left">Employee</th>
                      {weekDates.map((date, index) => {
                        const dateValue = weekDateValues[index];
                        const coverage = coverageByDate.get(dateValue) ?? { Kitchen: 0, Floor: 0 };
                        return (
                          <th key={dateValue} className="min-w-[128px] px-3 py-3 text-left">
                            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{dayLabels[index]}</div>
                            <div className="mt-0.5 text-sm font-bold text-text-primary">{formatColumnDate(date)}</div>
                            <div className="mt-2 space-y-0.5 text-[11px] leading-4 text-text-secondary">
                              <div><span className="font-bold text-text-primary">Kitchen:</span> {coverage.Kitchen}</div>
                              <div><span className="font-bold text-text-primary">Floor:</span> {coverage.Floor}</div>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedEmployees.map((group) => (
                      <Fragment key={group.group}>
                        <tr className="sticky top-[49px] z-10 bg-primary/10">
                          <td colSpan={8} className="border-y border-primary/15 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-primary">{group.group}</td>
                        </tr>
                        {group.employees.map((employee) => (
                          <tr key={employee.id} className="table-row">
                            <td className="table-sticky-cell sticky left-0 z-10 bg-surface px-3 py-2.5">
                              <div className="font-bold text-text-primary">{employee.nickname || employee.full_name}</div>
                              <div className="mt-1 text-xs text-text-secondary">{employee.position || "Employee"}</div>
                            </td>
                            {weekDateValues.map((dateValue) => {
                              const roster = rosterByEmployeeDate.get(rosterKey(employee.id, dateValue));
                              return (
                                <td key={dateValue} className="group border-l border-border px-1.5 py-1.5 align-top">
                                  <div
                                    className={`min-h-[58px] w-full rounded-2xl border border-dashed border-border bg-background/50 p-1.5 text-left transition ${!readOnly ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm" : ""} ${selectedTemplate ? "ring-1 ring-primary/10" : ""}`}
                                    role="button"
                                    tabIndex={readOnly ? -1 : 0}
                                    aria-disabled={readOnly}
                                    onClick={() => assignShift(employee, dateValue)}
                                    onKeyDown={(event) => {
                                      if (!readOnly && (event.key === "Enter" || event.key === " ")) assignShift(employee, dateValue);
                                    }}
                                  >
                                    <ShiftBlock roster={roster} locked={locked} canDeleteShift={canDeleteShift} onDelete={() => deleteShift(roster)} />
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-4 p-4 lg:hidden">
                {weekDateValues.map((dateValue, index) => (
                  <section key={dateValue} className="rounded-2xl border border-border bg-background p-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{dayLabels[index]}</div>
                      <div className="text-base font-bold text-text-primary">{formatColumnDate(weekDates[index])}</div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {groupedEmployees.map((group) => (
                        <div key={`${dateValue}-${group.group}`}>
                          <div className="mb-2 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-primary">{group.group}</div>
                          <div className="space-y-2">
                            {group.employees.map((employee) => {
                              const roster = rosterByEmployeeDate.get(rosterKey(employee.id, dateValue));
                              return (
                                <div
                                  key={`${dateValue}-${employee.id}`}
                                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 text-left"
                                  role="button"
                                  tabIndex={readOnly ? -1 : 0}
                                  aria-disabled={readOnly}
                                  onClick={() => assignShift(employee, dateValue)}
                                  onKeyDown={(event) => {
                                    if (!readOnly && (event.key === "Enter" || event.key === " ")) assignShift(employee, dateValue);
                                  }}
                                >
                                  <div>
                                    <div className="text-sm font-bold text-text-primary">{employee.nickname || employee.full_name}</div>
                                    <div className="text-xs text-text-secondary">{employee.position || "Employee"}</div>
                                  </div>
                                  <ShiftBlock roster={roster} locked={locked} canDeleteShift={canDeleteShift} onDelete={() => deleteShift(roster)} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Roster Status</div>
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone={statusTone}>{period?.status === "locked" ? "Locked" : period?.status === "published" ? "Published" : "Draft"}</Badge>
                  <Badge tone={readOnly ? "neutral" : "success"}>{readOnly ? "Read-only" : "Editable"}</Badge>
                </div>
              </div>
              {canManageRoster ? (
                <div className="flex gap-2">
                  {period?.status === "locked" ? (
                    <button className="icon-btn" type="button" onClick={() => setStatus("draft")} title="Unlock roster"><UnlockKeyhole size={16} /></button>
                  ) : (
                    <button className="icon-btn" type="button" onClick={() => setStatus("locked")} title="Lock roster"><LockKeyhole size={16} /></button>
                  )}
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Quick Shift Templates" description="Select a template, then click a roster cell.">
            <div className="space-y-2 p-4">
              {selectedTemplate ? (
                <div className="rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
                  Assignment mode: {selectedTemplate.name}. Click cells to assign instantly.
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-background px-3 py-2 text-xs font-semibold text-text-secondary">
                  No template selected. Click an empty cell to open the Add Shift form.
                </div>
              )}
              {!templates.length ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-800">
                  Shift templates are not ready yet. Apply the latest roster setup to load Morning, Mid, Closing, Full, OFF, AL, and MC.
                </div>
              ) : null}
              {templates.map((template) => (
                <button
                  key={template.id}
                  className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left transition ${selectedTemplateId === template.id ? "border-primary bg-primary text-white shadow-sm" : `${templateTone(template)} hover:-translate-y-0.5 hover:shadow-sm`}`}
                  type="button"
                  onClick={() => setSelectedTemplateId((current) => (current === template.id ? "" : template.id))}
                >
                  <span>
                    <span className="block text-sm font-bold">{template.name}</span>
                    <span className="mt-0.5 block text-xs font-semibold opacity-75">{shiftTimeLabel(template)}</span>
                  </span>
                  {selectedTemplateId === template.id ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Department Coverage" description="Weekly manpower by team.">
            <div className="space-y-3 p-4">
              {["Kitchen", "Floor"].map((bucket) => {
                const total = weekDateValues.reduce((sum, date) => sum + (coverageByDate.get(date)?.[bucket] ?? 0), 0);
                return (
                  <div key={bucket} className="rounded-2xl border border-border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-primary">{bucket}</span>
                      <span className="text-xs font-bold text-text-muted">{total} weekly slots</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {weekDateValues.map((date, index) => (
                        <div key={date} className="flex items-center justify-between rounded-xl bg-surface px-2 py-1.5 text-xs">
                          <span className="font-bold text-text-secondary">{dayLabels[index]}</span>
                          <span className="font-black text-primary">{coverageByDate.get(date)?.[bucket] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total Staff Scheduled", summary.staff, Users],
          ["Total Working Hours", hoursLabel(summary.hours), Clock],
          ["Off Days", summary.off, CalendarX],
          ["Annual Leave", summary.al, Plane],
          ["MC", summary.mc, HeartPulse],
        ].map(([label, value, Icon]) => (
          <Card key={label} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
                <div className="mt-2 text-2xl font-semibold text-text-primary">{value}</div>
              </div>
              <div className="rounded-2xl bg-primary/10 p-2 text-primary"><Icon size={17} /></div>
            </div>
          </Card>
        ))}
      </div>

      {shiftModal ? (
        <AddShiftModal
          employee={shiftModal.employee}
          date={shiftModal.date}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={setSelectedTemplateId}
          saving={saving}
          onClose={() => setShiftModal(null)}
          onSave={(template) => assignShift(shiftModal.employee, shiftModal.date, template)}
        />
      ) : null}

      {saving ? <div className="fixed bottom-5 right-5 rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold text-text-primary shadow-xl">Saving roster...</div> : null}
    </div>
  );
}
