import { useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { malaysiaStateName } from "../../../constants/malaysiaStates.js";
import PayrollHolidayWorkflow from "./PayrollHolidayWorkflow.jsx";

const kinds = [
  { value: "", label: "Review classification" },
  { value: "required", label: "Mandatory paid holiday" },
  { value: "gazetted", label: "Available for company paid selection" },
  { value: "special", label: "Specially declared" },
  { value: "substitute", label: "Substituted holiday" },
];
const entityName = (e) => e.display_name || e.name || e.legal_company_name;
const scopeLabel = (h) => h.scope === "national" ? "National" : malaysiaStateName(h.state_code);

// Source classification is an explicit review, never inferred from holiday names.
export function annualCalendarEntries(holidays, year, previous = []) {
  return holidays.filter(h => h.is_active && !h.legal_entity_id && ["national", "state"].includes(h.scope)
    && h.holiday_date?.startsWith(String(year))).map(h => {
    const e = previous.find(x => x.holiday_id === h.id);
    return { holiday_id: h.id, kind: e?.kind || "", source_reference: e?.source_reference || h.source_note || "",
      substitutes_holiday_id: e?.substitutes_holiday_id || "", holiday: h };
  });
}

export default function PayrollAnnualHolidays({ data, canManage, onAddHoliday, onViewHoliday, onCompanyChanged, onChanged }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [annual, setAnnual] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({});
  const [refresh, setRefresh] = useState(0);
  const [operation, setOperation] = useState("");
  const [company, setCompany] = useState("all");
  const [companyBenefit, setCompanyBenefit] = useState(false);
  const [additionalReview, setAdditionalReview] = useState(null);
  const [additionalEvidence, setAdditionalEvidence] = useState(null);
  useEffect(() => {
    let active = true;
    setAnnual(null); setError("");
    payrollService.readAnnualHolidays(year).then(value => { if (active) setAnnual(value); })
      .catch(e => { if (active) setError(e.message || "Unable to load annual holiday policy."); });
    return () => { active = false; };
  }, [year, refresh, data]);
  const calendars = annual?.calendars || [];
  const latest = calendars[0];
  const published = calendars.find(c => c.status === "published");
  const policies = (annual?.policies || []).filter((p, i, list) => list.findIndex(x => x.policy_id === p.policy_id) === i);
  const defaultPolicy = company === "all" ? policies.find(p => p.is_default) : policies.find(p => !p.outlet_ids?.length && p.legal_entity_ids?.length === 1 && p.legal_entity_ids.includes(company));
  useEffect(() => {
    let current = true; setCompanyBenefit(false);
    if (company !== "all") payrollService.readPhPolicy(company).then(rows => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
      const date = year === String(currentYear) ? today : `${year}-01-01`;
      if (current) setCompanyBenefit(rows.some(row => row.effective_from <= date));
    }).catch(cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [company, year, refresh, data]);
  const selection = defaultPolicy?.selected_holiday_ids || [];
  const benefitReady = company === "all" ? annual?.benefit_ready : companyBenefit;
  const ready = benefitReady && latest?.status === "published" && defaultPolicy?.status === "published" && defaultPolicy.calendar_version_id === published?.id && selection.length >= 11;
  const readiness = ready ? `${year} Public Holiday setup complete` : "Prepare official dates, select paid holidays, then publish.";
  const exceptional = (data.holidays || []).filter(h => h.holiday_date?.startsWith(year)
    && (h.legal_entity_id || h.scope === "outlet"));
  const years = [String(currentYear + 1), String(currentYear), String(currentYear - 1)];
  const editCalendar = () => {
    setDraft({ entries: latest?.entries?.length ? latest.entries.map(entry => ({ ...entry })) : annualCalendarEntries(data.holidays || [], year), source: latest?.source_reference || "", complete: latest?.source_complete || false,
      previousId: annual?.previous_calendar_id || latest?.id, requestId: crypto.randomUUID(), overrideId: latest?.entries?.[0]?.holiday_id || "", overrideReason: "" });
    setEditing("calendar"); setError("");
  };
  const editPolicy = (policy, exception = false) => {
    const calendar = published;
    setDraft({ name: policy?.name || `${year} Company Paid Holidays`, calendarId: calendar?.id,
      selected: [...new Set([...(calendar?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id),
        ...(policy?.selected_holiday_ids || []).filter(id => calendar?.entries.some(e => e.holiday_id === id))])],
      entities: policy?.legal_entity_ids || [], outlets: policy?.outlet_ids || [], reason: policy?.override_reason || "",
      previousId: policy?.id, requestId: crypto.randomUUID(), fixedScope: !!policy, exception });
    setEditing("policy"); setError("");
  };
  const patch = (key, value) => setDraft(({ saveRequestId, publishRequestId, ...d }) => ({ ...d, [key]: value, requestId: crypto.randomUUID() }));
  const select = (key, id, checked) => patch(key, checked ? [...draft[key], id] : draft[key].filter(x => x !== id));
  const save = async (publish) => {
    setBusy(true); setError("");
    try {
      // Intent changes require a new request identity; transport retries may reuse it.
      const input = { ...draft, publish, requestId: draft[`${publish ? "publish" : "save"}RequestId`] || crypto.randomUUID() };
      setDraft(d => ({ ...d, [`${publish ? "publish" : "save"}RequestId`]: input.requestId }));
      if (editing === "calendar") await payrollService.saveAnnualCalendar({ ...input, year, source: `${input.source}\nClassification override reason: ${input.overrideReason.trim()}`,
        entries: input.entries.map(({ holiday, ...entry }) => ({ ...entry, substitutes_holiday_id: entry.substitutes_holiday_id || null })) });
      else if (draft.exception) await payrollService.savePaidHolidayPolicy(input);
      else await payrollService.saveDefaultPaidHolidays(input);
      setEditing(null); setRefresh(n => n + 1);
    } catch (e) { setError(e.message || "Unable to save annual holiday evidence."); }
    finally { setBusy(false); }
  };
  const editable = canManage && annual?.can_manage;
  const calendarReady = draft.entries?.length > 0 && draft.entries.every(e => e.kind && e.source_reference.trim()
    && (e.kind !== "substitute" || e.substitutes_holiday_id));
  const policyCalendar = calendars.find(c => c.id === draft.calendarId);
  const policyReady = !!draft.name?.trim() && (!draft.exception || draft.entities?.length > 0) && !!draft.calendarId
    && (!draft.outlets?.length || !!draft.reason?.trim());
  const canSave = editing === "calendar" ? calendarReady && !!draft.source?.trim() && !!draft.overrideReason?.trim() : policyReady;
  const advancedContent = <>
    {editable && <section aria-label="Calendar Maintenance" className="border-t border-border py-3"><h4 className="font-bold">Calendar Maintenance</h4><p className="my-3 text-text-secondary">Manual overrides require authoritative evidence and a reason. Changes create a new calendar revision; published company selections and historical evidence remain unchanged.</p><div className="flex flex-wrap gap-3"><button className="btn-secondary" disabled={!latest} onClick={editCalendar}>Override Classification</button><button className="btn-secondary" onClick={onAddHoliday}>Add Sourced Holiday</button></div></section>}
    <section aria-label="Holiday History" className="border-t border-border py-3"><h4 className="font-bold">History</h4>
      <h5 className="mt-3 font-semibold">Calendar versions / Publication history</h5>
      {calendars.length ? calendars.map(c => <p key={c.id} className="py-2 break-words">Calendar {c.revision} · {c.status} · {c.source_reference}</p>) : <p className="py-2 text-text-secondary">No calendar versions yet.</p>}
      <h5 className="mt-3 font-semibold">Company policy history</h5>
      {annual?.policies?.length ? annual.policies.map(p => <p key={p.id} className="py-2">{p.name} · Revision {p.revision} · {p.status} · {p.selected_holiday_ids.length} selected</p>) : <p className="py-2 text-text-secondary">No company policy versions yet.</p>}
      {(annual?.history || []).map(e => <p key={e.id} className="py-1 text-xs text-text-secondary">{e.occurred_at} · {e.event_type.replaceAll("_", " ")}</p>)}
      <h5 className="mt-3 font-semibold">Historical / exceptional definitions ({exceptional.length})</h5><p className="my-2 text-xs text-text-secondary">Retained source evidence. These are not automatically selected Company Paid Holidays.</p>
      {exceptional.length ? <div className="divide-y divide-border">{exceptional.map(h => <div key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm"><div><strong>{h.name}</strong><p className="text-text-secondary">{h.holiday_date} · {h.scope === "outlet" ? "Outlet definition" : "Historical company definition"}</p></div><button type="button" className="text-primary" onClick={() => onViewHoliday(h.id)}>View</button></div>)}</div> : <p className="py-2 text-text-secondary">No historical or exceptional definitions.</p>}
    </section>
  </>;
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
      <div><h3 className="text-lg font-bold">Public Holidays</h3><p className="text-sm text-text-secondary">{annual ? readiness : "Prepare the annual calendar, paid holidays and work benefit."}</p></div>
      <div className="flex flex-wrap items-end gap-3"><SelectField label="Year" value={year} onChange={setYear} options={years.map(value => ({ value, label: value }))} />
        <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Setup Required"}</Badge></div>
    </div>
    {error && !editing && <div role="alert" className="p-4 text-sm text-rose-700">{error}<button type="button" className="ml-3 text-primary" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
    {!annual && !error ? <p className="p-4 text-sm text-text-secondary">Loading annual calendar…</p> : annual && <>
      <PayrollHolidayWorkflow operation={operation} onOperationChanged={setOperation} year={year} annual={annual} editable={editable} advancedContent={advancedContent} onAdditionalReview={setAdditionalReview} onPublished={() => { setRefresh(n=>n+1); onChanged?.(); }} />
      <section className="p-4">
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">Manage exceptions</summary><p className="my-2 text-text-secondary">Explicit company/outlet calendars retain their own scope. Changing an existing scope requires a separate policy; it is never silently reassigned.</p>
          <SelectField label="Review company selection" value={company} onChange={value => { setCompany(value); onCompanyChanged?.(value); }} options={[{ value: "all", label: "All applicable companies" }, ...(data.legal_entities || []).filter(e => e.is_active !== false).map(e => ({ value: e.id, label: entityName(e) }))]} />
          {policies.filter(p => !p.is_default).map(p => <div key={p.id} className="flex justify-between gap-3 py-2"><span>{p.legal_entity_ids.map(id => entityName((data.legal_entities || []).find(e => e.id === id) || {})).join(", ")} · {p.selected_holiday_ids.length} selected</span>{editable && <button className="text-primary" onClick={() => editPolicy(p, true)}>Review</button>}</div>)}
          {editable && <button className="btn-secondary" disabled={!published} onClick={() => editPolicy(null, true)}>Add Exception</button>}
        </details>
      </section>
      {!editable && <details className="border-t border-border p-4 text-sm"><summary className="cursor-pointer text-text-secondary">Advanced &amp; History</summary>{advancedContent}</details>}
    </>}
    {additionalReview && <Modal title="Review Additional Paid Entitlement" size="lg" onClose={() => !busy && setAdditionalReview(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={() => setAdditionalReview(null)}>Cancel</button><button className="btn-primary" disabled={busy || !additionalReview.attested || !additionalReview.reference.trim()} onClick={async () => {
      setBusy(true); setError("");
      try { await payrollService.confirmAdditionalHoliday(additionalReview); setAdditionalReview(null); setRefresh(n => n + 1); onChanged?.(); }
      catch (cause) { setError(cause.message); } finally { setBusy(false); }
    }}>{busy ? "Confirming…" : "Confirm Additional Entitlement"}</button></>}>
      <p className="font-semibold">{additionalReview.name} · {additionalReview.date}</p>
      <p className="my-3 text-sm text-text-secondary">Confirm mandatory paid status against the captured gazette and applicable employment-law evidence. This addition does not consume a company selection slot. Published company policies advance to a new revision; the annual source calendar and historical payroll remain unchanged.</p>
      <AdminFormField label="Authoritative entitlement evidence" required><textarea className="control" value={additionalReview.reference} onChange={e => setAdditionalReview(old => ({ ...old, reference: e.target.value, requestId: crypto.randomUUID() }))} /></AdminFormField>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={additionalReview.attested} onChange={e => setAdditionalReview(old => ({ ...old, attested: e.target.checked }))} />I verified the additional paid entitlement, date and jurisdiction against authoritative evidence.</label>
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    </Modal>}
    {additionalEvidence && <Modal title={additionalEvidence.holiday.name} description={`${additionalEvidence.holiday.holiday_date} · Additional gazetted holidays`} onClose={() => setAdditionalEvidence(null)} footer={<button className="btn-secondary" onClick={() => setAdditionalEvidence(null)}>Close</button>}>
      <p className="text-sm">{scopeLabel(additionalEvidence.holiday)} · Mandatory paid entitlement · No company selection slot</p>
      <h4 className="mt-4 font-bold">Authoritative evidence</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm">{additionalEvidence.entitlement_reference}</p>
      <details className="mt-4 text-sm"><summary className="cursor-pointer text-text-secondary">Source / Confirmation history</summary><p className="my-2 break-words">{additionalEvidence.source_reference}</p><p>Confirmed {additionalEvidence.confirmed_at}</p><p className="mt-2 break-all text-xs">SHA-256: {additionalEvidence.source_sha256}</p></details>
    </Modal>}
    {editing && <Modal size="xl" title={editing === "calendar" ? "Override Holiday Classification" : "Select Paid Holidays"}
      onClose={() => !busy && setEditing(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        {(editing !== "policy" || draft.exception) && <button className="btn-secondary" disabled={busy || !canSave} onClick={() => save(false)}>Save Draft</button>}
        <button className="btn-primary" disabled={busy || !canSave || (editing === "calendar" && !draft.complete)} onClick={() => save(true)}>{busy ? "Saving…" : "Publish"}</button></>}>
      {editing === "calendar" ? <div className="space-y-4">
        <p className="text-sm text-text-secondary">Source maintenance only. Select the holiday to override; all other reviewed classifications are preserved.</p>
        <SelectField label="Holiday to override" value={draft.overrideId} onChange={id => patch("overrideId", id)} options={draft.entries.map(e => ({ value: e.holiday_id, label: `${e.holiday.name} · ${e.holiday.holiday_date}` }))} />
        <AdminFormField label="Override reason" required><textarea className="control" value={draft.overrideReason} onChange={e => patch("overrideReason", e.target.value)} /></AdminFormField>
        <AdminFormField label="Official calendar / gazette reference" required><input className="control" value={draft.source} onChange={e => patch("source", e.target.value)} /></AdminFormField>
        {!draft.entries.length && <p className="text-sm text-text-secondary">No shared National/State holidays for this year. Add sourced definitions first.</p>}
        <div className="divide-y divide-border">{draft.entries.map((e, index) => e.holiday_id !== draft.overrideId ? null : <div key={e.holiday_id} className="grid gap-3 py-3 md:grid-cols-2"><div><strong>{e.holiday.name}</strong><p className="text-sm text-text-secondary">{e.holiday.holiday_date} · {scopeLabel(e.holiday)}</p></div>
          <SelectField label={`Classification — ${e.holiday.name}`} value={e.kind} disabled={published?.entries.some(x => x.holiday_id === e.holiday_id && x.kind === "required")} onChange={kind => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, kind } : x))} options={kinds} />
          <AdminFormField label={`Source — ${e.holiday.name}`}><input className="control" value={e.source_reference} onChange={event => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, source_reference: event.target.value } : x))} /></AdminFormField>
          {e.kind === "substitute" && <SelectField label="Original holiday" value={e.substitutes_holiday_id} onChange={id => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, substitutes_holiday_id: id } : x))} options={[{ value: "", label: "Select original holiday" }, ...draft.entries.filter(x => x.holiday_id !== e.holiday_id).map(x => ({ value: x.holiday_id, label: x.holiday.name }))]} />}
        </div>)}</div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={draft.complete} onChange={e => patch("complete", e.target.checked)} />I have reviewed the complete official annual source and all applicable National/State holidays and classifications.</label>
      </div> : <div className="space-y-4">
        {!draft.exception && <p className="text-sm font-semibold">Applies to: All applicable companies</p>}
        {draft.exception && <AdminFormField label="Exception name" required><input className="control" value={draft.name} onChange={e => patch("name", e.target.value)} /></AdminFormField>}
        {draft.exception && <SelectField label="Published calendar" value={draft.calendarId} options={calendars.filter(c => c.status === "published").map(c => ({ value: c.id, label: `Version ${c.revision} · ${c.source_reference}` }))}
          onChange={id => { const c = calendars.find(x => x.id === id); patch("calendarId", id); patch("selected", (c?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id)); }} />}
        <p className="text-sm text-text-secondary">Mandatory paid holidays cannot be deselected.</p>
        {draft.exception && <fieldset><legend className="mb-2 font-semibold">Applicable Legal Entities</legend><div className="flex flex-wrap gap-4">{(data.legal_entities || []).map(e => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={draft.fixedScope} checked={draft.entities.includes(e.id)} onChange={event => select("entities", e.id, event.target.checked)} />{entityName(e)}</label>)}</div></fieldset>}
        {draft.exception && <details><summary className="cursor-pointer text-sm text-text-secondary">Explicit outlet calendar override</summary><p className="my-2 text-xs text-text-secondary">Leave empty to share this policy across all company outlets. Use only for a genuinely different calendar.</p>
          <div className="flex flex-wrap gap-4">{(data.outlets || []).map(o => <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={draft.fixedScope} checked={draft.outlets.includes(o.id)} onChange={e => select("outlets", o.id, e.target.checked)} />{o.name}</label>)}</div>
          {!!draft.outlets.length && <AdminFormField label="Calendar override reason" required><input className="control" value={draft.reason} onChange={e => patch("reason", e.target.value)} /></AdminFormField>}</details>}
        <div className="divide-y divide-border">{(policyCalendar?.entries || []).map(e => <label key={e.holiday_id} className="flex items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" disabled={e.kind === "required"} checked={draft.selected.includes(e.holiday_id)} onChange={event => select("selected", e.holiday_id, event.target.checked)} /><div><strong>{e.holiday.name}</strong><p className="text-text-secondary">{e.holiday.holiday_date} · {scopeLabel(e.holiday)}{e.kind === "required" ? " · Required" : ""}</p></div></label>)}</div>
      </div>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
    </Modal>}
  </Card>;
}
