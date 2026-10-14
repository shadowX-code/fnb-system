import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Settings2, Star } from 'lucide-react';
import PageHeader from '../../../components/layout/PageHeader.jsx';
import AdminFilterToolbar, { AdminOutletField } from '../../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../../components/forms/AdminSearchField.jsx';
import MonthPickerField from '../../../components/forms/MonthPickerField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Modal from '../../../components/feedback/Modal.jsx';
import { useCrewAdminOutlet } from '../context/CrewAdminOutletContext.jsx';
import { googleBusinessService as service } from '../services/googleBusinessService.js';
import GoogleReviewTargetSettings from '../components/GoogleReviewTargetSettings.jsx';

const ratings = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const formatTime = value => value ? new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : 'Not synced';
function reviewMonth(value) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
 return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export default function CrewGoogleReviewsAdminPage({ store, auth }) {
 const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
 const [context, setContext] = useState(null), [settings, setSettings] = useState(false), [loading, setLoading] = useState(false);
 const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
 const [search, setSearch] = useState(''), [stars, setStars] = useState('all'), [reply, setReply] = useState('all'), [month, setMonth] = useState('');
 const [order, setOrder] = useState('newest'), [location, setLocation] = useState(''), [confirmation, setConfirmation] = useState(false);
 const [oauthResult, setOauthResult] = useState(() => new URLSearchParams(window.location.search).get('google_result'));
 const sequence = useRef(0), pending = useRef(false);
 useEffect(() => {
  const id = ++sequence.current; setContext(null); setError(''); setMessage(''); setConfirmation(false);
  if (!outletId) { setLoading(false); return undefined; }
  setLoading(true);
  service.context(outletId).then(data => { if (id === sequence.current) { setContext(data); setLocation(data.mapping?.name || ''); } })
   .catch(cause => { if (id === sequence.current) setError(cause.message); })
   .finally(() => { if (id === sequence.current) setLoading(false); });
  return () => { ++sequence.current; };
 }, [outletId]);
 useEffect(() => {
  if (!context?.cache_expires_at) return undefined;
  const timer = setTimeout(() => setContext(current => current ? { ...current, reviews: [], sync_status: 'awaiting_sync' } : current), Math.max(0, Date.parse(context.cache_expires_at) - Date.now()));
  return () => clearTimeout(timer);
 }, [context?.cache_expires_at]);
 async function run(action, command) {
  if (pending.current) return;
  pending.current = true; setBusy(action); setError(''); setMessage(''); const id = sequence.current;
  try {
   const data = await command();
   if (id !== sequence.current) return;
   if (action === 'authorize') {
    const url = new URL(data.url);
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Google authorization URL unavailable.');
    window.location.assign(url.href); return;
   }
   const next = await service.context(outletId);
   if (id !== sequence.current) return;
   setContext(next); setLocation(next.mapping?.name || ''); setConfirmation(false);
   setMessage(action === 'sync' ? 'Google review sync complete.' : action === 'map' ? 'Outlet mapping saved.' : action === 'disconnect' ? 'Google connection disconnected and access revoked.' : 'Google connection context refreshed.');
  } catch (cause) { if (id === sequence.current) setError(cause.message || 'Google Reviews request failed.'); }
  finally { pending.current = false; setBusy(''); }
 }
 const connected = context?.connection_status === 'connected', canManage = context?.can_manage;
 const available = connected && context?.sync_status === 'complete';
 const reviews = (available ? context.reviews || [] : []).filter(r =>
  (stars === 'all' || ratings[r.starRating] === Number(stars)) && (reply === 'all' || Boolean(r.reviewReply) === (reply === 'replied'))
  && (!month || reviewMonth(r.createTime) === month) && `${r.comment || ''} ${r.reviewer?.displayName || ''} ${r.reviewReply?.comment || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
  .sort((a,b) => (Date.parse(a.createTime) - Date.parse(b.createTime)) * (order === 'oldest' ? 1 : -1));
 const outlet = outlets.find(o => o.id === outletId);
 const state = !context?.configured ? 'Google connection configuration required' : !connected ? context?.connection_status === 'revocation_pending' ? 'Disconnect needs retry' : context?.connection_status === 'expired' ? 'Reconnect Google Business Profile' : 'Google Business Profile is not connected'
  : !context.mapping ? 'Choose this outlet’s Google Location' : context.sync_status === 'running' ? 'Syncing Google Reviews' : context.sync_status === 'error' ? 'Review sync needs attention' : available ? 'Google Review Inbox is up to date' : 'Sync this outlet’s Google Reviews';
 return <div className="space-y-5">
  <PageHeader section="Crew · Reputation" title="Google Reviews" description="Read-only Google review inbox. Separate from Customer Feedback and employee Performance." secondaryActions={<button className="btn-secondary" onClick={() => setSettings(!settings)}><Settings2 size={16} />{settings ? 'Review Inbox' : 'Settings'}</button>} primaryActions={!settings ? <button className="btn-primary" disabled={!connected || !context?.mapping || !!busy || context.sync_status === 'running'} onClick={() => run('sync', () => service.sync(outletId))}><RefreshCw size={16} />{busy === 'sync' ? 'Syncing…' : 'Sync reviews'}</button> : null} />
  <AdminFilterToolbar ariaLabel="Google Reviews scope" outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map(o => ({ value: o.id, label: o.name }))} />} />
  {['failed','rate_limited'].includes(oauthResult) ? <div role="alert" className="rounded-md border border-rose-200 px-4 py-3 text-sm text-rose-700">{oauthResult === 'rate_limited' ? 'Google returned a rate limit during authorization. Check the exact API request in the integration logs before retrying.' : 'Google authorization was not completed. Open Settings and reconnect.'}<button className="btn-secondary ml-3" onClick={() => setOauthResult('')}>Dismiss</button></div> : null}
  {error ? <div className="rounded-md border border-rose-200 px-4 py-3 text-sm text-rose-700" role="alert">{error}<button className="btn-secondary ml-3" disabled={!!busy} onClick={() => run('reload', () => Promise.resolve())}>Retry</button></div> : null}
  {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
  {loading ? <p role="status">Loading Google Reviews…</p> : !outletId ? <p>Select an outlet.</p> : context ? <>
   <div className="border-l-2 border-primary bg-primary/5 px-4 py-3" role="status"><strong>{state}</strong><p className="mt-1 text-sm text-text-secondary">Last successful sync: {formatTime(context.fetched_at)}. Reviews do not contribute to Crew Performance.</p></div>
   {settings ? <div className="grid gap-5 lg:grid-cols-2">
    <section className="space-y-3 border-t border-border pt-4" aria-label="Google Business Profile connection">
     <div className="flex justify-between gap-3"><h2 className="font-semibold">Google Business Profile</h2><Badge tone="neutral">{connected ? 'Connected' : context.connection_status === 'expired' ? 'Reconnect required' : context.connection_status === 'revocation_pending' ? 'Revocation pending' : 'Disconnected'}</Badge></div>
     <p className="text-sm text-text-secondary">One authorized connection supplies Google accounts and locations. Tokens stay server-side. Disconnect revokes Google access and clears the review cache.</p>
     <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={!canManage || !context.configured || !!busy || context.connection_status === 'revocation_pending'} onClick={() => run('authorize', () => service.authorize(outletId))}>{busy === 'authorize' ? 'Connecting…' : connected || context.connection_status === 'expired' ? 'Reconnect' : 'Connect Google'}</button><button className="btn-secondary" disabled={!canManage || !connected || !!busy} onClick={() => run('discover', () => service.discover(outletId))}>Refresh locations</button><button className="btn-secondary" disabled={!canManage || context.connection_status === 'disconnected' || !!busy} onClick={() => setConfirmation('disconnect')}>Disconnect</button></div>
     {!canManage ? <p className="text-sm text-text-secondary">All-outlet Performance review permission is required to manage the connection and mappings.</p> : null}
     {context.accounts?.length ? <ul className="text-sm text-text-secondary">{context.accounts.map(a => <li key={a.name}>{a.displayName}</li>)}</ul> : null}
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label="Outlet mapping">
     <h2 className="font-semibold">Outlet Mapping</h2><p className="text-sm text-text-secondary">{outlet?.name}: {context.mapping?.title || 'Not mapped'}. Select explicitly; names are never matched automatically.</p>
     <SelectField label="Google Location" value={location} onChange={setLocation} searchable disabled={!canManage || !connected || !!busy} options={[{ value: '', label: 'Not mapped' }, ...(context.locations || []).map(l => ({ value: l.name, label: l.title, description: l.name }))]} />
     <button className="btn-primary" disabled={!canManage || !connected || !!busy || location === (context.mapping?.name || '')} onClick={() => setConfirmation('map')}>Save mapping</button>
    </section>
    <GoogleReviewTargetSettings key={outletId} outletId={outletId} canEdit={auth?.hasPermission('crew_performance.review')} />
   </div> : <section className="space-y-4" aria-label="Review Inbox">
    <AdminFilterToolbar ariaLabel="Review filters" search={<AdminSearchField value={search} onChange={setSearch} placeholder="Review, reviewer or owner reply" maxLength={100} />} filters={<><SelectField label="Rating" value={stars} onChange={setStars} options={[{ value: 'all', label: 'All ratings' }, ...[5,4,3,2,1].map(n => ({ value: String(n), label: `${n} stars` }))]} /><SelectField label="Owner reply" value={reply} onChange={setReply} options={[{ value: 'all', label: 'All reviews' }, { value: 'replied', label: 'With owner reply' }, { value: 'unreplied', label: 'Without owner reply' }]} /><SelectField label="Order" value={order} onChange={setOrder} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} /></>} period={<MonthPickerField label="Created month" emptyLabel="All months" value={month} onChange={setMonth} />} secondaryActions={month ? <button className="btn-secondary" onClick={() => setMonth('')}>All months</button> : null} />
    <p className="text-sm text-text-secondary">Source: Google Business Profile · Read-only. Cached review content expires after 24 hours.</p>
    {reviews.length ? <div className="divide-y divide-border border-t border-border">{reviews.map(r => <article key={r.name} className="space-y-2 py-4">
     <div className="flex flex-wrap justify-between gap-2"><strong className="inline-flex items-center gap-1"><Star size={14} />{ratings[r.starRating]} / 5 · {r.reviewer?.displayName || 'Google reviewer'}</strong><time className="text-xs text-text-secondary" dateTime={r.createTime}>{formatTime(r.createTime)}</time></div>
     <p className="whitespace-pre-wrap break-words text-sm">{r.comment || 'No written review'}</p>
     {r.reviewReply ? <div className="border-l-2 border-border pl-3"><strong className="text-sm">Owner reply</strong><p className="whitespace-pre-wrap break-words text-sm">{r.reviewReply.comment}</p><time className="text-xs text-text-secondary" dateTime={r.reviewReply.updateTime}>{formatTime(r.reviewReply.updateTime)}</time></div> : <p className="text-xs text-text-secondary">No owner reply</p>}
     <details className="text-xs text-text-secondary"><summary>Source details</summary><p className="break-all">{r.name}</p><p>Updated: {formatTime(r.updateTime)}</p></details>
    </article>)}</div> : <p className="py-8 text-center text-sm text-text-secondary">{available ? 'No reviews match these filters.' : 'Connect, map this outlet and complete a sync to load its Google reviews.'}</p>}
   </section>}
  </> : null}
  {confirmation ? <Modal title={confirmation === 'disconnect' ? 'Disconnect Google Business Profile' : 'Confirm Outlet Mapping'} description={confirmation === 'disconnect' ? 'Google access will be revoked for this connection and its cached reviews cleared. Reconnect requires Google consent.' : `Confirm that the selected Google location belongs to ${outlet?.name}. This does not modify Google.`} onClose={() => { if (!busy) setConfirmation(false); }} footer={<><button className="btn-secondary" disabled={!!busy} onClick={() => setConfirmation(false)}>Cancel</button><button className="btn-primary" disabled={!!busy} onClick={() => confirmation === 'disconnect' ? run('disconnect', () => service.disconnect(outletId)) : run('map', () => service.map(outletId, location, context))}>{busy ? 'Saving…' : confirmation === 'disconnect' ? 'Disconnect' : 'Confirm mapping'}</button></>}><p className="text-sm">{confirmation === 'map' ? context.locations?.find(l => l.name === location)?.title || 'Remove mapping' : 'Existing first-party feedback and employee Performance are unchanged.'}</p>{error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}</Modal> : null}
 </div>;
}
