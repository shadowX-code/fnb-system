import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ClipboardCheck, Plus, ShieldCheck, XCircle } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryComplianceMatrix from "../components/FactoryComplianceMatrix.jsx";
import FactoryDailyToolbar, { FactoryDailyDateField } from "../components/FactoryDailyToolbar.jsx";
import FactoryMonthPicker from "../components/FactoryMonthPicker.jsx";
import FactoryOperationalGroup, { FactoryOperationalEvidence, FactoryOperationalRow } from "../components/FactoryOperationalGroup.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FactoryViewTabs from "../components/FactoryViewTabs.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryLatestRequest from "../hooks/useFactoryLatestRequest.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const tabs = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "setup", label: "Setup" },
];
const weekdays = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" }, { value: 4, label: "Thu" },
  { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 7, label: "Sun" },
];
const statusMeta = {
  pending: { label: "Pending", tone: "warning" },
  completed: { label: "Awaiting Verification", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  unsatisfactory: { label: "Unsatisfactory", tone: "danger" },
  missed: { label: "Missed", tone: "danger" },
};

function recurrenceLabel(row) {
  if (row.recurrence_type === "daily") return "Daily";
  const labels = (row.recurrence_weekdays || []).map((day) => weekdays.find((item) => item.value === Number(day))?.label).filter(Boolean);
  return `Weekly · ${labels.join(", ") || "Selected days"}`;
}

function StatusBadge({ status, variant = "compact" }) {
  const meta = statusMeta[status] || { label: status || "Pending", tone: "neutral" };
  return <FactoryStatusBadge tone={meta.tone} variant={variant}>{meta.label}</FactoryStatusBadge>;
}

function currentMonthInput() { return malaysiaBusinessDateInput().slice(0, 7); }
function monthDays(month) {
  const [year, zeroMonth] = month.split("-").map(Number);
  return Array.from({ length: new Date(year, zeroMonth, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
function groupByLocation(rows) {
  return rows.reduce((groups, row) => {
    const key = row.location_id || row.location_name || "location";
    const group = groups.get(key) || { id: key, location_name: row.location_name || "Location", rows: [] };
    group.rows.push(row);
    groups.set(key, group);
    return groups;
  }, new Map());
}
function emptyRequirementDraft() {
  return { task_name: "", location_ids: [], recurrence_type: "daily", recurrence_weekdays: [1], status: "active", effective_from: malaysiaBusinessDateInput() };
}
function monthlyCellLabel(cell) {
  if (cell.status === "mixed") return `${cell.verified_count}/${cell.total_count}`;
  if (cell.status === "verified") return "OK";
  if (cell.status === "completed") return "Await";
  if (cell.status === "unsatisfactory") return "Fail";
  if (cell.status === "missed") return "Missed";
  return "Due";
}
function monthlyCellTitle(cell, row) {
  const summary = cell.status === "mixed" ? `${cell.verified_count} of ${cell.total_count} verified` : statusMeta[cell.status]?.label || "Pending";
  return `${row.task_name} · ${formatFactoryDate(cell.due_date)} · ${summary}`;
}

function MonthlyEvidenceRows({ detail, canComplete, canVerify, onAct }) {
  if (!detail) return null;
  return <div className="border border-border bg-surface" aria-label="Location occurrence evidence"><div className="border-b border-border px-3 py-2 text-xs font-semibold text-text-secondary">Location occurrence evidence · {detail.task_name} · {formatFactoryDate(detail.due_date)}</div><FactoryTable rows={detail.occurrences || []} columns={[
      { key: "location", label: "Location", render: (row) => <div className="font-semibold text-text-primary">{row.location_name}</div> },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "completed", label: "Completed", render: (row) => row.completed_at ? <div><div className="font-semibold">{row.completed_by_name || "Completed"}</div><div className="text-xs text-text-secondary">{formatFactoryDateTime(row.completed_at)}</div></div> : "—" },
      { key: "verified", label: "Verified", render: (row) => row.verified_at ? <div><div className="font-semibold">{row.verified_by_name || "Verified"}</div><div className="text-xs text-text-secondary">{formatFactoryDateTime(row.verified_at)}</div></div> : "—" },
      { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions primaryAction={canComplete(row) ? { label: "Complete", icon: Check, onClick: () => onAct("complete", row) } : canVerify(row) ? { label: "Verify", icon: Check, onClick: () => onAct("verify", row, "verified") } : { label: "View", onClick: () => onAct("view", row) }} /> },
    ]} /></div>;
}

function OccurrenceDetail({ occurrence, onClose }) {
  if (!occurrence) return null;
  return <Modal title={`${occurrence.task_name} · ${occurrence.location_name}`} description={formatFactoryDate(occurrence.due_date)} onClose={onClose}>
    <div className="grid gap-x-6 md:grid-cols-2">
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Status</div><div className="mt-1"><StatusBadge status={occurrence.status} /></div></div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Schedule</div><div className="mt-1 text-sm font-semibold text-text-primary">{recurrenceLabel(occurrence)}</div></div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Completed</div><div className="mt-1 text-sm font-semibold text-text-primary">{occurrence.completed_by_name || "—"}</div>{occurrence.completed_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.completed_at)}</div> : null}</div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Verified</div><div className="mt-1 text-sm font-semibold text-text-primary">{occurrence.verified_by_name || "—"}</div>{occurrence.verified_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.verified_at)}</div> : null}</div>
    </div>
  </Modal>;
}

