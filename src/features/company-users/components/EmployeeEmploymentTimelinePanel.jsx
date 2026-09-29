import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { employeeEmploymentService } from "../../../services/employeeEmploymentService.js";

const fields = [
  ["employment_type", "Employment Type"],
  ["employment_status", "Employment Status"],
  ["position", "Position"],
  ["legal_entity_id", "Legal Employer"],
  ["workplace", "Workplace"],
];
const typeOptions = [
  { value: "probation", label: "Probation" },
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
  { value: "intern", label: "Intern" },
  { value: "contract", label: "Contract" },
];
const statusOptions = [
  { value: "active", label: "Active" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
];

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (key) => parts.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function assignmentOf(revision) {
  return Object.fromEntries(fields.map(([key]) => [key, revision?.[key] ?? ""]));
}

function displayValue(key, value, entities) {
  if (key === "legal_entity_id") {
    const entity = entities.find((entry) => entry.id === value);
    return entity?.display_name || entity?.legal_company_name || (value ? "Former employer" : "Not assigned");
  }
  if (key === "employment_type") return typeOptions.find((entry) => entry.value === value)?.label || value || "Missing";
  if (key === "employment_status") return statusOptions.find((entry) => entry.value === value)?.label || value || "Missing";
  return value || "Missing";
}

export default function EmployeeEmploymentTimelinePanel({ employeeId, canEdit, positions, workplaces, legalEntities, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(malaysiaToday);
  const [read, setRead] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [reason, setReason] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!employeeId || (!open && !editing)) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    employeeEmploymentService.read(employeeId, effectiveFrom)
      .then((result) => {
        if (!active) return;
        setRead(result);
        setAssignment(assignmentOf(result.assignment));
      })
      .catch((failure) => { if (active) { setRead(null); setAssignment(null); setError(failure.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, effectiveFrom, open, editing]);

  const before = assignmentOf(read?.assignment);
  const changed = assignment && fields.some(([key]) => assignment[key] !== before[key]);
  const isHistorical = effectiveFrom < malaysiaToday();
  const isFuture = effectiveFrom > malaysiaToday();
  const revisions = read?.revisions || [];

  async function confirm() {
    if (!read?.assignment || !changed || reason.trim().length < 3 || loading || saving) return;
    setSaving(true);
    setError("");
    try {
      await employeeEmploymentService.save({
        employeeId, effectiveFrom, assignment, reason: reason.trim(),
        expectedRevisionId: read.assignment.id,
        evidenceReference: evidenceReference.trim() || null,
      });
      setEditing(false);
      setOpen(true);
      setReason("");
      setEvidenceReference("");
      const latest = await employeeEmploymentService.read(employeeId, malaysiaToday());
      setRead(latest);
      setAssignment(assignmentOf(latest.assignment));
      await onSaved?.();
    } catch (failure) {
      setError(failure.message || "Employment change could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="mt-3 border-t border-border pt-3">
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide Employment Timeline" : "Employment Timeline"}
      </button>
      {canEdit && <button className="btn-secondary h-9 px-3 text-xs" type="button" onClick={() => {
        setEffectiveFrom(malaysiaToday()); setReason(""); setEvidenceReference(""); setEditing(true); setOpen(false);
      }}>Change Employment</button>}
    </div>
    {open && <div className="mt-3 rounded-xl border border-border bg-surface p-3 text-sm">
      {loading ? <p className="text-text-secondary">Loading employment history…</p>
        : error ? <p role="alert" className="text-rose-700">{error}</p>
          : <>
            <p className="text-xs text-text-secondary">Verified assignment history starts {read?.verified_from || "when this employee was created"}. Earlier periods are unresolved.</p>
            <div className="mt-2 divide-y divide-border">
              {revisions.map((item) => <div key={item.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <span>{item.effective_from}</span>
                  <span className="text-text-secondary">{displayValue("employment_type", item.employment_type, legalEntities)} · {displayValue("employment_status", item.employment_status, legalEntities)} · {item.position || "Position missing"}</span>
                  {item.effective_from > malaysiaToday() && <span className="text-amber-700">Scheduled</span>}
                  {item.supersedes_revision_id && <span className="text-text-secondary">Correction</span>}
                  {revisions.some((other) => other.supersedes_revision_id === item.id) && <span className="text-text-secondary">Superseded</span>}
                </div>
                <div className="text-xs text-text-secondary">{displayValue("legal_entity_id", item.legal_entity_id, legalEntities)} · {item.workplace || "Workplace missing"}</div>
                <div className="text-xs text-text-secondary">{item.reason} · Recorded {new Date(item.recorded_at).toLocaleString()}</div>
                {item.evidence_reference && <div className="text-xs text-text-secondary">Evidence: {item.evidence_reference}</div>}
              </div>)}
            </div>
          </>}
    </div>}
    {editing && createPortal(<Modal title="Change Employment" description="Choose when the complete employment assignment takes effect." size="lg" onClose={() => setEditing(false)}
      footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button><button className="btn-primary" type="button" disabled={saving || loading || !changed || reason.trim().length < 3 || !read?.assignment} onClick={confirm}>{saving ? "Saving…" : "Confirm Employment Change"}</button></>}>
      <div className="space-y-4">
        <DatePickerField label="Effective from" required value={effectiveFrom} onChange={setEffectiveFrom} />
        {isHistorical && <p className="text-sm text-amber-700">Historical correction. Prior evidence remains in the timeline; finalized records will not change.</p>}
        {isFuture && <p className="text-sm text-text-secondary">Scheduled change. Current Employee and Crew Access remain unchanged until this date.</p>}
        {loading ? <p className="text-sm text-text-secondary">Loading the assignment for this date…</p>
          : read?.state === "unresolved" ? <p role="alert" className="text-sm text-amber-700">Employment before the verified baseline is unresolved. Do not guess the earlier assignment.</p>
            : <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Employment Type" value={assignment?.employment_type || ""} onChange={(value) => setAssignment((current) => ({ ...current, employment_type: value }))} options={typeOptions} />
                <SelectField label="Employment Status" value={assignment?.employment_status || ""} onChange={(value) => setAssignment((current) => ({ ...current, employment_status: value }))} options={statusOptions} />
                <SelectField label="Position" searchable value={assignment?.position || ""} onChange={(value) => setAssignment((current) => ({ ...current, position: value }))} options={positions.map((item) => ({ value: item.name, label: item.name }))} />
                <SelectField label="Legal Employer" searchable value={assignment?.legal_entity_id || ""} onChange={(value) => setAssignment((current) => ({ ...current, legal_entity_id: value }))} options={[{ value: "", label: "Not assigned" }, ...legalEntities.filter((item) => item.is_active || item.id === assignment?.legal_entity_id).map((item) => ({ value: item.id, label: item.display_name || item.legal_company_name }))]} />
                <SelectField label="Workplace" searchable value={assignment?.workplace || ""} onChange={(value) => setAssignment((current) => ({ ...current, workplace: value }))} options={workplaces.map((item) => ({ value: item, label: item }))} />
              </div>
              {changed && <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm">
                <div className="font-semibold">Review change · {effectiveFrom}</div>
                {fields.filter(([key]) => assignment[key] !== before[key]).map(([key, label]) => <div key={key} className="mt-1 grid grid-cols-[120px_1fr] gap-2"><span className="text-text-secondary">{label}</span><span>{displayValue(key, before[key], legalEntities)} → <strong>{displayValue(key, assignment[key], legalEntities)}</strong></span></div>)}
              </div>}
              <label className="block text-sm font-semibold">Reason <textarea className="control mt-1 min-h-20 w-full py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this assignment changing?" /></label>
              <label className="block text-sm font-semibold">Evidence / reference <span className="font-normal text-text-secondary">(optional)</span><input className="control mt-1 w-full" value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
            </>}
        {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
      </div>
    </Modal>, document.body)}
  </div>;
}
