import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronRight, ClipboardCheck, Plus, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const weekdays = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 7, label: "Sun" },
];
const statusMeta = {
  pending: { label: "Pending", tone: "warning", icon: CalendarDays },
  completed: { label: "Awaiting Verification", tone: "info", icon: ClipboardCheck },
  verified: { label: "Verified", tone: "success", icon: ShieldCheck },
  unsatisfactory: { label: "Unsatisfactory", tone: "danger", icon: XCircle },
  missed: { label: "Missed", tone: "danger", icon: XCircle },
};
const monthStatusOptions = [
  { value: "", label: "All statuses" }, { value: "pending", label: "Pending" }, { value: "completed", label: "Awaiting Verification" },
  { value: "verified", label: "Verified" }, { value: "unsatisfactory", label: "Unsatisfactory" }, { value: "missed", label: "Missed" },
];

function currentMonthInput() { return malaysiaBusinessDateInput().slice(0, 7); }
function monthDays(month) {
  const [year, zeroMonth] = month.split("-").map(Number);
  return Array.from({ length: new Date(year, zeroMonth, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
function recurrenceLabel(row) {
  if (row.source_type === "after_production") return "After Production";
  if (row.recurrence_type === "daily") return "Scheduled · Daily";
  const labels = (row.recurrence_weekdays || []).map((day) => weekdays.find((item) => item.value === Number(day))?.label).filter(Boolean);
  return `Scheduled · Weekly${labels.length ? ` · ${labels.join(", ")}` : ""}`;
}
function emptyRequirementDraft() {
  return { task_name: "", equipment_ids: [], recurrence_type: "daily", recurrence_weekdays: [1], status: "active", effective_from: malaysiaBusinessDateInput() };
}
function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status || "Pending", tone: "neutral", icon: CalendarDays };
  const Icon = meta.icon;
  return <Badge tone={meta.tone}><span className="inline-flex items-center gap-1"><Icon size={12} />{meta.label}</span></Badge>;
}
function productionLabel(occurrence) {
  const production = occurrence.production_snapshot || {};
  return [production.product_name, production.batch_no].filter(Boolean).join(" · ") || "Production evidence";
}
function cellLabel(cell) {
  if (cell.status === "verified") return <Check aria-hidden="true" size={14} strokeWidth={3} />;
  if (cell.status === "unsatisfactory") return <XCircle aria-hidden="true" size={14} />;
  if (cell.status === "completed") return <ClipboardCheck aria-hidden="true" size={14} />;
  if (cell.status === "missed") return "!";
  return cell.total_count > 1 || cell.status === "mixed" ? `${cell.verified_count}/${cell.total_count}` : "•";
}
function cellClassName(status) {
  if (status === "verified") return "bg-emerald-50 text-emerald-700 hover:bg-emerald-100";
  if (status === "unsatisfactory" || status === "missed") return "bg-rose-50 text-rose-700 hover:bg-rose-100";
  if (status === "completed") return "bg-sky-50 text-sky-700 hover:bg-sky-100";
  if (status === "mixed") return "bg-amber-50 text-amber-800 hover:bg-amber-100";
  return "bg-amber-50 text-amber-800 hover:bg-amber-100";
}
function occurrenceMatchesStatus(occurrence, status) { return !status || occurrence.status === status; }

function OccurrenceDetail({ occurrence, onClose }) {
  if (!occurrence) return null;
  return <Modal title={`${occurrence.equipment_code} · ${occurrence.task_name}`} onClose={onClose} size="lg">
    <div className="grid gap-4 text-sm md:grid-cols-2">
      <div><div className="text-xs font-semibold text-text-muted">Status</div><div className="mt-1"><StatusBadge status={occurrence.status} /></div></div>
      <div><div className="text-xs font-semibold text-text-muted">Source</div><div className="mt-1 font-bold text-text-primary">{recurrenceLabel(occurrence)}</div></div>
      <div><div className="text-xs font-semibold text-text-muted">Equipment</div><div className="mt-1 font-bold text-text-primary">{[occurrence.equipment_code, occurrence.equipment_name].filter(Boolean).join(" · ")}</div><div className="text-xs text-text-secondary">{occurrence.location_name || "-"}</div></div>
      <div><div className="text-xs font-semibold text-text-muted">Due</div><div className="mt-1 font-bold text-text-primary">{formatFactoryDate(occurrence.due_date)}</div></div>
      {occurrence.source_type === "after_production" ? <div className="md:col-span-2"><div className="text-xs font-semibold text-text-muted">Production Evidence</div><div className="mt-1 font-bold text-text-primary">{productionLabel(occurrence)}</div><div className="text-xs text-text-secondary">{occurrence.production_snapshot?.production_no || ""}{occurrence.production_snapshot?.sop_version ? ` · SOP ${occurrence.production_snapshot.sop_version}` : ""}{occurrence.production_snapshot?.completed_at ? ` · ${formatFactoryDateTime(occurrence.production_snapshot.completed_at)}` : ""}</div></div> : null}
      <div><div className="text-xs font-semibold text-text-muted">Completed By</div><div className="mt-1 font-bold text-text-primary">{occurrence.completed_by_name || "-"}</div>{occurrence.completed_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.completed_at)}</div> : null}</div>
      <div><div className="text-xs font-semibold text-text-muted">Verified By</div><div className="mt-1 font-bold text-text-primary">{occurrence.verified_by_name || "-"}</div>{occurrence.verified_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.verified_at)}</div> : null}</div>
    </div>
  </Modal>;
}

