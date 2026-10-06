import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { employeeEmploymentService } from "../../../services/employeeEmploymentService.js";
import { employmentStatusOptions } from "../employmentStatus.js";

const fields = [
  ["employment_type", "Employment Type"],
  ["employment_status", "Employment Status"],
  ["position", "Position"],
  ["legal_entity_id", "Legal Employer"],
  ["workplace", "Workplace"],
  ["employment_jurisdiction", "Employment Jurisdiction"],
];
const jurisdictionOptions = [
  { value: "", label: "Not confirmed" },
  { value: "peninsular_labuan", label: "Peninsular Malaysia / Labuan" },
  { value: "sabah", label: "Sabah" },
  { value: "sarawak", label: "Sarawak" },
  { value: "unresolved", label: "Unresolved" },
];
const typeOptions = [
  { value: "probation", label: "Probation" },
  { value: "full_time", label: "Full-Time" },
  { value: "part_time", label: "Part-Time" },
  { value: "intern", label: "Intern" },
  { value: "contract", label: "Contract" },
];

function malaysiaToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (key) => parts.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function displayAssignmentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value;
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function assignmentOf(revision) {
  return Object.fromEntries(fields.map(([key]) => [key, revision?.[key] ?? ""]));
}

function displayValue(key, value, entities) {
  if (key === "employment_jurisdiction") return jurisdictionOptions.find((entry) => entry.value === value)?.label || "Not confirmed";
  if (key === "legal_entity_id") {
    const entity = entities.find((entry) => entry.id === value);
    return entity?.display_name || entity?.legal_company_name || (value ? "Former employer" : "Not assigned");
  }
  if (key === "employment_type") return typeOptions.find((entry) => entry.value === value)?.label || value || "Missing";
  if (key === "employment_status") return employmentStatusOptions.find((entry) => entry.value === value)?.label || value || "Missing";
  return value || "Missing";
}

