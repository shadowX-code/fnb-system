import { useEffect, useRef, useState } from 'react';
import { MessageSquare, RefreshCw, Eye } from 'lucide-react';
import AdminPagination, { useAdminClientPagination } from '../../../components/tables/AdminPagination.jsx';
import PageHeader from '../../../components/layout/PageHeader.jsx';
import AdminFilterToolbar, { AdminOutletField } from '../../../components/layout/AdminFilterToolbar.jsx';
import AdminUnderlineTabs from '../../../components/navigation/AdminUnderlineTabs.jsx';
import AdminSearchField from '../../../components/forms/AdminSearchField.jsx';
import MonthPickerField from '../../../components/forms/MonthPickerField.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import Card from '../../../components/ui/Card.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import EmptyState from '../../../components/feedback/EmptyState.jsx';
import LoadingSkeleton from '../../../components/feedback/LoadingSkeleton.jsx';
import { useCrewAdminOutlet } from '../context/CrewAdminOutletContext.jsx';
import { googleBusinessService as service } from '../services/googleBusinessService.js';
import GoogleReviewerAvatar from '../components/GoogleReviewerAvatar.jsx';
import GoogleReviewDetail, { ownerReplyLabel, ownerReplyTone } from '../components/GoogleReviewDetail.jsx';
import GoogleReviewsSettings from '../components/GoogleReviewsSettings.jsx';
import GoogleRatingOverview, { GoogleReviewStars } from '../components/GoogleRatingOverview.jsx';
import { googleReviewRatings as ratings } from '../domain/googleReviewPresentation.js';

const formatTime = value => new Date(value).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
function reviewMonth(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}