function MonthlyCellDetail({ cell, equipment, onClose, onOpenOccurrence }) {
  if (!cell || !equipment) return null;
  return <Modal title={`${equipment.equipment_code} · ${formatFactoryDate(cell.due_date)}`} description={equipment.location_name || ""} onClose={onClose} size="lg">
    <div className="divide-y divide-border">
      {(cell.occurrences || []).map((occurrence) => <button key={occurrence.id} className="flex w-full items-center justify-between gap-4 py-3 text-left first:pt-0 last:pb-0 hover:bg-slate-50" type="button" onClick={() => onOpenOccurrence(occurrence)}>
        <span className="min-w-0"><span className="block font-bold text-text-primary">{occurrence.task_name}</span><span className="mt-0.5 block truncate text-xs text-text-secondary">{recurrenceLabel(occurrence)}{occurrence.source_type === "after_production" ? ` · ${productionLabel(occurrence)}` : ""}</span>{occurrence.source_type === "after_production" && occurrence.production_snapshot?.sop_version ? <span className="mt-0.5 block text-xs text-text-muted">{occurrence.production_snapshot.production_no || ""} · SOP {occurrence.production_snapshot.sop_version}</span> : null}</span>
        <span className="flex shrink-0 items-center gap-2"><StatusBadge status={occurrence.status} /><ChevronRight size={16} className="text-text-muted" /></span>
      </button>)}
    </div>
  </Modal>;
}

