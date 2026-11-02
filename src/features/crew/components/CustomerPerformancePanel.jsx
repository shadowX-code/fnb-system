import { useEffect, useRef, useState } from 'react';
import Card from '../../../components/ui/Card.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Modal from '../../../components/feedback/Modal.jsx';
import { crewService } from '../../../services/crewService.js';
import { googleBusinessService } from '../services/googleBusinessService.js';

const reasons = {
 reconnect_required: 'Reconnect Google Business Profile in Google Reviews Settings.',
 mapping_required: 'Map a Google location to this outlet in Google Reviews Settings.',
 target_required: 'Set a Monthly Positive Review Target for this outlet and month.',
 month_not_closed: 'Monthly evidence is incomplete until this calendar month ends.',
 evidence_expired: 'Evidence expired. Refresh the preview for a new read.',
 incomplete_evidence: 'Complete monthly review evidence is unavailable. Try again after synchronization.',
 no_eligible_reviews: 'No eligible reviews for this month; Review Quality has no denominator.',
};
const number = value => new Intl.NumberFormat('en-MY', { maximumFractionDigits: 2 }).format(value);
const date = value => new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' });

export default function CustomerPerformancePanel({ outletId, period, auth, onPreview }) {
 const [context, setContext] = useState(null), [target, setTarget] = useState('');
 const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [previewing, setPreviewing] = useState(false);
 const [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState(null), [history, setHistory] = useState(null);
 const sequence = useRef(0), savingRef = useRef(false), previewRef = useRef(false);
 const canEdit = auth.hasPermission('crew_performance.review');
 const canPreview = auth.hasPermission('crew_google_reviews.view') && auth.hasPermission('crew_google_reviews.sync');
 useEffect(() => {
  const request = ++sequence.current;
  setContext(null); setTarget(''); setPreview(null); onPreview(null); setError(''); setMessage(''); setHistory(null); setLoading(true);
  if (!outletId) { setLoading(false); return; }
  crewService.googleReviewsAdminContext(outletId, period).then(next => {
   if (request === sequence.current) { setContext(next); setTarget(next.positive_target == null ? '' : String(next.positive_target)); }
  }).catch(cause => { if (request === sequence.current) setError(cause.message); })
   .finally(() => { if (request === sequence.current) setLoading(false); });
  return () => { ++sequence.current; };
 }, [outletId, period, onPreview]);
 useEffect(() => {
  if (!preview?.expiresAt) return;
  const timeout = window.setTimeout(() => { setPreview({ status: 'pending', reason: 'evidence_expired' }); onPreview(null); }, Math.max(0, Date.parse(preview.expiresAt) - Date.now()));
  return () => window.clearTimeout(timeout);
 }, [preview, onPreview]);
 async function save() {
  if (savingRef.current) return;
  savingRef.current = true; setSaving(true); setError(''); setMessage('');
  const request = sequence.current;
  try {
   const result = await crewService.setGoogleMonthlyTarget(outletId, period, Number(target));
   if (request !== sequence.current) return;
   setContext(current => ({ ...current, positive_target: result.positive_target }));
   setTarget(String(result.positive_target)); setPreview(null); onPreview(null); setMessage('Monthly target saved.');
  } catch (cause) { if (request === sequence.current) setError(cause.message); }
  finally { savingRef.current = false; setSaving(false); }
 }
 async function refreshPreview() {
  if (previewRef.current) return;
  previewRef.current = true; setPreviewing(true); setError(''); setMessage(''); setPreview(null); onPreview(null);
  const request = sequence.current;
  try {
   const result = await googleBusinessService.customerPreview(outletId, period);
   if (request !== sequence.current) return;
   if (result.expiresAt && Date.parse(result.expiresAt) <= Date.now()) { setPreview({ status: 'pending', reason: 'evidence_expired' }); return; }
   setPreview(result); onPreview({ ...result, outletId, period });
  } catch (cause) { if (request === sequence.current) { setError(cause.message); setPreview({ status: 'pending' }); } }
  finally { previewRef.current = false; setPreviewing(false); }
 }
 async function openHistory() {
  const request = sequence.current;
  try { const result = await crewService.googleTargetHistory(outletId, period); if (request === sequence.current) setHistory(result.rows); }
  catch (cause) { if (request === sequence.current) setError(cause.message); }
 }
 const validTarget = Number.isSafeInteger(Number(target)) && Number(target) > 0;
 const ready = preview?.status === 'preview_only';
 return <Card title="Customer · 20 points" ariaLabel="Customer Performance configuration and preview" action={<Badge tone="neutral">Preview only</Badge>}>
  <div className="space-y-4 p-4">
   <div className="flex flex-wrap items-end gap-3">
    <label className="field-label w-full min-w-0 sm:w-64">Monthly Positive Review Target
     <input className="control mt-1 w-full" type="number" min="1" step="1" value={target} disabled={loading || saving || previewing || !context || !canEdit || context.target_locked} onChange={event => { setTarget(event.target.value); setMessage(''); setPreview(null); onPreview(null); }} />
    </label>
    {canEdit ? <button className="btn-secondary" type="button" disabled={loading || saving || previewing || !context || context.target_locked || !validTarget || Number(target) === context.positive_target} onClick={save}>{saving ? 'Saving…' : 'Save Target'}</button> : null}
    <button className="btn-secondary" type="button" disabled={loading || !context} onClick={openHistory}>Target History</button>
    {canPreview ? <button className="btn-secondary" type="button" disabled={loading || saving || previewing || !context || Number(target) !== context.positive_target} onClick={refreshPreview}>{previewing ? 'Preparing preview…' : 'Refresh Customer Preview'}</button> : null}
   </div>
   {context?.target_locked ? <p className="text-sm text-text-secondary">Target locked after Performance finalization.</p> : null}
   {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
   {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
   <div aria-live="polite" className="space-y-2">
    <p className="font-semibold">Customer: {ready ? `${number(preview.score)} / 20 · Preview` : 'Pending'}</p>
    {ready ? <><dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
     <div><dt>Positive target achievement</dt><dd>{preview.positive} / {preview.target} positive reviews · {number(preview.positiveTarget)} / 15 points</dd></div>
     <div><dt>Review Quality</dt><dd>{preview.negative} negative / {preview.total} reviews · {number(preview.negativeRate * 100)}% · {preview.quality} / 5 points</dd></div>
    </dl><p className="text-sm text-text-secondary">Fresh Google read: {date(preview.fetchedAt)} · Valid until {date(preview.expiresAt)}</p></> : <p className="text-sm text-text-secondary">{reasons[preview?.reason] || (context && !context.positive_target ? reasons.target_required : 'Prepare a fresh preview for the selected outlet and month.')}</p>}
    <p className="text-sm text-text-secondary">Shared by eligible Service Crew for this outlet and month. Preview is not saved to employee scores or included in final totals or Reward.</p>
   </div>
  </div>
  {history ? <Modal title="Monthly Positive Review Target History" onClose={() => setHistory(null)} footer={<button className="btn-secondary" type="button" onClick={() => setHistory(null)}>Close</button>}>
   {history.length ? <ul className="space-y-3">{history.map(row => <li key={row.id}><strong>{row.old_target ?? 'Not set'} → {row.new_target}</strong><p className="text-sm text-text-secondary">{date(row.changed_at)}</p></li>)}</ul> : <p>No target changes for this month.</p>}
  </Modal> : null}
 </Card>;
}
