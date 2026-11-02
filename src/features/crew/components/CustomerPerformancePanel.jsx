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
 const [context, setContext] = useState(null), [target, setTarget] = useState(''), [editing, setEditing] = useState(false);
 const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [previewing, setPreviewing] = useState(false);
 const [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState(null), [history, setHistory] = useState(null);
 const sequence = useRef(0), savingRef = useRef(false), previewRef = useRef(false);
 const canEdit = auth.hasPermission('crew_performance.review');
 const canPreview = auth.hasPermission('crew_google_reviews.view') && auth.hasPermission('crew_google_reviews.sync');
 useEffect(() => {
  const request = ++sequence.current;
  setContext(null); setTarget(''); setEditing(false); setPreview(null); onPreview(null); setError(''); setMessage(''); setHistory(null); setLoading(true);
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
   setTarget(String(result.positive_target)); setEditing(false); setPreview(null); onPreview(null); setMessage('Monthly target saved.');
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
 return <Card title="Customer /20" ariaLabel="Customer Performance configuration and preview" action={<div className="flex flex-wrap items-center justify-end gap-2"><Badge tone="neutral">Preview only</Badge>{canPreview ? <button className="btn-secondary" type="button" disabled={loading || saving || previewing || !context} onClick={refreshPreview}>{previewing ? 'Preparing preview…' : 'Refresh Preview'}</button> : null}</div>}>
  <div className="space-y-3 p-4">
   <div aria-live="polite" className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <div className="min-w-0"><p className="text-xl font-semibold tabular-nums">{ready ? `${number(preview.score)} / 20` : 'Pending'}</p>{!ready ? <p className="mt-1 text-sm text-text-secondary">{reasons[preview?.reason] || (context && !context.positive_target ? reasons.target_required : 'Refresh Preview to read monthly evidence.')}</p> : <p className="mt-1 text-sm text-text-secondary">Outlet-shared Customer preview</p>}</div>
    <dl className="grid grid-cols-3 gap-3">
     <div><dt className="text-xs text-text-secondary">Positive Target</dt><dd className="mt-1 font-semibold tabular-nums">{ready ? `${number(preview.positiveTarget)} / 15` : '— / 15'}</dd>{ready ? <dd className="text-xs text-text-secondary">{preview.positive} / {preview.target} positive reviews</dd> : null}</div>
     <div><dt className="text-xs text-text-secondary">Review Quality</dt><dd className="mt-1 font-semibold tabular-nums">{ready ? `${preview.quality} / 5` : '— / 5'}</dd>{ready ? <dd className="text-xs text-text-secondary">{number(preview.negativeRate * 100)}% negative</dd> : null}</div>
     <div><dt className="text-xs text-text-secondary">Monthly Reviews</dt><dd className="mt-1 font-semibold tabular-nums">{ready ? preview.total : '—'}</dd>{ready ? <dd className="text-xs text-text-secondary">{preview.positive} positive · {preview.total - preview.positive - preview.negative} neutral · {preview.negative} negative</dd> : null}</div>
    </dl>
   </div>
   <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
    <span className="text-text-secondary">Monthly target: <strong className="font-semibold text-text-primary">{loading ? 'Loading…' : context?.positive_target == null ? 'Not configured' : `${context.positive_target} positive reviews`}</strong></span>
    {canEdit ? <button className="btn-secondary h-8 px-2 text-xs" type="button" disabled={loading || saving || !context || context.target_locked} onClick={() => { setEditing(true); setTarget(String(context.positive_target ?? '')); setError(''); }}>{context?.positive_target == null ? 'Configure Target' : 'Edit'}</button> : null}
    <button className="btn-secondary h-8 px-2 text-xs" type="button" aria-label="Target History" disabled={loading || !context} onClick={openHistory}>History</button>
    {context?.target_locked ? <span className="text-xs text-text-secondary">Target locked after Performance finalization.</span> : null}
   </div>
   {editing ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (validTarget && !saving) save(); }}>
    <label className="field-label w-full min-w-0 sm:w-64">Monthly Positive Review Target<input className="control mt-1 w-full" type="number" min="1" step="1" required value={target} disabled={saving || previewing || context?.target_locked} onChange={event => { setTarget(event.target.value); setMessage(''); }} /></label>
    <button className="btn-primary" type="submit" disabled={saving || previewing || context?.target_locked || !validTarget || Number(target) === context?.positive_target}>{saving ? 'Saving…' : 'Save Target'}</button>
    <button className="btn-secondary" type="button" disabled={saving} onClick={() => { setEditing(false); setTarget(String(context?.positive_target ?? '')); setError(''); }}>Cancel</button>
   </form> : null}
   {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
   {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
   <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-text-secondary"><span>Preview only · Not included in saved scores or Reward</span>{ready ? <span>Fresh read {date(preview.fetchedAt)} · Expires {date(preview.expiresAt)}</span> : null}</div>
  </div>
  {history ? <Modal title="Monthly Positive Review Target History" onClose={() => setHistory(null)} footer={<button className="btn-secondary" type="button" onClick={() => setHistory(null)}>Close</button>}>
   {history.length ? <ul className="space-y-3">{history.map(row => <li key={row.id}><strong>{row.old_target ?? 'Not set'} → {row.new_target}</strong><p className="text-sm text-text-secondary">{date(row.changed_at)}</p></li>)}</ul> : <p>No target changes for this month.</p>}
  </Modal> : null}
 </Card>;
}
