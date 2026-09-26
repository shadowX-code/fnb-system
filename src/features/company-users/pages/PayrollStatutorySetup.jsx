import { useEffect, useState } from 'react';
import Modal from '../../../components/feedback/Modal.jsx';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import DatePickerField from '../../../components/forms/DatePickerField.jsx';
import { payrollService } from '../../../services/payrollService.js';

const schemes = ['epf', 'socso', 'eis', 'pcb'];
const categories = {
  epf: [{value:'malaysian_under_60',label:'Malaysian · under 60'},{value:'malaysian_60_to_74',label:'Malaysian · 60–74'}],
  socso: [{value:'first_category_base',label:'Act 4 · First Category'},{value:'second_category_base',label:'Act 4 · Second Category'}],
  eis: [{value:'standard',label:'Standard'}],
};
export const statutorySchemeLabel = (scheme, state) => {
  if (state?.state === 'not_applicable') return 'Not Applicable';
  if (state?.state !== 'confirmed') return 'Setup Required';
  if (scheme === 'pcb') return 'Applicable · monthly confirmation';
  return categories[scheme]?.find(c=>c.value===state.category)?.label || 'Confirmed';
};

// Translate canonical eligibility reasons; never infer eligibility in the browser.
export function statutorySetupHelp(issue, evidence = {}) {
  if (issue?.includes('birthdate_unverified')) return 'Confirm a valid date of birth in the Employee profile. FeedX uses it to determine the contribution category.';
  if (issue?.includes('citizenship_category_unverified')) return evidence.nationality
    ? `The recorded nationality (${evidence.nationality}) is outside the currently supported Malaysian categories. Additional category support is required; a source note cannot establish eligibility.`
    : 'Complete nationality in the Employee profile. FeedX uses it to determine the supported contribution category.';
  if (issue?.includes('prior_contribution_history')) return 'Prior contribution history is required for this age group. FeedX does not yet own that evidence; this setup remains unresolved until supported evidence can be recorded.';
  if (issue?.includes('age') || issue?.includes('eligibility')) return `The recorded date of birth${evidence.birthday ? ` (${evidence.birthday})` : ''} does not support a category for this effective month. Verify the Employee profile; if correct, this case requires additional statutory support, not a manual category override.`;
  return 'Review the canonical Employee information required for a supported contribution category. This setup remains unresolved until FeedX can verify it.';
}