export default function EmployeeEmploymentTimelinePanel({ employeeId, joinedDate, canEdit, positions, workplaces, legalEntities, onSaved }) {
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

  const currentRead = read?.as_of === effectiveFrom ? read : null;
  const before = assignmentOf(currentRead?.assignment);
  const isBaselineCorrection = currentRead?.state === "unresolved" && currentRead?.verified_from && effectiveFrom < currentRead.verified_from;
  const missingFields = fields.filter(([key]) => !["legal_entity_id", "employment_jurisdiction"].includes(key) && !String(assignment?.[key] || "").trim()).map(([, label]) => label);
  const changed = assignment && fields.some(([key]) => assignment[key] !== before[key]);
  const isHistorical = effectiveFrom < malaysiaToday();
  const isFuture = effectiveFrom > malaysiaToday();
  const revisions = read?.revisions || [];
  const beforeJoinedDate = isBaselineCorrection && joinedDate && effectiveFrom < joinedDate;
  const canConfirm = Boolean(currentRead && !loading && !saving && !beforeJoinedDate && !missingFields.length
    && reason.trim().length >= 3 && (isBaselineCorrection || (currentRead.assignment && changed)));

  async function confirm() {
    if (!canConfirm) return;
    setSaving(true);
    setError("");
    try {
      await employeeEmploymentService.save({
        employeeId, effectiveFrom, assignment, reason: reason.trim(),
        expectedRevisionId: currentRead.assignment?.id ?? null,
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
                  {item.corrects_revision_id && <span className="text-text-secondary">{item.effective_from < (revisions.find((prior) => prior.id === item.corrects_revision_id)?.effective_from || item.effective_from) ? "Historical baseline correction" : "Correction"}</span>}
                  {revisions.some((other) => other.supersedes_revision_id === item.id) && <span className="text-text-secondary">Superseded</span>}
                </div>
                <div className="text-xs text-text-secondary">{displayValue("legal_entity_id", item.legal_entity_id, legalEntities)} · {item.workplace || "Workplace missing"} · {displayValue("employment_jurisdiction", item.employment_jurisdiction, legalEntities)}</div>
                <div className="text-xs text-text-secondary">{item.reason} · Recorded {new Date(item.recorded_at).toLocaleString()}</div>
                {item.evidence_reference && <div className="text-xs text-text-secondary">Evidence: {item.evidence_reference}</div>}
              </div>)}
            </div>
          </>}
    </div>}
    {editing && createPortal(<Modal title="Change Employment" description="Choose when the complete employment assignment takes effect." size="lg" onClose={() => setEditing(false)}
      footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button><button className="btn-primary" type="button" disabled={!canConfirm} onClick={confirm}>{saving ? "Saving…" : isBaselineCorrection ? "Confirm Historical Employment" : "Confirm Employment Change"}</button></>}>
      <div className="space-y-4">
        <DatePickerField label="Effective from" required value={effectiveFrom} onChange={setEffectiveFrom} />
        {isBaselineCorrection ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><strong>Historical employment correction</strong><p className="mt-1">This assignment will establish verified employment from {displayAssignmentDate(effectiveFrom)}. Enter all known fields. Existing finalized records will not be changed; earlier dates remain unverified.</p></div>
          : isHistorical && <p className="text-sm text-amber-700">Historical correction. Prior evidence remains in the timeline; finalized records will not change.</p>}
        {isFuture && <p className="text-sm text-text-secondary">Scheduled change. Current Employee and Crew Access remain unchanged until this date.</p>}
        {loading || !currentRead ? <p className="text-sm text-text-secondary">Loading the assignment for this date…</p>
          : currentRead.state === "unresolved" && !isBaselineCorrection ? <p role="alert" className="text-sm text-amber-700">No verified employment baseline is available for this date.</p>
            : <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Employment Type" required value={assignment?.employment_type || ""} onChange={(value) => setAssignment((current) => ({ ...current, employment_type: value }))} options={typeOptions} />
                <SelectField label="Employment Status" required value={assignment?.employment_status || ""} onChange={(value) => setAssignment((current) => ({ ...current, employment_status: value }))} options={employmentStatusOptions} />
                <SelectField label="Position" required searchable value={assignment?.position || ""} onChange={(value) => setAssignment((current) => ({ ...current, position: value }))} options={positions.map((item) => ({ value: item.name, label: item.name }))} />
                <SelectField label="Legal Employer" searchable value={assignment?.legal_entity_id || ""} onChange={(value) => setAssignment((current) => ({ ...current, legal_entity_id: value }))} options={[{ value: "", label: "Not assigned" }, ...legalEntities.filter((item) => item.is_active || item.id === assignment?.legal_entity_id).map((item) => ({ value: item.id, label: item.display_name || item.legal_company_name }))]} />
                <SelectField label="Workplace" required searchable value={assignment?.workplace || ""} onChange={(value) => setAssignment((current) => ({ ...current, workplace: value }))} options={workplaces.map((item) => ({ value: item, label: item }))} />
                <SelectField label="Employment Jurisdiction" value={assignment?.employment_jurisdiction || ""} onChange={(value) => setAssignment((current) => ({ ...current, employment_jurisdiction: value }))} options={jurisdictionOptions} />
              </div>
              {(changed || isBaselineCorrection) && <div className="rounded-xl border border-border bg-slate-50 p-3 text-sm">
                <div className="font-semibold">{isBaselineCorrection ? "Review verified assignment" : "Review change"} · {effectiveFrom}</div>
                {fields.filter(([key]) => isBaselineCorrection || assignment[key] !== before[key]).map(([key, label]) => <div key={key} className="mt-1 grid grid-cols-[120px_1fr] gap-2"><span className="text-text-secondary">{label}</span><span>{isBaselineCorrection ? <strong>{displayValue(key, assignment[key], legalEntities)}</strong> : <>{displayValue(key, before[key], legalEntities)} → <strong>{displayValue(key, assignment[key], legalEntities)}</strong></>}</span></div>)}
              </div>}
              <label className="block text-sm font-semibold">Reason <textarea className="control mt-1 min-h-20 w-full py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this assignment changing?" /></label>
              <label className="block text-sm font-semibold">Evidence / reference <span className="font-normal text-text-secondary">(optional)</span><input className="control mt-1 w-full" value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} /></label>
              {beforeJoinedDate ? <p role="alert" className="text-sm font-semibold text-amber-800">Effective date cannot precede this employee’s Joined Date ({joinedDate}).</p>
                : isBaselineCorrection && missingFields.length ? <p role="alert" className="text-sm font-semibold text-amber-800">Select {missingFields.join(", ")} to confirm this historical assignment.</p>
                  : isBaselineCorrection && reason.trim().length < 3 ? <p role="alert" className="text-sm font-semibold text-amber-800">Enter a reason of at least 3 characters to confirm this historical assignment.</p> : null}
            </>}
        {error && <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p>}
      </div>
    </Modal>, document.body)}
  </div>;
}
