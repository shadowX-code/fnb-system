import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ClipboardCheck, Plus, ShieldCheck, XCircle } from "lucide-react";
import { cleaningOccurrenceStatus } from "../utils/cleaningCalendarPresentation.js";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import TagList from "../../../components/ui/TagList.jsx";
import FactoryMestiRequirementHistory from "../components/FactoryMestiRequirementHistory.jsx";
import { FactoryMestiCleaningMethodField, FactoryMestiCleaningMethodReference, cleaningMethodLabel } from "../components/FactoryMestiCleaningMethod.jsx";
import { FactoryMestiMonthlyActionRow } from "../components/FactoryMestiMonthlyExpansion.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryComplianceMatrix, { FactoryComplianceLegend } from "../components/FactoryComplianceMatrix.jsx";
import FactoryDailyToolbar, { FactoryDailyDateField } from "../components/FactoryDailyToolbar.jsx";
import FactoryMonthPicker from "../components/FactoryMonthPicker.jsx";
import FactoryMestiOccurrenceActions from "../components/FactoryMestiOccurrenceActions.jsx";
import { FactoryMestiLocationSelection, FactoryMestiScheduleFields, mestiWeekdays as weekdays } from "../components/FactoryMestiRequirementFields.jsx";
import { cleaningMonthlyHierarchy } from "../utils/cleaningMonthlyHierarchy.js";
import FactoryOperationalGroup, { FactoryOperationalEvidence, FactoryOperationalRow } from "../components/FactoryOperationalGroup.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FactoryViewTabs from "../components/FactoryViewTabs.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryLatestRequest from "../hooks/useFactoryLatestRequest.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const tabs = [
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
  { value: "setup", label: "Setup" },
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
function monthlyCellTitle(cell, row) {
  const summary = cell.status === "mixed" ? `${cell.verified_count} of ${cell.total_count} verified` : statusMeta[cell.status]?.label || "Pending";
  return `${row.task_name} · ${formatFactoryDate(cell.due_date)} · ${summary}`;
}

function OccurrenceDetail({ occurrence, onClose }) {
  if (!occurrence) return null;
  return <Modal title={`${occurrence.task_name} · ${occurrence.location_name}`} description={formatFactoryDate(occurrence.due_date)} onClose={onClose}>
    <FactoryMestiCleaningMethodReference reference={occurrence.cleaning_method_reference} />
    <div className="grid gap-x-6 md:grid-cols-2">
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Status</div><div className="mt-1"><StatusBadge status={occurrence.status} /></div></div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Schedule</div><div className="mt-1 text-sm font-semibold text-text-primary">{recurrenceLabel(occurrence)}</div></div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Completed</div><div className="mt-1 text-sm font-semibold text-text-primary">{occurrence.completed_by_name || "—"}</div>{occurrence.completed_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.completed_at)}</div> : null}</div>
      <div className="border-b border-border py-2.5"><div className="text-xs font-semibold text-text-muted">Verified</div><div className="mt-1 text-sm font-semibold text-text-primary">{occurrence.verified_by_name || "—"}</div>{occurrence.verified_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.verified_at)}</div> : null}</div>
    </div>
  </Modal>;
}

