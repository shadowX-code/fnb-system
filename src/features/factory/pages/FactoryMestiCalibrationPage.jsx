import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { factoryService } from "../../../services/factoryService.js";
import { formatFactoryDate, malaysiaBusinessDateInput } from "../utils/factoryDates.js";

const frequencies = [1, 3, 6, 12];
const tones = { current: "success", due_soon: "warning", due: "warning", overdue: "danger", failed: "danger", inactive: "neutral", awaiting_verification: "info", verified: "success" };
const label = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const emptyRequirement = () => ({ equipment_id: "", calibration_type: "Temperature", interval_months: 1, effective_from: malaysiaBusinessDateInput(), status: "active" });
const emptyRecord = (row) => ({ scheduled_due_date: row.next_due, calibrated_date: malaysiaBusinessDateInput(), result: "pass", provider_name: "", reference_no: "", notes: "" });

function matchesFilter(row, query, status, location) {
  const text = `${row.equipment_name || row.equipment_snapshot?.equipment_name || ""} ${row.equipment_code || row.equipment_snapshot?.equipment_code || ""} ${row.calibration_type || ""}`.toLowerCase();
  return (!query || text.includes(query.toLowerCase())) && (!status || row.status === status) && (!location || row.location_name === location || row.equipment_snapshot?.location_name === location);
}

function FilterBar({ filters, locations, setFilters }) {
  return <div className="flex flex-wrap gap-2 border-b border-border p-3">
    <input className={`${inputClass()} min-w-48 flex-1`} value={filters.query} placeholder="Search equipment or calibration type" onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
    <SearchableSelect value={filters.status} options={[{ value: "", label: "All statuses" }, ...Object.keys(tones).map((value) => ({ value, label: label(value) }))]} onChange={(status) => setFilters((current) => ({ ...current, status }))} />
    <SearchableSelect value={filters.location} options={[{ value: "", label: "All locations" }, ...locations.map((value) => ({ value, label: value }))]} onChange={(location) => setFilters((current) => ({ ...current, location }))} />
  </div>;
}