export default function PayrollStatutorySetup({profile,onSaved,onClose}) {
  const [draft,setDraft]=useState(null);
  const [review,setReview]=useState(null);
  const [history,setHistory]=useState(null);
  const [overrides,setOverrides]=useState({});
  const [expanded,setExpanded]=useState({});
  const [sourceNote,setSourceNote]=useState('');
  const [reason,setReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    payrollService.readStatutorySetup(profile.id).then(r=>payrollService.readStatutorySetup(profile.id,r.next_effective_from)).then(r=>{
      if(active) {setHistory(r.history);setDraft({effectiveFrom:r.next_effective_from,applicability:r.applicability});}
    }).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[profile.id]);
  // Server resolves proposed applicability first. Ignore late responses after edits.
  useEffect(()=>{
    if(!draft) return;
    let active=true;setReview(null);setError('');
    payrollService.readStatutorySetup(profile.id,draft.effectiveFrom,draft.applicability)
      .then(r=>{if(active)setReview(r);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[profile.id,draft]);
  const applicable=schemes.filter(s=>s!=='pcb' && draft?.applicability[s]===true);
  const chosen=Object.fromEntries(applicable.map(s=>[s,overrides[s] ?? review?.schemes[s]?.recommendation ?? review?.schemes[s]?.category ?? null]));
  const manual=applicable.some(s=>review?.schemes[s]?.recommendation && chosen[s]!==review.schemes[s].recommendation);
  const allowed=review && schemes.every(s=>draft.applicability[s]!=null)
    && applicable.every(s=>chosen[s])
    && (!manual || (sourceNote.trim().length>=8 && reason.trim().length>=3));
  async function save() {
    setBusy(true);setError('');
    try {
      await payrollService.confirmStatutorySetup({profileId:profile.id,...draft,categories:chosen,
        fingerprint:review.fingerprint,sourceNote,reason});
      await onSaved();onClose();
    } catch(e) {setError(e.message || 'Unable to save statutory setup.');}
    finally {setBusy(false);}
  }
  return <Modal title={`Manage Statutory Setup · ${profile.employee_name}`} size="lg" onClose={onClose}
    description="Confirm applicability, then contribution categories where required. Earlier effective-dated evidence is retained."
    footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={!allowed || busy}>{busy?'Saving…':'Confirm Statutory Setup'}</button></>}>
    <div className="space-y-5">
      {!draft && !error && <p>Loading employee evidence…</p>}
      {draft && <>
        <section aria-label="Statutory schemes" className="divide-y divide-border">{schemes.map(s=>{
          const state=review?.schemes[s], applicable=draft.applicability[s]===true, requiresCategory=applicable && s!=='pcb';
          const editing=expanded[s] && state?.recommendation;
          return <div key={s} className="grid gap-3 py-3 sm:grid-cols-[11rem_1fr]">
          <SelectField label={s==='pcb'?'PCB / MTD':s.toUpperCase()} ariaLabel={`${s.toUpperCase()} applicability`} disabled={busy}
          value={draft.applicability[s]==null?'':String(draft.applicability[s])}
          onChange={v=>{setOverrides({});setExpanded({});setSourceNote('');setReason('');setDraft(d=>({...d,applicability:{...d.applicability,[s]:v===''?null:v==='true'}}));}}
          options={[{value:'',label:'Choose applicability'},{value:'true',label:'Applicable'},{value:'false',label:'Not Applicable'}]} />
          <div className="self-center text-sm">
            {draft.applicability[s]===false && <span className="text-text-secondary">Resolved · No further setup required</span>}
            {applicable && !review && <span role="status">Checking employee evidence…</span>}
            {applicable && s==='pcb' && review && <p className="text-text-secondary">Confirm PCB / MTD in each Payroll Run. No category required.</p>}
            {requiresCategory && state && <>
              {state.recommendation ? <>
                <p className="font-semibold">{categories[s].find(c=>c.value===chosen[s])?.label} <span className="font-normal text-text-secondary">· {chosen[s]===state.recommendation?'Recommended':'Override'}</span></p>
                {!editing ? <button type="button" className="mt-1 text-sm font-semibold text-primary" onClick={()=>setExpanded(o=>({...o,[s]:true}))}>Override</button>
                  : <div className="mt-2"><SelectField label={`${s.toUpperCase()} category`} ariaLabel={`${s.toUpperCase()} category`} value={chosen[s] || ''} disabled={busy}
                      onChange={v=>setOverrides(o=>({...o,[s]:v}))} options={categories[s]} />
                    <button type="button" className="mt-2 text-sm font-semibold text-primary" onClick={()=>{setOverrides(o=>{const next={...o};delete next[s];return next;});setExpanded(o=>({...o,[s]:false}));}}>Use recommendation</button></div>}
              </> : <>
                <p className="font-semibold">Additional information required</p>
                <p className="mt-1 text-text-secondary">{statutorySetupHelp(state.issue,review.evidence)}</p>
                <button type="button" className="mt-2 text-sm font-semibold text-primary" aria-expanded={Boolean(expanded[s])} onClick={()=>setExpanded(o=>({...o,[s]:!o[s]}))}>Complete Setup</button>
                {expanded[s] && <p className="mt-2 text-text-secondary">Correct missing or inaccurate identity information in People → Employees, then reopen this setup. If the information is already correct, keep this scheme unresolved until the required category/evidence is supported. No free-text evidence can bypass this check.</p>}
              </>}
            </>}
          </div></div>;
        })}</section>
        <DatePickerField label="Effective From" required value={draft.effectiveFrom} onChange={v=>{setOverrides({});setExpanded({});setSourceNote('');setReason('');setDraft(d=>({...d,effectiveFrom:v}));}} />
        {!review && !error && <p role="status">Resolving setup…</p>}
        {review && manual && <div className="space-y-3"><p className="text-sm text-text-secondary">Explain the change from FeedX's recommendation. The server still validates the selected category against employee evidence.</p>
          <AdminFormField label="Supporting evidence / source" required><input className="control" value={sourceNote} onChange={e=>setSourceNote(e.target.value)} /></AdminFormField>
          <AdminFormField label="Override reason" required><input className="control" value={reason} onChange={e=>setReason(e.target.value)} /></AdminFormField></div>}
        {!manual && review && <p className="text-xs text-text-secondary">FeedX records canonical employee evidence, confirming Admin and time automatically.</p>}
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Effective-dated history</summary>
          {history?.applicability.map(v=><p key={v.id} className="mt-2">{v.effective_from} · {schemes.map(s=>`${s.toUpperCase()}: ${v[`${s}_applicable`]==null?'Setup Required':v[`${s}_applicable`]?'Applicable':'Not Applicable'}`).join(' · ')}</p>)}
          {history?.categories.map(v=><p key={v.id} className="mt-2 text-text-secondary">Category evidence · {v.effective_from} · {v.reason}</p>)}</details>
      </>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
  </Modal>;
}
