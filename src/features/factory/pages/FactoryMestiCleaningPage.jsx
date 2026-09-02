import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ClipboardCheck, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { factoryService } from "../../../services/factoryService.js";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { factoryMonthLabel, formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const tabs = ["daily", "monthly", "setup"];
const weekdays = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
const statusMeta = {
  pending: { label: "Pending", tone: "warning", icon: CalendarDays },
  completed: { label: "Awaiting Verification", tone: "info", icon: ClipboardCheck },
  verified: { label: "Verified", tone: "success", icon: ShieldCheck },
  unsatisfactory: { label: "Unsatisfactory", tone: "danger", icon: XCircle },
  missed: { label: "Missed", tone: "danger", icon: XCircle },
};

function roleName(roles, roleId) {
  return roles.find((role) => role.id === roleId)?.name || "Role";
}

function recurrenceLabel(row) {
  if (row.recurrence_type === "daily") return "Daily";
  const labels = (row.recurrence_weekdays || []).map((day) => weekdays.find((item) => item.value === Number(day))?.label).filter(Boolean);
  return `Weekly · ${labels.join(", ") || "Selected days"}`;
}

function occurrenceTone(status) {
  return statusMeta[status]?.tone || "neutral";
}

function StatusBadge({ status }) {
  const meta = statusMeta[status] || { label: status || "Pending", tone: "neutral", icon: CalendarDays };
  const Icon = meta.icon;
  return <Badge tone={meta.tone}><span className="inline-flex items-center gap-1"><Icon size={12} /> {meta.label}</span></Badge>;
}

function currentMonthInput() {
  return malaysiaBusinessDateInput().slice(0, 7);
}

function monthDays(month) {
  const [year, zeroMonth] = month.split("-").map(Number);
  const total = new Date(year, zeroMonth, 0).getDate();
  return Array.from({ length: total }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function groupByArea(rows) {
  return rows.reduce((groups, row) => {
    const key = row.area_id || row.area_name || "area";
    const group = groups.get(key) || { id: key, area_name: row.area_name || "Area", rows: [] };
    group.rows.push(row);
    groups.set(key, group);
    return groups;
  }, new Map());
}

function DetailPanel({ occurrence, onClose }) {
  if (!occurrence) return null;
  return <Card title={`${occurrence.area_name} · ${occurrence.task_name}`} description={formatFactoryDate(occurrence.due_date)}>
    <div className="grid gap-3 p-4 text-sm md:grid-cols-2">
      <div><div className="text-xs font-semibold text-text-muted">Status</div><div className="mt-1"><StatusBadge status={occurrence.status} /></div></div>
      <div><div className="text-xs font-semibold text-text-muted">Frequency</div><div className="mt-1 font-bold text-text-primary">{recurrenceLabel(occurrence)}</div></div>
      <div><div className="text-xs font-semibold text-text-muted">Completed By</div><div className="mt-1 font-bold text-text-primary">{occurrence.completed_by_name || "—"}</div>{occurrence.completed_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.completed_at)}</div> : null}</div>
      <div><div className="text-xs font-semibold text-text-muted">Verified By</div><div className="mt-1 font-bold text-text-primary">{occurrence.verified_by_name || "—"}</div>{occurrence.verified_at ? <div className="text-xs text-text-secondary">{formatFactoryDateTime(occurrence.verified_at)}</div> : null}</div>
      <div className="md:col-span-2"><div className="text-xs font-semibold text-text-muted">Notes</div><div className="mt-1 rounded-lg bg-slate-50 p-3 font-semibold text-text-secondary">{occurrence.verification_note || occurrence.completion_note || "No notes recorded."}</div></div>
    </div>
    <div className="border-t border-border p-3 text-right"><button className="btn-secondary" type="button" onClick={onClose}>Close</button></div>
  </Card>;
}

export default function FactoryMestiCleaningPage({ auth, onNotify }) {
  const masterData = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const [activeTab, setActiveTab] = useState("daily");
  const [date, setDate] = useState(malaysiaBusinessDateInput());
  const [month, setMonth] = useState(currentMonthInput());
  const [dailyRows, setDailyRows] = useState([]);
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [areas, setAreas] = useState(masterData.mestiCleaningAreas || []);
  const [requirements, setRequirements] = useState(masterData.mestiCleaningRequirements || []);
  const [loading, setLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [areaDraft, setAreaDraft] = useState({ area_name: "", location_id: "", status: "active", sort_order: 100 });
  const [requirementDraft, setRequirementDraft] = useState({ task_name: "", area_ids: [], recurrence_type: "daily", recurrence_weekdays: [1], responsible_role_id: "", verifier_role_id: "", status: "active", effective_from: malaysiaBusinessDateInput() });
  const roles = masterData.factoryRoles || [];
  const activeLocations = (masterData.storageLocations || []).filter((location) => location.status === "active");
  const activeAreas = areas.filter((area) => area.status === "active");
  const currentEmployeeId = auth?.profile?.id || "";
  const currentRoleId = auth?.profile?.role_id || auth?.roleId || "";
  const canManage = can("factory_mesti_cleaning.manage");

  useEffect(() => setAreas(masterData.mestiCleaningAreas || []), [masterData.mestiCleaningAreas]);
  useEffect(() => setRequirements(masterData.mestiCleaningRequirements || []), [masterData.mestiCleaningRequirements]);

  const loadDaily = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDailyRows(await factoryService.listMestiCleaningDay(date));
    } catch (loadError) {
      console.error("[Factory] Unable to load MeSTI Cleaning day.", loadError);
      setError(loadError.message || "Unable to load Cleaning of Area.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadMonthly = useCallback(async () => {
    setMonthLoading(true);
    setError("");
    try {
      setMonthlyRows(await factoryService.listMestiCleaningMonth(month));
    } catch (loadError) {
      console.error("[Factory] Unable to load MeSTI Cleaning month.", loadError);
      setError(loadError.message || "Unable to load monthly Cleaning matrix.");
    } finally {
      setMonthLoading(false);
    }
  }, [month]);

  useEffect(() => { loadDaily(); }, [loadDaily]);
  useEffect(() => { if (activeTab === "monthly") loadMonthly(); }, [activeTab, loadMonthly]);

  async function act(action, occurrence, result) {
    try {
      if (action === "complete") await factoryService.completeMestiCleaningOccurrence(occurrence.id);
      else await factoryService.verifyMestiCleaningOccurrence(occurrence.id, result);
      onNotify?.({ title: "Cleaning updated", message: "Cleaning occurrence status was updated.", tone: "success" });
      await loadDaily();
      if (activeTab === "monthly") await loadMonthly();
    } catch (actionError) {
      onNotify?.({ title: "Cleaning update failed", message: actionError.message || "Unable to update Cleaning occurrence.", tone: "error" });
    }
  }

  async function saveArea(event) {
    event.preventDefault();
    try {
      const saved = await factoryService.saveMestiCleaningArea(areaDraft);
      setAreas((current) => [saved, ...current.filter((area) => area.id !== saved.id)].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)));
      setAreaDraft({ area_name: "", location_id: "", status: "active", sort_order: 100 });
    } catch (saveError) {
      onNotify?.({ title: "Area save failed", message: saveError.message || "Unable to save Cleaning Area.", tone: "error" });
    }
  }

  async function saveRequirement(event) {
    event.preventDefault();
    try {
      const saved = await factoryService.saveMestiCleaningRequirement(requirementDraft);
      setRequirements((current) => [saved, ...current.filter((requirement) => requirement.id !== requirementDraft.id && requirement.id !== saved.id)]);
      setRequirementDraft({ task_name: "", area_ids: [], recurrence_type: "daily", recurrence_weekdays: [1], responsible_role_id: "", verifier_role_id: "", status: "active", effective_from: malaysiaBusinessDateInput() });
      await loadDaily();
    } catch (saveError) {
      onNotify?.({ title: "Requirement save failed", message: saveError.message || "Unable to save Cleaning Requirement.", tone: "error" });
    }
  }

  const summary = useMemo(() => ({
    pending: dailyRows.filter((row) => row.status === "pending" || row.status === "missed").length,
    completed: dailyRows.filter((row) => row.status === "completed").length,
    verified: dailyRows.filter((row) => row.status === "verified").length,
    unsatisfactory: dailyRows.filter((row) => row.status === "unsatisfactory").length,
  }), [dailyRows]);
  const grouped = [...groupByArea(dailyRows).values()];
  const days = monthDays(month);
  const matrixKeys = [...new Map(monthlyRows.map((row) => [`${row.area_id}:${row.requirement_id}`, row])).values()];
  const byKeyDate = new Map(monthlyRows.map((row) => [`${row.area_id}:${row.requirement_id}:${row.due_date}`, row]));

  return <div className="space-y-5">
    <PageHeader section="MeSTI" title="Cleaning of Area" description="Daily cleaning completion, supervisor verification, and monthly compliance history." actions={<button className="btn-secondary" type="button" onClick={activeTab === "monthly" ? loadMonthly : loadDaily}><RefreshCw size={15} /> Refresh</button>} />
    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-white p-2">
      {tabs.map((tab) => <button key={tab} className={`rounded-lg px-4 py-2 text-sm font-bold capitalize ${activeTab === tab ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} type="button" onClick={() => setActiveTab(tab)}>{tab}</button>)}
    </div>
    {error ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{error}</div> : null}

    {activeTab === "daily" ? <>
      <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={CalendarDays} label="Due" value={dailyRows.length} helper={formatFactoryDate(date)} /><MetricCard icon={ClipboardCheck} label="Pending" value={summary.pending} tone={summary.pending ? "warning" : "success"} /><MetricCard icon={ShieldCheck} label="Verified" value={summary.verified} tone="success" /><MetricCard icon={XCircle} label="Unsatisfactory" value={summary.unsatisfactory} tone={summary.unsatisfactory ? "danger" : "success"} /></div>
      <div className="rounded-xl border border-border bg-white p-4 md:w-80"><Field label="Date"><FeedXDatePicker value={date} onChange={setDate} /></Field></div>
      {loading ? <div className="card p-4 text-sm font-semibold text-text-secondary">Loading Cleaning occurrences...</div> : !grouped.length ? <EmptyState title="No Cleaning occurrences" description="No active Cleaning Requirements are due for this date." /> : grouped.map((group) => <Card key={group.id} title={group.area_name}>
        <FactoryTable rows={group.rows} columns={[
          { key: "task", label: "Task", render: (row) => <div><div className="font-bold text-text-primary">{row.task_name}</div><div className="text-xs text-text-secondary">{recurrenceLabel(row)}</div></div> },
          { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
          { key: "completion", label: "Completion", render: (row) => row.completed_at ? <div><div className="font-semibold">{row.completed_by_name || "Completed"}</div><div className="text-xs text-text-secondary">{formatFactoryDateTime(row.completed_at)}</div></div> : "—" },
          { key: "actions", label: "Actions", align: "right", render: (row) => {
            const canComplete = (canManage || currentRoleId === row.responsible_role_id) && ["pending", "missed", "unsatisfactory"].includes(row.status);
            const canVerify = (canManage || currentRoleId === row.verifier_role_id) && row.status === "completed" && (canManage || row.completed_by !== currentEmployeeId);
            return <div className="flex flex-wrap justify-end gap-2">{canComplete ? <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => act("complete", row)}><Check size={13} /> Complete</button> : null}{canVerify ? <><button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => act("verify", row, "verified")}>Verify</button><button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => act("verify", row, "unsatisfactory")}>Unsatisfactory</button></> : null}<button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setDetail(row)}>Details</button></div>;
          } },
        ]} />
      </Card>)}
      <DetailPanel occurrence={detail} onClose={() => setDetail(null)} />
    </> : null}

    {activeTab === "monthly" ? <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4"><Field label="Month"><input className={inputClass()} type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></Field><button className="btn-secondary" type="button" onClick={loadMonthly}><RefreshCw size={15} /> Load</button><div className="pb-2 text-sm font-bold text-text-secondary">{factoryMonthLabel(month)}</div></div>
      <Card title="Monthly Compliance Matrix" description="Historical months render from preserved Cleaning occurrences.">
        {monthLoading ? <div className="p-4 text-sm font-semibold text-text-secondary">Loading monthly matrix...</div> : <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
            <thead><tr className="border-b border-border text-text-muted"><th className="sticky left-0 z-10 bg-white px-3 py-2">Task / Area</th><th className="px-3 py-2">Frequency</th>{days.map((day) => <th key={day} className="w-9 px-1 py-2 text-center">{Number(day.slice(-2))}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">{matrixKeys.map((row) => <tr key={`${row.area_id}:${row.requirement_id}`}><td className="sticky left-0 z-10 bg-white px-3 py-2"><div className="font-bold text-text-primary">{row.task_name}</div><div className="text-text-secondary">{row.area_name}</div></td><td className="whitespace-nowrap px-3 py-2 font-semibold text-text-secondary">{recurrenceLabel(row)}</td>{days.map((day) => { const cell = byKeyDate.get(`${row.area_id}:${row.requirement_id}:${day}`); return <td key={day} className="px-1 py-1 text-center">{cell ? <button className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-black ${occurrenceTone(cell.status) === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : occurrenceTone(cell.status) === "danger" ? "border-rose-200 bg-rose-50 text-rose-700" : occurrenceTone(cell.status) === "info" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-700"}`} type="button" title={statusMeta[cell.status]?.label} onClick={() => setDetail(cell)}>{cell.status === "verified" ? "V" : cell.status === "completed" ? "C" : cell.status === "unsatisfactory" ? "U" : cell.status === "missed" ? "M" : "P"}</button> : null}</td>; })}</tr>)}</tbody>
          </table>
          {!matrixKeys.length ? <EmptyState title="No monthly occurrences" description="No Cleaning Requirements are scheduled in this month." /> : null}
        </div>}
      </Card>
      <DetailPanel occurrence={detail} onClose={() => setDetail(null)} />
    </> : null}

    {activeTab === "setup" ? <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Areas" description="Compliance-facing area labels bound to canonical Factory Locations.">
        <form className="grid gap-3 border-b border-border p-4 md:grid-cols-2" onSubmit={saveArea}>
          <Field label="Area Name"><input className={inputClass()} value={areaDraft.area_name} onChange={(event) => setAreaDraft((current) => ({ ...current, area_name: event.target.value }))} required /></Field>
          <Field label="Location"><SearchableSelect value={areaDraft.location_id} options={activeLocations.map((location) => ({ value: location.id, label: location.location_name, helper: [location.location_code, location.location_type].filter(Boolean).join(" · ") }))} onChange={(location_id) => setAreaDraft((current) => ({ ...current, location_id }))} placeholder="Select Location" /></Field>
          <Field label="Status"><SearchableSelect value={areaDraft.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(status) => setAreaDraft((current) => ({ ...current, status }))} /></Field>
          <Field label="Sort Order"><input className={inputClass()} type="number" value={areaDraft.sort_order} onChange={(event) => setAreaDraft((current) => ({ ...current, sort_order: event.target.value }))} /></Field>
          <div className="md:col-span-2"><button className="btn-primary" type="submit" disabled={!canManage && !can("factory_mesti_cleaning.create") && !can("factory_mesti_cleaning.edit")}>Save Area</button></div>
        </form>
        <FactoryTable rows={areas} columns={[
          { key: "area", label: "Area", render: (row) => <div><div className="font-bold">{row.area_name}</div><div className="text-xs text-text-secondary">{row.location_name || "No location"}</div></div> },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</Badge> },
          { key: "actions", label: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setAreaDraft(row)}>Edit</button> },
        ]} emptyTitle="No Cleaning Areas" />
      </Card>
      <Card title="Cleaning Requirements" description="Structured recurrence and role authority for due Cleaning occurrences.">
        <form className="grid gap-3 border-b border-border p-4 md:grid-cols-2" onSubmit={saveRequirement}>
          <Field label="Task Name"><input className={inputClass()} value={requirementDraft.task_name} onChange={(event) => setRequirementDraft((current) => ({ ...current, task_name: event.target.value }))} placeholder="Floor, Ceiling, Drain" required /></Field>
          <Field label="Recurrence"><SearchableSelect value={requirementDraft.recurrence_type} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} onChange={(recurrence_type) => setRequirementDraft((current) => ({ ...current, recurrence_type }))} /></Field>
          <Field label="Responsible Role"><SearchableSelect value={requirementDraft.responsible_role_id} options={roles.map((role) => ({ value: role.id, label: role.name }))} onChange={(responsible_role_id) => setRequirementDraft((current) => ({ ...current, responsible_role_id }))} placeholder="Select role" /></Field>
          <Field label="Verifier Role"><SearchableSelect value={requirementDraft.verifier_role_id} options={roles.map((role) => ({ value: role.id, label: role.name }))} onChange={(verifier_role_id) => setRequirementDraft((current) => ({ ...current, verifier_role_id }))} placeholder="Select role" /></Field>
          <Field label="Effective From"><FeedXDatePicker value={requirementDraft.effective_from} onChange={(effective_from) => setRequirementDraft((current) => ({ ...current, effective_from }))} /></Field>
          <Field label="Status"><SearchableSelect value={requirementDraft.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(status) => setRequirementDraft((current) => ({ ...current, status }))} /></Field>
          {requirementDraft.recurrence_type === "weekly" ? <div className="md:col-span-2"><div className="mb-1 text-xs font-semibold text-text-muted">Weekdays</div><div className="flex flex-wrap gap-2">{weekdays.map((day) => <label key={day.value} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={(requirementDraft.recurrence_weekdays || []).includes(day.value)} onChange={(event) => setRequirementDraft((current) => ({ ...current, recurrence_weekdays: event.target.checked ? [...new Set([...(current.recurrence_weekdays || []), day.value])] : (current.recurrence_weekdays || []).filter((value) => value !== day.value) }))} />{day.label}</label>)}</div></div> : null}
          <div className="md:col-span-2"><div className="mb-1 text-xs font-semibold text-text-muted">Cleaning Areas</div><div className="grid gap-2 sm:grid-cols-2">{activeAreas.map((area) => <label key={area.id} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"><input type="checkbox" checked={(requirementDraft.area_ids || []).includes(area.id)} onChange={(event) => setRequirementDraft((current) => ({ ...current, area_ids: event.target.checked ? [...new Set([...(current.area_ids || []), area.id])] : (current.area_ids || []).filter((id) => id !== area.id) }))} />{area.area_name}</label>)}</div></div>
          <div className="md:col-span-2"><button className="btn-primary" type="submit" disabled={!canManage && !can("factory_mesti_cleaning.create") && !can("factory_mesti_cleaning.edit")}>Save Requirement</button></div>
        </form>
        <FactoryTable rows={requirements} columns={[
          { key: "task", label: "Task", render: (row) => <div><div className="font-bold">{row.task_name}</div><div className="text-xs text-text-secondary">{(row.area_names || []).join(", ") || "No areas"}</div></div> },
          { key: "frequency", label: "Frequency", render: recurrenceLabel },
          { key: "roles", label: "Roles", render: (row) => <div className="text-xs font-semibold text-text-secondary"><div>Do: {roleName(roles, row.responsible_role_id)}</div><div>Verify: {roleName(roles, row.verifier_role_id)}</div></div> },
          { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</Badge> },
          { key: "actions", label: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => setRequirementDraft(row)}>Edit</button> },
        ]} emptyTitle="No Cleaning Requirements" />
      </Card>
    </div> : null}
  </div>;
}
