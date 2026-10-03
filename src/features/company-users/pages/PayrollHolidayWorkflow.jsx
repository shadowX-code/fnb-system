import { useEffect, useLayoutEffect, useRef, useState } from "react";
import DataTable from "../../../components/tables/DataTable.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { malaysiaStateName } from "../../../constants/malaysiaStates.js";
import { payrollService } from "../../../services/payrollService.js";
import PayrollHolidayImport, { unresolvedHolidayRows } from "./PayrollHolidayImport.jsx";

export const holidayApplies = (h, geography) => !!geography && (h?.scope === "national" || h?.state_code === geography);
export function operationHolidayRows(candidate, calendar, geography, decisions = {}) {
  if (candidate?.rows?.length) return candidate.rows.filter(r => holidayApplies(r.row || r.previous?.holiday, geography)).map(r => ({
    key: r.key, date: r.row?.date || r.previous?.holiday?.holiday_date, name: r.row?.name || r.previous?.holiday?.name,
    scope: r.row?.scope || r.previous?.holiday?.scope, state_code: r.row?.state_code || r.previous?.holiday?.state_code,
    kind: decisions[r.key]?.kind || r.previous?.kind || r.row?.kind, state: r.state,
    uncertain: r.state === "blocked" || r.state === "changed" || r.state === "missing", issue: r.issue,
    classification: r.classification_review && !decisions[r.key]?.kind,
    suggestedKind: r.row?.suggested_kind,
  }));
  return (calendar?.entries || []).filter(e => holidayApplies(e.holiday, geography)).map(e => ({
    key: e.holiday_id, date: e.holiday.holiday_date, name: e.holiday.name, scope: e.holiday.scope, state_code: e.holiday.state_code, kind: e.kind, state: "matched",
  }));
}
const classification = kind => ({ required: "Mandatory paid", gazetted: "Company selected", special: "Additional gazetted", substitute: "Substituted" }[kind] || "Review Required");

