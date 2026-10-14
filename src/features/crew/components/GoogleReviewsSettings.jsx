import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Link2, LogOut, RefreshCw } from 'lucide-react';
import Card from '../../../components/ui/Card.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import ActionMenu from '../../../components/ui/ActionMenu.jsx';
import DataTable from '../../../components/tables/DataTable.jsx';
import SelectField from '../../../components/forms/SelectField.jsx';
import Modal from '../../../components/feedback/Modal.jsx';
import LoadingSkeleton from '../../../components/feedback/LoadingSkeleton.jsx';
import { googleBusinessService as service } from '../services/googleBusinessService.js';

// Mapping rows retain configuration only, never another outlet's review content.
const mappingContext = data => ({ generation: data.generation, mapping: data.mapping, can_manage: data.can_manage });

export default function GoogleReviewsSettings({ outlets, outletId, context, busy, run }) {
  const [menu, setMenu] = useState(false), [disconnect, setDisconnect] = useState(false);
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState(null), [location, setLocation] = useState(''), [dialogError, setDialogError] = useState('');
  const editRequest = useRef(0), mounted = useRef(true);
  const connected = context.connection_status === 'connected', canManage = context.can_manage;
  const outletIds = outlets.map(outlet => outlet.id).join(',');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++editRequest.current; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setRows([]);
    Promise.all(outlets.map(async outlet => {
      try {
        const data = outlet.id === outletId ? context : await service.context(outlet.id);
        return { ...outlet, context: mappingContext(data) };
      } catch { return { ...outlet, error: true }; }
    })).then(next => { if (current) { setRows(next); setLoading(false); } });
    return () => { current = false; };
  }, [outletIds, outletId, context, reload]);
  async function edit(row) {
    const request = ++editRequest.current;
    setDialogError(''); setEditor({ ...row, loading: true }); setLocation('');
    try {
      const data = await service.context(row.id);
      if (request !== editRequest.current || !mounted.current) return;
      if (!data.can_manage || data.connection_status !== 'connected') throw new Error('Connection or access changed. Refresh Settings before editing this mapping.');
      setEditor({ ...row, context: mappingContext(data), locations: data.locations || [] });
      setLocation(data.mapping?.name || '');
    } catch (cause) {
      if (request === editRequest.current && mounted.current) {
        setEditor({ ...row, unavailable: true }); setDialogError(cause.message || 'Unable to load this mapping.');
      }
    }
  }
  function closeEditor() { if (!busy) { ++editRequest.current; setEditor(null); setDialogError(''); } }
  async function saveMapping() {
    const result = await run('map', () => service.map(editor.id, location, editor.context), false);
    if (!mounted.current) return;
    if (result.ok) { setEditor(null); setDialogError(''); setReload(value => value + 1); }
    else setDialogError(result.error);
  }
  const status = connected ? 'Connected' : context.connection_status === 'expired' ? 'Reconnect required' : context.connection_status === 'revocation_pending' ? 'Disconnect needs retry' : 'Disconnected';
  const menuAction = (action, command) => { setMenu(false); run(action, command); };
  return <div className="space-y-5">
    <Card title="Google Connection" action={canManage && (connected || context.connection_status !== 'disconnected') ?
      <ActionMenu open={menu} onOpenChange={setMenu} ariaLabel="Manage Connection" width={220} trigger={({ toggle, open }) => <button className="btn-secondary" type="button" aria-haspopup="menu" aria-expanded={open} disabled={!!busy} onClick={toggle}>Manage Connection <ChevronDown size={15} /></button>}>
        <div role="menu" aria-label="Manage Connection">
          <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted disabled:opacity-50" disabled={!context.configured || !!busy || context.connection_status === 'revocation_pending'} onClick={() => menuAction('authorize', () => service.authorize(outletId))}><Link2 size={15} />Reconnect</button>
          <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted disabled:opacity-50" disabled={!connected || !!busy} onClick={() => menuAction('discover', () => service.discover(outletId))}><RefreshCw size={15} />Refresh Locations</button>
          <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-surface-muted disabled:opacity-50" disabled={!!busy} onClick={() => { setMenu(false); setDisconnect('local'); setDialogError(''); }}><LogOut size={15} />Disconnect</button>
          <button role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-700 hover:bg-surface-muted disabled:opacity-50" disabled={!!busy} onClick={()=>{setMenu(false);setDisconnect('global');setDialogError('');}}>Revoke Google Authorization</button>
        </div>
      </ActionMenu> : null}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Badge tone={connected ? 'success' : context.connection_status === 'disconnected' ? 'neutral' : 'warning'}>{status}</Badge>
          {connected ? <><span className="text-sm break-words">{context.accounts?.map(account => account.displayName).join(', ') || 'Google Business Profile'}</span>{canManage ? <span className="text-sm text-text-secondary">{context.locations?.length || 0} locations</span> : null}</> : null}
        </div>
        {!connected && context.connection_status === 'disconnected' ? <button className="btn-primary" disabled={!canManage || !context.configured || !!busy} onClick={() => run('authorize', () => service.authorize(outletId))}>{busy === 'authorize' ? 'Connecting…' : 'Connect Google'}</button> : null}
        {busy === 'discover' ? <span role="status" className="text-sm text-text-secondary">Refreshing locations…</span> : null}
      </div>
      {!context.configured ? <p className="border-t border-border px-4 py-3 text-sm text-text-secondary">Google connection setup is required.</p> : !canManage ? <p className="border-t border-border px-4 py-3 text-sm text-text-secondary">Your access allows viewing only.</p> : null}
    </Card>
    <Card title="Outlet Mapping" action={rows.some(row => row.error) ? <button className="btn-secondary" disabled={loading || !!busy} onClick={() => setReload(value => value + 1)}>Retry mappings</button> : null}>
      {loading ? <div role="status" aria-label="Loading outlet mappings"><LoadingSkeleton rows={3} /></div> : <DataTable density="compact" minWidth={640} mobileLayout="stack" rows={rows} getRowKey={row => row.id} columns={[
        { key: 'name', header: 'FeedX Outlet', render: row => <span className="font-semibold">{row.name}</span> },
        { key: 'location', header: 'Google Location', className: 'max-w-sm break-words', render: row => row.error ? 'Unavailable' : row.context.mapping?.title || (row.context.mapping ? 'Google location' : '—') },
        { key: 'status', header: 'Status', render: row => <Badge tone={row.error ? 'warning' : row.context.mapping ? 'success' : 'neutral'}>{row.error ? 'Unable to load' : row.context.mapping ? 'Mapped' : 'Unmapped'}</Badge> },
        { key: 'actions', header: 'Action', align: 'right', render: row => <button className="btn-secondary" aria-label={`Edit mapping for ${row.name}`} disabled={row.error || !canManage || !connected || !row.context.can_manage || !!busy} onClick={() => edit(row)}>Edit</button> },
      ]} />}
    </Card>
    {editor ? <Modal title="Edit Outlet Mapping" description={editor.name} onClose={closeEditor} footer={<><button className="btn-secondary" disabled={!!busy} onClick={closeEditor}>Cancel</button><button className="btn-primary" disabled={editor.loading || editor.unavailable || !!busy || location === (editor.context?.mapping?.name || '')} onClick={saveMapping}>{busy === 'map' ? 'Saving…' : 'Save mapping'}</button></>}>
      {editor.loading ? <p role="status">Loading mapping…</p> : !editor.unavailable ? <><SelectField label="Google Location" searchable value={location} onChange={setLocation} disabled={!!busy} options={[{ value: '', label: 'Unmapped' }, ...editor.locations.map(item => ({ value: item.name, label: item.title }))]} /><p className="mt-3 text-sm text-text-secondary">Choose the location for this outlet, or leave it unmapped. Changing it clears the previous reviews from this outlet’s Inbox.</p></> : null}
      {dialogError ? <p role="alert" className="mt-3 text-sm text-rose-700">{dialogError}</p> : null}
    </Modal> : null}
    {disconnect ? <Modal title={disconnect==='global' ? 'Revoke Google Authorization' : 'Disconnect Google Business Profile'} description={disconnect==='global' ? 'Revoke this account’s Google authorization across this Google project, including other FeedX environments?' : 'Disconnect this FeedX environment and clear its cached reviews?'} onClose={() => { if (!busy) setDisconnect(false); }} footer={<><button className="btn-secondary" disabled={!!busy} onClick={() => setDisconnect(false)}>Cancel</button><button className="btn-primary" disabled={!!busy} onClick={async () => { const result = await run('disconnect', () => disconnect==='global' ? service.revoke(outletId,context.generation) : service.disconnect(outletId,context.generation), false); if (!mounted.current) return; if (result.ok) setDisconnect(false); else setDialogError(result.error); }}>{busy === 'disconnect' ? 'Disconnecting…' : disconnect==='global' ? 'Revoke Google Authorization' : 'Disconnect'}</button></>}>
      <p className="text-sm">{disconnect==='global' ? 'This can disconnect both Staging and Production for the same Google account. Reconnection will require Google consent. Use ordinary Disconnect to stop only this environment.' : 'Google authorization in other environments stays intact. You can reconnect this environment later using Google authorization.'}</p>{dialogError ? <p role="alert" className="mt-3 text-sm text-rose-700">{dialogError}</p> : null}
    </Modal> : null}
  </div>;
}