export default function FactoryMestiEquipmentCleaningPage({ auth, onNotify }) {
  const masterData = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const [activeTab, setActiveTab] = useState("daily");
  const [date, setDate] = useState(malaysiaBusinessDateInput());
  const [month, setMonth] = useState(currentMonthInput());
  const [dailyRows, setDailyRows] = useState([]);
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [requirements, setRequirements] = useState(masterData.mestiEquipmentCleaningRequirements || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [monthlyDetail, setMonthlyDetail] = useState(null);
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [requirementDraft, setRequirementDraft] = useState(emptyRequirementDraft());
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [monthFilters, setMonthFilters] = useState({ query: "", location: "", status: "" });
  const activeEquipment = (masterData.equipment || []).filter((equipment) => equipment.status === "active");
  const currentEmployeeId = auth?.profile?.id || "";
  const canManage = can("factory_mesti_equipment_cleaning.manage");
  const canSaveSetup = canManage || can("factory_mesti_equipment_cleaning.create") || can("factory_mesti_equipment_cleaning.edit");

  useEffect(() => setRequirements(masterData.mestiEquipmentCleaningRequirements || []), [masterData.mestiEquipmentCleaningRequirements]);
  const loadDaily = useCallback(async () => {
    setLoading(true); setError("");
    try { setDailyRows(await factoryService.listMestiEquipmentCleaningDay(date)); }
    catch (loadError) { setError(loadError.message || "Unable to load Cleaning of Equipment."); }
    finally { setLoading(false); }
  }, [date]);
  const loadMonthly = useCallback(async () => {
    setLoading(true); setError("");
    try { setMonthlyRows(await factoryService.listMestiEquipmentCleaningMonth(month)); }
    catch (loadError) { setError(loadError.message || "Unable to load monthly Cleaning of Equipment."); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { if (activeTab === "daily") loadDaily(); }, [activeTab, loadDaily]);
  useEffect(() => { if (activeTab === "monthly") loadMonthly(); }, [activeTab, loadMonthly]);

  const groups = useMemo(() => [...dailyRows.reduce((map, row) => {
    const key = row.equipment_id || row.equipment_code || "equipment";
    const group = map.get(key) || { key, equipment_code: row.equipment_code || "Equipment", equipment_name: row.equipment_name || "", location_name: row.location_name || "", rows: [] };
    group.rows.push(row); map.set(key, group); return map;
  }, new Map()).values()], [dailyRows]);
  const summary = useMemo(() => ({ due: dailyRows.length, pending: dailyRows.filter((row) => row.status === "pending").length, awaiting: dailyRows.filter((row) => row.status === "completed").length, issues: dailyRows.filter((row) => row.status === "unsatisfactory" || row.status === "missed").length }), [dailyRows]);
  const monthLocations = useMemo(() => [...new Set(monthlyRows.map((row) => row.location_name).filter(Boolean))].sort(), [monthlyRows]);
  const visibleMonthlyRows = useMemo(() => monthlyRows.filter((row) => {
    const searchable = `${row.equipment_code} ${row.equipment_name} ${row.location_name}`.toLowerCase();
    const visibleDays = (row.days || []).flatMap((cell) => cell.occurrences || []);
    return (!monthFilters.query || searchable.includes(monthFilters.query.toLowerCase())) && (!monthFilters.location || row.location_name === monthFilters.location) && (!monthFilters.status || visibleDays.some((occurrence) => occurrenceMatchesStatus(occurrence, monthFilters.status)));
  }), [monthFilters, monthlyRows]);
  const visibleEquipment = useMemo(() => activeEquipment.filter((equipment) => `${equipment.equipment_code || ""} ${equipment.name || ""} ${equipment.category?.name || equipment.category_name || ""} ${equipment.location?.location_name || ""}`.toLowerCase().includes(equipmentQuery.toLowerCase())), [activeEquipment, equipmentQuery]);

  async function act(action, occurrence, result) {
    try {
      if (action === "complete") await factoryService.completeMestiEquipmentCleaningOccurrence(occurrence.id);
      else await factoryService.verifyMestiEquipmentCleaningOccurrence(occurrence.id, result);
      onNotify?.({ title: "Equipment cleaning updated", message: "The occurrence status was updated.", tone: "success" });
      await loadDaily();
      if (activeTab === "monthly") await loadMonthly();
    } catch (actionError) { onNotify?.({ title: "Equipment cleaning update failed", message: actionError.message || "Unable to update the occurrence.", tone: "error" }); }
  }
  function toggleEquipment(equipmentId, checked) {
    setRequirementDraft((current) => ({ ...current, equipment_ids: checked ? [...new Set([...current.equipment_ids, equipmentId])] : current.equipment_ids.filter((id) => id !== equipmentId) }));
  }
  function editRequirement(requirement) {
    setEquipmentQuery("");
    setRequirementDraft({ ...emptyRequirementDraft(), ...requirement, equipment_ids: requirement.equipment_ids || [], recurrence_weekdays: requirement.recurrence_weekdays || [] });
    setShowRequirementForm(true);
  }
  async function saveRequirement(event) {
    event.preventDefault();
    try {
      const saved = await factoryService.saveMestiEquipmentCleaningRequirement(requirementDraft);
      setRequirements((current) => [saved, ...current.filter((requirement) => requirement.logical_requirement_id !== saved.logical_requirement_id)]);
      setShowRequirementForm(false); setRequirementDraft(emptyRequirementDraft()); await loadDaily(); if (activeTab === "monthly") await loadMonthly();
    } catch (saveError) { onNotify?.({ title: "Requirement save failed", message: saveError.message || "Unable to save Equipment Cleaning Requirement.", tone: "error" }); }
  }

  return <div className="space-y-5">
    <PageHeader title="Cleaning of Equipment" description="" actions={<button className="btn-secondary" type="button" onClick={() => activeTab === "monthly" ? loadMonthly() : loadDaily()}><RefreshCw size={16} />Refresh</button>} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border" role="tablist"><div className="flex gap-2">{["daily", "monthly", "setup"].map((tab) => <button key={tab} className={`border-b-2 px-3 py-2 text-sm font-bold capitalize ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-text-secondary"}`} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>{activeTab === "daily" ? <div className="pb-2"><FeedXDatePicker value={date} onChange={setDate} /></div> : null}</div>
    {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    {activeTab === "daily" ? <><div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-white px-4 py-3 text-sm"><span className="font-bold text-text-primary">{summary.due} Due</span><span className="text-amber-800">{summary.pending} Pending</span><span className="text-sky-700">{summary.awaiting} Awaiting Verification</span><span className={summary.issues ? "text-rose-700" : "text-text-secondary"}>{summary.issues} Issues</span></div>{loading ? <div className="py-12 text-center text-sm font-semibold text-text-secondary">Loading Cleaning of Equipment...</div> : groups.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">{groups.map((group) => <section key={group.key}><div className="flex items-baseline justify-between gap-3 px-4 py-3"><div><div className="font-bold text-text-primary">{[group.equipment_code, group.equipment_name].filter(Boolean).join(" · ")}</div><div className="text-xs text-text-secondary">{group.location_name || "No location"}</div></div><span className="text-xs font-semibold text-text-muted">{group.rows.length} obligation{group.rows.length === 1 ? "" : "s"}</span></div><div className="divide-y divide-border/80">{group.rows.map((row) => <div key={row.id} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5 hover:bg-slate-50"><button className="min-w-0 flex-1 text-left" type="button" onClick={() => setDetail(row)}><span className="block font-semibold text-text-primary">{row.task_name}</span><span className="mt-0.5 block truncate text-xs text-text-secondary">{recurrenceLabel(row)}{row.source_type === "after_production" ? ` · ${productionLabel(row)}` : ""}</span></button><StatusBadge status={row.status} /><div className="flex shrink-0 items-center gap-2">{(row.status === "pending" || row.status === "missed" || row.status === "unsatisfactory") && (can("factory_mesti_equipment_cleaning.complete") || canManage) ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => act("complete", row)}>Complete</button> : null}{row.status === "completed" && row.completed_by !== currentEmployeeId && (can("factory_mesti_equipment_cleaning.review") || canManage) ? <><button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => act("verify", row, "verified")}><Check size={14} />Verify</button><button className="btn-danger px-3 py-1.5 text-xs" type="button" onClick={() => act("verify", row, "unsatisfactory")}>Unsatisfactory</button></> : null}<button className="icon-btn h-8 w-8" type="button" aria-label={`View ${row.task_name} details`} onClick={() => setDetail(row)}><ChevronRight size={16} /></button></div></div>)}</div></section>)}</div> : <EmptyState title="No equipment cleaning due" description="" />}</> : null}
    {activeTab === "monthly" ? <><div className="grid gap-3 rounded-xl border border-border bg-white p-3 md:grid-cols-[minmax(160px,0.7fr)_minmax(200px,1fr)_minmax(170px,0.7fr)_minmax(180px,0.7fr)]"><Field label="Month"><input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field><Field label="Equipment"><div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input className={`${inputClass} pl-9`} value={monthFilters.query} placeholder="Search equipment" onChange={(event) => setMonthFilters((current) => ({ ...current, query: event.target.value }))} /></div></Field><Field label="Location"><SearchableSelect value={monthFilters.location} options={[{ value: "", label: "All locations" }, ...monthLocations.map((location) => ({ value: location, label: location }))]} onChange={(location) => setMonthFilters((current) => ({ ...current, location }))} /></Field><Field label="Status"><SearchableSelect value={monthFilters.status} options={monthStatusOptions} onChange={(status) => setMonthFilters((current) => ({ ...current, status }))} /></Field></div>{loading ? <div className="py-12 text-center text-sm font-semibold text-text-secondary">Loading monthly compliance...</div> : <div className="overflow-x-auto rounded-xl border border-border bg-white"><table className="min-w-[1120px] border-collapse text-sm"><thead><tr className="border-b border-border bg-slate-50 text-left text-xs font-semibold text-text-muted"><th className="sticky left-0 z-10 min-w-64 bg-slate-50 px-4 py-2.5">Equipment</th>{monthDays(month).map((day) => <th key={day} className="w-9 min-w-9 px-0.5 py-2.5 text-center">{Number(day.slice(-2))}</th>)}</tr></thead><tbody>{visibleMonthlyRows.map((row) => { const byDate = new Map(row.days.map((day) => [day.due_date, day])); const summary = row.summary || {}; return <tr key={row.equipment_id} className="border-b border-border last:border-0"><td className="sticky left-0 z-10 bg-white px-4 py-3"><div className="font-bold text-text-primary">{[row.equipment_code, row.equipment_name].filter(Boolean).join(" · ")}</div><div className="mt-0.5 text-xs text-text-secondary">{row.location_name || "No location"}</div><div className="mt-1 text-xs font-semibold text-text-muted">{summary.total_count} cleanings · {summary.verified_count} verified · {summary.pending_count} pending</div></td>{monthDays(month).map((day) => { const cell = byDate.get(day); return <td key={day} className="p-0.5 text-center">{cell ? <button className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-bold ${cellClassName(cell.status)}`} title={`${cell.total_count} obligation${cell.total_count === 1 ? "" : "s"}: ${cell.verified_count} verified, ${cell.completed_count} awaiting verification, ${cell.pending_count} pending`} aria-label={`${row.equipment_code} on ${formatFactoryDate(day)}: ${cell.total_count} obligations`} type="button" onClick={() => setMonthlyDetail({ equipment: row, cell })}>{cellLabel(cell)}</button> : null}</td>; })}</tr>; })}</tbody></table>{!visibleMonthlyRows.length ? <EmptyState title="No monthly cleaning occurrences" description="" /> : null}</div>}</> : null}
    {activeTab === "setup" ? <><div className="flex justify-end">{canSaveSetup ? <button className="btn-primary" type="button" onClick={() => { setEquipmentQuery(""); setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(true); }}><Plus size={16} />Create Requirement</button> : null}</div><div className="overflow-hidden rounded-xl border border-border bg-white"><div className="border-b border-border px-4 py-3"><div className="font-bold text-text-primary">Scheduled Cleaning Requirements</div><div className="mt-0.5 text-sm text-text-secondary">After Production obligations are created from completed Production SOPs.</div></div><FactoryTable rows={requirements} emptyTitle="No scheduled cleaning requirements" columns={[{ key: "task", label: "Task", render: (row) => <div className="font-bold text-text-primary">{row.task_name}</div> }, { key: "equipment", label: "Equipment", render: (row) => <span className="font-semibold text-text-secondary" title={(row.equipment_names || []).join(", ")}>{(row.equipment_ids || []).length} equipment{(row.equipment_ids || []).length === 1 ? "" : "s"}</span> }, { key: "recurrence", label: "Frequency", render: (row) => recurrenceLabel(row).replace("Scheduled · ", "") }, { key: "effective", label: "Effective From", render: (row) => formatFactoryDate(row.effective_from) }, { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> }, { key: "actions", label: "Actions", align: "right", render: (row) => canSaveSetup ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => editRequirement(row)}>Edit</button> : null }]} /></div></> : null}
    {showRequirementForm ? <Modal title={requirementDraft.id ? "Edit Cleaning Requirement" : "Create Cleaning Requirement"} onClose={() => setShowRequirementForm(false)} size="lg" footer={<><button className="btn-secondary" type="button" onClick={() => setShowRequirementForm(false)}>Cancel</button><button className="btn-primary" type="submit" form="equipment-cleaning-requirement">{requirementDraft.id ? "Save Changes" : "Create Requirement"}</button></>}><form id="equipment-cleaning-requirement" className="space-y-5" onSubmit={saveRequirement}><section className="space-y-3"><h3 className="text-sm font-bold text-text-primary">Cleaning Rule</h3><div className="grid gap-3 md:grid-cols-2"><Field label="Task Name"><input className={inputClass} value={requirementDraft.task_name} onChange={(event) => setRequirementDraft((current) => ({ ...current, task_name: event.target.value }))} required /></Field><Field label="Effective From"><FeedXDatePicker value={requirementDraft.effective_from} onChange={(value) => setRequirementDraft((current) => ({ ...current, effective_from: value }))} /></Field><Field label="Frequency"><select className={inputClass} value={requirementDraft.recurrence_type} onChange={(event) => setRequirementDraft((current) => ({ ...current, recurrence_type: event.target.value }))}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>{requirementDraft.id ? <Field label="Status"><select className={inputClass} value={requirementDraft.status} onChange={(event) => setRequirementDraft((current) => ({ ...current, status: event.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field> : null}</div>{requirementDraft.recurrence_type === "weekly" ? <div><div className="mb-2 text-sm font-bold text-text-primary">Weekdays</div><div className="flex flex-wrap gap-2">{weekdays.map((day) => <label key={day.value} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={requirementDraft.recurrence_weekdays.includes(day.value)} onChange={(event) => setRequirementDraft((current) => ({ ...current, recurrence_weekdays: event.target.checked ? [...new Set([...current.recurrence_weekdays, day.value])] : current.recurrence_weekdays.filter((value) => value !== day.value) }))} />{day.label}</label>)}</div></div> : null}</section><section className="border-t border-border pt-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-bold text-text-primary">Applies to Equipment</h3><span className="text-xs font-semibold text-text-secondary">{requirementDraft.equipment_ids.length} equipment selected</span></div><div className="relative mt-3"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input className={`${inputClass} pl-9`} value={equipmentQuery} onChange={(event) => setEquipmentQuery(event.target.value)} placeholder="Search equipment, category, or location" /></div><div className="mt-3 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">{visibleEquipment.map((equipment) => <label key={equipment.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50"><input aria-label={`${equipment.equipment_code} ${equipment.name}`} type="checkbox" checked={requirementDraft.equipment_ids.includes(equipment.id)} onChange={(event) => toggleEquipment(equipment.id, event.target.checked)} /><span className="min-w-0"><span className="block font-bold text-text-primary">{equipment.equipment_code} · {equipment.name}</span><span className="block text-xs text-text-secondary">{equipment.category?.name || equipment.category_name || "Uncategorized"} · {equipment.location?.location_name || "No location"}</span></span></label>)}{!visibleEquipment.length ? <div className="px-3 py-5 text-sm font-semibold text-text-secondary">No matching active Equipment.</div> : null}</div></section></form></Modal> : null}
    <MonthlyCellDetail cell={monthlyDetail?.cell} equipment={monthlyDetail?.equipment} onClose={() => setMonthlyDetail(null)} onOpenOccurrence={(occurrence) => { setMonthlyDetail(null); setDetail(occurrence); }} />
    <OccurrenceDetail occurrence={detail} onClose={() => setDetail(null)} />
  </div>;
}
