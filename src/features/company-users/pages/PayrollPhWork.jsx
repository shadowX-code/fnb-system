import { useEffect, useRef, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import { payrollService } from "../../../services/payrollService.js";

const treatments = [{ value: "additional_pay", label: "Additional Pay" }, { value: "replacement_leave", label: "Replacement Leave" }];
const label = (value) => treatments.find(item => item.value === value)?.label || "Policy required";
const money = (value) => value == null ? "—" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);
const clock = value => value ? new Date(value).toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const range = (start, end) => `${clock(start)} – ${clock(end)}`;

export function PayrollPhPolicy({ entities, canManage }) {
  const [entityId, setEntityId] = useState("all");
  const [versions, setVersions] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeEntities = entities.filter(e => e.is_active !== false);
  const load = async (id) => id === "all" ? Promise.all(activeEntities.map(async e => ({ entity: e, rows: await payrollService.readPhPolicy(e.id) }))) : payrollService.readPhPolicy(id);
  useEffect(() => { let current = true; setVersions(null); setDraft(null); setError("");
    if (entityId) load(entityId).then(rows => { if (current) setVersions(rows); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [entityId]);
  const save = async () => { setBusy(true); setError("");
    try { if (entityId === "all") await payrollService.saveDefaultPhPolicy(draft); else await payrollService.savePhPolicy({ entityId, ...draft }); setVersions(await load(entityId)); setDraft(null); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  const rows = entityId === "all" ? (versions || []).flatMap(v => v.rows.slice(0, 1)) : (versions || []);
  const uniform = rows.length > 0 && (entityId !== "all" || rows.length === activeEntities.length) && rows.every(v => v.treatment === rows[0].treatment && v.effective_from === rows[0].effective_from);
  return <Card className="space-y-3 p-4"><div><h3 className="font-bold">Working on a Paid Holiday</h3>
    <p className="text-sm text-text-secondary">A company benefit for confirmed work on selected paid holidays. Not a statutory premium or substitute for statutory entitlements.</p></div>
    <p className="text-sm">Applies to: {entityId === "all" ? "All applicable companies" : activeEntities.find(e => e.id === entityId)?.display_name || activeEntities.find(e => e.id === entityId)?.name}</p>
    <details className="text-sm"><summary className="cursor-pointer text-primary">Manage exceptions / History</summary><div className="mt-3"><SelectField label="Company" value={entityId} onChange={setEntityId} options={[{ value: "all", label: "All applicable companies" }, ...activeEntities.map(e => ({ value: e.id, label: e.display_name || e.name }))]} /></div>
      {rows.map(v => <p key={v.id} className="mt-2 text-text-secondary">{v.effective_from} · {label(v.treatment)}{v.remark ? ` · ${v.remark}` : ""}</p>)}
    </details>
    {entityId && versions === null && !error && <p role="status">Loading policy…</p>}
    {versions && <p className="text-sm"><strong>{uniform ? label(rows[0].treatment) : rows.length ? "Company-specific benefits — review exceptions" : "Setup Required"}</strong>{uniform ? ` · Effective ${rows[0].effective_from}` : ""}</p>}
    <p className="text-xs text-text-secondary">Additional Pay: Monthly Basic / 26 × 1 ordinary day; Hourly Rate × approved PH hours. Replacement Leave: 1 day, valid until 31 December of the entitlement year, no carry-forward.</p>
    {canManage && entityId && versions && !draft && <button className="btn-secondary" type="button" onClick={() => setDraft({ date: "", treatment: rows[0]?.treatment || "additional_pay", remark: "" })}>Edit Policy</button>}
    {draft && <Modal title="Edit PH Work Policy" onClose={() => !busy && setDraft(null)} footer={<><button className="btn-secondary" type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy || !draft.date} onClick={save}>{busy ? "Saving…" : "Confirm Policy"}</button></>}><div className="space-y-3"><p className="text-sm">Applies to: {entityId === "all" ? "All applicable companies" : "Selected company exception"}. Existing historical policies are not changed.</p><SelectField label="Default Benefit" value={draft.treatment} onChange={treatment => setDraft(old => ({ ...old, treatment }))} options={treatments} />
      <p className="text-xs text-text-secondary">Additional Pay: Monthly Basic / 26 × 1 day; Hourly Rate × approved PH hours. Replacement Leave: 1 day, expires 31 December, no carry-forward.</p>
      <DatePickerField label="Effective From" value={draft.date} onChange={date => setDraft(old => ({ ...old, date }))} />
      <AdminFormField label="Remark (Optional)"><input className="control" value={draft.remark} onChange={e => setDraft(old => ({ ...old, remark: e.target.value }))} /></AdminFormField>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div></Modal>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </Card>;
}

export default function PayrollPhWork({ runId, employeeId, canManage, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const generation = useRef(0);
  const load = async () => {
    const request = ++generation.current;
    const result = await payrollService.readPhWork(runId, employeeId);
    if (request === generation.current) setRows(result);
  };
  useEffect(() => { setRows(null); setEditing(null); setError(""); load().catch(e => setError(e.message)); return () => { generation.current++; }; }, [runId, employeeId]);
  const confirm = async (row, treatment, remark = "") => {
    setBusy(true); setError("");
    // A failed transport keeps the exact request for safe retry. Changed intent
    // creates a new identity; server owns amount, actor, evidence and recalculation.
    const intent = `${row.work_date}:${row.source_fingerprint}:${treatment}:${remark}`;
    const requestId = editing?.intent === intent ? editing.requestId : crypto.randomUUID();
    setEditing({ date: row.work_date, treatment, remark, intent, requestId });
    try { await payrollService.confirmPhWork({ runId, employeeId, workDate: row.work_date, treatment, remark, fingerprint: row.source_fingerprint, requestId });
      setEditing(null); await load(); await onChanged?.(); }
    catch (cause) { setError(cause.message); await load(); }
    finally { setBusy(false); }
  };
  if (rows?.length === 0 && !error) return null;
  return <section className="space-y-3 border-t border-border pt-4"><h4 className="font-bold">Public Holiday Work</h4>
    <p className="text-xs text-text-secondary">Company benefit only. Statutory PH obligations remain separate; PH overtime is unsupported.</p>
    {rows === null && !error && <p role="status">Loading PH work…</p>}
    {rows?.map(row => { const decision = row.decision; const treatment = decision?.treatment || row.recommended_treatment;
      const unresolved = !!row.issue; const edit = editing?.date === row.work_date;
      return <div key={row.work_date} className="space-y-2 border-b border-border pb-3"><div className="flex justify-between gap-3"><strong>{row.work_date} · {(row.source?.paid_holiday_policy?.holidays || []).map(h => h.holiday?.name).filter(Boolean).join(" / ") || "Company Paid Holiday"}</strong>
        <Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Review Required" : "Confirmed"}</Badge></div>
        <dl className="grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-text-secondary">Published Roster</dt><dd>{range(row.source?.scheduled_start_at, row.source?.scheduled_end_at)}</dd></div>
          <div><dt className="text-text-secondary">Clock In–Out</dt><dd>{range(row.source?.clock_in_at, row.source?.clock_out_at)}</dd></div>
          <div><dt className="text-text-secondary">Approved Payable Time</dt><dd>{(Number(row.time?.approved_minutes || 0) / 60).toFixed(2)} h</dd></div></dl>
        <p><strong>{label(treatment)}</strong> · {treatment === "replacement_leave" ? row.grant_id && !unresolved ? "1 day granted" : "1 day · expires 31 December" : money(row.additional_amount)}
          {!decision?.id && row.recommended_treatment && <small className="ml-2 text-text-secondary">Recommended</small>}</p>
        {treatment === "additional_pay" && <p className="text-xs text-text-secondary">{row.formula} · {row.compensation?.pay_basis === "monthly" ? `${money(row.compensation.basic_salary)} / 26` : `${money(row.compensation?.hourly_rate)} × ${(Number(row.time?.approved_minutes) / 60).toFixed(2)} h`}</p>}
        {row.issue && <p className="text-xs text-amber-800">{row.issue === "ph_treatment_confirmation_required" ? "Confirm the company treatment." : row.issue === "ph_treatment_evidence_changed" ? "Source evidence changed. Review and confirm again." : row.issue === "ph_company_policy_required" ? "Set a date-effective company policy in Public Holidays Settings." : "Supported approved PH hours and company policy are required."}</p>}
        {canManage && row.policy?.id && row.issue !== "public_holiday_ot_unsupported" && <div className="space-y-2">
          {!edit ? <div className="flex flex-wrap gap-3"><button type="button" className="btn-primary" disabled={busy} onClick={() => confirm(row, row.recommended_treatment)}>Use Recommended Treatment</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing({ date: row.work_date, treatment, remark: "" })}>Change Treatment</button></div>
            : <><SelectField label="Company Treatment" value={editing.treatment} onChange={value => setEditing(old => ({ ...old, treatment: value, intent: null }))} options={treatments} />
              <AdminFormField label="Remark (Optional)"><input className="control" value={editing.remark} onChange={e => setEditing(old => ({ ...old, remark: e.target.value, intent: null }))} /></AdminFormField>
              <div className="flex gap-2"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary" type="button" disabled={busy} onClick={() => confirm(row, editing.treatment, editing.remark)}>{busy ? "Confirming…" : "Confirm Treatment"}</button></div></>}
        </div>}
      </div>;
    })}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </section>;
}