function RequirementModal({ open, draft, locations, onClose, onSave, onChange, onToggleLocation }) {
  if (!open) return null;
  return <Modal open={open} onClose={onClose} title={draft.id ? "Edit Cleaning Requirement" : "Create Cleaning Requirement"} description="Requirements remain versioned and only meaningful edits create a new version." footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" form="area-cleaning-requirement" type="submit">Save Requirement</button></>}>
    <form id="area-cleaning-requirement" className="grid gap-4 p-5 md:grid-cols-2" onSubmit={onSave}>
      <Field label="Task Name"><input className={inputClass()} value={draft.task_name} onChange={(event) => onChange("task_name", event.target.value)} placeholder="Floor, Ceiling, Drain" required /></Field>
      <Field label="Frequency"><SearchableSelect value={draft.recurrence_type} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} onChange={(value) => onChange("recurrence_type", value)} /></Field>
      <Field label="Effective From"><FeedXDatePicker value={draft.effective_from} onChange={(value) => onChange("effective_from", value)} /></Field>
      <Field label="Status"><SearchableSelect value={draft.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(value) => onChange("status", value)} /></Field>
      {draft.recurrence_type === "weekly" ? <div className="md:col-span-2"><div className="mb-2 text-xs font-semibold text-text-muted">Weekdays</div><div className="flex flex-wrap gap-2">{weekdays.map((day) => <label key={day.value} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={(draft.recurrence_weekdays || []).includes(day.value)} onChange={(event) => onChange("recurrence_weekdays", event.target.checked ? [...new Set([...(draft.recurrence_weekdays || []), day.value])] : (draft.recurrence_weekdays || []).filter((value) => value !== day.value))} />{day.label}</label>)}</div></div> : null}
      <div className="md:col-span-2"><div className="mb-2 text-xs font-semibold text-text-muted">Locations</div><div className="grid gap-2 sm:grid-cols-2">{locations.map((location) => <label key={location.id} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-text-primary"><input type="checkbox" checked={(draft.location_ids || []).includes(location.id)} onChange={(event) => onToggleLocation(location.id, event.target.checked)} />{location.location_name}</label>)}</div></div>
    </form>
  </Modal>;
}

export default function FactoryMestiCleaningPage({ auth, onNotify }) {
  const masterData = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const [activeTab, setActiveTab] = useState("daily");
  const [date, setDate] = useState(malaysiaBusinessDateInput());
  const [month, setMonth] = useState(currentMonthInput());
  const [dailyRows, setDailyRows] = useState([]);
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [requirements, setRequirements] = useState(masterData.mestiCleaningRequirements || []);
  const [loading, setLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [error, setError] = useState("");
  const [monthlyDetailKey, setMonthlyDetailKey] = useState("");
  const [occurrenceDetail, setOccurrenceDetail] = useState(null);
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [requirementDraft, setRequirementDraft] = useState(emptyRequirementDraft());
  const runLatestRequest = useFactoryLatestRequest();
  const activeLocations = (masterData.storageLocations || []).filter((location) => location.status === "active");
  const canManage = can("factory_mesti_cleaning.manage");
  const canSaveSetup = canManage || can("factory_mesti_cleaning.create") || can("factory_mesti_cleaning.edit");

  useEffect(() => setRequirements(masterData.mestiCleaningRequirements || []), [masterData.mestiCleaningRequirements]);
  const loadDaily = useCallback(() => runLatestRequest(
    () => factoryService.listMestiCleaningDay(date),
    { onStart: () => { setLoading(true); setError(""); }, onSuccess: setDailyRows, onError: (loadError) => { console.error("[Factory] Unable to load MeSTI Cleaning day.", loadError); setError(loadError.message || "Unable to load Cleaning of Area."); }, onFinally: () => setLoading(false) },
  ), [date, runLatestRequest]);
  const loadMonthly = useCallback(() => runLatestRequest(
    () => factoryService.listMestiCleaningMonth(month),
    { onStart: () => { setMonthLoading(true); setError(""); }, onSuccess: setMonthlyRows, onError: (loadError) => { console.error("[Factory] Unable to load MeSTI Cleaning month.", loadError); setError(loadError.message || "Unable to load monthly Cleaning matrix."); }, onFinally: () => setMonthLoading(false) },
  ), [month, runLatestRequest]);
  useEffect(() => { if (activeTab === "daily") loadDaily(); }, [activeTab, loadDaily]);
  useEffect(() => { if (activeTab === "monthly") loadMonthly(); }, [activeTab, loadMonthly]);

  async function act(action, occurrence, result) {
    if (action === "view") { setOccurrenceDetail(occurrence); return; }
    try {
      if (action === "complete") await factoryService.completeMestiCleaningOccurrence(occurrence.id);
      else await factoryService.verifyMestiCleaningOccurrence(occurrence.id, result);
      onNotify?.({ title: "Cleaning updated", message: "Cleaning occurrence status was updated.", tone: "success" });
      await loadDaily();
      if (activeTab === "monthly") await loadMonthly();
    } catch (actionError) { onNotify?.({ title: "Cleaning update failed", message: actionError.message || "Unable to update Cleaning occurrence.", tone: "error" }); }
  }
  function changeDraft(key, value) { setRequirementDraft((current) => ({ ...current, [key]: value })); }
  function toggleLocation(locationId, checked) { changeDraft("location_ids", checked ? [...new Set([...(requirementDraft.location_ids || []), locationId])] : (requirementDraft.location_ids || []).filter((id) => id !== locationId)); }
  function closeRequirementForm() { setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(false); }
  async function saveRequirement(event) {
    event.preventDefault();
    try {
      const saved = await factoryService.saveMestiCleaningRequirement(requirementDraft);
      setRequirements((current) => [saved, ...current.filter((requirement) => requirement.logical_requirement_id !== saved.logical_requirement_id && requirement.id !== requirementDraft.id && requirement.id !== saved.id)]);
      closeRequirementForm(); await loadDaily(); if (activeTab === "monthly") await loadMonthly();
    } catch (saveError) { onNotify?.({ title: "Requirement save failed", message: saveError.message || "Unable to save Cleaning Requirement.", tone: "error" }); }
  }

  const summary = useMemo(() => ({ pending: dailyRows.filter((row) => row.status === "pending" || row.status === "missed").length, completed: dailyRows.filter((row) => row.status === "completed").length, verified: dailyRows.filter((row) => row.status === "verified").length, unsatisfactory: dailyRows.filter((row) => row.status === "unsatisfactory").length }), [dailyRows]);
  const grouped = [...groupByLocation(dailyRows).values()];
  const days = monthDays(month);
  const monthlyCells = new Map(monthlyRows.flatMap((row) => (row.days || []).map((cell) => [`${row.logical_requirement_id}:${cell.due_date}`, cell])));
  const matrixRows = monthlyRows.map((row) => ({ ...row, frequency: recurrenceLabel(row) }));

  return <div className="space-y-6">
    <PageHeader section="MeSTI" title="Cleaning of Area" description="Daily cleaning completion, supervisor verification, and monthly compliance history." />
    <FactoryViewTabs value={activeTab} onChange={setActiveTab} tabs={tabs} />
    {error ? <div role="alert" className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-200">{error}</div> : null}

    {activeTab === "daily" ? <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={CalendarDays} label="Due" value={dailyRows.length} helper={formatFactoryDate(date)} /><MetricCard icon={ClipboardCheck} label="Pending" value={summary.pending} tone={summary.pending ? "warning" : "success"} /><MetricCard icon={ShieldCheck} label="Verified" value={summary.verified} tone="success" /><MetricCard icon={XCircle} label="Unsatisfactory" value={summary.unsatisfactory} tone={summary.unsatisfactory ? "danger" : "success"} /></div>
      <FactoryDailyToolbar><FactoryDailyDateField><FeedXDatePicker value={date} onChange={setDate} /></FactoryDailyDateField></FactoryDailyToolbar>
      {loading ? <div className="border-b border-border py-8 text-sm font-semibold text-text-secondary">Loading Cleaning occurrences...</div> : !grouped.length ? <EmptyState title="No Cleaning occurrences" description="No active Cleaning Requirements are due for this date." /> : <div className="border border-border bg-surface">{grouped.map((group) => <FactoryOperationalGroup key={group.id} title={group.location_name} count={`${group.rows.length} task${group.rows.length === 1 ? "" : "s"}`}>
        {group.rows.map((row) => {
          const canComplete = (can("factory_mesti_cleaning.complete") || canManage) && ["pending", "missed", "unsatisfactory"].includes(row.status);
          const canVerify = (can("factory_mesti_cleaning.review") || canManage) && row.status === "completed";
          const note = row.verification_note || row.completion_note;
          const evidence = <FactoryOperationalEvidence items={[
            row.completed_at ? { key: "completed", label: `Completed ${row.completed_by_name || "—"} · ${formatFactoryDateTime(row.completed_at)}` } : null,
            row.verified_at ? { key: "verified", label: `Verified ${row.verified_by_name || "—"} · ${formatFactoryDateTime(row.verified_at)}` } : null,
            note ? { key: "note", label: `Note: ${note}`, title: note } : null,
          ]} />;
          return <FactoryOperationalRow key={row.id} primary={row.task_name} secondary={recurrenceLabel(row)} evidence={evidence} status={<StatusBadge status={row.status} variant="emphasized" />} actions={<FactoryRowActions primaryAction={canComplete ? { label: "Complete", icon: Check, onClick: () => act("complete", row) } : canVerify ? { label: "Verify", onClick: () => act("verify", row, "verified") } : null} secondaryActions={canVerify ? [{ label: "Mark unsatisfactory", icon: XCircle, destructive: true, onClick: () => act("verify", row, "unsatisfactory") }] : []} />} />;
        })}</FactoryOperationalGroup>)}</div>}
    </div> : null}

    {activeTab === "monthly" ? <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4"><div className="w-full sm:w-60"><Field label="Month"><FactoryMonthPicker value={month} onChange={setMonth} /></Field></div></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary"><span className="font-semibold text-text-primary">Legend</span><span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />Verified / compliant</span><span><i className="mr-1 inline-block size-2 rounded-full bg-amber-500" />Awaiting / pending</span><span><i className="mr-1 inline-block size-2 rounded-full bg-rose-500" />Missed / incomplete</span><span><i className="mr-1 inline-block size-2 rounded-full bg-slate-400" />Not applicable</span></div>
      <FactoryDataSurface>{monthLoading ? <div className="py-8 text-center text-sm font-semibold text-text-secondary">Loading monthly matrix...</div> : <FactoryComplianceMatrix rows={matrixRows} days={days} getCell={(row, day) => monthlyCells.get(`${row.logical_requirement_id}:${day}`)} renderEntity={(row) => row.task_name} renderSecondary={() => "Location-based requirement"} onCellClick={(cell, row) => { const key = `${row.logical_requirement_id}:${cell.due_date}`; setMonthlyDetailKey((current) => current === key ? "" : key); }} cellLabel={monthlyCellLabel} cellTitle={monthlyCellTitle} expandedCellKey={monthlyDetailKey} renderExpanded={(cell, row) => <MonthlyEvidenceRows detail={{ ...cell, task_name: row.task_name }} canComplete={(occurrence) => (can("factory_mesti_cleaning.complete") || canManage) && ["pending", "missed", "unsatisfactory"].includes(occurrence.status)} canVerify={(occurrence) => (can("factory_mesti_cleaning.review") || canManage) && occurrence.status === "completed"} onAct={act} />} empty={<EmptyState title="No monthly occurrences" description="No Cleaning Requirements are scheduled in this month." />} />}</FactoryDataSurface>
    </div> : null}

    {activeTab === "setup" ? <div className="space-y-5">
      <div className="flex items-center justify-end">{canSaveSetup ? <button className="btn-primary h-10 px-3 text-sm" type="button" onClick={() => { setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(true); }}><Plus size={15} /> Create Requirement</button> : null}</div>
      <FactoryDataSurface><FactoryTable rows={requirements} columns={[
        { key: "task", label: "Task", render: (row) => <div><div className="font-semibold text-text-primary">{row.task_name}</div><div className="text-xs text-text-secondary">Version {row.version_no || 1}</div></div> },
        { key: "locations", label: "Locations", render: (row) => <div className="text-sm text-text-secondary">{(row.location_names || []).join(", ") || "—"}</div> },
        { key: "frequency", label: "Frequency", render: recurrenceLabel },
        { key: "status", label: "Status", render: (row) => <FactoryStatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</FactoryStatusBadge> },
        { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions directSingleSecondary secondaryActions={canSaveSetup ? [{ label: "Edit", onClick: () => { setRequirementDraft({ ...row, location_ids: row.location_ids || [], recurrence_weekdays: row.recurrence_weekdays || [] }); setShowRequirementForm(true); } }] : []} /> },
      ]} /></FactoryDataSurface>
      <RequirementModal open={showRequirementForm} draft={requirementDraft} locations={activeLocations} onClose={closeRequirementForm} onSave={saveRequirement} onChange={changeDraft} onToggleLocation={toggleLocation} />
    </div> : null}
    <OccurrenceDetail occurrence={occurrenceDetail} onClose={() => setOccurrenceDetail(null)} />
  </div>;
}
