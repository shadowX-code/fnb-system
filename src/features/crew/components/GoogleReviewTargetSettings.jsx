import { useEffect, useRef, useState } from 'react';
import AdminFormField from '../../../components/forms/AdminFormField.jsx';
import MonthPickerField from '../../../components/forms/MonthPickerField.jsx';
import { crewService } from '../../../services/crewService.js';

// Existing audited target configuration remains separate from the Phase 1 inbox.
export default function GoogleReviewTargetSettings({ outletId, canEdit }) {
 const [period, setPeriod] = useState(`${new Date().toISOString().slice(0,7)}-01`), [context, setContext] = useState(null);
 const [input, setInput] = useState(''), [history, setHistory] = useState([]), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
 const sequence=useRef(0);
 useEffect(() => {
  ++sequence.current;
  let active = true; setContext(null); setHistory([]); setMessage('');
  Promise.all([crewService.googleReviewsAdminContext(outletId,period),crewService.googleTargetHistory(outletId,period)])
   .then(([data, audit]) => { if (active) { setContext(data); setInput(String(data.positive_target ?? '')); setHistory(audit.rows || []); } })
   .catch(cause => { if (active) setMessage(cause.message || 'Target settings unavailable.'); });
  return () => { active = false; ++sequence.current; };
 }, [outletId,period]);
 async function save(event) {
  event.preventDefault(); const target = Number(input);
  if (saving) return;
  if (!Number.isSafeInteger(target) || target <= 0) { setMessage('Enter a whole number greater than zero.'); return; }
  setSaving(true); setMessage('');
  const id=sequence.current;
  try {
   await crewService.setGoogleMonthlyTarget(outletId,period,target);
   const [next,audit] = await Promise.all([crewService.googleReviewsAdminContext(outletId,period),crewService.googleTargetHistory(outletId,period)]);
   if(id!==sequence.current)return;
   setContext(next); setHistory(audit.rows || []); setMessage('Monthly target saved. The change is audited.');
  } catch (cause) { if(id===sequence.current)setMessage(cause.message || 'Target could not be saved.'); }
  finally { setSaving(false); }
 }
 return <section className="space-y-3 border-t border-border pt-4 lg:col-span-2" aria-label="Monthly positive review target">
  <h2 className="font-semibold">Monthly Positive Review Target</h2><p className="text-sm text-text-secondary">Existing target configuration only. Google-to-Performance scoring remains disabled.</p>
  <div className="max-w-xs"><MonthPickerField label="Target month" value={period.slice(0,7)} onChange={v => setPeriod(`${v}-01`)} /></div>
  <form className="flex flex-wrap items-end gap-3" onSubmit={save}><AdminFormField label="Positive reviews"><input className="control w-36" type="number" min="1" step="1" value={input} onChange={e => setInput(e.target.value)} disabled={!context || !canEdit || context.target_locked || saving} /></AdminFormField><button className="btn-primary" disabled={!context || !canEdit || context.target_locked || saving || !input}>{saving ? 'Saving…' : 'Save target'}</button></form>
  {context?.target_locked ? <p className="text-sm">Locked after Performance finalization.</p> : null}
  {message ? <p role="status" className="text-sm">{message}</p> : null}
  <h3 className="text-sm font-semibold">Target history</h3><ol className="divide-y divide-border">{history.map(h => <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{h.old_target ?? 'Not set'} → {h.new_target} positive reviews</span><time dateTime={h.changed_at}>{new Date(h.changed_at).toLocaleString('en-MY')}</time></li>)}</ol>
 </section>;
}
