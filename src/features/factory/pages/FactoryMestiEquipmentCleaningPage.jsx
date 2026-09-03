import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ClipboardCheck, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { factoryMonthLabel, formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

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

function currentMonthInput() { return malaysiaBusinessDateInput().slice(0, 7); }
function monthDays(month) {
  const [year, zeroMonth] = month.split("-").map(Number);
  return Array.from({ length: new Date(year, zeroMonth, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
function recurrenceLabel(row) {
  if (row.source_type === "after_production") return "After Production";
  if (row.recurrence_type === "daily") return "Daily";
  const labels = (row.recurrence_weekdays || []).map((day) => weekdays.find((item) => item.value === Number(day))?.label).filter(Boolean);
  return `Weekly · ${labels.join(", ") || "Selected days"}`;
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
  return [production.product_name, production.batch_no].filter(Boolean).join(" · ") || "Production usage";
}
function monthlyCellLabel(cell) {
  if (cell.status === "mixed" || cell.source_type === "after_production") return `${cell.verified_count}/${cell.total_count}`;
  if (cell.status === "verified") return "V";
  if (cell.status === "completed") return "C";
  if (cell.status === "unsatisfactory") return "U";
  if (cell.status === "missed") return "M";
  return "P";
}

function OccurrenceDetail({ occurrence, onClose }) {
  if (!occurrence) return null;
  return <Modal title={`${occurrence.equipment_code} · ${occurrence.task_name}`} onClose={onClose} size="lg">
    <div className="grid gap-4 p-5 text-sm md:grid-cols-2">
      <div><div className="text-xs font-semibold text-text-muted">Status</div><div className="mt-1"><StatusBadge status={occurrence.status} /></div></div>
      <div><div className="text-xs font-semibold text-text-muted">Source</div><div className="mt-1 font-bold text-text-primary">{recurrenceLabel(occurrence)}</div></div>
      <div><div className="text-xs font-semibold text-text-muted">Equipment</div><div className="mt-1 font-bold text-text-primary">{[occurrence.equipment_code, occurrence.equipment_name].filter(Boolean).join(" · ")}</div><div className="text-xs text-text-secondary">{occurrence.location_name || "-"}</div></div>
      <div><div className="text-xs font-semibold text-text-muted">Due</div><div className="mt-1 font-bold text-text-primary">{formatFactoryDate(occurrence.due_date)}</div></div>
      {occurrence.source_type === "after_production" ? <div className="md:col-span-2"><div className="text-xs font-semibold text-text-muted">Production Evidence</div><div className="mt-1 font-bold text-text-primary">{productionLabel(occurrence)}</div><div className="text-xs text-text-secondary">{occurrence.production_snapshot?.completed_at ? formatFactoryDateTime(occurrence.production_snapshot.completed_at) : ""}</div></div> : null}
      <div><div className="text-xs font-semibold text-text-muted">Completed By</div><div className="mt-1 font-bold text-text-primary">{occurrence.completed_by_name || "-"}</div>{occurrence.completed_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.completed_at)}</div> : null}</div>
      <div><div className="text-xs font-semibold text-text-muted">Verified By</div><div className="mt-1 font-bold text-text-primary">{occurrence.verified_by_name || "-"}</div>{occurrence.verified_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.verified_at)}</div> : null}</div>
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
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [requirementDraft, setRequirementDraft] = useState(emptyRequirementDraft());
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
  const summary = useMemo(() => ({ pending: dailyRows.filter((row) => row.status === "pending").length, awaiting: dailyRows.filter((row) => row.status === "completed").length, verified: dailyRows.filter((row) => row.status === "verified").length }), [dailyRows]);

  async function act(action, occurrence, result) {
    try {
      if (action === "complete") await factoryService.completeMestiEquipmentCleaningOccurrence(occurrence.id);
      else await factoryService.verifyMestiEquipmentCleaningOccurrence(occurrence.id, result);
      onNotify?.({ title: "Equipment cleaning updated", message: "The occurrence status was updated.", tone: "success" });
      await loadDaily(); if (activeTab === "monthly") await loadMonthly();
    } catch (actionError) { onNotify?.({ title: "Equipment cleaning update failed", message: actionError.message || "Unable to update the occurrence.", tone: "error" }); }
  }
  function toggleEquipment(equipmentId, checked) {
    setRequirementDraft((current) => ({ ...current, equipment_ids: checked ? [...new Set([...current.equipment_ids, equipmentId])] : current.equipment_ids.filter((id) => id !== equipmentId) }));
  }
  function editRequirement(requirement) {
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
    <div className="flex flex-wrap gap-2 border-b border-border" role="tablist">{["daily", "monthly", "setup"].map((tab) => <button key={tab} className={`border-b-2 px-3 py-2 text-sm font-bold capitalize ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-text-secondary"}`} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>
    {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    {activeTab === "daily" ? <>
      <div className="flex flex-wrap items-end justify-between gap-3"><Field label="Due Date"><FeedXDatePicker value={date} onChange={setDate} /></Field><div className="flex gap-3"><MetricCard label="Pending" value={summary.pending} /><MetricCard label="Awaiting Verification" value={summary.awaiting} /><MetricCard label="Verified" value={summary.verified} /></div></div>
      {loading ? <div className="py-12 text-center text-sm font-semibold text-text-secondary">Loading Cleaning of Equipment...</div> : groups.length ? groups.map((group) => <Card key={group.key} title={[group.equipment_code, group.equipment_name].filter(Boolean).join(" · ")} description={group.location_name}>
        <FactoryTable rows={group.rows} columns={[
          { key: "task", label: "Task", render: (row) => <div><div className="font-bold text-text-primary">{row.task_name}</div><div className="text-xs text-text-secondary">{recurrenceLabel(row)}{row.source_type === "after_production" ? ` · ${productionLabel(row)}` : ""}</div></div> },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "evidence", label: "Audit", render: (row) => <button className="btn-ghost text-xs" type="button" onClick={() => setDetail(row)}>Details</button> },
          { key: "actions", label: "Actions", render: (row) => <div className="flex flex-wrap gap-2">{row.status === "pending" || row.status === "missed" || row.status === "unsatisfactory" ? (can("factory_mesti_equipment_cleaning.complete") || canManage ? <button className="btn-secondary" type="button" onClick={() => act("complete", row)}>Complete</button> : null) : null}{row.status === "completed" && row.completed_by !== currentEmployeeId && (can("factory_mesti_equipment_cleaning.review") || canManage) ? <><button className="btn-secondary" type="button" onClick={() => act("verify", row, "verified")}><Check size={15} />Verify</button><button className="btn-danger" type="button" onClick={() => act("verify", row, "unsatisfactory")}>Unsatisfactory</button></> : null}</div> },
        ]} />
      </Card>) : <EmptyState title="No equipment cleaning due" description="" />}
    </> : null}
    {activeTab === "monthly" ? <>
      <Field label="Month"><input className={inputClass} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field>
      {loading ? <div className="py-12 text-center text-sm font-semibold text-text-secondary">Loading monthly compliance...</div> : <div className="overflow-x-auto"><table className="min-w-full border-collapse text-sm"><thead><tr className="border-b border-border text-left text-xs text-text-muted"><th className="sticky left-0 bg-surface px-3 py-2">Requirement</th>{monthDays(month).map((day) => <th key={day} className="px-1 py-2 text-center">{Number(day.slice(-2))}</th>)}</tr></thead><tbody>{monthlyRows.map((row) => { const byDate = new Map(row.days.map((day) => [day.due_date, day])); return <tr key={row.logical_requirement_id} className="border-b border-border"><td className="sticky left-0 bg-surface px-3 py-3"><div className="font-bold text-text-primary">{row.task_name}</div><div className="text-xs text-text-secondary">{recurrenceLabel(row)}</div></td>{monthDays(month).map((day) => { const cell = byDate.get(day); return <td key={day} className="p-1 text-center">{cell ? <button className={`h-8 min-w-8 rounded border px-1 text-xs font-bold ${cell.status === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-surface text-text-secondary"}`} title={`${cell.verified_count} of ${cell.total_count} verified`} type="button" onClick={() => setDetail(cell.occurrences?.[0] || null)}>{monthlyCellLabel({ ...cell, source_type: row.source_type })}</button> : null}</td>; })}</tr>; })}</tbody></table>{!monthlyRows.length ? <EmptyState title="No monthly cleaning occurrences" description="" /> : null}</div>}
    </> : null}
    {activeTab === "setup" ? <>
      <div className="flex justify-end">{canSaveSetup ? <button className="btn-primary" type="button" onClick={() => { setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(true); }}><Plus size={16} />Create Requirement</button> : null}</div>
      <Card title="Cleaning Requirements" description=""><FactoryTable rows={requirements} columns={[
        { key: "task", label: "Task", render: (row) => <div className="font-bold text-text-primary">{row.task_name}</div> },
        { key: "equipment", label: "Equipment", render: (row) => <div className="text-sm font-semibold text-text-secondary">{(row.equipment_names || []).join(", ")}</div> },
        { key: "recurrence", label: "Recurrence", render: (row) => recurrenceLabel(row) },
        { key: "effective", label: "Effective From", render: (row) => formatFactoryDate(row.effective_from) },
        { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
        { key: "actions", label: "Actions", render: (row) => canSaveSetup ? <button className="btn-secondary" type="button" onClick={() => editRequirement(row)}>Edit</button> : null },
      ]} /></Card>
    </> : null}
    {showRequirementForm ? <Modal title={requirementDraft.id ? "Edit Cleaning Requirement" : "Create Cleaning Requirement"} onClose={() => setShowRequirementForm(false)} size="xl"><form className="space-y-5 p-5" onSubmit={saveRequirement}>
      <div className="grid gap-4 md:grid-cols-2"><Field label="Task Name"><input className={inputClass} value={requirementDraft.task_name} onChange={(event) => setRequirementDraft((current) => ({ ...current, task_name: event.target.value }))} required /></Field><Field label="Effective From"><FeedXDatePicker value={requirementDraft.effective_from} onChange={(value) => setRequirementDraft((current) => ({ ...current, effective_from: value }))} /></Field></div>
      <Field label="Frequency"><select className={inputClass} value={requirementDraft.recurrence_type} onChange={(event) => setRequirementDraft((current) => ({ ...current, recurrence_type: event.target.value }))}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>{requirementDraft.recurrence_type === "weekly" ? <div><div className="mb-2 text-sm font-bold text-text-primary">Weekdays</div><div className="flex flex-wrap gap-2">{weekdays.map((day) => <label key={day.value} className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={requirementDraft.recurrence_weekdays.includes(day.value)} onChange={(event) => setRequirementDraft((current) => ({ ...current, recurrence_weekdays: event.target.checked ? [...new Set([...current.recurrence_weekdays, day.value])] : current.recurrence_weekdays.filter((value) => value !== day.value) }))} />{day.label}</label>)}</div></div> : null}
      <div><div className="mb-2 text-sm font-bold text-text-primary">Equipment</div><div className="grid gap-2 md:grid-cols-2">{activeEquipment.map((equipment) => <label key={equipment.id} className="flex items-center gap-3 rounded border border-border px-3 py-2 text-sm"><input aria-label={`${equipment.equipment_code} ${equipment.name}`} type="checkbox" checked={requirementDraft.equipment_ids.includes(equipment.id)} onChange={(event) => toggleEquipment(equipment.id, event.target.checked)} /><span><span className="font-bold text-text-primary">{equipment.equipment_code} · {equipment.name}</span><span className="block text-xs text-text-secondary">{equipment.location?.location_name || ""}</span></span></label>)}</div></div>
      <div className="flex justify-end gap-2 border-t border-border pt-4"><button className="btn-secondary" type="button" onClick={() => setShowRequirementForm(false)}>Cancel</button><button className="btn-primary" type="submit">Save Requirement</button></div>
    </form></Modal> : null}
    <OccurrenceDetail occurrence={detail} onClose={() => setDetail(null)} />
  </div>;
}
