import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, CalendarX, ChevronLeft, ChevronRight, Clipboard, Clock, Download, HeartPulse, LockKeyhole, Plane, Plus, Send, Share2, Trash2, UnlockKeyhole, Users, X } from "lucide-react";
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
import { SHIFT_TIME_INPUT_ERROR, buildShiftTimeOptions, formatShiftTimeInput, formatShiftTimeRange, normalizeShiftTimeInput } from "../utils/shiftTime.js";

const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const nonWorkingCodes = new Set(["OFF", "AL", "MC"]);
const groupLabels = {
  floor: "FLOOR",
  kitchen: "KITCHEN",
  other: "OTHER",
};

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

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fallbackGroupFromDepartment(department) {
  const value = String(department || "").toLowerCase();
  if (value.includes("kitchen")) return "kitchen";
  if (value.includes("service") || value.includes("frontline") || value.includes("floor")) return "floor";
  return "other";
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

const timeOptions = buildShiftTimeOptions();

const breakOptions = [0, 30, 45, 60, 90, 120].map((minutes) => ({
  value: String(minutes),
  label: minutes ? `${minutes} mins unpaid` : "0 mins",
}));

function TimeComboField({ label, value, onChange, error, onError }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatShiftTimeInput(value));
  const wrapperRef = useRef(null);

  useEffect(() => {
    setDraft(formatShiftTimeInput(value));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function commit(nextValue = draft) {
    if (!String(nextValue || "").trim()) {
      onChange("");
      setDraft("");
      onError?.("");
      return true;
    }
    const result = normalizeShiftTimeInput(nextValue);
    if (!result.valid) {
      onError?.(result.error);
      return false;
    }
    onChange(result.value);
    setDraft(result.display);
    onError?.("");
    return true;
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">{label}</label>
      <input
        className={`control h-10 pr-9 ${error ? "border-rose-300 bg-rose-50/60 text-rose-900" : ""}`}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange("");
          onError?.("");
        }}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (commit()) setOpen(false);
          }
        }}
        placeholder="10:00am"
      />
      <button className="absolute right-2 top-[27px] rounded-lg p-1 text-text-muted hover:bg-primary/10 hover:text-primary" type="button" onClick={() => setOpen((current) => !current)} aria-label={`Open ${label} suggestions`}>
        <ChevronRight size={14} className={`transition ${open ? "rotate-90" : ""}`} />
      </button>
      {error ? <div className="mt-1 text-[11px] font-semibold text-rose-600">{error}</div> : null}
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[9999] max-h-56 overflow-y-auto rounded-2xl border border-border bg-white p-1.5 shadow-2xl">
          {timeOptions.map((option) => (
            <button
              key={option.value}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold transition hover:bg-primary/5 hover:text-primary ${option.value === value ? "bg-primary/10 text-primary" : "text-text-primary"}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setDraft(option.label);
                onError?.("");
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              <span className="text-xs font-semibold text-text-muted">{option.displayLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BreakDurationField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const currentValue = Number(value || 0);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1.5 block text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">Break Duration</label>
      <div className="relative">
        <input
          className="control h-10 pr-24"
          type="number"
          min="0"
          step="5"
          value={currentValue}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value || 0)))}
          onFocus={(event) => {
            event.target.select();
            setOpen(true);
          }}
        />
        <button className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-text-muted hover:bg-primary/10 hover:text-primary" type="button" onClick={() => setOpen((current) => !current)}>
          mins unpaid
          <ChevronRight size={13} className={`transition ${open ? "rotate-90" : ""}`} />
        </button>
      </div>
      <div className="mt-1 text-[11px] text-text-muted">Use 0 for no break.</div>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[9999] rounded-2xl border border-border bg-white p-1.5 shadow-2xl">
          {breakOptions.map((option) => (
            <button
              key={option.value}
              className={`flex w-full rounded-xl px-3 py-2 text-left text-sm font-bold transition hover:bg-primary/5 hover:text-primary ${String(currentValue) === option.value ? "bg-primary/10 text-primary" : "text-text-primary"}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(Number(option.value));
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildRosterShareHorizontalSvg({ outletName, rangeLabel, status, groups, weekDates, rosterByEmployeeDate, generatedAt }) {
  const width = 1600;
  const margin = 32;
  const leftWidth = 280;
  const columnWidth = 174;
  const headerHeight = 128;
  const dateHeaderHeight = 64;
  const groupHeight = 34;
  const rowHeight = 62;
  const footerHeight = 42;
  const rows = [];

  groups.forEach((group) => {
    rows.push({ type: "group", label: group.label });
    group.employees.forEach((employee) => rows.push({ type: "employee", employee }));
  });

  const tableHeight = dateHeaderHeight + rows.reduce((sum, row) => sum + (row.type === "group" ? groupHeight : rowHeight), 0);
  const height = headerHeight + tableHeight + footerHeight + margin;
  const weekValues = weekDates.map(toDateInputValue);
  let y = headerHeight + dateHeaderHeight;

  const rowMarkup = rows.map((row) => {
    if (row.type === "group") {
      const markup = `
        <rect x="${margin}" y="${y}" width="${width - margin * 2}" height="${groupHeight}" rx="12" fill="#f4fbf6"/>
        <line x1="${margin + 16}" y1="${y + groupHeight / 2}" x2="${margin + 52}" y2="${y + groupHeight / 2}" stroke="#22c55e" stroke-width="3" stroke-linecap="round"/>
        <text x="${margin + 66}" y="${y + 23}" font-size="17" font-weight="600" fill="#047857" letter-spacing="2.5">${escapeXml(row.label)}</text>
      `;
      y += groupHeight;
      return markup;
    }

    const employee = row.employee;
    const rowY = y;
    y += rowHeight;
    const cells = weekValues.map((dateValue, index) => {
      const cellX = margin + leftWidth + index * columnWidth;
      const roster = rosterByEmployeeDate.get(rosterKey(employee.id, dateValue));
      const template = roster?.template;
      const isOff = template && nonWorkingCodes.has(template.code);
      const label = template ? (isOff ? template.code : formatShiftTimeRange(roster.start_time, roster.end_time)) : "-";
      const subLabel = template ? template.name : "No shift";
      const tone = shiftShareTone(template);
      return `
        <rect x="${cellX + 9}" y="${rowY + 9}" width="${columnWidth - 18}" height="44" rx="16" fill="${tone.fill}" stroke="${tone.stroke}" filter="url(#softShadow)"/>
        <text x="${cellX + columnWidth / 2}" y="${rowY + 28}" text-anchor="middle" font-size="16" font-weight="600" fill="${tone.text}">${escapeXml(label)}</text>
        <text x="${cellX + columnWidth / 2}" y="${rowY + 45}" text-anchor="middle" font-size="11" font-weight="500" fill="${tone.text}" opacity="0.68">${escapeXml(subLabel)}</text>
      `;
    }).join("");

    return `
      <rect x="${margin}" y="${rowY}" width="${width - margin * 2}" height="${rowHeight}" fill="#ffffff"/>
      <line x1="${margin + 8}" y1="${rowY + rowHeight}" x2="${width - margin - 8}" y2="${rowY + rowHeight}" stroke="#e5e7eb"/>
      <text x="${margin + 22}" y="${rowY + 28}" font-size="20" font-weight="700" fill="#111827">${escapeXml(employee.nickname || employee.full_name)}</text>
      <text x="${margin + 22}" y="${rowY + 49}" font-size="13" font-weight="500" fill="#6b7280">${escapeXml(employee.position || "Employee")}</text>
      ${cells}
    `;
  }).join("");

  const dateHeaders = weekDates.map((date, index) => {
    const x = margin + leftWidth + index * columnWidth;
    return `
      <rect x="${x + 14}" y="${headerHeight + 9}" width="${columnWidth - 28}" height="46" rx="14" fill="#ffffff" stroke="#e5e7eb"/>
      <text x="${x + columnWidth / 2}" y="${headerHeight + 28}" text-anchor="middle" font-size="13" font-weight="600" fill="#64748b" letter-spacing="2.2">${dayLabels[(date.getDay() + 6) % 7].toUpperCase()}</text>
      <text x="${x + columnWidth / 2}" y="${headerHeight + 49}" text-anchor="middle" font-size="18" font-weight="700" fill="#111827">${escapeXml(formatColumnDate(date))}</text>
    `;
  }).join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family: Inter, Plus Jakarta Sans, Geist, Arial, sans-serif;">
      <defs>
        <filter id="softShadow" x="-10%" y="-30%" width="120%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#101828" flood-opacity="0.04"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="#f7f8fa"/>
      <rect x="${margin / 2}" y="${margin / 2}" width="${width - margin}" height="${height - margin}" rx="24" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="${margin / 2}" y="${margin / 2}" width="${width - margin}" height="106" rx="24" fill="#f8faf8"/>
      <circle cx="${margin + 30}" cy="66" r="23" fill="#dcfce7"/>
      <text x="${margin + 30}" y="74" text-anchor="middle" font-size="24" font-weight="700" fill="#16a34a">F</text>
      <text x="${margin + 72}" y="56" font-size="32" font-weight="700" fill="#111827">${escapeXml(outletName)}</text>
      <text x="${margin + 72}" y="84" font-size="15" font-weight="600" fill="#475569">Duty Roster</text>
      <text x="${margin + 184}" y="84" font-size="15" font-weight="500" fill="#6b7280">${escapeXml(rangeLabel)}</text>
      <text x="${width - margin - 222}" y="53" font-size="12" font-weight="500" fill="#94a3b8">Generated ${escapeXml(generatedAt)}</text>
      <rect x="${width - margin - 150}" y="65" width="126" height="34" rx="17" fill="#ecfdf5" stroke="#bbf7d0"/>
      <text x="${width - margin - 87}" y="87" text-anchor="middle" font-size="13" font-weight="600" fill="#047857">${escapeXml(status)}</text>

      <rect x="${margin}" y="${headerHeight}" width="${width - margin * 2}" height="${dateHeaderHeight}" rx="16" fill="#f8fafc" stroke="#e5e7eb"/>
      <text x="${margin + 22}" y="${headerHeight + 40}" font-size="14" font-weight="600" fill="#64748b" letter-spacing="2">EMPLOYEE</text>
      ${dateHeaders}
      ${rowMarkup}

      <text x="${margin}" y="${height - 28}" font-size="12" font-weight="500" fill="#94a3b8">Generated ${escapeXml(generatedAt)}</text>
    </svg>
  `;
}

function shiftShareTone(template) {
  const code = template?.code;
  if (!template) return { fill: "#f8fafc", stroke: "#e2e8f0", text: "#94a3b8" };
  if (code === "OFF") return { fill: "#f1f5f9", stroke: "#cbd5e1", text: "#64748b" };
  if (code === "AL" || code === "MC") return { fill: "#f5f3ff", stroke: "#ddd6fe", text: "#6d28d9" };
  if (code === "MID") return { fill: "#fffbeb", stroke: "#fde68a", text: "#92400e" };
  if (code === "CLOSING") return { fill: "#fff1f2", stroke: "#fecdd3", text: "#be123c" };
  if (code === "FULL") return { fill: "#eff6ff", stroke: "#bfdbfe", text: "#1d4ed8" };
  return { fill: "#ecfdf5", stroke: "#bbf7d0", text: "#065f46" };
}

function buildRosterShareVerticalSvg({ outletName, rangeLabel, status, groups, weekDates, rosterByEmployeeDate, generatedAt }) {
  const width = 860;
  const margin = 28;
  const headerHeight = 132;
  const legendHeight = 42;
  const groupHeaderHeight = 30;
  const employeeCardBase = 62;
  const dayRowHeight = 26;
  const footerHeight = 46;
  const weekValues = weekDates.map(toDateInputValue);
  const employees = groups.flatMap((group) => [
    { type: "group", label: group.label },
    ...group.employees.map((employee) => ({ type: "employee", employee })),
  ]);
  const bodyHeight = employees.reduce((sum, row) => {
    if (row.type === "group") return sum + groupHeaderHeight;
    return sum + employeeCardBase + weekValues.length * dayRowHeight;
  }, 0);
  const height = headerHeight + legendHeight + bodyHeight + footerHeight + margin;
  let y = headerHeight;

  const legend = [
    ["Morning", "#ecfdf5", "#065f46"],
    ["Mid", "#fffbeb", "#92400e"],
    ["Closing", "#fff1f2", "#be123c"],
    ["Full", "#eff6ff", "#1d4ed8"],
    ["Leave", "#f5f3ff", "#6d28d9"],
    ["OFF", "#f1f5f9", "#64748b"],
  ].map(([label, fill, text], index) => {
    const x = margin + index * 126;
    return `
      <rect x="${x}" y="${headerHeight - 4}" width="112" height="26" rx="13" fill="${fill}" stroke="#e5e7eb"/>
      <text x="${x + 56}" y="${headerHeight + 13}" text-anchor="middle" font-size="11" font-weight="600" fill="${text}">${escapeXml(label)}</text>
    `;
  }).join("");

  y += legendHeight;

  const body = employees.map((row) => {
    if (row.type === "group") {
      const markup = `
        <line x1="${margin}" y1="${y + 14}" x2="${margin + 50}" y2="${y + 14}" stroke="#22c55e" stroke-width="3" stroke-linecap="round"/>
        <text x="${margin + 64}" y="${y + 19}" font-size="15" font-weight="600" fill="#047857" letter-spacing="2.4">${escapeXml(row.label)}</text>
      `;
      y += groupHeaderHeight;
      return markup;
    }

    const employee = row.employee;
    const cardY = y;
    const cardHeight = employeeCardBase + weekValues.length * dayRowHeight;
    y += cardHeight + 8;
    const initials = String(employee.nickname || employee.full_name || "?").trim().slice(0, 2).toUpperCase();
    const dayRows = weekValues.map((dateValue, index) => {
      const rowY = cardY + 54 + index * dayRowHeight;
      const date = weekDates[index];
      const roster = rosterByEmployeeDate.get(rosterKey(employee.id, dateValue));
      const template = roster?.template;
      const code = template?.code;
      const isNonWorking = template && nonWorkingCodes.has(code);
      const tone = shiftShareTone(template);
      const shiftLabel = template ? (isNonWorking ? code : formatShiftTimeRange(roster.start_time, roster.end_time)) : "-";
      const subLabel = template && !isNonWorking ? template.name : template?.name || "No shift";
      return `
        <text x="${margin + 72}" y="${rowY + 18}" font-size="13" font-weight="600" fill="#64748b">${escapeXml(`${date.getDate()} ${dayLabels[(date.getDay() + 6) % 7]}`)}</text>
        <rect x="${margin + 176}" y="${rowY + 2}" width="${width - margin * 2 - 188}" height="22" rx="11" fill="${tone.fill}" stroke="${tone.stroke}"/>
        <text x="${margin + 192}" y="${rowY + 17}" font-size="13" font-weight="600" fill="${tone.text}">${escapeXml(shiftLabel)}</text>
        <text x="${width - margin - 18}" y="${rowY + 17}" text-anchor="end" font-size="10" font-weight="500" fill="${tone.text}" opacity="0.68">${escapeXml(subLabel)}</text>
      `;
    }).join("");

    return `
      <rect x="${margin}" y="${cardY}" width="${width - margin * 2}" height="${cardHeight}" rx="16" fill="#ffffff" stroke="#e5e7eb" filter="url(#posterShadow)"/>
      <circle cx="${margin + 34}" cy="${cardY + 32}" r="20" fill="#dcfce7"/>
      <text x="${margin + 34}" y="${cardY + 39}" text-anchor="middle" font-size="14" font-weight="700" fill="#047857">${escapeXml(initials)}</text>
      <text x="${margin + 66}" y="${cardY + 28}" font-size="18" font-weight="700" fill="#111827">${escapeXml(employee.nickname || employee.full_name)}</text>
      <text x="${margin + 66}" y="${cardY + 49}" font-size="12" font-weight="500" fill="#6b7280">${escapeXml(employee.position || "Employee")}</text>
      ${dayRows}
    `;
  }).join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family: Inter, Plus Jakarta Sans, Geist, Arial, sans-serif;">
      <defs>
        <filter id="posterShadow" x="-10%" y="-20%" width="120%" height="150%">
          <feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#101828" flood-opacity="0.04"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="#f7f8fa"/>
      <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="24" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="14" y="14" width="${width - 28}" height="104" rx="24" fill="#f8faf8"/>
      <circle cx="${margin + 24}" cy="60" r="20" fill="#dcfce7"/>
      <text x="${margin + 24}" y="68" text-anchor="middle" font-size="21" font-weight="700" fill="#16a34a">F</text>
      <text x="${margin + 58}" y="55" font-size="26" font-weight="700" fill="#111827">${escapeXml(outletName)}</text>
      <text x="${margin + 58}" y="80" font-size="14" font-weight="600" fill="#475569">Duty Roster</text>
      <text x="${margin + 146}" y="80" font-size="14" font-weight="500" fill="#6b7280">${escapeXml(rangeLabel)}</text>
      <rect x="${width - margin - 120}" y="44" width="96" height="32" rx="16" fill="#ecfdf5" stroke="#bbf7d0"/>
      <text x="${width - margin - 72}" y="65" text-anchor="middle" font-size="12" font-weight="600" fill="#047857">${escapeXml(status)}</text>
      <text x="${width - margin - 120}" y="96" font-size="10" font-weight="500" fill="#94a3b8">Generated ${escapeXml(generatedAt)}</text>
      ${legend}
      ${body}
      <text x="${margin}" y="${height - 30}" font-size="12" font-weight="500" fill="#94a3b8">Generated ${escapeXml(generatedAt)}</text>
    </svg>
  `;
}

function svgToPng(svgMarkup) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 2));
      const width = image.naturalWidth || image.width || 1600;
      const height = image.naturalHeight || image.height || 900;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      context.fillStyle = "#f7f8fa";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(url);
        if (!pngBlob) {
          reject(new Error("Unable to generate roster image."));
          return;
        }
        resolve({ blob: pngBlob, dataUrl: canvas.toDataURL("image/png") });
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to prepare roster image."));
    };
    image.src = url;
  });
}

function ShareRosterModal({ image, layout, onLayoutChange, loading, error, onDownload, onCopy, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-primary">Share Roster</div>
            <h2 className="mt-1 text-lg font-semibold text-text-primary">Roster Image Preview</h2>
            <p className="mt-0.5 text-sm text-text-secondary">Clean staff-facing roster image without filters or admin controls.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close share roster"><X size={18} /></button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-5 py-2.5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-text-muted">Share Layout</div>
            <p className="mt-0.5 text-xs font-semibold text-text-secondary">Choose the staff-facing image format.</p>
          </div>
          <div className="flex rounded-2xl border border-border bg-background p-1">
            {[
              { value: "horizontal", label: "Horizontal" },
              { value: "vertical", label: "Vertical" },
            ].map((option) => (
              <button
                key={option.value}
                className={`rounded-xl px-4 py-2 text-xs font-black transition ${layout === option.value ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                type="button"
                onClick={() => onLayoutChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#f3f5f4] p-2.5 sm:p-3">
          {loading ? <div className="rounded-3xl border border-border bg-surface p-10 text-center text-sm font-semibold text-text-secondary">Generating roster image...</div> : null}
          {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700">{error}</div> : null}
          {image?.dataUrl ? (
            <div className={`mx-auto bg-white shadow-sm ${layout === "vertical" ? "max-w-[460px] rounded-2xl p-1" : "rounded-xl p-1"}`}>
              <img className={`${layout === "vertical" ? "max-h-[70vh] w-auto max-w-full object-contain" : "h-auto w-full"} rounded-lg`} src={image.dataUrl} alt="Duty roster share preview" />
            </div>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-surface px-4 py-3">
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-secondary" type="button" disabled={!image?.blob || loading} onClick={onCopy}><Clipboard size={16} /> Copy Image</button>
          <button className="btn-primary" type="button" disabled={!image?.blob || loading} onClick={onDownload}><Download size={16} /> Download Image</button>
        </footer>
      </div>
    </div>
  );
}

function PositionGroupCard({ group, title, description, tone, positions, selectedIds, otherSelectedIds, onToggle, onClear, expanded, onToggleExpanded }) {
  const [query, setQuery] = useState("");
  const visiblePositions = positions.filter((position) => position.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedCount = selectedIds.size;

  function selectAllVisible() {
    visiblePositions.forEach((position) => {
      if (!selectedIds.has(position.id)) onToggle(group, position.id);
    });
  }

  return (
    <div className={`rounded-3xl border bg-surface p-4 ${tone === "floor" ? "border-emerald-200" : "border-amber-200"}`}>
      <button className="flex w-full items-start justify-between gap-3 text-left" type="button" onClick={onToggleExpanded}>
        <div>
          <div className="text-sm font-black text-text-primary">{title} · {selectedCount} positions</div>
          <p className="mt-1 text-xs font-semibold text-text-secondary">{description}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${tone === "floor" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {expanded ? "Hide" : "Manage"}
        </span>
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
        {[...selectedIds].map((positionId) => {
          const position = positions.find((item) => item.id === positionId);
          if (!position) return null;
          return (
            <button
              key={positionId}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${tone === "floor" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
              type="button"
              onClick={() => onToggle(group, positionId)}
            >
              {position.name} ×
            </button>
          );
        })}
        {!selectedCount ? <span className="text-xs font-semibold text-text-muted">No positions assigned.</span> : null}
      </div>

      {expanded ? (
        <div className="mt-4 rounded-2xl border border-border bg-background p-3">
          <input className="control h-9 w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search position..." />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-surface" type="button" onClick={selectAllVisible}>Select all visible</button>
            <button className="rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-surface" type="button" onClick={onClear}>Clear group</button>
          </div>
          <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
            {visiblePositions.map((position) => {
              const selected = selectedIds.has(position.id);
              const assignedElsewhere = otherSelectedIds.has(position.id);
              return (
                <button
                  key={position.id}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                    selected
                      ? tone === "floor"
                        ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                        : "border-amber-300 bg-amber-100 text-amber-800"
                      : assignedElsewhere
                        ? "border-border bg-slate-50 text-text-muted line-through"
                        : "border-border bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary"
                  }`}
                  type="button"
                  onClick={() => onToggle(group, position.id)}
                >
                  {position.name}
                </button>
              );
            })}
            {!visiblePositions.length ? <div className="text-xs font-semibold text-text-muted">No positions found.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RosterSettingsDrawer({ outletId, outlets, positions, mappings, templates, onClose, onSaveMappings, onSaveTemplate, onDeactivateTemplate, onReorderTemplates, saving }) {
  const [templateDraft, setTemplateDraft] = useState({
    name: "",
    code: "",
    start_time: "",
    end_time: "",
    break_minutes: 60,
    shift_type: "working",
    color: "green",
  });
  const [draggedTemplateId, setDraggedTemplateId] = useState("");
  const [expandedGroup, setExpandedGroup] = useState("floor");
  const [templateErrors, setTemplateErrors] = useState({});
  const [showArchivedTemplates, setShowArchivedTemplates] = useState(false);
  const [floorIds, setFloorIds] = useState(() => new Set(mappings.filter((item) => item.group_name === "floor").map((item) => item.position_id)));
  const [kitchenIds, setKitchenIds] = useState(() => new Set(mappings.filter((item) => item.group_name === "kitchen").map((item) => item.position_id)));
  const outletName = outlets.find((outlet) => outlet.id === outletId)?.name ?? "Selected outlet";
  const assignedIds = new Set([...floorIds, ...kitchenIds]);
  const unassignedPositions = positions.filter((position) => !assignedIds.has(position.id));
  const activeTemplates = templates.filter((template) => template.is_active);
  const archivedTemplates = templates.filter((template) => !template.is_active);

  useEffect(() => {
    setFloorIds(new Set(mappings.filter((item) => item.group_name === "floor").map((item) => item.position_id)));
    setKitchenIds(new Set(mappings.filter((item) => item.group_name === "kitchen").map((item) => item.position_id)));
  }, [mappings]);

  function togglePosition(group, positionId) {
    if (group === "floor") {
      setFloorIds((current) => {
        const next = new Set(current);
        if (next.has(positionId)) next.delete(positionId);
        else next.add(positionId);
        return next;
      });
      setKitchenIds((current) => {
        const next = new Set(current);
        next.delete(positionId);
        return next;
      });
    } else {
      setKitchenIds((current) => {
        const next = new Set(current);
        if (next.has(positionId)) next.delete(positionId);
        else next.add(positionId);
        return next;
      });
      setFloorIds((current) => {
        const next = new Set(current);
        next.delete(positionId);
        return next;
      });
    }
  }

  function editTemplate(template) {
    setTemplateDraft({
      ...template,
      break_minutes: template.break_minutes ?? 0,
    });
    setTemplateErrors({});
  }

  function selectTemplate(template) {
    editTemplate(template);
  }

  function templateAccent(template) {
    if (template.shift_type === "off" || template.code === "OFF") return "border-slate-200 bg-slate-50";
    if (template.shift_type === "leave" || template.shift_type === "medical" || template.code === "AL" || template.code === "MC") return "border-violet-200 bg-violet-50";
    return "border-emerald-200 bg-emerald-50";
  }

  function dropTemplate(targetId) {
    if (!draggedTemplateId || draggedTemplateId === targetId) return;
    const fromIndex = activeTemplates.findIndex((template) => template.id === draggedTemplateId);
    const toIndex = activeTemplates.findIndex((template) => template.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...activeTemplates];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setDraggedTemplateId("");
    onReorderTemplates(next);
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
    setTemplateErrors({});
  }

  function isNonWorkingDraft(draft) {
    const code = String(draft.code || draft.name || "").trim().toUpperCase().replace(/\s+/g, "_");
    return nonWorkingCodes.has(code) || draft.shift_type === "off" || draft.shift_type === "leave" || draft.shift_type === "medical";
  }

  function validateTemplateDraft() {
    const nextErrors = {};
    const name = templateDraft.name.trim();
    const code = String(templateDraft.code || name).trim().toUpperCase().replace(/\s+/g, "_");
    const nonWorking = isNonWorkingDraft({ ...templateDraft, code });

    if (!name) nextErrors.name = "Template name is required.";
    if (!nonWorking) {
      if (!templateDraft.start_time) nextErrors.start_time = SHIFT_TIME_INPUT_ERROR;
      if (!templateDraft.end_time) nextErrors.end_time = SHIFT_TIME_INPUT_ERROR;
    }

    setTemplateErrors(nextErrors);
    if (Object.keys(nextErrors).length) return null;

    return {
      ...templateDraft,
      name,
      code,
      start_time: nonWorking ? "" : templateDraft.start_time,
      end_time: nonWorking ? "" : templateDraft.end_time,
      break_minutes: nonWorking ? 0 : Number(templateDraft.break_minutes || 0),
      shift_type: nonWorking ? (code === "OFF" ? "off" : code === "MC" ? "medical" : "leave") : "working",
      outlet_id: outletId,
      sort_order: templateDraft.sort_order || activeTemplates.length + 1,
    };
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
            <p className="mt-1 text-xs font-semibold text-text-secondary">Assign job positions to roster teams. Unassigned positions appear under Other.</p>
            <div className="mt-4 space-y-3">
              <PositionGroupCard
                group="floor"
                title="Floor Team"
                description="Positions that appear under Floor in roster."
                tone="floor"
                positions={positions}
                selectedIds={floorIds}
                otherSelectedIds={kitchenIds}
                onToggle={togglePosition}
                onClear={() => setFloorIds(new Set())}
                expanded={expandedGroup === "floor"}
                onToggleExpanded={() => setExpandedGroup((current) => (current === "floor" ? "" : "floor"))}
              />
              <PositionGroupCard
                group="kitchen"
                title="Kitchen Team"
                description="Positions that appear under Kitchen in roster."
                tone="kitchen"
                positions={positions}
                selectedIds={kitchenIds}
                otherSelectedIds={floorIds}
                onToggle={togglePosition}
                onClear={() => setKitchenIds(new Set())}
                expanded={expandedGroup === "kitchen"}
                onToggleExpanded={() => setExpandedGroup((current) => (current === "kitchen" ? "" : "kitchen"))}
              />
              <div className="rounded-2xl border border-dashed border-border bg-surface p-3">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Unassigned Positions</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {unassignedPositions.map((position) => (
                    <span key={position.id} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-text-secondary">{position.name}</span>
                  ))}
                  {!unassignedPositions.length ? <span className="text-xs font-semibold text-text-muted">All positions are assigned to Floor or Kitchen.</span> : null}
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  className="btn-primary"
                  type="button"
                  disabled={saving}
                  onClick={() => onSaveMappings({
                    floorPositionIds: [...floorIds],
                    kitchenPositionIds: [...kitchenIds],
                    allPositionIds: positions.map((position) => position.id),
                  })}
                >
                  Save Position Groups
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-background p-4">
            <div className="text-sm font-bold text-text-primary">Shift Template Settings</div>
            <p className="mt-1 text-xs font-semibold text-text-secondary">Templates are outlet-specific. Drag active templates to control quick-assign order.</p>
            <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">{templateDraft.id ? "Edit Template" : "Add Template"}</div>
                  <p className="mt-1 text-xs font-semibold text-text-secondary">Type time as 10:00am or choose from suggestions. Break duration is unpaid.</p>
                </div>
                {templateDraft.id ? <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={resetTemplate}>New</button> : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <input
                    className={`control ${templateErrors.name ? "border-rose-300 bg-rose-50/60" : ""}`}
                    value={templateDraft.name}
                    onChange={(event) => {
                      setTemplateDraft((current) => ({ ...current, name: event.target.value }));
                      setTemplateErrors((current) => ({ ...current, name: "" }));
                    }}
                    placeholder="Name"
                  />
                  {templateErrors.name ? <div className="mt-1 text-[11px] font-semibold text-rose-600">{templateErrors.name}</div> : null}
                </div>
                <input className="control" value={templateDraft.code} onChange={(event) => setTemplateDraft((current) => ({ ...current, code: event.target.value }))} placeholder="Code" />
                <TimeComboField
                  label="Start Time"
                  value={templateDraft.start_time || ""}
                  error={templateErrors.start_time}
                  onError={(start_time) => setTemplateErrors((current) => ({ ...current, start_time }))}
                  onChange={(start_time) => setTemplateDraft((current) => ({ ...current, start_time }))}
                />
                <TimeComboField
                  label="End Time"
                  value={templateDraft.end_time || ""}
                  error={templateErrors.end_time}
                  onError={(end_time) => setTemplateErrors((current) => ({ ...current, end_time }))}
                  onChange={(end_time) => setTemplateDraft((current) => ({ ...current, end_time }))}
                />
                <BreakDurationField
                  value={templateDraft.break_minutes ?? 0}
                  onChange={(break_minutes) => setTemplateDraft((current) => ({ ...current, break_minutes }))}
                />
                <SelectField
                  label="Template Color"
                  value={templateDraft.color}
                  options={["green", "amber", "red", "blue", "purple", "gray"].map((color) => ({ value: color, label: color[0].toUpperCase() + color.slice(1) }))}
                  onChange={(color) => setTemplateDraft((current) => ({ ...current, color }))}
                  placeholder="Color"
                />
              </div>
              <div className={`mt-3 rounded-2xl border px-3 py-2 ${templateAccent(templateDraft)}`}>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Live Preview</div>
                <div className="mt-1 text-sm font-black text-text-primary">{templateDraft.name || "New Shift Template"}</div>
                <div className="mt-0.5 text-xs font-semibold text-text-secondary">{shiftTimeLabel(templateDraft)} · {Number(templateDraft.break_minutes || 0)} mins break</div>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {templateDraft.id && templateDraft.is_active !== false ? (
                  <button className="btn-secondary text-amber-700 hover:bg-amber-50" type="button" onClick={() => onDeactivateTemplate(templateDraft.id)}>Archive</button>
                ) : null}
                <button
                  className="btn-primary"
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    const payload = validateTemplateDraft();
                    if (!payload) return;
                    await onSaveTemplate(payload);
                    resetTemplate();
                  }}
                >
                  {saving ? "Saving..." : "Save Template"}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {activeTemplates.map((template) => (
                <div
                  key={template.id}
                  className={`flex cursor-grab items-center justify-between gap-3 rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-sm ${templateAccent(template)}`}
                  draggable
                  onDragStart={() => setDraggedTemplateId(template.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropTemplate(template.id)}
                >
                  <div>
                    <div className="text-sm font-bold text-text-primary">{template.name}</div>
                    <div className="text-xs font-semibold text-text-secondary">{shiftTimeLabel(template)} · {template.break_minutes} mins break</div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => editTemplate(template)}>Edit</button>
                    <button className="btn-secondary h-9 px-3 text-xs text-amber-700 hover:bg-amber-50" type="button" onClick={() => onDeactivateTemplate(template.id)}>Archive</button>
                  </div>
                </div>
              ))}
              {!activeTemplates.length ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm font-semibold text-text-muted">
                  No active templates yet. Add Morning, Mid, Closing, Full, OFF, AL, or MC to start scheduling.
                </div>
              ) : null}
            </div>

            {archivedTemplates.length ? (
              <div className="mt-4 rounded-2xl border border-border bg-surface p-3">
                <button className="flex w-full items-center justify-between gap-3 text-left" type="button" onClick={() => setShowArchivedTemplates((current) => !current)}>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Archived Templates · {archivedTemplates.length}</div>
                  <span className="text-xs font-bold text-text-secondary">{showArchivedTemplates ? "Hide" : "Show"}</span>
                </button>
                {showArchivedTemplates ? (
                  <div className="mt-3 space-y-2">
                    {archivedTemplates.map((template) => (
                      <div key={template.id} className="rounded-2xl border border-border bg-background p-3 opacity-75">
                        <div className="text-sm font-bold text-text-primary">{template.name}</div>
                        <div className="text-xs font-semibold text-text-secondary">{shiftTimeLabel(template)}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
  const [popoverRect, setPopoverRect] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const rangeLabel = mode === "month" ? formatMonthYear(visibleDates[0]) : formatWeekRange(weekDates);
  const draftWeek = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(draftDate), index));

  useEffect(() => {
    const nextDate = new Date(`${weekStart}T00:00:00`);
    setDraftDate(nextDate);
    setViewMonth(startOfMonth(nextDate));
  }, [weekStart, mode]);

  useEffect(() => {
    if (!open) return undefined;

    function updatePopoverRect() {
      const trigger = buttonRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = 360;
      const gap = 10;
      const estimatedHeight = 430;
      const spaceBelow = window.innerHeight - trigger.bottom;
      const top = spaceBelow >= estimatedHeight + gap
        ? trigger.bottom + gap
        : Math.max(12, trigger.top - estimatedHeight - gap);
      const left = Math.min(Math.max(12, trigger.left), window.innerWidth - width - 12);
      setPopoverRect({ top, left, width });
    }

    function handlePointerDown(event) {
      if (!buttonRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    updatePopoverRect();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePopoverRect);
    window.addEventListener("scroll", updatePopoverRect, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePopoverRect);
      window.removeEventListener("scroll", updatePopoverRect, true);
    };
  }, [open]);

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
    <div>
      <div className="flex items-center gap-2">
        <button className="icon-btn" type="button" onClick={onPrevious} aria-label={mode === "month" ? "Previous month" : "Previous week"}><ChevronLeft size={16} /></button>
        <button
          ref={buttonRef}
          className="flex h-10 min-w-[230px] items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 text-left text-sm font-bold text-text-primary shadow-sm transition hover:border-primary/40 hover:bg-primary/5"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="flex items-center gap-2"><CalendarDays size={16} className="text-primary" /> {rangeLabel}</span>
          <ChevronRight size={14} className={`text-text-muted transition ${open ? "rotate-90" : ""}`} />
        </button>
        <button className="icon-btn" type="button" onClick={onNext} aria-label={mode === "month" ? "Next month" : "Next week"}><ChevronRight size={16} /></button>
      </div>

      {open && popoverRect ? createPortal((
        <div
          ref={popoverRef}
          className="fixed z-[9999] rounded-3xl border border-border bg-white p-4 shadow-2xl"
          style={{ top: popoverRect.top, left: popoverRect.left, width: popoverRect.width }}
        >
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
      ), document.body) : null}
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
  const [allTemplates, setAllTemplates] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [period, setPeriod] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [shiftDrawer, setShiftDrawer] = useState(null);
  const [bulkDrawer, setBulkDrawer] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLayout, setShareLayout] = useState("horizontal");
  const [shareImage, setShareImage] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
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
  const outletName = activeOutlets.find((outlet) => outlet.id === outletId)?.name ?? "Selected outlet";

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
    const rawFocus = localStorage.getItem("feedx:dutyRosterFocus");
    if (!rawFocus) return;
    try {
      const focus = JSON.parse(rawFocus);
      if (focus.outletId) setOutletId(focus.outletId);
      if (focus.date) {
        setViewMode("week");
        setWeekStart(toDateInputValue(startOfWeek(`${focus.date}T00:00:00`)));
      }
    } catch (focusError) {
      console.warn("Unable to apply duty roster focus", focusError);
    } finally {
      localStorage.removeItem("feedx:dutyRosterFocus");
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadRosterData() {
      if (!outletId) return;
      setLoading(true);
      setError("");
      try {
        const [employeeRows, positionRows, mappingRows, templateRows, allTemplateRows, rosterRows, nextPeriod] = await Promise.all([
          employeeService.listEmployees(),
          jobPositionService.listJobPositions(),
          rosterPositionGroupService.listMappings(),
          shiftTemplateService.listShiftTemplates(outletId),
          shiftTemplateService.listAllShiftTemplates(outletId),
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
        setAllTemplates(allTemplateRows);
        setRosters(rosterRows);
        setPeriod(nextPeriod);
        setSelectedTemplateId((current) => (templateRows.some((template) => template.id === current) ? current : ""));
      } catch (loadError) {
        console.error("Unable to load duty roster", loadError);
        const setupMissing = loadError?.cause?.code === "42P01" || /shift_templates|duty_rosters|roster_periods/i.test(loadError?.message || "");
        const orderingMissing = /sort_order|template ordering/i.test(loadError?.message || "") || /sort_order/i.test(loadError?.cause?.message || "");
        if (!ignore) {
          setError(orderingMissing
            ? "Duty Roster setup needs the latest shift template ordering update. Please apply the latest setup and refresh."
            : setupMissing
              ? "Duty Roster is not ready yet. Please ask admin to apply the latest setup for roster tables and shift templates."
              : loadError.message || "Unable to load duty roster.");
        }
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
      rosterGroup: position ? mappedGroup || "other" : fallbackGroupFromDepartment(employee.department),
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

  async function savePositionMappings(mappingPayload) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      return;
    }
    setSaving(true);
    try {
      const saved = await rosterPositionGroupService.saveMappings(mappingPayload);
      setPositionMappings(saved);
      ui.notify({ title: "Position groups saved" });
    } catch (mappingError) {
      console.error("Unable to save roster group mapping", mappingError);
      ui.notify({ title: "Unable to save group mapping", message: mappingError.message || "Please try again.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function refreshShiftTemplates() {
    const [activeRows, allRows] = await Promise.all([
      shiftTemplateService.listShiftTemplates(outletId),
      shiftTemplateService.listAllShiftTemplates(outletId),
    ]);
    setTemplates(activeRows);
    setAllTemplates(allRows);
    setSelectedTemplateId((current) => (activeRows.some((template) => template.id === current) ? current : ""));
    return { activeRows, allRows };
  }

  async function saveShiftTemplate(template) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      throw new Error("You do not have permission to manage duty roster settings.");
    }
    setSaving(true);
    try {
      const saved = await shiftTemplateService.saveShiftTemplate(template);
      await refreshShiftTemplates();
      ui.notify({ title: "Shift template saved" });
      return saved;
    } catch (templateError) {
      console.error("Unable to save shift template", templateError);
      ui.notify({ title: "Unable to save template", message: templateError.message || "Please try again.", tone: "error" });
      throw templateError;
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
      await refreshShiftTemplates();
      ui.notify({ title: "Shift template archived" });
    } catch (templateError) {
      console.error("Unable to deactivate shift template", templateError);
      ui.notify({ title: "Unable to archive template", message: templateError.message || "Please try again.", tone: "error" });
    }
  }

  async function reorderShiftTemplates(nextTemplates) {
    if (!canManageRoster) {
      notifyPermissionDenied(ui, "manage duty roster settings");
      return;
    }
    try {
      await shiftTemplateService.reorderShiftTemplates(nextTemplates);
      await refreshShiftTemplates();
    } catch (reorderError) {
      console.error("Unable to reorder shift templates", reorderError);
      ui.notify({ title: "Unable to reorder templates", message: reorderError.message || "Please try again.", tone: "error" });
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

  async function generateShareRosterImage(nextLayout = shareLayout) {
    setShareLoading(true);
    setShareError("");
    setShareImage(null);
    try {
      const generatedAt = new Intl.DateTimeFormat("en-MY", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());
      const sharePayload = {
        outletName,
        rangeLabel: formatWeekRange(weekDates),
        status: period?.status === "locked" ? "Locked" : period?.status === "published" ? "Published" : "Draft",
        groups: groupedEmployees,
        weekDates,
        rosterByEmployeeDate,
        generatedAt,
      };
      const svg = nextLayout === "vertical"
        ? buildRosterShareVerticalSvg(sharePayload)
        : buildRosterShareHorizontalSvg(sharePayload);
      const image = await svgToPng(svg);
      setShareImage(image);
    } catch (shareError) {
      console.error("Unable to generate roster image", shareError);
      setShareError(shareError.message || "Unable to generate roster image.");
    } finally {
      setShareLoading(false);
    }
  }

  async function prepareShareRoster() {
    if (!canExportRoster) {
      notifyPermissionDenied(ui, "share duty roster");
      return;
    }
    setShareLayout("horizontal");
    setShareOpen(true);
    await generateShareRosterImage("horizontal");
  }

  async function changeShareLayout(nextLayout) {
    setShareLayout(nextLayout);
    await generateShareRosterImage(nextLayout);
  }

  function shareFileRange() {
    const start = weekDates[0];
    const end = weekDates[6];
    const month = new Intl.DateTimeFormat("en-MY", { month: "short" }).format(start).toLowerCase();
    const endMonth = new Intl.DateTimeFormat("en-MY", { month: "short" }).format(end).toLowerCase();
    return `${start.getDate()}${month}-${end.getDate()}${endMonth}-${end.getFullYear()}`;
  }

  function downloadShareRoster() {
    if (!shareImage?.dataUrl) return;
    const link = document.createElement("a");
    link.href = shareImage.dataUrl;
    link.download = `duty-roster-${outletName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${shareFileRange()}-${shareLayout}.png`;
    link.click();
  }

  async function copyShareRoster() {
    if (!shareImage?.blob) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error("Image copy is not supported in this browser.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": shareImage.blob })]);
      ui.notify({ title: "Roster image copied" });
    } catch (copyError) {
      console.error("Unable to copy roster image", copyError);
      ui.notify({ title: "Unable to copy image", message: copyError.message || "Please download the image instead.", tone: "error" });
    }
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
            {canExportRoster ? (
              <button className="btn-secondary" type="button" onClick={prepareShareRoster}>
                <Share2 size={16} /> Share Roster
              </button>
            ) : null}
            {canManageRoster ? (
              <button
                className="btn-primary"
                type="button"
                disabled={viewMode !== "week" || !period || period.status === "published" || period.status === "locked"}
                onClick={() => setStatus("published")}
                title={viewMode !== "week" ? "Switch to Week view to publish a roster week." : undefined}
              >
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
          <div />
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

        </div>
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

      {shareOpen ? (
        <ShareRosterModal
          image={shareImage}
          layout={shareLayout}
          onLayoutChange={changeShareLayout}
          loading={shareLoading}
          error={shareError}
          onDownload={downloadShareRoster}
          onCopy={copyShareRoster}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <RosterSettingsDrawer
          outletId={outletId}
          outlets={activeOutlets}
          positions={jobPositions}
          mappings={positionMappings}
          templates={allTemplates}
          saving={saving}
          onClose={() => setSettingsOpen(false)}
          onSaveMappings={savePositionMappings}
          onSaveTemplate={saveShiftTemplate}
          onDeactivateTemplate={deactivateShiftTemplate}
          onReorderTemplates={reorderShiftTemplates}
        />
      ) : null}

      {saving ? <div className="fixed bottom-5 right-5 rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-bold text-text-primary shadow-xl">Saving roster...</div> : null}
    </div>
  );
}
