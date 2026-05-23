import { Fragment, useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, ClipboardCopy, Clock, Download, HeartPulse, LockKeyhole, Plane, Plus, Send, Trash2, UnlockKeyhole, Users, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { employeeService } from "../../../services/employeeService.js";
import { shiftTemplateService } from "../../../services/shiftTemplateService.js";
import { dutyRosterService } from "../../../services/dutyRosterService.js";
import { rosterPeriodService } from "../../../services/rosterPeriodService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";
import { rosterPositionGroupService } from "../../../services/rosterPositionGroupService.js";
import { canCreate, canDelete, canEdit, canExport, canManage, notifyPermissionDenied } from "../../../utils/accessControl.js";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const nonWorkingCodes = new Set(["OFF", "AL", "MC"]);
const groupLabels = {
  floor: "FLOOR",
  kitchen: "KITCHEN",
  other: "OTHER",
};

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

function formatDay(date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(date);
}

function formatColumnDate(date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short" }).format(date).toUpperCase();
}

function formatWeekRange(dates) {
  return `${formatDay(dates[0])} - ${formatDay(dates[6])} ${dates[6].getFullYear()}`;
}

function formatMonthYear(date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" }).format(date);
}

function monthCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
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

function fallbackGroupFromDepartment(department) {
  const value = String(department || "").toLowerCase();
  if (value.includes("kitchen")) return "kitchen";
  if (value.includes("service") || value.includes("frontline") || value.includes("floor")) return "floor";
  return "other";
}

function coverageBucket(groupName) {
  return groupName === "kitchen" ? "Kitchen" : "Floor";
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

function formatShiftTime(value) {
  if (!value) return "";
  const [hourRaw, minuteRaw = "0"] = String(value).split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  return minute ? `${displayHour}:${String(minute).padStart(2, "0")}${suffix}` : `${displayHour}${suffix}`;
}

function formatShiftTimeRange(startTime, endTime) {
  const start = formatShiftTime(startTime);
  const end = formatShiftTime(endTime);
  if (!start || !end) return "";
  return `${start} - ${end}`;
}

function shiftTimeLabel(template) {
  return formatShiftTimeRange(template?.start_time, template?.end_time) || template?.code || "No time";
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

function ShiftBlock({ roster }) {
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
          <div className="text-[11px] font-black">
            {isNonWorking ? template.code : formatShiftTimeRange(roster.start_time, roster.end_time)}
          </div>
          <div className="mt-1 text-xs font-semibold opacity-80">{template.name}</div>
        </div>
      </div>
    </div>
  );
}

function ShiftDrawer({ mode, employee, date, roster, templates, selectedTemplateId, onSelectTemplate, onClose, onSave, onDelete, saving, canDeleteShift }) {
  const [templateId, setTemplateId] = useState(roster?.shift_template_id || selectedTemplateId || "");
  const [remark, setRemark] = useState(roster?.remark || "");
  const selected = templates.find((item) => item.id === templateId);
  const team = groupLabels[employee.rosterGroup] ?? "OTHER";
  const dateObject = new Date(`${date}T00:00:00`);

  function chooseTemplate(template) {
    setTemplateId(template.id);
    onSelectTemplate?.(template.id);
    if (mode === "add") onSave(template, remark);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close shift drawer backdrop" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[440px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">{mode === "edit" ? "Edit Shift" : "Add Shift"}</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{employee.nickname || employee.full_name}</h2>
              <p className="mt-1 text-sm text-text-secondary">{team} · {dayLabels[(dateObject.getDay() + 6) % 7]} {formatDay(dateObject)}</p>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close shift drawer">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Shift Selection</div>
            <div className="mt-3 grid gap-2">
              {templates.map((item) => (
                <button
                  key={item.id}
                  className={`flex items-center justify-between rounded-2xl border p-3 text-left transition ${
                    templateId === item.id ? "border-primary bg-primary/10 ring-2 ring-primary/15" : `${templateTone(item)} hover:-translate-y-0.5 hover:shadow-sm`
                  }`}
                  type="button"
                  disabled={saving}
                  onClick={() => chooseTemplate(item)}
                >
                  <span>
                    <span className="block text-sm font-bold">{item.name}</span>
                    <span className="mt-1 block text-xs font-semibold opacity-75">{shiftTimeLabel(item)}</span>
                  </span>
                  {templateId === item.id ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
            {mode === "add" ? <p className="mt-3 text-xs font-semibold text-text-secondary">Selecting a template saves this shift immediately.</p> : null}
          </section>

          {mode === "edit" ? (
            <section className="mt-4 rounded-3xl border border-border bg-background p-4">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-text-muted" htmlFor="shift-remark">Remark</label>
              <textarea
                id="shift-remark"
                className="control mt-2 min-h-24 w-full resize-none"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
                placeholder="Optional shift note"
              />
            </section>
          ) : null}
        </div>

        <footer className="shrink-0 border-t border-border bg-background p-4">
          {mode === "edit" ? (
            <div className="flex items-center justify-between gap-2">
              <button className="btn-secondary text-rose-700 hover:bg-rose-50" type="button" disabled={!canDeleteShift || saving} onClick={() => onDelete(roster)}>
                <Trash2 size={16} /> Delete
              </button>
              <div className="flex gap-2">
                <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
                <button className="btn-primary" type="button" disabled={!selected || saving} onClick={() => onSave(selected, remark)}>
                  {saving ? "Saving..." : "Save Shift"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}

function BulkAssignDrawer({ employee, dates, templates, selectedTemplateId, onClose, onSave, saving }) {
  const [templateId, setTemplateId] = useState(selectedTemplateId || "");
  const [selectedDates, setSelectedDates] = useState(() => new Set(dates.slice(0, 5).map(toDateInputValue)));
  const [remark, setRemark] = useState("");
  const template = templates.find((item) => item.id === templateId);

  function toggleDate(dateValue) {
    setSelectedDates((current) => {
      const next = new Set(current);
      if (next.has(dateValue)) next.delete(dateValue);
      else next.add(dateValue);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close bulk assign drawer backdrop" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[480px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Bulk Assign</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{employee.nickname || employee.full_name}</h2>
              <p className="mt-1 text-sm text-text-secondary">{groupLabels[employee.rosterGroup] ?? "OTHER"} · Select multiple dates</p>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close bulk assign drawer"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Dates</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {dates.map((date, index) => {
                const dateValue = toDateInputValue(date);
                return (
                  <button
                    key={dateValue}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm font-bold transition ${selectedDates.has(dateValue) ? "border-primary bg-primary text-white" : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:bg-primary/5"}`}
                    type="button"
                    onClick={() => toggleDate(dateValue)}
                  >
                    {viewDayLabel(date, index)}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-4 rounded-3xl border border-border bg-background p-4">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Shift Template</div>
            <div className="mt-3 grid gap-2">
              {templates.map((item) => (
                <button
                  key={item.id}
                  className={`flex items-center justify-between rounded-2xl border p-3 text-left transition ${templateId === item.id ? "border-primary bg-primary/10 ring-2 ring-primary/15" : `${templateTone(item)} hover:-translate-y-0.5 hover:shadow-sm`}`}
                  type="button"
                  onClick={() => setTemplateId(item.id)}
                >
                  <span>
                    <span className="block text-sm font-bold">{item.name}</span>
                    <span className="mt-1 block text-xs font-semibold opacity-75">{shiftTimeLabel(item)}</span>
                  </span>
                  {templateId === item.id ? <CheckIcon /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded-3xl border border-border bg-background p-4">
            <label className="text-xs font-black uppercase tracking-[0.16em] text-text-muted" htmlFor="bulk-remark">Remark</label>
            <textarea id="bulk-remark" className="control mt-2 min-h-20 w-full resize-none" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Optional note for selected dates" />
          </section>
        </div>

        <footer className="shrink-0 border-t border-border bg-background p-4">
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary" type="button" disabled={!template || selectedDates.size === 0 || saving} onClick={() => onSave(employee, [...selectedDates], template, remark)}>
              {saving ? "Saving..." : `Assign ${selectedDates.size} Dates`}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function viewDayLabel(date, index) {
  return `${dayLabels[(date.getDay() + 6) % 7]} ${formatDay(date)}`;
}

function RosterSettingsDrawer({ outletId, outlets, positions, mappings, templates, onClose, onSaveMapping, onSaveTemplate, onDeactivateTemplate, saving }) {
  const [templateDraft, setTemplateDraft] = useState({
    name: "",
    code: "",
    start_time: "",
    end_time: "",
    break_minutes: 60,
    shift_type: "working",
    color: "green",
  });
  const mappingByPosition = new Map(mappings.map((item) => [item.position_id, item.group_name]));
  const outletName = outlets.find((outlet) => outlet.id === outletId)?.name ?? "Selected outlet";

  function editTemplate(template) {
    setTemplateDraft({
      ...template,
      break_minutes: template.break_minutes ?? 0,
    });
  }

  function resetTemplate() {
    setTemplateDraft({
      name: "",
      code: "",
      start_time: "",
      end_time: "",
      break_minutes: 60,
      shift_type: "working",
      color: "green",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <button className="flex-1 cursor-default" type="button" aria-label="Close roster settings" onClick={onClose} />
      <aside className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Duty Roster Settings</div>
              <h2 className="mt-1 text-xl font-semibold text-text-primary">{outletName}</h2>
              <p className="mt-1 text-sm text-text-secondary">Configure roster groups and outlet shift templates.</p>
            </div>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Close roster settings"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-sm font-bold text-text-primary">Position Group Mapping</div>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Choose where each HR job position appears on the roster.</p>
            <div className="mt-4 space-y-2">
              {positions.map((position) => (
                <div key={position.id} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3 rounded-2xl border border-border bg-surface p-3">
                  <div>
                    <div className="text-sm font-bold text-text-primary">{position.name}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">{position.department || "Unassigned department"}</div>
                  </div>
                  <SelectField
                    value={mappingByPosition.get(position.id) ?? "other"}
                    options={[
                      { value: "floor", label: "Floor" },
                      { value: "kitchen", label: "Kitchen" },
                      { value: "other", label: "Other" },
                    ]}
                    onChange={(group_name) => onSaveMapping({ position_id: position.id, group_name })}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-sm font-bold text-text-primary">Shift Template Settings</div>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Templates are outlet-specific and power the quick assignment panel.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <input className="control" value={templateDraft.name} onChange={(event) => setTemplateDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name" />
              <input className="control" value={templateDraft.code} onChange={(event) => setTemplateDraft((current) => ({ ...current, code: event.target.value }))} placeholder="Code" />
              <input className="control" type="time" value={templateDraft.start_time || ""} onChange={(event) => setTemplateDraft((current) => ({ ...current, start_time: event.target.value }))} />
              <input className="control" type="time" value={templateDraft.end_time || ""} onChange={(event) => setTemplateDraft((current) => ({ ...current, end_time: event.target.value }))} />
              <input className="control" type="number" min="0" value={templateDraft.break_minutes} onChange={(event) => setTemplateDraft((current) => ({ ...current, break_minutes: event.target.value }))} placeholder="Break minutes" />
              <SelectField
                value={templateDraft.color}
                options={["green", "amber", "red", "blue", "purple", "gray"].map((color) => ({ value: color, label: color[0].toUpperCase() + color.slice(1) }))}
                onChange={(color) => setTemplateDraft((current) => ({ ...current, color }))}
              />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-secondary" type="button" onClick={resetTemplate}>Clear</button>
              <button
                className="btn-primary"
                type="button"
                disabled={!templateDraft.name.trim() || saving}
                onClick={async () => {
                  await onSaveTemplate({ ...templateDraft, outlet_id: outletId });
                  resetTemplate();
                }}
              >
                Save Template
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
                  <div>
                    <div className="text-sm font-bold text-text-primary">{template.name}</div>
                    <div className="text-xs font-semibold text-text-secondary">{shiftTimeLabel(template)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => editTemplate(template)}>Edit</button>
                    <button className="btn-secondary h-9 px-3 text-xs text-rose-700 hover:bg-rose-50" type="button" onClick={() => onDeactivateTemplate(template.id)}>Deactivate</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function RosterDateSelector({ mode, weekStart, weekDates, visibleDates, onSelectDate, onPrevious, onNext }) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => new Date(`${weekStart}T00:00:00`));
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(`${weekStart}T00:00:00`));
  const rangeLabel = mode === "month" ? formatMonthYear(visibleDates[0]) : formatWeekRange(weekDates);
  const draftWeek = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(draftDate), index));

  useEffect(() => {
    const nextDate = new Date(`${weekStart}T00:00:00`);
    setDraftDate(nextDate);
    setViewMonth(startOfMonth(nextDate));
  }, [weekStart, mode]);

  function applyDate(date = draftDate) {
    onSelectDate(date);
    setOpen(false);
  }

  function shortcutToday() {
    const today = new Date();
    setDraftDate(today);
    setViewMonth(startOfMonth(today));
    if (mode === "month") applyDate(today);
  }

  function shortcutThisWeek() {
    const today = new Date();
    setDraftDate(today);
    setViewMonth(startOfMonth(today));
    if (mode === "week") applyDate(today);
  }

  function shortcutThisMonth() {
    const today = new Date();
    setDraftDate(startOfMonth(today));
    setViewMonth(startOfMonth(today));
    if (mode === "month") applyDate(today);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button className="icon-btn" type="button" onClick={onPrevious} aria-label={mode === "month" ? "Previous month" : "Previous week"}><ChevronLeft size={16} /></button>
        <button
          className="flex h-10 min-w-[230px] items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 text-left text-sm font-bold text-text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="flex items-center gap-2"><CalendarDays size={16} className="text-primary" /> {rangeLabel}</span>
          <ChevronRight size={14} className={`text-text-muted transition ${open ? "rotate-90" : ""}`} />
        </button>
        <button className="icon-btn" type="button" onClick={onNext} aria-label={mode === "month" ? "Next month" : "Next week"}><ChevronRight size={16} /></button>
      </div>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+10px)] z-[210] w-[360px] rounded-3xl border border-border bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <button className="icon-btn" type="button" onClick={() => setViewMonth((current) => addMonths(current, -1))}><ChevronLeft size={15} /></button>
            <div className="text-sm font-black text-text-primary">{formatMonthYear(viewMonth)}</div>
            <button className="icon-btn" type="button" onClick={() => setViewMonth((current) => addMonths(current, 1))}><ChevronRight size={15} /></button>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-black uppercase tracking-wide text-text-muted">
            {dayLabels.map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {monthCalendarDays(viewMonth).map((date) => {
              const value = toDateInputValue(date);
              const inMonth = date.getMonth() === viewMonth.getMonth();
              const selected = mode === "month"
                ? value === toDateInputValue(startOfMonth(draftDate))
                : value === toDateInputValue(startOfWeek(draftDate));
              const inDraftWeek = mode === "week" && draftWeek.some((item) => toDateInputValue(item) === value);
              return (
                <button
                  key={value}
                  className={`h-9 rounded-xl text-sm font-bold transition ${
                    selected
                      ? "bg-primary text-white shadow-sm"
                      : inDraftWeek
                        ? "bg-primary/10 text-primary"
                        : inMonth
                          ? "text-text-primary hover:bg-primary/5"
                          : "text-text-muted/50 hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => {
                    const next = mode === "month" ? startOfMonth(date) : startOfWeek(date);
                    setDraftDate(next);
                    if (mode === "month") applyDate(next);
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-background p-3 text-xs font-semibold text-text-secondary">
            {mode === "month" ? (
              <span>Selected month: <strong className="text-text-primary">{formatMonthYear(draftDate)}</strong></span>
            ) : (
              <div className="space-y-1">
                <div>From: <strong className="text-text-primary">{formatDay(draftWeek[0])} {draftWeek[0].getFullYear()}</strong></div>
                <div>To: <strong className="text-text-primary">{formatDay(draftWeek[6])} {draftWeek[6].getFullYear()}</strong></div>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={shortcutToday}>Today</button>
            <button className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={shortcutThisWeek}>This Week</button>
            <button className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-slate-50" type="button" onClick={shortcutThisMonth}>This Month</button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary h-9 px-3 text-xs" type="button" onClick={() => applyDate()}>Apply</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DutyRosterPage({ store, ui, auth }) {
  const activeOutlets = store.outlets.filter((outlet) => outlet.status === "active" || outlet.is_active);
  const [outletId, setOutletId] = useState(activeOutlets[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(() => toDateInputValue(startOfWeek(new Date())));
  const [viewMode, setViewMode] = useState("week");
  const [employees, setEmployees] = useState([]);
  const [jobPositions, setJobPositions] = useState([]);
  const [positionMappings, setPositionMappings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [period, setPeriod] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [shiftDrawer, setShiftDrawer] = useState(null);
  const [bulkDrawer, setBulkDrawer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
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
  const visibleDates = useMemo(() => (
    viewMode === "month"
      ? datesBetween(startOfMonth(`${weekStart}T00:00:00`), endOfMonth(`${weekStart}T00:00:00`))
      : weekDates
  ), [viewMode, weekDates, weekStart]);
  const visibleDateValues = visibleDates.map(toDateInputValue);
  const visibleStart = visibleDateValues[0];
  const visibleEnd = visibleDateValues[visibleDateValues.length - 1];
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
        const [employeeRows, positionRows, mappingRows, templateRows, rosterRows, nextPeriod] = await Promise.all([
          employeeService.listEmployees(),
          jobPositionService.listJobPositions(),
          rosterPositionGroupService.listMappings(),
          shiftTemplateService.listShiftTemplates(outletId),
          dutyRosterService.listDutyRosters(outletId, visibleStart, visibleEnd),
          rosterPeriodService.getOrCreateRosterPeriod(outletId, weekDateValues[0], weekEnd),
        ]);
        if (ignore) return;
        setEmployees(employeeRows.filter((employee) => (
          employee.is_active !== false &&
          employee.employment_status !== "resigned" &&
          (!employee.workplace || employee.workplace === outletId || employee.workplace === activeOutlets.find((outlet) => outlet.id === outletId)?.name)
        )));
        setJobPositions(positionRows);
        setPositionMappings(mappingRows);
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
  }, [outletId, viewMode, weekStart]);

  const rosterByEmployeeDate = useMemo(() => new Map(rosters.map((roster) => [rosterKey(roster.employee_id, roster.roster_date), roster])), [rosters]);
  const positionByName = useMemo(() => {
    const map = new Map();
    jobPositions.forEach((position) => map.set(String(position.name).toLowerCase(), position));
    return map;
  }, [jobPositions]);
  const mappingByPositionId = useMemo(() => new Map(positionMappings.map((mapping) => [mapping.position_id, mapping.group_name])), [positionMappings]);
  const employeesWithGroups = useMemo(() => employees.map((employee) => {
    const position = positionByName.get(String(employee.position || "").toLowerCase());
    const mappedGroup = position ? mappingByPositionId.get(position.id) : null;
    return {
      ...employee,
      position_id: position?.id ?? "",
      rosterGroup: mappedGroup || fallbackGroupFromDepartment(employee.department),
    };
  }), [employees, mappingByPositionId, positionByName]);
  const employeePositions = useMemo(() => [...new Set(employeesWithGroups.map((employee) => employee.position).filter(Boolean))].sort(), [employeesWithGroups]);
  const groupedEmployees = useMemo(() => {
    const groups = new Map();
    employeesWithGroups
      .filter((employee) => groupFilter === "all" || employee.rosterGroup === groupFilter)
      .filter((employee) => positionFilter === "all" || employee.position === positionFilter)
      .filter((employee) => {
        const query = employeeSearch.trim().toLowerCase();
        if (!query) return true;
        return [employee.full_name, employee.nickname, employee.employee_code].some((value) => String(value || "").toLowerCase().includes(query));
      })
      .forEach((employee) => {
        const group = employee.rosterGroup;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(employee);
      });
    const order = ["floor", "kitchen", "other"];
    return [...groups.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([group, items]) => ({ group, label: groupLabels[group] ?? "OTHER", employees: items }));
  }, [employeeSearch, employeesWithGroups, groupFilter, positionFilter]);

  const coverageByDate = useMemo(() => {
    const result = new Map();
    visibleDateValues.forEach((date) => result.set(date, { Kitchen: 0, Floor: 0 }));
    rosters.forEach((roster) => {
      if (!isWorkingRoster(roster)) return;
      const employee = employeesWithGroups.find((item) => item.id === roster.employee_id);
      const bucket = coverageBucket(employee?.rosterGroup);
      const current = result.get(roster.roster_date) ?? { Kitchen: 0, Floor: 0 };
      current[bucket] += 1;
      result.set(roster.roster_date, current);
    });
    return result;
  }, [employeesWithGroups, rosters, visibleDateValues.join("|")]);

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

  async function saveShift(employee, date, templateOverride = selectedTemplate, remark = "") {
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
    if (!templateOverride) return;
    setSaving(true);
    try {
      const saved = await dutyRosterService.saveDutyRoster({
        outletId,
        employeeId: employee.id,
        rosterDate: date,
        template: templateOverride,
        status: period?.status === "published" ? "published" : "draft",
        remark,
      });
      setRosters((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      setShiftDrawer(null);
      ui.notify({ title: "Shift saved", message: `${employee.nickname || employee.full_name} · ${templateOverride.name}` });
    } catch (saveError) {
      console.error("Unable to save duty roster shift", saveError);
      ui.notify({ title: "Unable to save shift", message: saveError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleCellClick(employee, date) {
    if (readOnly) return;
    const existing = rosterByEmployeeDate.get(rosterKey(employee.id, date));
    if (existing) {
      setShiftDrawer({ mode: "edit", employee, date, roster: existing });
      return;
    }
    if (selectedTemplate) {
      saveShift(employee, date, selectedTemplate);
      return;
    }
    setShiftDrawer({ mode: "add", employee, date, roster: null });
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
      setShiftDrawer(null);
      ui.notify({ title: "Shift removed" });
    } catch (deleteError) {
      console.error("Unable to delete duty roster shift", deleteError);
      ui.notify({ title: "Unable to remove shift", message: deleteError.message || "Please try again.", tone: "error" });
    }
  }

  async function bulkAssign(employee, dates, template, remark = "") {
    if (!dates.length || !template) return;
    setSaving(true);
    try {
      const savedRows = await Promise.all(dates.map((date) => dutyRosterService.saveDutyRoster({
        outletId,
        employeeId: employee.id,
        rosterDate: date,
        template,
        status: period?.status === "published" ? "published" : "draft",
        remark,
      })));
      setRosters((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        savedRows.forEach((row) => byId.set(row.id, row));
        return [...byId.values()];
      });
      setBulkDrawer(null);
      ui.notify({ title: "Bulk assignment saved", message: `${dates.length} dates assigned to ${template.name}.` });
    } catch (bulkError) {
      console.error("Unable to bulk assign duty roster", bulkError);
      ui.notify({ title: "Unable to bulk assign", message: bulkError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function savePositionMapping(mapping) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      return;
    }
    try {
      const saved = await rosterPositionGroupService.saveMapping(mapping);
      setPositionMappings((current) => {
        const exists = current.some((item) => item.position_id === saved.position_id);
        return exists ? current.map((item) => (item.position_id === saved.position_id ? saved : item)) : [...current, saved];
      });
      ui.notify({ title: "Group mapping saved" });
    } catch (mappingError) {
      console.error("Unable to save roster group mapping", mappingError);
      ui.notify({ title: "Unable to save group mapping", message: mappingError.message || "Please try again.", tone: "error" });
    }
  }

  async function saveShiftTemplate(template) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      return;
    }
    setSaving(true);
    try {
      const saved = await shiftTemplateService.saveShiftTemplate(template);
      setTemplates((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      ui.notify({ title: "Shift template saved" });
    } catch (templateError) {
      console.error("Unable to save shift template", templateError);
      ui.notify({ title: "Unable to save template", message: templateError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deactivateShiftTemplate(id) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      return;
    }
    try {
      await shiftTemplateService.deactivateShiftTemplate(id);
      setTemplates((current) => current.filter((item) => item.id !== id));
      ui.notify({ title: "Shift template deactivated" });
    } catch (templateError) {
      console.error("Unable to deactivate shift template", templateError);
      ui.notify({ title: "Unable to deactivate template", message: templateError.message || "Please try again.", tone: "error" });
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

  function selectRosterDate(date) {
    const next = viewMode === "month" ? startOfMonth(date) : startOfWeek(date);
    setWeekStart(toDateInputValue(next));
  }

  function navigateRoster(direction) {
    const current = new Date(`${weekStart}T00:00:00`);
    const next = viewMode === "month" ? addMonths(current, direction) : addDays(current, direction * 7);
    setWeekStart(toDateInputValue(viewMode === "month" ? startOfMonth(next) : startOfWeek(next)));
  }

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
            {canManageRoster && viewMode === "week" ? (
              <button className="btn-primary" type="button" disabled={!period || period.status === "published" || period.status === "locked"} onClick={() => setStatus("published")}>
                <Send size={16} /> Publish Roster
              </button>
            ) : null}
            {canManageRoster ? (
              <button className="btn-secondary" type="button" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
            ) : null}
          </div>
        )}
      />

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1.15fr_1.15fr_0.9fr_1fr_auto_auto] lg:items-end">
          <FieldLabel label="Outlet">
            <SelectField
              value={outletId}
              options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
              onChange={setOutletId}
            />
          </FieldLabel>
          <FieldLabel label={viewMode === "month" ? "Month" : "Date Range"}>
            <RosterDateSelector
              mode={viewMode}
              weekStart={weekStart}
              weekDates={weekDates}
              visibleDates={visibleDates}
              onSelectDate={selectRosterDate}
              onPrevious={() => navigateRoster(-1)}
              onNext={() => navigateRoster(1)}
            />
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
          <FieldLabel label="Employee">
            <input className="control h-10 w-full" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Search name..." />
          </FieldLabel>
          <div className="flex rounded-2xl border border-border bg-background p-1">
            {["week", "month"].map((mode) => (
              <button
                key={mode}
                className={`rounded-xl px-3 py-2 text-xs font-bold capitalize ${viewMode === mode ? "bg-primary text-white" : "text-text-secondary hover:text-text-primary"}`}
                type="button"
                onClick={() => {
                  setViewMode(mode);
                  const current = new Date(`${weekStart}T00:00:00`);
                  setWeekStart(toDateInputValue(mode === "month" ? startOfMonth(current) : startOfWeek(current)));
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          {viewMode === "week" ? <button className="btn-secondary h-10" type="button" disabled={!canWriteShift || locked} onClick={copyWeek}>
            <ClipboardCopy size={16} /> Copy Week
          </button> : <div />}
        </div>
        <div className="mt-3 max-w-sm">
          <FieldLabel label="Position">
            <SelectField
              value={positionFilter}
              options={[{ value: "all", label: "All Positions" }, ...employeePositions.map((position) => ({ value: position, label: position }))]}
              onChange={setPositionFilter}
            />
          </FieldLabel>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div> : null}
      {!canWriteShift ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Read-only access. You need Duty Roster create or edit permission to change shifts.</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title={viewMode === "month" ? `Full Month View · ${formatMonthYear(visibleDates[0])}` : `Weekly Roster · ${formatWeekRange(weekDates)}`}
          description="Employee x date cells are shift slots. Click any cell to add or edit a shift."
        >
          {loading ? (
            <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading duty roster...</div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className={`w-full border-separate border-spacing-0 text-sm ${viewMode === "month" ? "min-w-[2400px]" : "min-w-[1120px]"}`}>
                  <thead className="table-head">
                    <tr>
                      <th className="table-sticky-cell sticky left-0 z-20 w-[220px] px-3 py-3 text-left">Employee</th>
                      {visibleDates.map((date) => {
                        const dateValue = toDateInputValue(date);
                        return (
                          <th key={dateValue} className={`${viewMode === "month" ? "min-w-[72px]" : "min-w-[128px]"} px-3 py-3 text-left`}>
                            {viewMode === "month" ? (
                              <>
                                <div className="text-sm font-black text-text-primary">{date.getDate()}</div>
                                <div className="mt-0.5 text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{dayLabels[(date.getDay() + 6) % 7]}</div>
                              </>
                            ) : (
                              <>
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{dayLabels[(date.getDay() + 6) % 7]}</div>
                                <div className="mt-0.5 text-sm font-bold text-text-primary">{formatColumnDate(date)}</div>
                              </>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groupedEmployees.map((group) => (
                      <Fragment key={group.group}>
                        <tr className="sticky top-[49px] z-10 bg-primary/10">
                          <td colSpan={visibleDates.length + 1} className="border-y border-primary/15 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-primary">{group.label}</td>
                        </tr>
                        {group.employees.map((employee) => (
                          <tr key={employee.id} className="table-row">
                            <td className="table-sticky-cell sticky left-0 z-10 bg-surface px-3 py-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-bold text-text-primary">{employee.nickname || employee.full_name}</div>
                                  <div className="mt-1 truncate text-xs text-text-secondary">{employee.position || "Employee"}</div>
                                </div>
                                {!readOnly ? (
                                  <button className="rounded-xl border border-border px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10" type="button" onClick={() => setBulkDrawer({ employee })}>
                                    Bulk
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            {visibleDateValues.map((dateValue) => {
                              const roster = rosterByEmployeeDate.get(rosterKey(employee.id, dateValue));
                              return (
                                <td key={dateValue} className="group border-l border-border px-1.5 py-1.5 align-top">
                                  <div
                                    className={`min-h-[58px] w-full rounded-2xl border border-dashed border-border bg-background/50 p-1.5 text-left transition ${!readOnly ? "cursor-pointer hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm" : ""} ${selectedTemplate ? "ring-1 ring-primary/10" : ""}`}
                                    role="button"
                                    tabIndex={readOnly ? -1 : 0}
                                    aria-disabled={readOnly}
                                    onClick={() => handleCellClick(employee, dateValue)}
                                    onKeyDown={(event) => {
                                      if (!readOnly && (event.key === "Enter" || event.key === " ")) handleCellClick(employee, dateValue);
                                    }}
                                  >
                                    {viewMode === "month" ? (
                                      roster?.template ? (
                                        <div className={`flex min-h-[38px] items-center justify-center rounded-xl border px-1 text-[11px] font-black shadow-sm ${templateTone(roster.template)}`} title={`${roster.template.name} · ${shiftTimeLabel(roster.template)}`}>
                                          {roster.template.code === "CLOSING" ? "C" : roster.template.code === "MORNING" ? "M" : roster.template.code === "FULL" ? "F" : roster.template.code}
                                        </div>
                                      ) : (
                                        <div className="flex min-h-[38px] items-center justify-center rounded-xl text-primary opacity-0 transition group-hover:bg-primary/5 group-hover:opacity-100">
                                          <Plus size={13} />
                                        </div>
                                      )
                                    ) : (
                                      <ShiftBlock roster={roster} />
                                    )}
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
                {visibleDateValues.map((dateValue, index) => (
                  <section key={dateValue} className="rounded-2xl border border-border bg-background p-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{dayLabels[(visibleDates[index].getDay() + 6) % 7]}</div>
                      <div className="text-base font-bold text-text-primary">{formatColumnDate(visibleDates[index])}</div>
                    </div>
                    <div className="mt-3 space-y-3">
                      {groupedEmployees.map((group) => (
                        <div key={`${dateValue}-${group.group}`}>
                          <div className="mb-2 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-primary">{group.label}</div>
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
                                  onClick={() => handleCellClick(employee, dateValue)}
                                  onKeyDown={(event) => {
                                    if (!readOnly && (event.key === "Enter" || event.key === " ")) handleCellClick(employee, dateValue);
                                  }}
                                >
                                  <div>
                                    <div className="text-sm font-bold text-text-primary">{employee.nickname || employee.full_name}</div>
                                    <div className="text-xs text-text-secondary">{employee.position || "Employee"}</div>
                                  </div>
                                  <ShiftBlock roster={roster} />
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
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
                  <span>Selected: {selectedTemplate.name}. Click a roster cell to assign.</span>
                  <button className="font-black underline-offset-2 hover:underline" type="button" onClick={() => setSelectedTemplateId("")}>Clear</button>
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
                const total = visibleDateValues.reduce((sum, date) => sum + (coverageByDate.get(date)?.[bucket] ?? 0), 0);
                return (
                  <div key={bucket} className="rounded-2xl border border-border bg-background p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-text-primary">{bucket}</span>
                      <span className="text-xs font-bold text-text-muted">{total} weekly slots</span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {visibleDateValues.map((date, index) => (
                        <div key={date} className="flex items-center justify-between rounded-xl bg-surface px-2 py-1.5 text-xs">
                          <span className="font-bold text-text-secondary">{viewMode === "month" ? `${visibleDates[index].getDate()} ${dayLabels[(visibleDates[index].getDay() + 6) % 7]}` : dayLabels[index]}</span>
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

      {shiftDrawer ? (
        <ShiftDrawer
          mode={shiftDrawer.mode}
          employee={shiftDrawer.employee}
          date={shiftDrawer.date}
          roster={shiftDrawer.roster}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          onSelectTemplate={setSelectedTemplateId}
          saving={saving}
          canDeleteShift={canDeleteShift}
          onClose={() => setShiftDrawer(null)}
          onSave={(template, remark) => saveShift(shiftDrawer.employee, shiftDrawer.date, template, remark)}
          onDelete={deleteShift}
        />
      ) : null}

      {bulkDrawer ? (
        <BulkAssignDrawer
          employee={bulkDrawer.employee}
          dates={visibleDates}
          templates={templates}
          selectedTemplateId={selectedTemplateId}
          saving={saving}
          onClose={() => setBulkDrawer(null)}
          onSave={bulkAssign}
        />
      ) : null}

      {settingsOpen ? (
        <RosterSettingsDrawer
          outletId={outletId}
          outlets={activeOutlets}
          positions={jobPositions}
          mappings={positionMappings}
          templates={templates}
          saving={saving}
          onClose={() => setSettingsOpen(false)}
          onSaveMapping={savePositionMapping}
          onSaveTemplate={saveShiftTemplate}
          onDeactivateTemplate={deactivateShiftTemplate}
        />
      ) : null}

      {saving ? <div className="fixed bottom-5 right-5 rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold text-text-primary shadow-xl">Saving roster...</div> : null}
    </div>
  );
}
