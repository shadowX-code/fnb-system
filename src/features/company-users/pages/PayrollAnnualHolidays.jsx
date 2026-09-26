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
  }, [year, refresh, data]);
  const calendars = annual?.calendars || [];
  const latest = calendars[0];
  const published = calendars.find(c => c.status === "published");
  const policies = (annual?.policies || []).filter((p, i, list) => list.findIndex(x => x.policy_id === p.policy_id) === i);
  const defaultPolicy = policies.find(p => p.is_default);
  const entries = latest?.entries || [];
  const selection = defaultPolicy?.selected_holiday_ids || [];
  const required = entries.filter(e => e.kind === "required");
  const optional = entries.filter(e => e.kind !== "required");
  const ready = annual?.benefit_ready && latest?.status === "published" && defaultPolicy?.status === "published" && defaultPolicy.calendar_version_id === published?.id;
  const exceptional = (data.holidays || []).filter(h => h.holiday_date?.startsWith(year)
    && (h.legal_entity_id || h.scope === "outlet"));
  const years = [String(currentYear + 1), String(currentYear), String(currentYear - 1)];
  const editCalendar = () => {
    setDraft({ entries: annualCalendarEntries(data.holidays || [], year, latest?.entries), source: latest?.source_reference || "", complete: latest?.source_complete || false,
      previousId: annual?.previous_calendar_id || latest?.id, requestId: crypto.randomUUID() });
    setEditing("calendar"); setError("");
  };
  const editPolicy = (policy, exception = false) => {
    const calendar = published;
    setDraft({ name: policy?.name || `${year} Company Paid Holidays`, calendarId: calendar?.id,
      selected: policy?.selected_holiday_ids || (calendar?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id),
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
      if (editing === "calendar") await payrollService.saveAnnualCalendar({ ...input, year,
        entries: input.entries.map(({ holiday, ...entry }) => ({ ...entry, substitutes_holiday_id: entry.substitutes_holiday_id || null })) });
      else if (editing === "import") await payrollService.importHolidayCalendar({ ...input, year, previousId: annual?.previous_calendar_id || latest?.id });
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
  const importFile = async (file) => {
    setError("");
    try {
      if (!file || file.size > 1024 * 1024) throw new Error("Choose a JSON manifest smaller than 1 MB.");
      const manifest = JSON.parse(await file.text());
      if (!manifest.source_reference || !Array.isArray(manifest.holidays) || !manifest.holidays.length) throw new Error("The manifest needs source_reference and reviewed holidays.");
      setDraft({ manifest, requestId: crypto.randomUUID() });
    } catch (cause) { setDraft({}); setError(cause.message); }
  };
  const canSave = editing === "import" ? !!draft.manifest : editing === "calendar" ? calendarReady && !!draft.source?.trim() : policyReady;
  return <Card className="overflow-hidden">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
      <div><h3 className="text-lg font-bold">Public Holidays</h3><p className="text-sm text-text-secondary">Holiday Calendar · Company Policy</p></div>
      <div className="flex flex-wrap items-end gap-3"><SelectField label="Year" value={year} onChange={setYear} options={years.map(value => ({ value, label: value }))} />
        <Badge tone={ready ? "success" : "warning"}>{ready ? "Ready" : "Setup Required"}</Badge></div>
    </div>
    {error && !editing && <div role="alert" className="p-4 text-sm text-rose-700">{error}<button type="button" className="ml-3 text-primary" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
    {!annual && !error ? <p className="p-4 text-sm text-text-secondary">Loading annual calendar…</p> : annual && <>
      <section className="border-b border-border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">Holiday Calendar</h4>
        <p className="text-sm text-text-secondary">{latest ? "Review holidays, then confirm the company selection." : "Import a reviewed official annual calendar. No dates have been generated."}</p></div>
        {editable && <button type="button" className="btn-secondary" onClick={() => { setDraft({}); setEditing("import"); setError(""); }}>Import Calendar</button>}</div>
        <dl className="my-4 grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-text-secondary">Required holidays</dt><dd className="font-semibold">{required.filter(e => selection.includes(e.holiday_id)).length}/{required.length}</dd></div>
          <div><dt className="text-text-secondary">Company selected</dt><dd className="font-semibold">{optional.filter(e => selection.includes(e.holiday_id)).length}/{optional.length}</dd></div>
          <div><dt className="text-text-secondary">Total paid holidays</dt><dd className="font-semibold">{selection.length}</dd></div>
          <div><dt className="text-text-secondary">Geography</dt><dd>Malaysia · applicable states</dd></div>
        </dl>
        {defaultPolicy && published && defaultPolicy.calendar_version_id !== published.id && <p role="status" className="mb-3 text-sm text-amber-800">Calendar updated. Review and publish the company selection; the existing policy has not changed.</p>}
        {entries.length > 0 && <div className="mt-3"><DataTable density="compact" rows={entries} getRowKey={e => e.holiday_id} columns={[
          { key: "date", header: "Date", render: e => e.holiday.holiday_date },
          { key: "name", header: "Holiday", render: e => <strong>{e.holiday.name}</strong> },
          { key: "scope", header: "Scope", render: e => scopeLabel(e.holiday) },
          { key: "kind", header: "Company Status", render: e => e.kind === "required" ? "Required" : !e.kind ? "Review Required" : selection.includes(e.holiday_id) ? "Selected" : "Not Selected" },
          { key: "view", header: "Action", render: e => <button type="button" className="text-primary" onClick={() => onViewHoliday(e.holiday_id)}>View</button> },
        ]} /></div>}
      </section>
      <section className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-bold">Company Policy</h4><p className="text-sm text-text-secondary">Applies to: All applicable companies</p></div>
        {editable && <button type="button" className="btn-primary" disabled={!published} onClick={() => editPolicy(defaultPolicy)}>Select Paid Holidays</button>}</div>
        <p className="mt-2 text-sm text-text-secondary">{published ? "Required holidays stay selected. Choose additional company-observed holidays, then publish." : "Publish the reviewed annual calendar first."}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-primary">Manage exceptions</summary><p className="my-2 text-text-secondary">Explicit company/outlet calendars retain their own scope. Changing an existing scope requires a separate policy; it is never silently reassigned.</p>
          {policies.filter(p => !p.is_default).map(p => <div key={p.id} className="flex justify-between gap-3 py-2"><span>{p.legal_entity_ids.map(id => entityName((data.legal_entities || []).find(e => e.id === id) || {})).join(", ")} · {p.selected_holiday_ids.length} selected</span>{editable && <button className="text-primary" onClick={() => editPolicy(p, true)}>Review</button>}</div>)}
          {editable && <button className="btn-secondary" disabled={!published} onClick={() => editPolicy(null, true)}>Add Exception</button>}
        </details>
      </section>
      <details className="border-t border-border p-4 text-sm"><summary className="cursor-pointer text-text-secondary">View details / History</summary>
        {calendars.map(c => <p key={c.id} className="py-2">Calendar {c.revision} · {c.status} · {c.source_reference}</p>)}
        {(annual.history || []).map(e => <p key={e.id} className="py-1 text-xs text-text-secondary">{e.occurred_at} · {e.event_type.replaceAll("_", " ")}</p>)}
        {editable && <div className="mt-3 flex gap-3"><button className="btn-secondary" onClick={editCalendar}>Resolve Calendar Exceptions</button><button className="btn-secondary" onClick={onAddHoliday}>Add Sourced Holiday</button></div>}
      </details>
      {!!exceptional.length && <details className="border-t border-border p-4"><summary className="cursor-pointer text-sm text-text-secondary">Historical / exceptional definitions ({exceptional.length})</summary><p className="my-2 text-xs text-text-secondary">Retained source evidence. These are not automatically selected Company Paid Holidays.</p><div className="divide-y divide-border">{exceptional.map(h => <div key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm"><div><strong>{h.name}</strong><p className="text-text-secondary">{h.holiday_date} · {h.scope === "outlet" ? "Outlet definition" : "Historical company definition"}</p></div><button type="button" className="text-primary" onClick={() => onViewHoliday(h.id)}>View</button></div>)}</div></details>}
    </>}
    {editing && <Modal size="xl" title={editing === "import" ? "Import Holiday Calendar" : editing === "calendar" ? `Review ${year} Calendar Exceptions` : "Select Paid Holidays"}
      onClose={() => !busy && setEditing(null)} footer={<><button className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        {(editing !== "policy" || draft.exception) && <button className="btn-secondary" disabled={busy || !canSave} onClick={() => save(false)}>Save Draft</button>}
        <button className="btn-primary" disabled={busy || !canSave || (editing === "calendar" && !draft.complete) || (editing === "import" && !draft.manifest?.source_complete)} onClick={() => save(true)}>{busy ? "Saving…" : "Publish"}</button></>}>
      {editing === "import" ? <div className="space-y-4"><p className="text-sm text-text-secondary">Upload a reviewed JSON manifest transcribed from the official JPM annual calendar and applicable gazettes. FeedX does not scrape, generate or certify official dates. Imported source updates never publish company selections.</p>
        <AdminFormField label="Reviewed calendar manifest"><input type="file" accept="application/json,.json" disabled={busy} onChange={e => importFile(e.target.files[0])} /></AdminFormField>
        <details className="text-sm"><summary>Manifest format</summary><p className="mt-2">source_reference, source_complete and holidays. Each holiday requires date, name, scope (national/state), state_code for State, kind (required/gazetted/special/substitute), and source_reference where different. Substitute requires the canonical substitutes_holiday_id. Unresolved classification must be reviewed before import.</p></details>
        {draft.manifest && <><p className="text-sm">{draft.manifest.source_reference} · {draft.manifest.holidays.length} reviewed holidays</p><DataTable density="compact" rows={draft.manifest.holidays} getRowKey={(r, i) => `${r.date}-${r.name}-${i}`} columns={[{ key: "date", header: "Date" }, { key: "name", header: "Holiday" }, { key: "scope", header: "Scope" }]} /><label className="flex gap-2 text-sm"><input type="checkbox" checked={!!draft.manifest.source_complete} onChange={e => patch("manifest", { ...draft.manifest, source_complete: e.target.checked })} />Complete annual source and applicable special/substitute gazettes reviewed</label></>}
      </div> : editing === "calendar" ? <div className="space-y-4">
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
        {!draft.exception && <p className="text-sm font-semibold">Applies to: All applicable companies</p>}
        {draft.exception && <AdminFormField label="Exception name" required><input className="control" value={draft.name} onChange={e => patch("name", e.target.value)} /></AdminFormField>}
        {draft.exception && <SelectField label="Published calendar" value={draft.calendarId} options={calendars.filter(c => c.status === "published").map(c => ({ value: c.id, label: `Version ${c.revision} · ${c.source_reference}` }))}
          onChange={id => { const c = calendars.find(x => x.id === id); patch("calendarId", id); patch("selected", (c?.entries || []).filter(e => e.kind === "required").map(e => e.holiday_id)); }} />}
        <p className="text-sm text-text-secondary">Required holidays cannot be deselected.</p>
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