export default function PayrollHolidayWorkflow({ year, annual, editable, advancedContent, onPublished, onAdditionalReview, operation = "", onOperationChanged = () => {} }) {
  const [context, setContext] = useState(null);
  const [operations, setOperations] = useState([]);
  const [geography, setGeography] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [allCandidates, setAllCandidates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [mandatoryConfirmed, setMandatoryConfirmed] = useState(false);
  const [step, setStep] = useState(1);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  useEffect(() => {
    let active = true;
    payrollService.readHolidayOperation(operation || null).then(value => {
      if (!active) return;
      setContext(value); if (!operation) setOperations(value.outlets); setGeography(value.unverified_count === 0 && value.geographies.length === 1 ? value.geographies[0] : "");
    }).catch(e => active && setError(e.message));
    return () => { active = false; };
  }, [operation]);
  useLayoutEffect(() => { setSelected(null); setMandatoryConfirmed(false); setReviewed(false); setStep(1); request.current = null; }, [year, operation, geography, candidate?.id, candidate?.revision]);
  const calendar = annual.calendars?.find(c => c.status === "published");
  const policy = annual.policies?.find(p => operation ? p.outlet_ids?.length === 1 && p.outlet_ids[0] === operation : p.is_default);
  const publishedProposal = candidate?.history?.some(e => e.event_type === "operation_published" && e.details.geography === geography && e.details.calendar_id === calendar?.id);
  const proposal = publishedProposal ? null : candidate?.rows?.length && candidate.proposal_metadata?.document_role !== "supplement" ? candidate : null;
  const decisions = { ...(proposal?.decisions || {}) };
  const rawRows = operationHolidayRows(proposal, calendar, geography, decisions);
  const mandatoryCandidates = rawRows.filter(r => r.kind === "required" || r.classification && r.suggestedKind === "required");
  if (mandatoryConfirmed) mandatoryCandidates.forEach(r => { decisions[r.key] = { ...decisions[r.key], action: "accept", kind: "required" }; });
  const rows = operationHolidayRows(proposal, calendar, geography, decisions).sort((a,b) => a.date.localeCompare(b.date));
  const mandatory = rows.filter(r => r.kind === "required" && !r.classification);
  const optional = rows.filter(r => r.kind === "gazetted" && !r.classification);
  const chosen = selected || (proposal ? [] : policy?.selected_holiday_ids || []);
  const picked = optional.filter(r => chosen.includes(r.key));
  const additional = (annual.additional_entries || []).filter(e => holidayApplies(e.holiday, geography)).map(e => ({ key: e.holiday_id, date: e.holiday.holiday_date, name: e.holiday.name, scope: e.holiday.scope, state_code: e.holiday.state_code, kind: "special" }));
  const additionalProposals = allCandidates.filter(c => c.proposal_metadata?.document_role === "supplement" && !allCandidates.some(n => n.id !== c.id && n.source_sha256 === c.source_sha256 && n.created_at > c.created_at)).flatMap(c => (c.rows || []).filter(r => r.row && holidayApplies(r.row, geography) && !c.additional_confirmations?.[r.key]).map(r => ({ ...r.row, key: `${c.id}:${r.key}`, state: r.state, issue: r.issue, candidateId: c.id, rowKey: r.key })));
  const exceptions = proposal ? unresolvedHolidayRows({ ...proposal, decisions }).filter(r => holidayApplies(r.row || r.previous?.holiday, geography) && (!r.classification_review || r.state === "blocked" || r.state === "changed")) : [];
  const sourceExceptions = rows.filter(r => r.uncertain && (r.state === "blocked" || decisions[r.key]?.action !== (r.state === "missing" ? "retain" : "accept")));
  const geographyReady = context && context.unverified_count === 0 && context.geographies.length === 1;
  const ready = geographyReady && mandatory.length === 5 && picked.length >= 6 && !sourceExceptions.length && !exceptions.length;
  const finalRows = [...mandatory, ...picked, ...additional].sort((a,b) => a.date.localeCompare(b.date));
  const columns = [{ key: "date", header: "Date", render: r => r.date }, { key: "name", header: "Holiday", render: r => <strong>{r.name}</strong> },
    { key: "scope", header: "Applicability", render: r => r.scope === "national" ? "National" : malaysiaStateName(r.state_code) }];
  const publish = async () => {
    setBusy(true); setError("");
    try {
      const scopedDecisions = Object.fromEntries(Object.entries(decisions).filter(([key]) => rows.some(r => r.key === key)));
      const input = { year: Number(year), outlet_id: operation || null, geography, candidate_id: proposal?.id || null, candidate_revision: proposal?.revision || null,
        calendar_id: calendar?.id || null, previous_calendar_id: annual.previous_calendar_id || annual.calendars?.[0]?.id || null,
        previous_policy_id: policy?.id || null, selected_keys: picked.map(r => r.key), decisions: scopedDecisions, reviewed };
      const fingerprint = JSON.stringify(input);
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
      await payrollService.publishHolidayOperation({ ...input, request_id: request.current.id });
      setStep(1); setSelected(null); onPublished();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="p-4" aria-label="Public Holiday setup">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h4 className="font-bold">{geography ? `${malaysiaStateName(geography)} · ${year}` : "Choose a verified operation"}</h4><p className="text-sm text-text-secondary">Official dates → Company holidays → Review &amp; publish</p></div>
      <SelectField label="Operation" value={operation} onChange={onOperationChanged} options={[{value:"",label:"All workplaces"}, ...operations.map(o => ({value:o.id,label:o.name}))]} />
    </div>
    {context && !geographyReady && <p role="status" className="mb-4 text-sm text-amber-800">{context.unverified_count ? "Statutory geography is missing for this operation. Confirm workplace state in outlet settings before publishing." : "Workplaces span states. Select one workplace to prepare its applicable calendar."}</p>}
    <nav aria-label="Holiday setup steps" className="mb-4 flex flex-wrap gap-2">{["Official Calendar","Select Company Holidays","Review & Publish"].map((name,index) => <button type="button" key={name} className={step === index+1 ? "btn-primary" : "btn-secondary"} disabled={!geography || index>0 && !rows.length} onClick={() => setStep(index+1)} aria-current={step === index+1 ? "step" : undefined}>{index+1}. {name}</button>)}</nav>
    {editable && <div hidden={step !== 1}><PayrollHolidayImport year={year} geography={geography} operational calendarPublished={!!calendar} onCandidateChanged={setCandidate} onCandidatesChanged={setAllCandidates} onPublished={onPublished} advancedContent={advancedContent} /></div>}
    {step === 1 && <>
      <h4 className="mt-4 font-bold">Official Calendar</h4><p className="my-2 text-sm text-text-secondary">Official source: {proposal?.source_reference || calendar?.source_reference || "JPM / BKPP annual calendar"}</p><p className="mb-3 text-sm text-text-secondary">JPM / BKPP · National and {geography ? malaysiaStateName(geography) : "verified workplace"} holidays only. Source-verified dates need no action.</p>
      {rows.length > 0 && <DataTable density="compact" rows={rows} getRowKey={r=>r.key} columns={[...columns,{key:"state",header:"Status",render:r => sourceExceptions.some(e=>e.key===r.key) ? <span className="text-amber-800">Review Required · {r.issue || "Source change"}</span> : "Source verified"}]} />}
      {!rows.length && <p className="my-4 text-sm text-text-secondary">Check official updates to prepare the applicable calendar. Unsupported documents can be reviewed in Advanced &amp; History.</p>}
      {rows.length > 0 && <button type="button" className="btn-primary mt-4" onClick={()=>setStep(2)}>Select Company Holidays</button>}
    </>}
    {step === 2 && <>
      <h4 className="font-bold">Mandatory Paid Holidays</h4><p className="my-2 text-sm text-text-secondary">{mandatory.length}/5 mandatory confirmed</p>
      <DataTable density="compact" rows={mandatoryCandidates} getRowKey={r=>r.key} columns={columns} />
      {mandatoryCandidates.some(r=>r.classification) && <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={mandatoryConfirmed} onChange={e=>setMandatoryConfirmed(e.target.checked)} />Confirm these five mandatory paid holidays against the applicable employment-law evidence.</label>}
      <h4 className="mt-5 font-bold">Company-selected Paid Holidays</h4><p className="my-2 text-sm text-text-secondary">{picked.length}/6 company holidays selected · Select at least six.</p>
      <DataTable density="compact" rows={optional.filter(r=>!mandatoryCandidates.some(m=>m.key===r.key))} getRowKey={r=>r.key} columns={[{key:"select",header:"Selected",render:r=><input type="checkbox" className="accent-primary" aria-label={`Select ${r.name}`} checked={chosen.includes(r.key)} disabled={!editable || r.state === "blocked"} onChange={e=>setSelected(e.target.checked ? [...chosen,r.key] : chosen.filter(k=>k!==r.key))} />},...columns]} />
      <h4 className="mt-5 font-bold">Additional Gazetted Holidays</h4><p className="my-2 text-sm text-text-secondary">Separate paid entitlements; these do not consume company selection slots.</p>
      {additional.length ? <DataTable density="compact" rows={additional} getRowKey={r=>r.key} columns={columns} /> : <p className="text-sm text-text-secondary">No additional paid entitlements confirmed.</p>}
      {!!additionalProposals.length && <DataTable density="compact" rows={additionalProposals} getRowKey={r=>r.key} columns={[...columns,{key:"review",header:"Status / Action",render:r=>r.state === "blocked" ? <span className="text-amber-800">Review Required · {r.issue}</span> : <button type="button" className="text-primary" disabled={!editable} onClick={()=>onAdditionalReview({candidateId:r.candidateId,rowKey:r.rowKey,name:r.name,date:r.date,reference:"",attested:false,requestId:crypto.randomUUID()})}>Review Additional Entitlement</button>}]} />}
      <button type="button" className="btn-primary mt-4" onClick={()=>setStep(3)}>Review Calendar</button>
    </>}
    {step === 3 && <>
      <h4 className="font-bold">Review &amp; Publish</h4><p className="my-2 text-sm text-text-secondary">{malaysiaStateName(geography)} · Only the published calendar affects Payroll.</p>
      <dl className="my-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">{[["Mandatory",mandatory.length],["Company Selected",picked.length],["Additional Gazetted",additional.length],["Total Paid Holidays",finalRows.length]].map(([name,total])=><div key={name}><dt className="text-text-secondary">{name}</dt><dd className="font-semibold">{total}</dd></div>)}</dl>
      <DataTable density="compact" rows={finalRows} getRowKey={r=>r.key} columns={[...columns,{key:"kind",header:"Classification",render:r=>classification(r.kind)}]} />
      {!ready && <p role="status" className="my-3 text-sm text-amber-800">{!geographyReady ? "Verify statutory workplace geography before publishing." : sourceExceptions.length || exceptions.length ? "Review the applicable uncertain or conflicting dates first." : mandatory.length !== 5 ? "Confirm all five mandatory paid holidays." : `Select ${Math.max(0,6-picked.length)} more company holidays.`}</p>}
      <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />I reviewed the complete applicable calendar and company paid-holiday selection.</label>
      {editable && <button className="btn-primary" disabled={busy || !ready || !reviewed} onClick={publish}>{busy ? "Publishing…" : `Publish ${year} Calendar`}</button>}
    </>}
    {error && <p role="alert" className="my-3 text-sm text-rose-700">{error}</p>}

  </section>;
}
