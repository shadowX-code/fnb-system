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

export default function PayrollStatutorySetup({profile,onSaved,onClose}) {
  const [draft,setDraft]=useState(null);
  const [review,setReview]=useState(null);
  const [history,setHistory]=useState(null);
  const [overrides,setOverrides]=useState({});
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
  const manual=applicable.some(s=>!review?.schemes[s]?.recommendation || chosen[s]!==review.schemes[s].recommendation);
  const allowed=review && schemes.every(s=>draft.applicability[s]!=null)
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
    footer={<><button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={!allowed || busy}>{busy?'Saving…':'Confirm Setup'}</button></>}>
    <div className="space-y-5">
      {!draft && !error && <p>Loading employee evidence…</p>}
      {draft && <>
        <section><h3 className="font-bold">Applicability</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{schemes.map(s=><SelectField key={s} label={s==='pcb'?'PCB / MTD':s.toUpperCase()}
          value={draft.applicability[s]==null?'':String(draft.applicability[s])}
          onChange={v=>{setOverrides({});setDraft(d=>({...d,applicability:{...d.applicability,[s]:v===''?null:v==='true'}}));}}
          options={[{value:'',label:'Choose applicability'},{value:'true',label:'Applicable'},{value:'false',label:'Not Applicable'}]} />)}</div></section>
        <DatePickerField label="Effective From" required value={draft.effectiveFrom} onChange={v=>{setOverrides({});setDraft(d=>({...d,effectiveFrom:v}));}} />
        {!review && !error && <p role="status">Resolving setup…</p>}
        {review && <section><h3 className="font-bold">Contribution Categories</h3>
          {!applicable.length && <p className="mt-2 text-sm text-text-secondary">No contribution category required.</p>}
          {applicable.map(s=>{
            const state=review.schemes[s],editing=overrides[s]!==undefined || !state.recommendation;
            return <div key={s} className="border-b border-border py-3">
              <div className="flex items-start justify-between gap-3"><strong className="text-sm">{s.toUpperCase()}</strong>
                {state.recommendation && !editing && <span className="text-sm">Recommended · {categories[s].find(c=>c.value===state.recommendation)?.label}</span>}</div>
              {state.issue && !state.recommendation && <p className="mt-1 text-sm text-amber-800">Setup Required · {state.issue.replaceAll('_',' ')}</p>}
              {editing ? <div className="mt-2"><SelectField label={`${s.toUpperCase()} category`} value={chosen[s] || ''} onChange={v=>setOverrides(o=>({...o,[s]:v}))}
                options={[{value:'',label:'Setup Required · no confirmed category'},...categories[s]]} />
                {state.recommendation && <button className="mt-2 text-sm font-semibold text-primary" onClick={()=>setOverrides(o=>{const next={...o};delete next[s];return next;})}>Use recommendation</button>}</div>
                : <button className="mt-2 text-sm font-semibold text-primary" onClick={()=>setOverrides(o=>({...o,[s]:state.recommendation}))}>Override recommendation</button>}
            </div>;
          })}
          {draft.applicability.pcb===true && <p className="mt-3 text-sm text-text-secondary">PCB / MTD is applicable. Confirm its amount in each Payroll Run; no employee category is required.</p>}
        </section>}
        {review && manual && <div className="space-y-3"><p className="text-sm text-text-secondary">Complete Setup / override evidence is required. Missing categories remain Setup Required and block applicable statutory calculation.</p>
          <AdminFormField label="Evidence / source reference" required><input className="control" value={sourceNote} onChange={e=>setSourceNote(e.target.value)} /></AdminFormField>
          <AdminFormField label="Setup / override reason" required><input className="control" value={reason} onChange={e=>setReason(e.target.value)} /></AdminFormField></div>}
        {!manual && review && <p className="text-xs text-text-secondary">FeedX records canonical employee evidence, confirming Admin and time automatically.</p>}
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Effective-dated history</summary>
          {history?.applicability.map(v=><p key={v.id} className="mt-2">{v.effective_from} · {schemes.map(s=>`${s.toUpperCase()}: ${v[`${s}_applicable`]==null?'Setup Required':v[`${s}_applicable`]?'Applicable':'Not Applicable'}`).join(' · ')}</p>)}
          {history?.categories.map(v=><p key={v.id} className="mt-2 text-text-secondary">Category evidence · {v.effective_from} · {v.reason}</p>)}</details>
      </>}
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </div>
  </Modal>;
}
