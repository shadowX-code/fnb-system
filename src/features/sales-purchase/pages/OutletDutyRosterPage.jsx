import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, Download, HeartPulse, Search, Users, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { dutyRosterService } from "../../../services/dutyRosterService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";
import { rosterPeriodService } from "../../../services/rosterPeriodService.js";
import { rosterPositionGroupService } from "../../../services/rosterPositionGroupService.js";
import { canExport } from "../../../utils/accessControl.js";
import { formatShiftTimeRange } from "../utils/shiftTime.js";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nonWorkingCodes = new Set(["OFF", "AL", "MC"]);
const groupLabels = { floor: "FLOOR", kitchen: "KITCHEN", other: "OTHER" };

function toDateInputValue(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function addMonths(value, months) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date;
}

function startOfMonth(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date;
}

function endOfMonth(value = new Date()) {
  const date = startOfMonth(value);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return date;
}

function datesBetween(start, end) {
  const dates = [];
  let current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current = addDays(current, 1);
  }
  return dates;
}

function monthCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function formatMonthYear(date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(date);
}

function fallbackGroupFromDepartment(department) {
  const value = String(department || "").toLowerCase();
  if (value.includes("kitchen")) return "kitchen";
  if (value.includes("service") || value.includes("frontline") || value.includes("floor")) return "floor";
  return "other";
}

function isWorkingRoster(roster) {
  return roster && !nonWorkingCodes.has(roster.template?.code);
}

function rosterHasPublishedSnapshot(roster) {
  return ["published", "locked"].includes(roster?.status) || roster?.employee_snapshot?.is_roster_snapshot;
}

function snapshotEmployeeFromRoster(roster) {
  if (!rosterHasPublishedSnapshot(roster) || !roster?.employee_snapshot?.full_name) return null;
  return {
    ...roster.employee_snapshot,
    id: roster.employee_id,
    is_roster_snapshot: true,
  };
}