function RequirementModal({ open, draft, locations, methods, onClose, onSave, onChange, error, saving }) {
  const [view, setView] = useState("edit");
  useEffect(() => { setView("edit"); }, [open, draft.id]);
  if (!open) return null;
  return <Modal open={open} onClose={onClose} title={draft.id ? "Edit Cleaning Requirement" : "Create Cleaning Requirement"} description="Requirements remain versioned and only meaningful edits create a new version." footer={<><button className="btn-secondary" type="button" onClick={onClose}>{view === "history" ? "Close" : "Cancel"}</button>{view === "edit" ? <button className="btn-primary" form="area-cleaning-requirement" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Requirement"}</button> : null}</>}>
    {draft.id ? <div className="mb-4"><FactoryViewTabs ariaLabel="Requirement" value={view} onChange={setView} tabs={[{ value: "edit", label: "Edit" }, { value: "history", label: "History" }]} /></div> : null}
    {view === "history" ? <FactoryMestiRequirementHistory logicalRequirementId={draft.logical_requirement_id || draft.id} loadVersions={factoryService.listMestiCleaningRequirementVersions} formatSchedule={recurrenceLabel} /> : <form id="area-cleaning-requirement" className="grid gap-4 md:grid-cols-2" onSubmit={onSave}>
      <Field label="Task Name"><input className={inputClass()} value={draft.task_name} onChange={event => onChange("task_name", event.target.value)} placeholder="Floor, Ceiling, Drain" required /></Field>
      <Field label="Effective From"><FeedXDatePicker required value={draft.effective_from} onChange={value => onChange("effective_from", value)} /></Field>
      <FactoryMestiCleaningMethodField draft={draft} methods={methods} onChange={value => onChange("cleaning_method", value)} />
      <FactoryMestiScheduleFields frequency={draft.recurrence_type} weekdays={draft.recurrence_weekdays || []} status={draft.status} onFrequencyChange={value => onChange("recurrence_type", value)} onWeekdaysChange={value => onChange("recurrence_weekdays", value)} onStatusChange={value => onChange("status", value)} />
      <FactoryMestiLocationSelection locations={locations} value={draft.location_ids || []} onChange={value => onChange("location_ids", value)} />
      {error ? <p role="alert" className="md:col-span-2 text-sm text-[var(--factory-danger-text)]">{error}</p> : null}
    </form>}
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
  const [occurrenceDetail, setOccurrenceDetail] = useState(null);
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [requirementDraft, setRequirementDraft] = useState(emptyRequirementDraft());
  const [requirementError, setRequirementError] = useState("");
  const [savingRequirement, setSavingRequirement] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [actionFailure, setActionFailure] = useState(null);
  const mutationOwner = useRef(false);
  const saveOwner = useRef(false);
  const refreshOwner = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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

  const canCompleteOccurrence = row => (can("factory_mesti_cleaning.complete") || canManage) && ["pending", "missed", "unsatisfactory"].includes(row.status);
  const canVerifyOccurrence = row => (can("factory_mesti_cleaning.review") || canManage) && row.status === "completed";
  refreshOwner.current = activeTab === "monthly" ? loadMonthly : loadDaily;
  async function act(action, occurrence, result) {
    if (action === "view") { setOccurrenceDetail(occurrence); return; }
    if (mutationOwner.current) return;
    mutationOwner.current = true; setWorkingId(occurrence.id); setActionFailure(null);
    try {
      if (action === "complete") await factoryService.completeMestiCleaningOccurrence(occurrence.id);
      else await factoryService.verifyMestiCleaningOccurrence(occurrence.id, result);
      onNotify?.({ title: "Cleaning updated", message: "Cleaning occurrence status was updated.", tone: "success" });
    } catch (actionError) {
      const message = actionError.message || "Unable to update Cleaning occurrence. Refresh and retry.";
      setActionFailure({ id: occurrence.id, message });
      onNotify?.({ title: "Cleaning update failed", message, tone: "error" });
    } finally {
      // Re-read even after a rejected transition; another operator may have acted.
      if (mounted.current) await refreshOwner.current();
      mutationOwner.current = false;
      if (mounted.current) setWorkingId("");
    }
  }
  function changeDraft(key, value) { setRequirementError(""); setRequirementDraft(current => ({ ...current, [key]: value })); }
  function closeRequirementForm() { setRequirementError(""); setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(false); }
  async function saveRequirement(event) {
    event.preventDefault();
    if (saveOwner.current) return;
    saveOwner.current = true; setSavingRequirement(true); setRequirementError("");
    try {
      const saved = await factoryService.saveMestiCleaningRequirement(requirementDraft);
      setRequirements(current => [saved, ...current.filter(requirement => requirement.logical_requirement_id !== saved.logical_requirement_id && requirement.id !== requirementDraft.id && requirement.id !== saved.id)]);
      closeRequirementForm();
    } catch (saveError) {
      const message = saveError.message || "Unable to save Cleaning Requirement.";
      setRequirementError(message);
      onNotify?.({ title: "Requirement save failed", message, tone: "error" });
    } finally { saveOwner.current = false; setSavingRequirement(false); }
  }

  const summary = useMemo(() => ({ pending: dailyRows.filter((row) => row.status === "pending" || row.status === "missed").length, completed: dailyRows.filter((row) => row.status === "completed").length, verified: dailyRows.filter((row) => row.status === "verified").length, unsatisfactory: dailyRows.filter((row) => row.status === "unsatisfactory").length }), [dailyRows]);
  const grouped = [...groupByLocation(dailyRows).values()];
  const days = monthDays(month);
  const matrixRows = useMemo(() => cleaningMonthlyHierarchy(monthlyRows), [monthlyRows]);
  const currentRequirements = requirements.filter(row => !row.superseded_by && !row.effective_until);

  return <div className="space-y-6">
    <PageHeader section="MeSTI" title="Cleaning of Area" description="Daily cleaning completion, supervisor verification, and monthly compliance history." />
    <FactoryViewTabs value={activeTab} onChange={setActiveTab} tabs={tabs} />
    {error ? <div role="alert" className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-900 dark:text-amber-200">{error}</div> : null}

    {activeTab === "daily" ? <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={CalendarDays} label="Due" value={dailyRows.length} helper={formatFactoryDate(date)} /><MetricCard icon={ClipboardCheck} label="Pending" value={summary.pending} tone={summary.pending ? "warning" : "success"} /><MetricCard icon={ShieldCheck} label="Verified" value={summary.verified} tone="success" /><MetricCard icon={XCircle} label="Unsatisfactory" value={summary.unsatisfactory} tone={summary.unsatisfactory ? "danger" : "success"} /></div>
      <FactoryDailyToolbar><FactoryDailyDateField><FeedXDatePicker value={date} onChange={setDate} /></FactoryDailyDateField></FactoryDailyToolbar>
      {loading ? <div className="border-b border-border py-8 text-sm font-semibold text-text-secondary">Loading Cleaning occurrences...</div> : !grouped.length ? <EmptyState title="No Cleaning occurrences" description="No active Cleaning Requirements are due for this date." /> : <div className="border border-border bg-surface">{grouped.map((group) => <FactoryOperationalGroup key={group.id} title={group.location_name} count={`${group.rows.length} task${group.rows.length === 1 ? "" : "s"}`}>
        {group.rows.map((row) => {
          const canComplete = canCompleteOccurrence(row);
          const canVerify = canVerifyOccurrence(row);
          const note = row.verification_note || row.completion_note;
          const evidence = <FactoryOperationalEvidence items={[
            row.completed_at ? { key: "completed", label: `Completed ${row.completed_by_name || "—"} · ${formatFactoryDateTime(row.completed_at)}` } : null,
            row.verified_at ? { key: "verified", label: `Verified ${row.verified_by_name || "—"} · ${formatFactoryDateTime(row.verified_at)}` } : null,
            note ? { key: "note", label: `Note: ${note}`, title: note } : null,
          ]} />;
          return <FactoryOperationalRow key={row.id} primary={row.task_name} secondary={recurrenceLabel(row)} evidence={<>{evidence}<FactoryMestiCleaningMethodReference reference={row.cleaning_method_reference} compact /></>} status={<StatusBadge status={row.status} variant="emphasized" />} actions={<FactoryRowActions primaryAction={canComplete ? { label: "Complete", icon: Check, disabled: Boolean(workingId), onClick: () => act("complete", row) } : canVerify ? { label: "Verify", disabled: Boolean(workingId), onClick: () => act("verify", row, "verified") } : null} secondaryActions={canVerify ? [{ label: "Mark unsatisfactory", icon: XCircle, destructive: true, onClick: () => act("verify", row, "unsatisfactory") }] : []} />} />;
        })}</FactoryOperationalGroup>)}</div>}
    </div> : null}

    {activeTab === "monthly" ? <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4"><div className="w-full sm:w-60"><Field label="Month"><FactoryMonthPicker value={month} onChange={setMonth} /></Field></div></div>
      <FactoryComplianceLegend />
      <FactoryDataSurface>{monthLoading && !monthlyRows.length ? <div className="py-8 text-center text-sm font-semibold text-text-secondary">Loading monthly matrix...</div> : <FactoryComplianceMatrix
        key={month} cleaningStatuses today={malaysiaBusinessDateInput()} onToday={() => setMonth(malaysiaBusinessDateInput().slice(0,7))} rows={matrixRows} days={days} rowKey={row => row.matrix_key} getChildren={row => row.children}
        getCell={(row, day) => row.calendarCells.get(day)}
        entityLabel="Task / Location" renderEntity={row => row.location_name || row.task_name}
        renderFrequency={row => row.location_name ? null : recurrenceLabel(row)}
        isCellInteractive={row => Boolean(row.location_name)}
        renderCellDetail={occurrence => <section aria-label="Cleaning occurrence actions">
          <FactoryMestiMonthlyActionRow primary={occurrence.task_name} secondary={`${occurrence.location_name} · ${formatFactoryDate(occurrence.due_date)}`}
            status={<span aria-live="polite"><StatusBadge status={cleaningOccurrenceStatus(occurrence)} /></span>}
            actions={<FactoryMestiOccurrenceActions status={occurrence.status} canComplete={!error && canCompleteOccurrence(occurrence)} canVerify={!error && canVerifyOccurrence(occurrence)} working={Boolean(workingId) || monthLoading} onComplete={() => act("complete", occurrence)} onVerify={() => act("verify", occurrence, "verified")} onMarkUnsatisfactory={() => act("verify", occurrence, "unsatisfactory")} onView={() => act("view", occurrence)} />}
          />
          <div className="px-3 pb-2"><FactoryMestiCleaningMethodReference reference={occurrence.cleaning_method_reference} compact /></div>
          {actionFailure?.id === occurrence.id ? <p role="alert" className="px-3 pb-2 text-sm text-[var(--factory-danger-text)]">{actionFailure.message}</p> : null}
          {error ? <div className="px-3 pb-2"><p role="alert" className="text-sm text-[var(--factory-danger-text)]">{error}</p><button type="button" className="btn-secondary mt-2" onClick={loadMonthly}>Retry refresh</button></div> : null}
        </section>}
        cellTitle={(cell, row) => monthlyCellTitle(cell, { task_name: row.location_name ? `${row.task_name} · ${row.location_name}` : row.task_name })}
        empty={<EmptyState title="No monthly occurrences" description="No Cleaning Requirements are scheduled in this month." />}
      />}</FactoryDataSurface>
    </div> : null}

    {activeTab === "setup" ? <div className="space-y-5">
      <div className="flex items-center justify-end">{canSaveSetup ? <button className="btn-primary h-10 px-3 text-sm" type="button" onClick={() => { setRequirementDraft(emptyRequirementDraft()); setShowRequirementForm(true); }}><Plus size={15} /> Create Requirement</button> : null}</div>
      <FactoryDataSurface><FactoryTable rows={currentRequirements} columns={[
        { key: "task", label: "Task", render: (row) => <span className="font-semibold text-text-primary">{row.task_name}</span> },
        { key: "method", label: "Method", render: row => cleaningMethodLabel(row.cleaning_method_reference) },
        { key: "locations", label: "Locations", render: (row) => <TagList tags={row.location_names || []} maxVisible={2} label="Locations" /> },
        { key: "frequency", label: "Frequency", render: recurrenceLabel },
        { key: "effective", label: "Effective From", render: (row) => formatFactoryDate(row.effective_from) },
        { key: "status", label: "Status", render: (row) => <FactoryStatusBadge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</FactoryStatusBadge> },
        { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions directSingleSecondary secondaryActions={canSaveSetup ? [{ label: "Edit", onClick: () => { setRequirementDraft({ ...row, location_ids: row.location_ids || [], recurrence_weekdays: row.recurrence_weekdays || [] }); setShowRequirementForm(true); } }] : []} /> },
      ]} /></FactoryDataSurface>
      <RequirementModal open={showRequirementForm} draft={requirementDraft} locations={activeLocations} methods={masterData.mestiCleaningMethods} onClose={closeRequirementForm} onSave={saveRequirement} onChange={changeDraft} error={requirementError} saving={savingRequirement} />
    </div> : null}
    <OccurrenceDetail occurrence={occurrenceDetail} onClose={() => setOccurrenceDetail(null)} />
  </div>;
}