export default function CrewGoogleReviewsAdminPage({ store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [context, setContext] = useState(null), [tab, setTab] = useState('inbox'), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [search, setSearch] = useState(''), [stars, setStars] = useState('all'), [reply, setReply] = useState('all'), [month, setMonth] = useState('');
  const [detail,setDetail]=useState(null);
  const [order, setOrder] = useState('newest');
  const [oauthResult, setOauthResult] = useState(() => new URLSearchParams(window.location.search).get('google_result'));
  const sequence = useRef(0), pending = useRef(false);
  useEffect(() => {
    const id = ++sequence.current; setContext(null); setError('');
    if (!outletId) { setLoading(false); return undefined; }
    setLoading(true);
    service.context(outletId).then(data => { if (id === sequence.current) setContext(data); })
      .catch(cause => { if (id === sequence.current) setError(cause.message); })
      .finally(() => { if (id === sequence.current) setLoading(false); });
    return () => { ++sequence.current; };
  }, [outletId, reload]);
  useEffect(() => {
    if (!context?.cache_expires_at) return undefined;
    const timer = setTimeout(() => setContext(current => current ? { ...current, reviews: [], sync_status: 'awaiting_sync' } : current), Math.max(0, Date.parse(context.cache_expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [context?.cache_expires_at]);
  useEffect(() => {
    if (context?.connection_status !== 'connected' || tab !== 'inbox' || detail) return undefined;
    let cancelled = false, refreshing = false;
    const timer = setInterval(async () => {
      if (cancelled || document.visibilityState !== 'visible' || pending.current || refreshing) return;
      const id = sequence.current; refreshing = true;
      try {
        const next = await service.context(outletId);
        if (!cancelled && id === sequence.current && !pending.current) setContext(next);
      } catch (cause) {
        if (!cancelled && id === sequence.current) setError(cause.message || 'Unable to refresh Google Reviews status.');
      } finally { refreshing = false; }
    }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [context?.connection_status, outletId, tab, detail]);
  async function run(action, command, surfaceError = true) {
    if (pending.current) return { ok: false, error: 'Another action is in progress.' };
    pending.current = true; setBusy(action); setError(''); const id = sequence.current;
    try {
      const data = await command();
      if (id !== sequence.current) return { ok: false, error: 'Outlet changed. Refresh Settings.' };
      if (action === 'authorize') {
        const url = new URL(data.url);
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Google authorization URL unavailable.');
        window.location.assign(url.href); return { ok: true };
      }
      const next = await service.context(outletId);
      if (id !== sequence.current) return { ok: false, error: 'Outlet changed. Refresh Settings.' };
      setContext(next);
      return { ok: true };
    } catch (cause) {
      const message = cause.message || 'Google Reviews request failed.';
      if (id === sequence.current) {
        if (surfaceError) setError(message);
        // Read FeedX's stored authority after failure; never retry a Google request.
        try { const next = await service.context(outletId); if (id === sequence.current) setContext(next); }
        catch { if (id === sequence.current) setContext(current => current ? { ...current, reviews: [], sync_status: 'awaiting_sync' } : null); }
      }
      return { ok: false, error: message };
    } finally { pending.current = false; setBusy(''); }
  }
  async function refreshReplyProjection() {
    const id=sequence.current;
    const next=await service.context(outletId);
    if(id!==sequence.current)throw new Error('Outlet changed.');
    setContext(next);
    if(next.can_sync && next.sync_status!=='complete' && next.connection_status==='connected' && next.mapping) {
      const refreshed=await run('sync',()=>service.sync(outletId));
      if(!refreshed.ok)throw new Error(refreshed.error);
    }
  }
  const connected = context?.connection_status === 'connected';
  const available = connected && context?.mapping && context?.sync_status === 'complete' && Date.parse(context.cache_expires_at) > Date.now();
  const reviews = (available ? context.reviews || [] : []).filter(review =>
    (stars === 'all' || ratings[review.starRating] === Number(stars)) && (reply === 'all' || Boolean(review.reviewReply) === (reply === 'replied'))
    && (!month || reviewMonth(review.createTime) === month) && `${review.comment || ''} ${review.reviewer?.displayName || ''} ${review.reviewReply?.comment || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (Date.parse(a.createTime) - Date.parse(b.createTime)) * (order === 'oldest' ? 1 : -1) || a.name.localeCompare(b.name));
  const pagination = useAdminClientPagination('google-reviews.inbox', reviews.length, 20, JSON.stringify([outletId, search, stars, reply, month, order]));
  const visibleReviews = reviews.slice(pagination.from, pagination.to);
  const syncing = busy === 'sync' || context?.sync_status === 'running';
  const activeFilters = [
    search && { key: 'search', label: 'Search', value: search, onRemove: () => setSearch('') },
    stars !== 'all' && { key: 'stars', label: 'Rating', value: `${stars} stars`, onRemove: () => setStars('all') },
    reply !== 'all' && { key: 'reply', label: 'Owner reply', value: reply === 'replied' ? 'With reply' : 'Without reply', onRemove: () => setReply('all') },
    month && { key: 'month', label: 'Month', value: month, onRemove: () => setMonth('') },
  ].filter(Boolean);
  const emptyTitle = !context?.configured ? 'Google connection setup required' : !connected ? context?.connection_status === 'revocation_pending' ? 'Disconnect needs retry' : context?.connection_status === 'expired' ? 'Reconnect Google Business Profile' : 'Google Business Profile is not connected'
    : !context.mapping ? 'No Google Location mapped' : syncing ? 'Syncing Google Reviews…' : context.sync_status === 'error' ? 'Review sync needs attention' : available ? (context.reviews?.length ? 'No reviews match these filters' : 'No Google reviews yet') : 'Ready to sync';
  const emptyDescription = !connected || !context?.mapping ? 'Open Settings to manage the connection and outlet mapping.' : syncing ? 'Reviews will appear when synchronization finishes.' : context.sync_status === 'error' ? 'Try syncing again. If it continues, check the reported error.' : available ? (context.reviews?.length ? 'Adjust or clear your filters.' : 'The latest sync returned no reviews for this location.') : 'Sync reviews to load this outlet’s Inbox.';
  return <div className="space-y-4">
    <PageHeader title="Google Reviews" primaryActions={tab === 'inbox' ? <div className="flex flex-wrap items-center gap-3"><div className="max-w-sm text-sm text-text-secondary" role="status"><p>{syncing ? 'Syncing…' : context?.automatic_sync ? 'Automatic · Every 30 minutes' : 'Automatic sync paused'}</p>{!error && !context?.sync_health?.error_code && context?.scheduler_error ? <p role="alert">Automatic sync needs attention. Use Sync Now or retry after the next scheduled interval.</p> : null}{context?.sync_health?.last_success_at ? <p>Last success {formatTime(context.sync_health.last_success_at)}</p> : context?.fetched_at ? <p>Last success {formatTime(context.fetched_at)}</p> : null}{!error && context?.sync_health?.error_code ? <p role="alert">{context.sync_health.error_code==='reconnect_required' ? 'Reconnect Google in Settings.' : context.sync_health.error_code==='google_rate_limited' ? 'Google rate limit. Automatic sync will retry after cooldown.' : context.sync_health.error_code==='google_access_denied' ? 'Google location access denied. Check the connected account.' : 'Sync failed. Try Sync Now or check the connection in Settings.'}{context.sync_health.error_code==='google_rate_limited' ? ` ${context.sync_health.error_service || ''} · ${context.sync_health.error_request || ''}` : ''}</p> : null}</div>{context?.can_sync ? <button className="btn-primary" disabled={!connected || !context?.mapping || !!busy || syncing} onClick={() => run('sync', () => service.sync(outletId))}><RefreshCw size={16} className={syncing ? 'animate-spin motion-reduce:animate-none' : ''} />{syncing ? 'Syncing…' : 'Sync Now'}</button> : null}</div> : null} />
    <AdminUnderlineTabs value={tab} onChange={next => { if (!busy) { setTab(next); setError(''); } }} ariaLabel="Google Reviews sections" tabs={[{ value: 'inbox', label: 'Review Inbox' }, { value: 'settings', label: 'Settings' }]} />
    {['failed', 'rate_limited'].includes(oauthResult) ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 px-4 py-3 text-sm text-rose-700">{oauthResult === 'rate_limited' ? 'Google rate limit during authorization. Check the exact API request before retrying.' : 'Google authorization was not completed. Open Settings to reconnect.'}<button className="btn-secondary" onClick={() => setOauthResult('')}>Dismiss</button></div> : null}
    {error ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 px-4 py-3 text-sm text-rose-700" role="alert"><span className="min-w-0 break-words">{error}</span><button className="btn-secondary" disabled={!!busy} onClick={() => setReload(value => value + 1)}>Reload</button></div> : null}
    {loading ? <div role="status" aria-label="Loading Google Reviews"><LoadingSkeleton rows={4} /></div> : !outletId ? <EmptyState title="No outlets available" description="Google Reviews requires access to an active outlet." /> : context ? tab === 'settings' ?
      <GoogleReviewsSettings outlets={outlets} outletId={outletId} context={context} busy={busy} run={run} /> : <>
        <AdminFilterToolbar ariaLabel="Review filters" denseFields outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map(outlet => ({ value: outlet.id, label: outlet.name }))} />} search={<AdminSearchField value={search} onChange={setSearch} placeholder="Search reviews" maxLength={100} />} filters={<SelectField label="Rating" value={stars} onChange={setStars} options={[{ value: 'all', label: 'All ratings' }, ...[5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${n} ${n === 1 ? 'star' : 'stars'}` }))]} />} period={<MonthPickerField label="Created month" emptyLabel="All months" value={month} onChange={setMonth} />} moreFilters={<><SelectField label="Owner reply" value={reply} onChange={setReply} options={[{ value: 'all', label: 'All reviews' }, { value: 'replied', label: 'With owner reply' }, { value: 'unreplied', label: 'Without owner reply' }]} /><SelectField label="Order" value={order} onChange={setOrder} options={[{ value: 'newest', label: 'Newest first' }, { value: 'oldest', label: 'Oldest first' }]} /></>} activeFilters={activeFilters} onClear={() => { setSearch(''); setStars('all'); setReply('all'); setMonth(''); }} />
        <GoogleRatingOverview context={context} />
        <Card title="Review Inbox" description={context.mapping?.title || undefined} action={<Badge>{available ? `${reviews.length} reviews` : syncing ? 'Syncing' : 'Not synced'}</Badge>}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm text-text-secondary"><span>Google</span></div>
          {reviews.length ? <div className="divide-y divide-border">{visibleReviews.map(review => <article key={review.name} className="space-y-2 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1"><div className="flex min-w-0 items-center gap-2"><GoogleReviewerAvatar reviewer={review.reviewer} /><div className="min-w-0"><button className="text-left text-sm font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" aria-label={`Open review by ${review.reviewer?.displayName || 'Google reviewer'}`} onClick={()=>setDetail(review)}>{review.reviewer?.displayName || 'Google reviewer'}</button><span className="ml-3 inline-flex align-middle"><GoogleReviewStars rating={review.starRating} /></span></div></div><time className="text-sm text-text-secondary" dateTime={review.createTime}>{formatTime(review.createTime)}</time></div>
            <p className="max-w-3xl whitespace-pre-wrap break-words text-sm">{review.comment || 'No written review'}</p>
            <div className="flex flex-wrap items-center justify-between gap-2"><Badge tone={ownerReplyTone(review.reviewReply)}>{ownerReplyLabel(review.reviewReply)}</Badge><button className="btn-secondary" onClick={()=>setDetail(review)}><Eye size={14} />View review</button></div>
            {review.reviewReply ? <div className="rounded-lg bg-surface-muted px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary"><span className="inline-flex items-center gap-1.5 font-semibold"><MessageSquare size={14} />Owner reply</span><time dateTime={review.reviewReply.updateTime}>{formatTime(review.reviewReply.updateTime)}</time></div><p className="mt-1 max-w-3xl whitespace-pre-wrap break-words text-sm">{review.reviewReply.comment}</p></div> : null}
          </article>)}</div> : <div className="p-4"><EmptyState icon={MessageSquare} title={emptyTitle} description={emptyDescription} actions={!connected || !context.mapping ? <button className="btn-secondary" onClick={() => setTab('settings')}>Open Settings</button> : activeFilters.length ? <button className="btn-secondary" onClick={() => { setSearch(''); setStars('all'); setReply('all'); setMonth(''); }}>Clear filters</button> : null} /></div>}
          <AdminPagination page={pagination.page} pageSize={pagination.pageSize} total={reviews.length} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} noun="reviews" />
        </Card>
      </> : null}
    {detail ? <GoogleReviewDetail key={`${outletId}:${detail.name}`} review={detail} outletId={outletId} basis={context} outletName={outlets.find(outlet=>outlet.id===outletId)?.name} onClose={()=>setDetail(null)} onConfirmed={refreshReplyProjection} /> : null}
  </div>;
}