function statusBadgeClass(status) {
  if (status === "locked") return "border-slate-200 bg-slate-100 text-slate-700";
  if (status === "published") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatStatusLabel(status) {
  if (status === "locked") return "Locked";
  if (status === "published") return "Published";
  return "Draft";
}

function rosterDayStatus(stats) {
  const rows = stats?.rosters ?? [];
  if (!rows.length) return "";
  if (rows.every((row) => row.status === "locked")) return "locked";
  if (rows.every((row) => row.status === "published")) return "published";
  return "draft";
}

function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const current = startOfMonth(`${value}T00:00:00`);
  const today = startOfMonth(new Date());

  useEffect(() => {
    if (!open) return undefined;
    function updateRect() {
      const next = buttonRef.current?.getBoundingClientRect();
      if (!next) return;
      const width = Math.max(next.width, 320);
      const gap = 8;
      const estimatedHeight = 245;
      const spaceBelow = window.innerHeight - next.bottom;
      const top = spaceBelow >= estimatedHeight + gap
        ? next.bottom + gap
        : Math.max(12, next.top - estimatedHeight - gap);
      const left = Math.min(Math.max(12, next.left), window.innerWidth - width - 12);
      setRect({ top, left, width });
    }
    function onPointerDown(event) {
      if (!buttonRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    updateRect();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open]);

  function chooseMonth(monthIndex) {
    const next = new Date(current.getFullYear(), monthIndex, 1);
    onChange(toDateInputValue(next));
    setOpen(false);
  }

  function changeYear(offset) {
    const next = new Date(current.getFullYear() + offset, current.getMonth(), 1);
    onChange(toDateInputValue(next));
  }

  return (
    <div>
      <button
        ref={buttonRef}
        className="control flex h-10 w-full items-center justify-between px-3 text-left font-semibold"
        type="button"
        onClick={() => setOpen((state) => !state)}
      >
        <span>{formatMonthYear(current)}</span>
        <span className="text-text-muted">▾</span>
      </button>
      {open && rect ? createPortal((
        <div
          ref={panelRef}
          className="fixed z-[9999] rounded-3xl border border-border bg-surface p-4 shadow-2xl"
          style={{ top: rect.top, left: rect.left, width: rect.width }}
        >
          <div className="flex items-center justify-between">
            <button className="icon-btn" type="button" onClick={() => changeYear(-1)} aria-label="Previous year"><ChevronLeft size={16} /></button>
            <div className="text-sm font-black text-text-primary">{current.getFullYear()}</div>
            <button className="icon-btn" type="button" onClick={() => changeYear(1)} aria-label="Next year"><ChevronRight size={16} /></button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {monthLabels.map((label, index) => {
              const selected = index === current.getMonth();
              const currentMonth = index === today.getMonth() && current.getFullYear() === today.getFullYear();
              return (
                <button
                  key={label}
                  className={`rounded-2xl border px-3 py-2 text-sm font-bold transition ${
                    selected
                      ? "border-primary bg-primary text-white shadow-sm"
                      : currentMonth
                        ? "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                        : "border-transparent text-text-secondary hover:bg-primary/10 hover:text-primary"
                  }`}
                  type="button"
                  onClick={() => chooseMonth(index)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}

function DailyDutyDrawer({ date, stats, employeesById, onClose, onOpenSchedule }) {
  const dateObject = new Date(`${date}T00:00:00`);
  const grouped = { floor: [], kitchen: [], other: [] };
  const offRows = [];
  const leaveRows = [];

  (stats?.rosters ?? []).forEach((roster) => {
    const employee = employeesById.get(roster.employee_id);
    if (!employee) return;
    const row = { roster, employee };
    if (roster.template?.code === "OFF") offRows.push(row);
    else if (roster.template?.code === "AL" || roster.template?.code === "MC") leaveRows.push(row);
    else grouped[employee.rosterGroup || "other"].push(row);
  });

  const hasRoster = Boolean(stats?.rosters?.length);
  const hasWorkingStaff = ["floor", "kitchen", "other"].some((group) => grouped[group].length > 0);

  function StaffLine({ row }) {
    const shift = row.roster.template?.code && nonWorkingCodes.has(row.roster.template.code)
      ? row.roster.template.code
      : formatShiftTimeRange(row.roster.start_time, row.roster.end_time);
    const shiftType = row.roster.template?.name || row.roster.template?.code || "Shift";
    return (
      <div className="rounded-2xl border border-border bg-background p-3">
        <div className="text-sm font-bold text-text-primary">{row.employee.nickname || row.employee.full_name}</div>
        <div className="mt-1 text-xs font-semibold text-text-secondary">{row.employee.position || "Employee"}</div>
        {row.employee.is_roster_snapshot ? (
          <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">Published snapshot</div>
        ) : null}
        <div className="mt-2 text-xs font-bold text-text-primary">{shift} · {shiftType}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close daily duty drawer backdrop" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[460px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Outlet Duty Roster</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">
                {new Intl.DateTimeFormat("en-MY", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(dateObject)}
              </h2>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close daily duty drawer"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-sm font-bold text-text-primary">Daily Summary</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ["Total Staff", stats.working],
                ["Floor", stats.floor],
                ["Kitchen", stats.kitchen],
                ["OFF", stats.off],
                ["AL", stats.al],
                ["MC", stats.mc],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-border bg-surface p-3">
                  <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">{label}</div>
                  <div className="mt-1 text-xl font-semibold text-text-primary">{value}</div>
                </div>
              ))}
            </div>
          </section>

          {!hasRoster ? (
            <div className="rounded-3xl border border-dashed border-border bg-background p-6 text-center text-sm font-semibold text-text-secondary">
              No staff scheduled for this date.
            </div>
          ) : hasWorkingStaff ? (
            ["floor", "kitchen", "other"].map((group) => grouped[group].length ? (
              <section key={group}>
                <div className="mb-2 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-primary">{groupLabels[group]}</div>
                <div className="space-y-2">
                  {grouped[group].map((row) => <StaffLine key={row.roster.id} row={row} />)}
                </div>
              </section>
            ) : null)
          ) : null}

          {leaveRows.length || offRows.length ? (
            <section>
              <div className="mb-2 rounded-xl bg-violet-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-violet-700">OFF / AL / MC</div>
              <div className="space-y-2">
                {[...offRows, ...leaveRows].map((row) => <StaffLine key={row.roster.id} row={row} />)}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-border bg-background p-4">
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
            <button className="btn-primary" type="button" onClick={() => onOpenSchedule(dateObject)}>Open Schedule View</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export default function OutletDutyRosterPage({ store, ui, auth }) {
  const activeOutlets = store.outlets.filter((outlet) => outlet.status === "active" || outlet.is_active);
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [monthStart, setMonthStart] = useState(() => toDateInputValue(startOfMonth(new Date())));
  const [employees, setEmployees] = useState([]);
  const [jobPositions, setJobPositions] = useState([]);
  const [positionMappings, setPositionMappings] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [dailyDrawerDate, setDailyDrawerDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canExportOverview = canExport(auth, "outlet_duty_roster");

  const monthDates = useMemo(() => datesBetween(startOfMonth(`${monthStart}T00:00:00`), endOfMonth(`${monthStart}T00:00:00`)), [monthStart]);
  const monthDateValues = monthDates.map(toDateInputValue);
  const calendarDays = useMemo(() => monthCalendarDays(monthDates[0] ?? new Date()), [monthStart]);

  useEffect(() => {
    if (!outletId && activeOutlets[0]?.id) setOutletId(activeOutlets[0].id);
  }, [activeOutlets, outletId]);

  useEffect(() => {
    let ignore = false;
    async function loadOverview() {
      if (!outletId) return;
      setLoading(true);
      setError("");
      try {
        const [employeeRows, positionRows, mappingRows, rosterRows, periodRows] = await Promise.all([
          employeeService.listEmployees(),
          jobPositionService.listJobPositions(),
          rosterPositionGroupService.listMappings(),
          dutyRosterService.listDutyRosters(outletId, monthDateValues[0], monthDateValues[monthDateValues.length - 1]),
          rosterPeriodService.listRosterPeriods(outletId, monthDateValues[0], monthDateValues[monthDateValues.length - 1]),
        ]);
        if (ignore) return;
        const outlet = activeOutlets.find((item) => item.id === outletId);
        setEmployees(employeeRows.filter((employee) => (
          employee.is_active !== false &&
          employee.employment_status === "active" &&
          (!employee.workplace || employee.workplace === outletId || employee.workplace === outlet?.name)
        )));
        setJobPositions(positionRows);
        setPositionMappings(mappingRows);
        setRosters(rosterRows);
        setPeriods(periodRows);
      } catch (loadError) {
        console.error("Unable to load outlet duty roster", loadError);
        if (!ignore) setError(loadError.message || "Unable to load outlet duty roster.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadOverview();
    return () => {
      ignore = true;
    };
  }, [outletId, monthStart]);

  const positionByName = useMemo(() => {
    const map = new Map();
    jobPositions.forEach((position) => map.set(String(position.name).toLowerCase(), position));
    return map;
  }, [jobPositions]);
  const mappingByPositionId = useMemo(() => new Map(positionMappings.map((mapping) => [mapping.position_id, mapping.group_name])), [positionMappings]);
  const displayEmployees = useMemo(() => {
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    rosters.forEach((roster) => {
      if (byId.has(roster.employee_id)) return;
      const snapshotEmployee = snapshotEmployeeFromRoster(roster);
      if (snapshotEmployee) byId.set(snapshotEmployee.id, snapshotEmployee);
    });
    return [...byId.values()];
  }, [employees, rosters]);
  const employeesWithGroups = useMemo(() => displayEmployees.map((employee) => {
    const position = positionByName.get(String(employee.position || "").toLowerCase());
    const mappedGroup = position ? mappingByPositionId.get(position.id) : null;
    return {
      ...employee,
      position_id: position?.id ?? "",
      rosterGroup: position ? mappedGroup || "other" : fallbackGroupFromDepartment(employee.department),
    };
  }), [displayEmployees, mappingByPositionId, positionByName]);
  const employeePositions = useMemo(() => [...new Set(employeesWithGroups.map((employee) => employee.position).filter(Boolean))].sort(), [employeesWithGroups]);
  const filteredEmployees = useMemo(() => employeesWithGroups
    .filter((employee) => groupFilter === "all" || employee.rosterGroup === groupFilter)
    .filter((employee) => positionFilter === "all" || employee.position === positionFilter)
    .filter((employee) => {
      const query = employeeSearch.trim().toLowerCase();
      if (!query) return true;
      return [employee.full_name, employee.nickname, employee.employee_code].some((value) => String(value || "").toLowerCase().includes(query));
    }), [employeeSearch, employeesWithGroups, groupFilter, positionFilter]);
  const filteredEmployeeIds = useMemo(() => new Set(filteredEmployees.map((employee) => employee.id)), [filteredEmployees]);
  const employeesById = useMemo(() => new Map(employeesWithGroups.map((employee) => [employee.id, employee])), [employeesWithGroups]);

  const periodByDate = useMemo(() => {
    const map = new Map();
    monthDateValues.forEach((date) => {
      const period = periods.find((item) => item.week_start_date <= date && item.week_end_date >= date);
      if (period) map.set(date, period);
    });
    return map;
  }, [monthDateValues.join("|"), periods]);

  const statsByDate = useMemo(() => {
    const result = new Map();
    monthDateValues.forEach((date) => {
      result.set(date, { working: 0, floor: 0, kitchen: 0, other: 0, off: 0, al: 0, mc: 0, rosters: [] });
    });
    rosters.forEach((roster) => {
      if (!filteredEmployeeIds.has(roster.employee_id)) return;
      const stats = result.get(roster.roster_date);
      if (!stats) return;
      const employee = employeesById.get(roster.employee_id);
      stats.rosters.push(roster);
      const code = roster.template?.code;
      if (code === "OFF") stats.off += 1;
      else if (code === "AL") stats.al += 1;
      else if (code === "MC") stats.mc += 1;
      else if (isWorkingRoster(roster)) {
        stats.working += 1;
        const group = employee?.rosterGroup || "other";
        if (group === "kitchen") stats.kitchen += 1;
        else if (group === "floor") stats.floor += 1;
        else stats.other += 1;
      }
    });
    return result;
  }, [employeesById, filteredEmployeeIds, monthDateValues.join("|"), rosters]);

  const selectedDailyStats = dailyDrawerDate
    ? statsByDate.get(dailyDrawerDate) ?? { working: 0, floor: 0, kitchen: 0, other: 0, off: 0, al: 0, mc: 0, rosters: [] }
    : null;

  const monthSummary = useMemo(() => {
    const inMonthDates = monthDateValues;
    return inMonthDates.reduce((summary, date) => {
      const stats = statsByDate.get(date);
      if (!stats?.rosters?.length) summary.unscheduledDays += 1;
      summary.totalScheduledShifts += stats?.rosters?.length ?? 0;
      summary.workingStaff += stats?.working ?? 0;
      summary.leaveDays += (stats?.al ?? 0) + (stats?.mc ?? 0);
      return summary;
    }, { totalScheduledShifts: 0, workingStaff: 0, leaveDays: 0, unscheduledDays: 0 });
  }, [monthDateValues, statsByDate]);

  function navigateMonth(direction) {
    setMonthStart(toDateInputValue(startOfMonth(addMonths(`${monthStart}T00:00:00`, direction))));
    setDailyDrawerDate("");
  }

  function openScheduleForDate(date) {
    localStorage.setItem("feedx:dutyRosterFocus", JSON.stringify({ outletId, date: toDateInputValue(date) }));
    window.location.hash = "duty-roster";
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Overview"
        title="Outlet Duty Roster"
        description="Monthly outlet duty coverage overview."
        actions={(
          <button className="btn-secondary" type="button" disabled={!canExportOverview} onClick={() => ui.notify({ title: "Export prepared", message: "Outlet duty roster export will be connected to the export service." })}>
            <Download size={16} /> Export
          </button>
        )}
      />

      <Card className="relative overflow-visible p-4">
        <div className="grid gap-3 xl:grid-cols-[1.1fr_1.1fr_0.9fr_0.9fr_1.2fr] xl:items-end">
          <FieldLabel label="Outlet">
            <SelectField value={outletId} options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={setOutletId} />
          </FieldLabel>
          <FieldLabel label="Month">
            <div className="flex gap-2">
              <button className="icon-btn h-10 w-10" type="button" onClick={() => navigateMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
              <div className="min-w-0 flex-1"><MonthPicker value={monthStart} onChange={(value) => { setMonthStart(value); setDailyDrawerDate(""); }} /></div>
              <button className="icon-btn h-10 w-10" type="button" onClick={() => navigateMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button>
            </div>
          </FieldLabel>
          <FieldLabel label="Group">
            <SelectField
              value={groupFilter}
              options={[
                { value: "all", label: "All Groups" },
                { value: "floor", label: "Floor" },
                { value: "kitchen", label: "Kitchen" },
                { value: "other", label: "Other" },
              ]}
              onChange={setGroupFilter}
            />
          </FieldLabel>
          <FieldLabel label="Position">
            <SelectField value={positionFilter} options={[{ value: "all", label: "All Positions" }, ...employeePositions.map((position) => ({ value: position, label: position }))]} onChange={setPositionFilter} />
          </FieldLabel>
          <FieldLabel label="Employee Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={15} />
              <input className="control h-10 w-full pl-9" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Search name..." />
            </div>
          </FieldLabel>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Scheduled Shifts", value: monthSummary.totalScheduledShifts, helper: "All saved roster entries", icon: CalendarDays },
          { label: "Working Staff", value: monthSummary.workingStaff, helper: "Working shift assignments", icon: Users },
          { label: "AL / MC Days", value: monthSummary.leaveDays, helper: "Leave and medical entries", icon: HeartPulse },
          { label: "Unscheduled Days", value: monthSummary.unscheduledDays, helper: "No roster entries saved", icon: CalendarX },
        ].map((item) => (
          <MetricCard key={item.label} label={item.label} value={item.value} helper={item.helper} icon={item.icon} />
        ))}
      </div>

      <Card title={`Outlet Duty Roster · ${formatMonthYear(monthDates[0])}`} description="Click a date to review the daily roster.">
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading outlet duty roster...</div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-2 border-b border-border pb-3">
              {dayLabels.map((day) => <div key={day} className="text-center text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{day}</div>)}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-7">
              {calendarDays.map((date) => {
                const dateValue = toDateInputValue(date);
                const stats = statsByDate.get(dateValue) ?? { working: 0, floor: 0, kitchen: 0, other: 0, off: 0, al: 0, mc: 0, rosters: [] };
                const inMonth = date.getMonth() === monthDates[0].getMonth();
                const isToday = dateValue === toDateInputValue(new Date());
                const isSelected = dailyDrawerDate === dateValue;
                const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                const hasRoster = stats.rosters.length > 0;
                const period = periodByDate.get(dateValue);
                const dayStatus = rosterDayStatus(stats) || (stats.rosters.length ? period?.status : "");
                const leaveText = [
                  stats.off ? `OFF ${stats.off}` : "",
                  stats.al ? `AL ${stats.al}` : "",
                  stats.mc ? `MC ${stats.mc}` : "",
                ].filter(Boolean).join(" / ");
                return (
                  <button
                    key={dateValue}
                    className={`group min-h-[128px] rounded-3xl border p-3 text-left transition ${
                      inMonth ? "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm" : "cursor-default"
                    } ${
                      isSelected ? "border-primary/50 bg-primary/10" : isToday ? "border-primary/60 bg-primary/5" : "border-border bg-surface"
                    } ${isWeekend && !isSelected ? "bg-background" : ""} ${!inMonth ? "hidden opacity-35 sm:block" : ""}`}
                    type="button"
                    disabled={!inMonth}
                    onClick={() => setDailyDrawerDate(dateValue)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-lg font-semibold text-text-primary">{date.getDate()}</div>
                      <div className="flex flex-col items-end gap-1">
                        {isToday ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary">Today</span> : null}
                        {dayStatus ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusBadgeClass(dayStatus)}`}>{formatStatusLabel(dayStatus)}</span> : null}
                      </div>
                    </div>
                    <div className="mt-4 text-sm font-bold text-text-primary">{hasRoster ? `${stats.working} Staff Scheduled` : "Not Scheduled Yet"}</div>
                    {hasRoster && stats.working > 0 ? (
                      <div className="mt-1 text-xs font-semibold text-text-secondary">
                        Floor {stats.floor} · Kitchen {stats.kitchen}{stats.other ? ` · Other ${stats.other}` : ""}
                      </div>
                    ) : null}
                    {hasRoster && stats.working === 0 && leaveText ? (
                      <div className="mt-1 text-xs font-semibold text-text-secondary">{leaveText}</div>
                    ) : null}
                    {stats.al || stats.mc ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {stats.al ? <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700">AL {stats.al}</span> : null}
                        {stats.mc ? <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700">MC {stats.mc}</span> : null}
                      </div>
                    ) : null}
                    {inMonth ? <div className="mt-4 text-[11px] font-black uppercase tracking-wide text-primary opacity-0 transition group-hover:opacity-100">View daily roster →</div> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-xs font-semibold text-text-secondary">
              <span className="inline-flex items-center gap-2"><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">AL</span> Annual leave</span>
              <span className="inline-flex items-center gap-2"><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">MC</span> Medical leave</span>
              <span className="inline-flex items-center gap-2"><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">Today</span> Current date</span>
              <span className="inline-flex items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusBadgeClass("draft")}`}>Draft</span> Draft roster</span>
              <span className="inline-flex items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusBadgeClass("published")}`}>Published</span> Published roster</span>
              <span className="inline-flex items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${statusBadgeClass("locked")}`}>Locked</span> Locked roster</span>
            </div>
          </div>
        )}
      </Card>

      {dailyDrawerDate && selectedDailyStats ? (
        <DailyDutyDrawer
          date={dailyDrawerDate}
          stats={selectedDailyStats}
          employeesById={employeesById}
          onClose={() => setDailyDrawerDate("")}
          onOpenSchedule={openScheduleForDate}
        />
      ) : null}
    </div>
  );
}
