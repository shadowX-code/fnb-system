import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ClipboardList, Search } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryComplianceMatrix from "../components/FactoryComplianceMatrix.jsx";
import FactoryDailyToolbar, { FactoryDailyDateField } from "../components/FactoryDailyToolbar.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import FactoryViewTabs from "../components/FactoryViewTabs.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import FactoryMonthPicker from "../components/FactoryMonthPicker.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatFactoryDate, formatFactoryDateTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const resultOptions = [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }];
const statusTone = { draft: "neutral", submitted: "warning", verified: "success" };
const resultTone = { compliant: "success", non_compliant: "danger", awaiting_verification: "warning" };

function currentMonthInput() { return malaysiaBusinessDateInput().slice(0, 7); }
function monthDays(month) {
  const [year, zeroMonth] = month.split("-").map(Number);
  return Array.from({ length: new Date(year, zeroMonth, 0).getDate() }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}
function label(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function overall(entry) { return entry.clothing_result === "pass" && entry.hygiene_result === "pass" ? "compliant" : "non_compliant"; }
function isCompleteEntry(entry) { return overall(entry) === "compliant" || (entry.issue?.trim() && entry.action_taken?.trim()); }
function blank(employee) {
  return { employee_id: employee.id, employee_snapshot: { employee_name: employee.name, position: employee.position }, clothing_result: "pass", hygiene_result: "pass", issue: "", action_taken: "", notes: "" };
}
function detailRow(labelText, value) {
  return <div key={labelText} className="border-b border-border py-2.5 last:border-0"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{labelText}</div><div className="mt-0.5 text-sm font-semibold text-text-primary">{value || "-"}</div></div>;
}
function ResultBadge({ value }) { return <FactoryStatusBadge tone={resultTone[value] || "neutral"}>{label(value)}</FactoryStatusBadge>; }
function SessionStatusBadge({ value }) { return <FactoryStatusBadge tone={statusTone[value] || "neutral"}>{label(value || "draft")}</FactoryStatusBadge>; }

function SessionDetail({ daily, date, onClose }) {
  const session = daily.session || {};
  const entries = daily.entries || [];
  const compliant = entries.filter((entry) => overall(entry) === "compliant").length;
  return <Modal title={`${formatFactoryDate(date)} Inspection Session`} description="Daily session evidence and verification state." onClose={onClose} size="lg">
    <div className="grid gap-x-6 md:grid-cols-2">
      {detailRow("Session Status", label(session.status || "draft"))}
      {detailRow("Inspected Count", entries.length)}
      {detailRow("Compliant Count", compliant)}
      {detailRow("Non-Compliant Count", entries.length - compliant)}
      {detailRow("Submitted By", session.submitted_by_name)}
      {detailRow("Submitted At", formatFactoryDateTime(session.submitted_at))}
      {detailRow("Verified By", session.verified_by_name)}
      {detailRow("Verified At", formatFactoryDateTime(session.verified_at))}
    </div>
  </Modal>;
}

function EntryDetail({ entry, session, date, onClose }) {
  if (!entry) return null;
  return <Modal title={entry.employee_snapshot?.employee_name || entry.employee_name || "Operator"} description={`${formatFactoryDate(entry.inspection_date || date)} operator inspection evidence.`} onClose={onClose} size="lg">
    <div className="grid gap-x-6 md:grid-cols-2">
      {detailRow("Employee", entry.employee_snapshot?.employee_name || entry.employee_name)}
      {detailRow("Position", entry.employee_snapshot?.position || entry.position)}
      {detailRow("Inspection Date", formatFactoryDate(entry.inspection_date || date))}
      {detailRow("Session Status", label(entry.session_status || session?.status || "draft"))}
      {detailRow("Clothing", label(entry.clothing_result))}
      {detailRow("Hygiene", label(entry.hygiene_result))}
      {detailRow("Overall", label(entry.overall_result || overall(entry)))}
      {detailRow("Issue", entry.issue)}
      {detailRow("Action", entry.action_taken)}
      {detailRow("Notes", entry.notes)}
      {detailRow("Submitted By", entry.submitted_by_name || session?.submitted_by_name)}
      {detailRow("Submitted At", formatFactoryDateTime(entry.submitted_at || session?.submitted_at))}
      {detailRow("Verified By", entry.verified_by_name || session?.verified_by_name)}
      {detailRow("Verified At", formatFactoryDateTime(entry.verified_at || session?.verified_at))}
    </div>
  </Modal>;
}

export default function FactoryMestiOperatorHygienePage({ auth, onNotify }) {
  const { can } = useFactoryPermissions();
  const [tab, setTab] = useState("daily");
  const [date, setDate] = useState(malaysiaBusinessDateInput());
  const [daily, setDaily] = useState({ entries: [], employees: [] });
  const [month, setMonth] = useState(currentMonthInput());
  const [matrix, setMatrix] = useState([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [detail, setDetail] = useState(null);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const currentEmployeeId = auth?.profile?.id || "";
  const entries = daily.entries || [];
  const session = daily.session || null;
  const isDraft = !session || session.status === "draft";
  const selected = useMemo(() => new Set(entries.map((entry) => entry.employee_id)), [entries]);
  const stats = useMemo(() => {
    const compliant = entries.filter((entry) => overall(entry) === "compliant").length;
    return { inspected: entries.length, compliant, nonCompliant: entries.length - compliant };
  }, [entries]);
  const employeeOptions = useMemo(() => (daily.employees || []).filter((employee) => !selected.has(employee.id)).map((employee) => ({ value: employee.id, label: [employee.name, employee.position].filter(Boolean).join(" - ") })), [daily.employees, selected]);
  const visibleMatrix = useMemo(() => matrix.filter((row) => `${row.employee_name || ""} ${row.position || ""}`.toLowerCase().includes(employeeQuery.toLowerCase())), [employeeQuery, matrix]);

  const loadDaily = useCallback(async () => {
    setLoading(true); setError("");
    try { setDaily(await factoryService.getMestiOperatorHygieneDaily(date)); }
    catch (loadError) { setError(loadError.message || "Unable to load Operator Hygiene Inspection."); }
    finally { setLoading(false); }
  }, [date]);
  const loadMonthly = useCallback(async () => {
    setLoading(true); setError("");
    try { setMatrix(await factoryService.listMestiOperatorHygieneMonthly(month)); }
    catch (loadError) { setError(loadError.message || "Unable to load monthly Operator Hygiene Inspection."); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { if (tab === "daily") loadDaily(); }, [tab, loadDaily]);
  useEffect(() => { if (tab === "monthly") loadMonthly(); }, [tab, loadMonthly]);

  async function save(nextEntries) {
    try {
      await factoryService.saveMestiOperatorHygiene({ inspection_date: date, entries: nextEntries });
      await loadDaily();
    } catch (saveError) {
      setError(saveError.message || "Unable to save inspection.");
    }
  }
  function update(employeeId, patch) {
    const nextEntries = entries.map((entry) => entry.employee_id === employeeId ? { ...entry, ...patch } : entry);
    setDaily((current) => ({ ...current, entries: nextEntries }));
    setError("");
    if (nextEntries.every(isCompleteEntry)) save(nextEntries);
  }
  async function submit() {
    try {
      await factoryService.submitMestiOperatorHygiene(date);
      await loadDaily();
      onNotify?.({ title: "Operator hygiene submitted", tone: "success" });
    } catch (submitError) { setError(submitError.message || "Unable to submit inspection."); }
  }
  async function verify() {
    try {
      await factoryService.verifyMestiOperatorHygiene(date);
      await loadDaily();
      onNotify?.({ title: "Operator hygiene verified", tone: "success" });
    } catch (verifyError) { setError(verifyError.message || "Unable to verify inspection."); }
  }
  function addEmployee(employeeId) {
    const employee = (daily.employees || []).find((item) => item.id === employeeId);
    if (employee) save([...entries, blank(employee)]);
  }
  function markAllPass() { save(entries.map((entry) => ({ ...entry, clothing_result: "pass", hygiene_result: "pass", issue: "", action_taken: "" }))); }

  const columns = [
    { key: "operator", label: "Operator", render: (entry) => <button type="button" className="text-left" onClick={() => setDetail(entry)}><span className="block font-bold text-text-primary">{entry.employee_snapshot?.employee_name}</span><span className="block text-xs text-text-secondary">{entry.employee_snapshot?.position || "-"}</span></button> },
    { key: "clothing", label: "Clothing", render: (entry) => isDraft ? <SearchableSelect value={entry.clothing_result} options={resultOptions} onChange={(value) => update(entry.employee_id, { clothing_result: value })} /> : label(entry.clothing_result) },
    { key: "hygiene", label: "Hygiene", render: (entry) => isDraft ? <SearchableSelect value={entry.hygiene_result} options={resultOptions} onChange={(value) => update(entry.employee_id, { hygiene_result: value })} /> : label(entry.hygiene_result) },
    { key: "result", label: "Overall", render: (entry) => <ResultBadge value={overall(entry)} /> },
    { key: "issue", label: "Issue", render: (entry) => isDraft ? <input className={inputClass(overall(entry) !== "compliant" && !entry.issue?.trim())} required={overall(entry) !== "compliant"} value={entry.issue || ""} placeholder="Required on Fail" onChange={(event) => update(entry.employee_id, { issue: event.target.value })} /> : entry.issue || "-" },
    { key: "action", label: "Action", render: (entry) => isDraft ? <input className={inputClass(overall(entry) !== "compliant" && !entry.action_taken?.trim())} required={overall(entry) !== "compliant"} value={entry.action_taken || ""} placeholder="Required on Fail" onChange={(event) => update(entry.employee_id, { action_taken: event.target.value })} /> : entry.action_taken || "-" },
    { key: "actions", label: "Actions", align: "right", render: (entry) => <FactoryRowAction label={`View ${entry.employee_snapshot?.employee_name} details`} onClick={() => setDetail(entry)} /> },
  ];

  return <div className="space-y-5">
    <PageHeader section="MeSTI" title="Operator Hygiene Inspection" description="Daily operator clothing and hygiene inspection evidence." />
    <FactoryViewTabs value={tab} onChange={setTab} tabs={[{ value: "daily", label: "Daily" }, { value: "monthly", label: "Monthly" }]} />
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}

    {tab === "daily" ? <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-bold text-text-primary">{stats.inspected} Inspected</span><span className="text-emerald-700">{stats.compliant} Compliant</span><span className={stats.nonCompliant ? "text-rose-700" : "text-text-secondary"}>{stats.nonCompliant} Non-Compliant</span><SessionStatusBadge value={session?.status || "draft"} />
        <button className="btn-secondary ml-auto" type="button" onClick={() => setSessionDetailOpen(true)}><ClipboardList size={15} />Session Details</button>
        {isDraft ? <><button type="button" className="btn-secondary" onClick={markAllPass} disabled={!entries.length || !can("factory_mesti_operator_hygiene.manage")}>Mark All Pass</button><button type="button" className="btn-primary" disabled={!entries.length || !can("factory_mesti_operator_hygiene.submit")} onClick={submit}>Submit Inspection</button></> : null}
        {session?.status === "submitted" ? <button type="button" className="btn-primary" disabled={!can("factory_mesti_operator_hygiene.verify")} onClick={verify} title={session.submitted_by === currentEmployeeId ? "Self-verification is blocked by the server." : undefined}><Check size={15} />Verify</button> : null}
      </div>
      <FactoryDailyToolbar><FactoryDailyDateField><FeedXDatePicker value={date} onChange={setDate} /></FactoryDailyDateField></FactoryDailyToolbar>
      <FactoryDataSurface><FactoryTable rows={entries} columns={columns} emptyTitle="No Operators Selected" emptyDescription="Add active employees below." /></FactoryDataSurface>
      {isDraft ? <div className="rounded-xl border border-border bg-white p-3"><Field label="Add Operator"><SearchableSelect value="" options={employeeOptions} placeholder="Select canonical Employee" onChange={addEmployee} /></Field></div> : null}
      <div className="text-xs font-semibold text-text-secondary">Submitted by {session?.submitted_by_name || "-"} {session?.submitted_at ? `- ${formatFactoryDateTime(session.submitted_at)}` : ""} - Verified by {session?.verified_by_name || "-"} {session?.verified_at ? `- ${formatFactoryDateTime(session.verified_at)}` : ""}</div>
      {loading ? <div className="py-8 text-center text-sm font-semibold text-text-secondary">Loading Operator Hygiene Inspection...</div> : null}
    </> : null}

    {tab === "monthly" ? <>
      <FactoryDailyToolbar><div className="w-full sm:w-[170px]"><Field label="Month"><FactoryMonthPicker value={month} onChange={setMonth} /></Field></div><div className="w-full sm:w-[260px]"><Field label="Employee"><div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" /><input className={`${inputClass()} pl-9`} value={employeeQuery} placeholder="Search employee" onChange={(event) => setEmployeeQuery(event.target.value)} /></div></Field></div></FactoryDailyToolbar>
      <FactoryDataSurface><FactoryComplianceMatrix rows={visibleMatrix} days={monthDays(month)} rowKey={(row) => row.employee_id} entityLabel="Employee" frequencyLabel="Summary" renderEntity={(row) => row.employee_name} renderSecondary={(row) => row.position || "—"} renderFrequency={(row) => `${row.summary?.inspected_count || 0} inspected · ${row.summary?.compliant_count || 0} compliant · ${row.summary?.non_compliant_count || 0} non-compliant`} getCell={(row, day) => { const cell = row.days?.[day]; return cell ? { ...cell, inspection_date: day, status: cell.state === "compliant" ? "verified" : cell.state === "non_compliant" ? "missed" : "completed" } : null; }} cellLabel={(cell) => cell.state === "compliant" ? "Pass" : cell.state === "non_compliant" ? "Fail" : "Pending"} cellTitle={(cell, row) => `${row.employee_name} on ${formatFactoryDate(cell.inspection_date)}: ${label(cell.state)}`} onCellClick={(cell, row) => setDetail({ ...cell, employee_id: row.employee_id, employee_name: row.employee_name, position: row.position })} empty={<div className="py-10 text-center text-sm font-semibold text-text-secondary">No monthly inspection evidence.</div>} /></FactoryDataSurface>
      {loading ? <div className="py-8 text-center text-sm font-semibold text-text-secondary">Loading monthly compliance...</div> : null}
    </> : null}

    {sessionDetailOpen ? <SessionDetail daily={daily} date={date} onClose={() => setSessionDetailOpen(false)} /> : null}
    <EntryDetail entry={detail} session={session} date={date} onClose={() => setDetail(null)} />
  </div>;
}