export default function FactoryMestiCalibrationPage({ onNotify, onRefreshFactoryData }) {
  const master = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const [tab, setTab] = useState("schedule");
  const [schedule, setSchedule] = useState([]);
  const [records, setRecords] = useState([]);
  const [requirement, setRequirement] = useState(null);
  const [recording, setRecording] = useState(null);
  const [recordForm, setRecordForm] = useState(null);
  const [settings, setSettings] = useState(master.mestiCalibrationSettings || { responsible_role_id: "", verifier_role_id: "" });
  const [filters, setFilters] = useState({ query: "", status: "", location: "" });
  const [error, setError] = useState("");
  const requirements = master.mestiCalibrationRequirements || [];
  const equipment = master.equipment || [];
  const roles = master.factoryRoles || [];
  const canManage = can("factory_mesti_calibration.manage");
  const locations = useMemo(() => [...new Set([...schedule.map((row) => row.location_name), ...records.map((row) => row.equipment_snapshot?.location_name)].filter(Boolean))].sort(), [records, schedule]);
  const visibleSchedule = useMemo(() => schedule.filter((row) => matchesFilter(row, filters.query, filters.status, filters.location)), [filters, schedule]);
  const visibleRecords = useMemo(() => records.filter((row) => matchesFilter(row, filters.query, filters.status, filters.location)), [filters, records]);

  useEffect(() => setSettings(master.mestiCalibrationSettings || { responsible_role_id: "", verifier_role_id: "" }), [master.mestiCalibrationSettings]);
  const load = useCallback(async () => {
    try {
      setError("");
      const [nextSchedule, nextRecords] = await Promise.all([factoryService.listMestiCalibrationSchedule(), factoryService.listMestiCalibrationRecords()]);
      setSchedule(nextSchedule);
      setRecords(nextRecords);
    } catch (loadError) { setError(loadError.message || "Unable to load Calibration."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveRequirement(event) {
    event.preventDefault();
    try {
      const saved = await factoryService.saveMestiCalibrationRequirement(requirement);
      setRequirement(null);
      await onRefreshFactoryData?.({ silent: true });
      await load();
      onNotify?.({ title: saved?.version_created ? "Calibration requirement version created" : "Calibration requirement unchanged", tone: "success" });
    } catch (saveError) { setError(saveError.message); }
  }
  async function saveSettings(event) {
    event.preventDefault();
    try { await factoryService.saveMestiCalibrationSettings(settings); await onRefreshFactoryData?.({ silent: true }); onNotify?.({ title: "Calibration settings saved", tone: "success" }); } catch (saveError) { setError(saveError.message); }
  }
  async function record(event) {
    event.preventDefault();
    try { await factoryService.recordMestiCalibration(recording.id, recordForm); setRecording(null); await load(); onNotify?.({ title: "Calibration recorded", tone: "success" }); } catch (recordError) { setError(recordError.message); }
  }
  async function verify(id) {
    try { await factoryService.verifyMestiCalibration(id); await load(); onNotify?.({ title: "Calibration verified", tone: "success" }); } catch (verifyError) { setError(verifyError.message); }
  }

  return <div className="space-y-5">
    <PageHeader section="MeSTI" title="Calibration Schedule & Record" description="Periodic equipment calibration, verification, and immutable history." actions={<button className="btn-secondary" type="button" onClick={load}><RefreshCw size={15} /> Refresh</button>} />
    <div className="flex gap-2 rounded-lg border border-border bg-white p-2">{["schedule", "records", "setup"].map((item) => <button key={item} type="button" className={`rounded-md px-4 py-2 text-sm font-bold ${tab === item ? "bg-primary text-white" : "text-text-secondary"}`} onClick={() => setTab(item)}>{label(item)}</button>)}</div>
    {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div> : null}
    {tab === "schedule" ? <Card title="Calibration Schedule"><FilterBar filters={filters} locations={locations} setFilters={setFilters} /><FactoryTable rows={visibleSchedule} columns={[
      { key: "equipment", label: "Equipment", render: (row) => <div><div className="font-bold">{row.equipment_name}</div><div className="text-xs text-text-secondary">{row.equipment_code}</div></div> },
      { key: "category", label: "Category", render: (row) => row.category_name || "-" }, { key: "location", label: "Location", render: (row) => row.location_name || "-" }, { key: "type", label: "Calibration Type", render: (row) => row.calibration_type }, { key: "frequency", label: "Frequency", render: (row) => `${row.interval_months} month${row.interval_months === 1 ? "" : "s"}` }, { key: "last", label: "Last Valid Calibration", render: (row) => formatFactoryDate(row.last_calibration) }, { key: "next", label: "Next Due", render: (row) => formatFactoryDate(row.next_due) }, { key: "status", label: "Status", render: (row) => <Badge tone={tones[row.status] || "neutral"}>{label(row.status)}</Badge> },
      { key: "actions", label: "Actions", align: "right", render: (row) => <button className="btn-primary px-3 py-1.5 text-xs" type="button" disabled={row.status === "inactive" || (!can("factory_mesti_calibration.complete") && !canManage)} onClick={() => { setRecording(row); setRecordForm(emptyRecord(row)); }}>Record Calibration</button> },
    ]} emptyTitle="No Calibration Requirements" emptyDescription="Create an active requirement in Setup." /></Card> : null}
    {tab === "records" ? <Card title="Calibration Records"><FilterBar filters={filters} locations={locations} setFilters={setFilters} /><FactoryTable rows={visibleRecords} columns={[
      { key: "date", label: "Calibrated Date", render: (row) => formatFactoryDate(row.calibrated_date) }, { key: "equipment", label: "Equipment", render: (row) => row.equipment_snapshot?.equipment_name || "-" }, { key: "type", label: "Calibration Type", render: (row) => requirements.find((item) => item.id === row.requirement_id)?.calibration_type || "Historical requirement" }, { key: "due", label: "Scheduled Due", render: (row) => formatFactoryDate(row.scheduled_due_date) }, { key: "result", label: "Result", render: (row) => <Badge tone={row.result === "pass" ? "success" : "danger"}>{label(row.result)}</Badge> }, { key: "performed", label: "Recorded By", render: (row) => row.recorded_by_name || "-" }, { key: "provider", label: "Provider", render: (row) => row.provider_name || "-" }, { key: "verification", label: "Verification", render: (row) => <Badge tone={tones[row.status]}>{label(row.status)}</Badge> }, { key: "actions", label: "Actions", align: "right", render: (row) => row.status === "awaiting_verification" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={!can("factory_mesti_calibration.review") && !canManage} onClick={() => verify(row.id)}><Check size={13} /> Verify</button> : null },
    ]} emptyTitle="No Calibration Records" emptyDescription="Recorded calibration evidence remains after requirement changes." /></Card> : null}
    {tab === "setup" ? <><Card title="Calibration Settings"><form className="grid gap-3 p-4 md:grid-cols-3" onSubmit={saveSettings}><Field label="Responsible Role"><SearchableSelect value={settings.responsible_role_id || ""} options={roles.map((role) => ({ value: role.id, label: role.name }))} onChange={(responsible_role_id) => setSettings((current) => ({ ...current, responsible_role_id }))} placeholder="Configure role" /></Field><Field label="Verifier Role"><SearchableSelect value={settings.verifier_role_id || ""} options={roles.map((role) => ({ value: role.id, label: role.name }))} onChange={(verifier_role_id) => setSettings((current) => ({ ...current, verifier_role_id }))} placeholder="Configure role" /></Field><div className="flex items-end"><button className="btn-primary" disabled={!canManage}>Save Settings</button></div></form></Card><Card title="Calibration Requirements" action={<button className="btn-primary" type="button" disabled={!canManage} onClick={() => setRequirement(emptyRequirement())}><Plus size={15} /> Requirement</button>}><FactoryTable rows={requirements} columns={[
      { key: "equipment", label: "Equipment", render: (row) => row.equipment?.name || "-" }, { key: "type", label: "Calibration Type", render: (row) => row.calibration_type }, { key: "frequency", label: "Frequency", render: (row) => `${row.interval_months} months` }, { key: "effective", label: "Effective From", render: (row) => formatFactoryDate(row.effective_from) }, { key: "version", label: "Version", render: (row) => `Version ${row.version_no}` }, { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{label(row.status)}</Badge> }, { key: "actions", label: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={!canManage} onClick={() => setRequirement({ ...row })}>Edit</button> },
    ]} emptyTitle="No Calibration Requirements" /></Card></> : null}
    {requirement ? <Modal title={requirement.id ? "Edit Calibration Requirement" : "Create Calibration Requirement"} onClose={() => setRequirement(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setRequirement(null)}>Cancel</button><button className="btn-primary" type="submit" form="calibration-requirement">Save Requirement</button></>}><form id="calibration-requirement" className="grid gap-3" onSubmit={saveRequirement}><Field label="Equipment"><SearchableSelect value={requirement.equipment_id} options={equipment.filter((item) => item.status === "active" || item.id === requirement.equipment_id).map((item) => ({ value: item.id, label: `${item.name} · ${item.location?.location_name || "No location"}` }))} onChange={(equipment_id) => setRequirement((current) => ({ ...current, equipment_id }))} /></Field><Field label="Calibration Type"><input className={inputClass()} value={requirement.calibration_type} onChange={(event) => setRequirement((current) => ({ ...current, calibration_type: event.target.value }))} /></Field><Field label="Interval"><SearchableSelect value={String(requirement.interval_months)} options={frequencies.map((value) => ({ value: String(value), label: `${value} month${value === 1 ? "" : "s"}` }))} onChange={(value) => setRequirement((current) => ({ ...current, interval_months: Number(value) }))} /></Field><Field label="Effective From"><FeedXDatePicker value={requirement.effective_from} onChange={(effective_from) => setRequirement((current) => ({ ...current, effective_from }))} /></Field><Field label="Status"><SearchableSelect value={requirement.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(status) => setRequirement((current) => ({ ...current, status }))} /></Field></form></Modal> : null}
    {recording ? <Modal title="Record Calibration" description={`${recording.equipment_name} · ${recording.calibration_type}`} onClose={() => setRecording(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setRecording(null)}>Cancel</button><button className="btn-primary" type="submit" form="calibration-record">Submit Record</button></>}><form id="calibration-record" className="grid gap-3" onSubmit={record}><Field label="Scheduled Due"><input className={inputClass()} readOnly value={recordForm.scheduled_due_date} /></Field><Field label="Calibrated Date"><FeedXDatePicker value={recordForm.calibrated_date} onChange={(calibrated_date) => setRecordForm((current) => ({ ...current, calibrated_date }))} /></Field><Field label="Result"><SearchableSelect value={recordForm.result} options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }]} onChange={(result) => setRecordForm((current) => ({ ...current, result }))} /></Field><Field label="Provider"><input className={inputClass()} value={recordForm.provider_name} onChange={(event) => setRecordForm((current) => ({ ...current, provider_name: event.target.value }))} /></Field><Field label="Reference No"><input className={inputClass()} value={recordForm.reference_no} onChange={(event) => setRecordForm((current) => ({ ...current, reference_no: event.target.value }))} /></Field><Field label="Notes"><textarea className={inputClass()} value={recordForm.notes} onChange={(event) => setRecordForm((current) => ({ ...current, notes: event.target.value }))} /></Field></form></Modal> : null}
  </div>;
}
