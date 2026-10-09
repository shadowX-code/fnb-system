import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import { marketingService } from './marketingService.js';
const label = value => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const stamp = value => value ? new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value)) : 'Unavailable';
const active = c => ['test_authorized', 'production_authorized'].includes(c.status) && Date.parse(c.expires_at) > Date.now();

export function MetaConnections({ organizationId, brandId, brands }) {
  const auth = useAuth();
  const configure = auth.hasPermission('marketing_settings.configure');
  const [configuration, setConfiguration] = useState(null), [data, setData] = useState(null), [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [disconnect, setDisconnect] = useState(null), [diagnostics, setDiagnostics] = useState(null);
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  const lifetime = useRef(0);
  useEffect(() => { setDiagnostics(null); }, [scope]);
  useEffect(() => {
    let live = true; lifetime.current++;setLoading(true);setData(null);setPending([]);setError('');setDisconnect(null);setBusy(false);
    Promise.all([marketingService.metaConfiguration(), organizationId ? marketingService.integrations(organizationId, brandId) : Promise.resolve(null), configure && organizationId && brandId ? marketingService.pendingMeta(organizationId, brandId) : Promise.resolve([])])
      .then(([config, integrations, sessions]) => { if (live) { setConfiguration(config); setData(integrations); setPending(sessions); } })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; lifetime.current++; };
  }, [scope, configure, refresh]);
  async function perform(action, message) {
    const generation = lifetime.current;setBusy(true);setError('');
    try { await action();if (generation === lifetime.current) { setDisconnect(null);setRefresh(v => v + 1);setNotice(message); } }
    catch (e) { if (generation === lifetime.current) setError(e.message); }
    finally { if (generation === lifetime.current) setBusy(false); }
  }
  async function connect() {
    const generation = lifetime.current;
    await perform(async () => {
      const result = await marketingService.authorizeMeta(organizationId, brandId);
      if (generation !== lifetime.current) return;
      const url = new URL(result.authorization_url);
      if (url.protocol !== 'https:' || url.hostname !== 'www.facebook.com') throw new Error('Meta authorization URL is unavailable.');
      window.location.assign(url.toString());
    }, 'Opening Meta authorization.');
  }
  const result = new URLSearchParams(window.location.search).get('meta_result');
  return <section className="card p-5 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Meta accounts</h2><p className="text-sm text-text-secondary mt-1">Connect a Facebook Page and its linked professional Instagram account to one brand. Connecting does not publish content.</p></div>{configure ? <button className="btn-primary" disabled={busy || loading || !brandId || !configuration?.configured} onClick={connect}>Connect / reconnect Meta</button> : null}</div>
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {result ? <p role="status" className="text-sm">{result === 'select_account' ? 'Authorization received. Select the verified accounts below within 15 minutes.' : result === 'cancelled' ? 'Meta authorization was cancelled.' : 'Meta authorization did not complete. Check the app settings and reconnect.'}</p> : null}
    <AsyncDataSurface loading={loading} error={error} hasData={Boolean(configuration)} onRetry={() => setRefresh(v => v + 1)}>
      {configuration ? <><Badge tone={configuration.configured ? 'success' : 'warning'}>{configuration.configured ? 'OAuth configured' : 'Setup required'}</Badge>{!configuration.configured ? <p className="text-sm text-text-secondary break-all">Missing server configuration: {configuration.missing.join(', ')}.</p> : null}<p className="text-sm text-text-secondary">{brandId ? 'Account selection applies to the selected brand.' : 'Select a brand to authorize an account.'} External execution is limited to server-enabled test accounts and requires a separate content approval.</p><p className="text-xs text-text-secondary">Worker last checked: {stamp(data?.worker?.last_seen_at)}{data?.worker?.error_code ? ` · ${label(data.worker.error_code)}` : ''}</p></> : null}
      {pending.flatMap(session => session.accounts.map(a => <div className="marketing-row" key={`${session.id}:${a.channel}:${a.id}`}><span><strong>{a.name} · {label(a.channel)}</strong><small>Meta account {a.id} · {a.capabilities.publishing ? 'Publishing permission granted' : 'Publishing permission unavailable'}</small></span><button className="btn-secondary" disabled={busy || !configuration?.configured} onClick={() => perform(() => marketingService.bindMeta(session.id, a.id, a.channel), 'Meta account connected. No content was sent.')}>Connect to brand</button></div>))}
      {(data?.connections || []).map(c => <div className="marketing-row" key={c.id}><span><strong>{brands.find(b => b.id === c.brand_id)?.name} · {label(c.channel)}{c.account_name ? ` · ${c.account_name}` : ''}</strong><small>{label(!active(c) && c.status.endsWith('_authorized') ? 'expired' : c.status)} · Expires {stamp(c.expires_at)}</small><small>{active(c) && c.capabilities.publishing ? `Granted formats: ${c.capabilities.formats.join(', ')}` : 'Publishing unavailable'} · {active(c) && c.capabilities.execution_enabled ? 'Test execution enabled' : 'External execution disabled'}</small><small>Last synchronization: {stamp(c.last_synced_at)}{c.sync_truncated ? ' · Recent 80 posts only' : ''}{c.sync_error_code || c.error_code ? ` · ${label(c.sync_error_code || c.error_code)}` : ''}</small></span>{configure ? <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy || !configuration?.configured || c.status === 'not_connected'} onClick={() => perform(async () => { const generation = lifetime.current;const result = await marketingService.diagnoseMeta(c.id);if (generation === lifetime.current) setDiagnostics(result); }, 'Read-only connection check completed.')}>Check connection</button><button className="btn-secondary" disabled={busy || (!active(c) && !(c.channel === 'facebook' && c.status === 'error' && c.error_code === 'meta_permission_or_token_invalid')) || !c.capabilities.posts} onClick={() => perform(() => c.status === 'error' ? marketingService.retryMetaSync(c.id) : marketingService.syncMeta(c.id), 'Synchronization requested. The worker will collect available evidence.')}>{c.status === 'error' ? 'Retry sync' : 'Sync posts'}</button><button className="btn-secondary" disabled={busy || c.status === 'not_connected'} onClick={() => setDisconnect(c)}>Disconnect</button></div> : null}</div>)}
      {diagnostics ? <div className="text-xs space-y-2" role="status"><p>Connection check · {label(diagnostics.channel)} · Account {diagnostics.account_id} · Token {diagnostics.token.type} · Valid {String(diagnostics.token.valid)} · App matches {String(diagnostics.token.app_matches)} · Account matches {String(diagnostics.credential_identity_matches)} · Expiry valid {String(diagnostics.token.expiry_in_future)}</p>{diagnostics.token.granted_scopes ? <p>Granted permissions · {diagnostics.token.granted_scopes.join(', ') || 'None'}</p> : null}{diagnostics.publishing_evidence ? <p>Publishing verification incomplete · Page {diagnostics.publishing_evidence.page_id || 'Unavailable'} · Can post {diagnostics.publishing_evidence.can_post === null ? 'Unavailable' : String(diagnostics.publishing_evidence.can_post)} · Linked-Page MANAGE / CREATE_CONTENT tasks unverified · Missing required permissions {diagnostics.publishing_evidence.missing_scopes.join(', ') || 'None'}{diagnostics.channel === 'instagram' ? ` · Linked professional account verified ${String(diagnostics.publishing_evidence.professional_account_verified)} · Publishing quota ${diagnostics.publishing_evidence.quota_usage ?? 'Unavailable'} / ${diagnostics.publishing_evidence.quota_total ?? 'Unavailable'}` : ''}. This read-only check does not authorize execution.</p> : null}{diagnostics.evidence.map(row => <p key={row.check}>{label(row.check)} · HTTP {row.http_status ?? 'Unavailable'} · Graph {row.graph_error_code ?? 'None'} / {row.graph_error_subcode ?? 'None'}{row.error_permissions.length ? ` · ${row.error_permissions.join(', ')}` : ''}</p>)}</div> : null}
      {!data?.connections.length ? <p className="text-sm text-text-secondary">No Meta accounts are connected in this scope.</p> : null}
      <p className="text-xs text-text-secondary">Facebook Reels and messaging are unavailable. Instagram images require JPEG, up to 8 MB, width 320–1440 px and aspect ratio 4:5–1.91:1. Publishing accepts MP4 up to 50 MB; Meta validates video processing before Instagram publication.</p>
    </AsyncDataSurface>
    {disconnect ? <Modal title="Disconnect Meta account" onClose={() => { if (!busy) setDisconnect(null); }} footer={<><button className="btn-secondary" disabled={busy} onClick={() => setDisconnect(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={() => perform(() => marketingService.disconnectMeta(disconnect.id), 'Account disconnected; encrypted credentials removed.')}>Disconnect account</button></>}><p>Disconnect {disconnect.account_name} from this brand. Scheduled execution will stop. Uncertain delivery will remain visible for investigation. Previously published posts on Meta remain there.</p></Modal> : null}
  </section>;
}

export function PublishAuthorization({ content, onComplete }) {
  const auth = useAuth(), [connections, setConnections] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [accepted, setAccepted] = useState(false);
  const request = useRef(crypto.randomUUID()), lifetime = useRef(0);
  useEffect(() => {
    let live = true; lifetime.current++;setConnections(null);setError('');setAccepted(false);
    if(content.status !== 'scheduled' || !auth.hasPermission('marketing_content.execute') || !auth.hasPermission('marketing_content.publish')) return () => { live = false;lifetime.current++; };
    marketingService.integrations(content.organization_id, content.brand_id, 'content').then(data => { if (live) setConnections(data.connections); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false;lifetime.current++; };
  }, [content.id, content.revision, content.status, auth.user?.id]);
  if (content.status !== 'scheduled' || !auth.hasPermission('marketing_content.execute') || !auth.hasPermission('marketing_content.publish')) return null;
  const selected = content.payload.variants.map(v => connections?.find(c => c.channel === v.channel && active(c) && c.capabilities.publishing && c.capabilities.execution_enabled && c.capabilities.formats.includes(v.format)));
  const ready = selected.every(Boolean);
  return <section className="card p-4 space-y-3"><h3 className="font-semibold">External publishing approval</h3><p className="text-sm">Authorize revision {content.revision} for {stamp(content.scheduled_at)}. Posts due now may be sent by the worker immediately after authorization.</p>{content.payload.variants.map((v, i) => <p className="text-sm" key={v.channel}>{label(v.channel)} → {selected[i]?.account_name || 'No enabled account for this format'}{selected[i] ? ` · Meta account ${selected[i].provider_account_id} · Test authorization` : ''}</p>)}{error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}<label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={accepted} disabled={!ready || busy} onChange={e => setAccepted(e.target.checked)} />I approve sending this exact caption and media to the listed accounts.</label><button className="btn-primary" disabled={!ready || !accepted || busy} onClick={async () => { const generation = lifetime.current;setBusy(true);try { await marketingService.execute(request.current, content, selected.map(c => c.id));if (generation === lifetime.current) onComplete(); } catch (e) { if (generation === lifetime.current) setError(e.message); } finally { if (generation === lifetime.current) setBusy(false); } }}>Authorize external publishing</button>{connections && !ready ? <p className="text-sm text-text-secondary">Connect an authorized account and configure its test-account allowlist before enabling external execution.</p> : null}</section>;
}

export function SocialEvidence({ organizationId, brandId }) {
  const auth = useAuth(), [page, setPage] = useState(1), [state, setState] = useState(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([organizationId, brandId, auth.user?.id]);
  useEffect(() => { setPage(1); }, [scope]);
  useEffect(() => { let live = true;setState(null);setError('');marketingService.integrations(organizationId, brandId, 'analytics', page).then(data => { if (live) setState(data); }).catch(e => { if (live) setError(e.message); });return () => { live = false; }; }, [scope, page, refresh]);
  return <section className="card p-5 space-y-3"><h2 className="font-semibold">Social evidence</h2><p className="text-sm text-text-secondary">Platform-reported observations retain their collection time. Reach is a platform estimate; it is not additive across posts. These metrics do not establish conversions or incremental revenue.</p><AsyncDataSurface loading={!state && !error} error={error} onRetry={() => setRefresh(v => v + 1)} isEmpty={state && !state.posts.length} emptyTitle="No synchronized platform evidence" hasData={Boolean(state?.posts.length)}>{state?.posts.map(p => <div className="marketing-row" key={p.id}><span><strong>{label(p.channel)} · {p.caption || 'Post without caption'}</strong><small>Published {stamp(p.published_at)} · Observed {stamp(p.observed_at)}</small><small>{Object.entries(p.metrics).map(([key, value]) => `${label(key)}: ${value}`).join(' · ') || 'No metrics returned'}</small><small>{Object.keys(p.unavailable_metrics).length ? `Unavailable: ${Object.keys(p.unavailable_metrics).map(label).join(', ')}` : ''}</small>{p.permalink ? <a className="text-sm underline" href={p.permalink} target="_blank" rel="noreferrer">View platform post</a> : null}</span></div>)}</AsyncDataSurface><AdminPagination page={page} pageSize={20} total={state?.total || 0} loading={!state && !error} onPageChange={setPage} noun="platform posts" /></section>;
}
