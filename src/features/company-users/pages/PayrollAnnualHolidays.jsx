import { useEffect, useState } from "react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { malaysiaStateName } from "../../../constants/malaysiaStates.js";

const kinds = [
  { value: "", label: "Review classification" },
  { value: "required", label: "Required paid holiday" },
  { value: "gazetted", label: "Other gazetted holiday" },
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

export default function PayrollAnnualHolidays({ data, canManage, onAddHoliday, onViewHoliday }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [annual, setAnnual] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setAnnual(null); setError("");
    payrollService.readAnnualHolidays(year).then(value => { if (active) setAnnual(value); })
      .catch(e => { if (active) setError(e.message || "Unable to load annual holiday policy."); });
    return () => { active = false; };
  }, [year, refresh]);
  const calendars = annual?.calendars || [];
  const latest = calendars[0];
  const published = calendars.find(c => c.status === "published");
  const policies = (annual?.policies || []).filter((p, i, list) => list.findIndex(x => x.policy_id === p.policy_id) === i);
  const entries = annualCalendarEntries(data.holidays || [], year, latest?.entries);
  const exceptional = (data.holidays || []).filter(h => h.holiday_date?.startsWith(year)
    && (h.legal_entity_id || h.scope === "outlet"));
  const years = [...new Set([String(currentYear - 1), String(currentYear), String(currentYear + 1),
    ...(data.holidays || []).map(h => h.holiday_date?.slice(0, 4)).filter(Boolean)])].sort().reverse();
  const editCalendar = () => {
    setDraft({ entries, source: latest?.source_reference || "", complete: latest?.source_complete || false,
      previousId: latest?.id, requestId: crypto.randomUUID() });
    setEditing("calendar"); setError("");
  };
  const editPolicy = (policy) => {
    const calendar = calendars.find(c => c.id === policy?.calendar_version_id) || published;
    setDraft({ name: policy?.name || `${year} Company Paid Holidays`, calendarId: calendar?.id,
      selected: policy?.selected_holiday_ids || (calendar?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id),
      entities: policy?.legal_entity_ids || [], outlets: policy?.outlet_ids || [], reason: policy?.override_reason || "",
      previousId: policy?.id, requestId: crypto.randomUUID(), fixedScope: !!policy });
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
      if (editing === "calendar") await payrollService.saveAnnualCalendar({ ...input, year,
        entries: input.entries.map(({ holiday, ...entry }) => ({ ...entry, substitutes_holiday_id: entry.substitutes_holiday_id || null })) });
      else await payrollService.savePaidHolidayPolicy(input);
      setEditing(null); setRefresh(n => n + 1);
    } catch (e) { setError(e.message || "Unable to save annual holiday evidence."); }
    finally { setBusy(false); }
  };
  const editable = canManage && annual?.can_manage;
  const calendarReady = draft.entries?.length > 0 && draft.entries.every(e => e.kind && e.source_reference.trim()
    && (e.kind !== "substitute" || e.substitutes_holiday_id));
  const policyCalendar = calendars.find(c => c.id === draft.calendarId);
  const policyReady = !!draft.name?.trim() && draft.entities?.length > 0 && !!draft.calendarId
    && (!draft.outlets?.length || !!draft.reason?.trim());
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
      <div><h3 className="text-lg font-bold">Annual Paid Holidays</h3><p className="text-sm text-text-secondary">Official calendar → company selection → published paid holidays.</p></div>
      <div className="flex flex-wrap items-end gap-3"><SelectField label="Year" value={year} onChange={setYear} options={years.map(value => ({ value, label: value }))} />
        {editable && <button type="button" className="btn-secondary" onClick={onAddHoliday}>Add Holiday</button>}</div>
    </div>
    {error && !editing && <div role="alert" className="p-4 text-sm text-rose-700">{error}<button type="button" className="ml-3 text-primary" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
    {!annual && !error ? <p className="p-4 text-sm text-text-secondary">Loading annual calendar…</p> : annual && <>
      <section className="border-b border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">1. Annual Calendar</h4>
        <p className="text-sm text-text-secondary">{latest ? `${latest.entries.length} source-reviewed holidays · Version ${latest.revision}` : "Official annual source not yet reviewed. No dates have been generated."}</p></div>
        <div className="flex items-center gap-3"><Badge tone={latest?.status === "published" ? "success" : "warning"}>{latest?.status === "published" ? "Published" : "Review Required"}</Badge>
          {editable && <button type="button" className="btn-secondary" onClick={editCalendar}>Review Calendar</button>}</div></div>
        {latest && <p className="mt-2 text-xs text-text-secondary">Source: {latest.source_reference}</p>}
        {entries.length > 0 && <div className="mt-3"><DataTable density="compact" rows={entries} getRowKey={e => e.holiday_id} columns={[
          { key: "date", header: "Date", render: e => e.holiday.holiday_date },
          { key: "name", header: "Holiday", render: e => <strong>{e.holiday.name}</strong> },
          { key: "scope", header: "Scope", render: e => scopeLabel(e.holiday) },
          { key: "kind", header: "Classification", render: e => kinds.find(k => k.value === e.kind)?.label || "Review required" },
          { key: "view", header: "Action", render: e => <button type="button" className="text-primary" onClick={() => onViewHoliday(e.holiday_id)}>View</button> },
        ]} /></div>}
      </section>
      <section className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">2. Company Paid Holiday Policy</h4><p className="text-sm text-text-secondary">Gazetted holidays trigger payroll treatment only when selected in an applicable published policy.</p></div>
        {editable && <button type="button" className="btn-primary" disabled={!published} onClick={() => editPolicy(null)}>Select Paid Holidays</button>}</div>
        {!policies.length ? <p className="mt-3 text-sm text-text-secondary">{published ? "Select the company paid holidays and applicable Legal Entities. Required holidays remain selected." : "Publish the source-reviewed annual calendar first."}</p>
          : <div className="mt-3 divide-y divide-border">{policies.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{p.name}</strong><p className="text-text-secondary">{p.selected_holiday_ids.length} selected · {p.legal_entity_ids.map(id => entityName((data.legal_entities || []).find(e => e.id === id) || {})).join(", ")}{p.outlet_ids.length ? " · Explicit outlet override" : " · Shared company calendar"}</p></div><div className="flex items-center gap-3"><Badge tone={p.status === "published" ? "success" : "warning"}>{p.status === "published" ? "Ready · Published" : "Draft · Review Required"}</Badge>{editable && <button type="button" className="text-primary font-semibold" onClick={() => editPolicy(p)}>Review</button>}</div></div>)}</div>}
      </section>
      {!!exceptional.length && <details className="border-t border-border p-4"><summary className="cursor-pointer text-sm text-text-secondary">Historical / exceptional definitions ({exceptional.length})</summary><p className="my-2 text-xs text-text-secondary">Retained source evidence. These are not automatically selected Company Paid Holidays.</p><div className="divide-y divide-border">{exceptional.map(h => <div key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm"><div><strong>{h.name}</strong><p className="text-text-secondary">{h.holiday_date} · {h.scope === "outlet" ? "Outlet definition" : "Historical company definition"}</p></div><button type="button" className="text-primary" onClick={() => onViewHoliday(h.id)}>View</button></div>)}</div></details>}
    </>}
    {editing && <Modal size="xl" title={editing === "calendar" ? `Review ${year} Annual Calendar` : "Select Company Paid Holidays"}
      onClose={() => !busy && setEditing(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        <button className="btn-secondary" disabled={busy || (editing === "calendar" ? !calendarReady || !draft.source?.trim() : !policyReady)} onClick={() => save(false)}>Save Draft</button>
        <button className="btn-primary" disabled={busy || (editing === "calendar" ? !calendarReady || !draft.source?.trim() || !draft.complete : !policyReady)} onClick={() => save(true)}>{busy ? "Saving…" : "Publish"}</button></>}>
      {editing === "calendar" ? <div className="space-y-4">
        <p className="text-sm text-text-secondary">Classify each holiday from its authoritative source. This review does not generate official dates or certify statutory compliance.</p>
        <AdminFormField label="Official calendar / gazette reference" required><input className="control" value={draft.source} onChange={e => patch("source", e.target.value)} /></AdminFormField>
        {!draft.entries.length && <p className="text-sm text-text-secondary">No shared National/State holidays for this year. Add sourced definitions first.</p>}
        <div className="divide-y divide-border">{draft.entries.map((e, index) => <div key={e.holiday_id} className="grid gap-3 py-3 md:grid-cols-2"><div><strong>{e.holiday.name}</strong><p className="text-sm text-text-secondary">{e.holiday.holiday_date} · {scopeLabel(e.holiday)}</p></div>
          <SelectField label={`Classification — ${e.holiday.name}`} value={e.kind} disabled={published?.entries.some(x => x.holiday_id === e.holiday_id && x.kind === "required")} onChange={kind => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, kind } : x))} options={kinds} />
          <AdminFormField label={`Source — ${e.holiday.name}`}><input className="control" value={e.source_reference} onChange={event => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, source_reference: event.target.value } : x))} /></AdminFormField>
          {e.kind === "substitute" && <SelectField label="Original holiday" value={e.substitutes_holiday_id} onChange={id => patch("entries", draft.entries.map((x, i) => i === index ? { ...x, substitutes_holiday_id: id } : x))} options={[{ value: "", label: "Select original holiday" }, ...draft.entries.filter(x => x.holiday_id !== e.holiday_id).map(x => ({ value: x.holiday_id, label: x.holiday.name }))]} />}
        </div>)}</div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={draft.complete} onChange={e => patch("complete", e.target.checked)} />I have reviewed the complete official annual source and all applicable National/State holidays and classifications.</label>
      </div> : <div className="space-y-4">
        <AdminFormField label="Policy name" required><input className="control" value={draft.name} onChange={e => patch("name", e.target.value)} /></AdminFormField>
        <SelectField label="Published calendar" value={draft.calendarId} options={calendars.filter(c => c.status === "published").map(c => ({ value: c.id, label: `Version ${c.revision} · ${c.source_reference}` }))}
          onChange={id => { const c = calendars.find(x => x.id === id); patch("calendarId", id); patch("selected", (c?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id)); }} />
        <p className="text-sm text-text-secondary">Calendar version {policyCalendar?.revision} · {policyCalendar?.source_reference}. Required holidays cannot be deselected.</p>
        <fieldset><legend className="mb-2 font-semibold">Applicable Legal Entities</legend><div className="flex flex-wrap gap-4">{(data.legal_entities || []).map(e => <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={draft.fixedScope} checked={draft.entities.includes(e.id)} onChange={event => select("entities", e.id, event.target.checked)} />{entityName(e)}</label>)}</div></fieldset>
        <details><summary className="cursor-pointer text-sm text-text-secondary">Explicit outlet calendar override</summary><p className="my-2 text-xs text-text-secondary">Leave empty to share this policy across all company outlets. Use only for a genuinely different calendar.</p>
          <div className="flex flex-wrap gap-4">{(data.outlets || []).map(o => <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={draft.fixedScope} checked={draft.outlets.includes(o.id)} onChange={e => select("outlets", o.id, e.target.checked)} />{o.name}</label>)}</div>
          {!!draft.outlets.length && <AdminFormField label="Calendar override reason" required><input className="control" value={draft.reason} onChange={e => patch("reason", e.target.value)} /></AdminFormField>}</details>
        <div className="divide-y divide-border">{(policyCalendar?.entries || []).map(e => <label key={e.holiday_id} className="flex items-start gap-3 py-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" disabled={e.kind === "required"} checked={draft.selected.includes(e.holiday_id)} onChange={event => select("selected", e.holiday_id, event.target.checked)} /><div><strong>{e.holiday.name}</strong><p className="text-text-secondary">{e.holiday.holiday_date} · {scopeLabel(e.holiday)}{e.kind === "required" ? " · Required" : ""}</p></div></label>)}</div>
      </div>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
    </Modal>}
  </Card>;
}
