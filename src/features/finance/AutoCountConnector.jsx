import { useState } from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { manageAccountingConnector, manageAutoCountDevice } from './dataSources.js';

const connectionLabels = {
  pending: ['pending', 'Pending verification'],
  connected: ['success', 'Connected'],
  revoked: ['neutral', 'Revoked'],
  error: ['error', 'Legal entity inactive'],
};
const syncErrors = {
  source_read: 'Check the Account Book reader and source tables on the office PC, then run Sync Now.',
  scope_limit: 'The connector reached its extraction limit. Review the posting scope in the Windows sync report.',
  upload_rejected: 'FeedX rejected an upload. Review the Windows sync report before retrying.',
  network: 'Check the office PC’s access to FeedX Staging, then run Sync Now.',
  receipt: 'The upload receipt could not be verified. The connector keeps the batch for retry.',
  local: 'Open the Windows connector sync report to identify and correct the failure.',
};
const commandErrors = {
  PT403: 'Only the FeedX owner can manage this connection.',
  PT404: 'This connector is unavailable. Refresh the page and try again.',
  PT409: 'The connection has changed or is still unverified. Refresh its status and try again.',
  PT429: 'Too many active pairing codes. Wait for an earlier code to expire, then try again.',
  PT422: 'Check that the Legal Entity is active and the book is ready.',
};

export function AutoCountStatus({ entry, timestamp }) {
  const [tone, label] = connectionLabels[entry.state];
  const { connector } = entry;
  return <>
    <div className="flex flex-wrap gap-2" aria-live="polite">
      <StatusBadge status={tone}>{label}</StatusBadge>
      {entry.state === 'connected' && connector.syncState === 'running' && <StatusBadge status="in_progress">Syncing</StatusBadge>}
      {['connected', 'pending'].includes(entry.state) && ['failed', 'interrupted'].includes(connector.syncState) && <StatusBadge status="error">Sync failed</StatusBadge>}
      {entry.state === 'connected' && connector.retryRequestedAt && <StatusBadge status="scheduled">Sync requested</StatusBadge>}
    </div>
    <dl className="finance-source-facts">
      <div><dt>Source book</dt><dd>{entry.connection.externalTenantId} · {connector.verifiedAt ? 'Verified by connector' : 'Awaiting verification'}</dd></div>
      <div><dt>Last completed sync</dt><dd>{timestamp(connector.lastSyncAt)}</dd></div>
      <div><dt>Source rows in latest reported run</dt><dd>{connector.sourceRows ?? 'Not reported'}</dd></div>
      <div><dt>Pending upload retries</dt><dd>{connector.pendingRetries ?? 'Not reported'}</dd></div>
    </dl>
    {entry.state === 'pending' && <p className="finance-source-note">The Windows Connector will verify the bound book on its next run. If this stays pending, check the connector on the office PC.</p>}
    {entry.state === 'connected' && connector.retryRequestedAt && <p className="finance-source-note">The next scheduled run or Sync Now on the office PC will pick up this request.</p>}
    {['connected', 'pending'].includes(entry.state) && connector.syncState === 'failed' && <p className="finance-source-note">{syncErrors[connector.syncError] ?? syncErrors.local}</p>}
    {entry.state === 'connected' && connector.syncState === 'interrupted' && <p className="finance-source-note">The connector did not report an outcome. Check the office PC and run Sync Now.</p>}
  </>;
}

const windowsInstaller = '/downloads/FeedX-AutoCount-Connector-Setup.exe';

export function AutoCountDevices({ state, onAction, timestamp }) {
  return state.connectorDevices?.map((device) => <article key={device.id} className="finance-source-connection">
    <div className="finance-section-heading">
      <div><h3>{device.label || 'AutoCount Desktop Connector'}</h3><p>Last check-in: {timestamp(device.lastSeenAt)}</p></div>
      <StatusBadge status={device.active ? 'info' : 'neutral'}>{device.active ? 'Paired' : 'Revoked'}</StatusBadge>
    </div>
    <p className="finance-source-note">SQL sync and native report support are assessed independently. Native Trial Balance, P&amp;L and Balance Sheet are unverified.</p>
    {!device.books.length && <p className="finance-source-note">Authorized books appear after the Windows Connector checks in. Use Test Connection in Windows to check in now.</p>}
    {device.books.length > 0 && <ul className="divide-y divide-border">
      {device.books.map((book) => {
        const entry = state.connections.find((item) => item.connection.id === book.connectionId);
        const canBind = device.active && book.ready && (!entry || entry.state === 'revoked');
        return <li key={book.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="type-body-sm font-semibold">{book.company}</p>
            <p className="type-caption text-text-secondary">{book.name} · {book.ready ? entry ? entry.legalEntityLabel : 'Ready to connect' : 'Authorize on Windows'}</p>
          </div>
          {canBind && <button className="btn-secondary" type="button" onClick={() => onAction('bind', entry, { book })}>{entry ? 'Reconnect book' : 'Connect book'}</button>}
        </li>;
      })}
    </ul>}
    <div className="finance-source-actions">
      <button className="btn-secondary" type="button" onClick={() => onAction('pair', null, { device })}>Replace computer</button>
      {device.active && <button className="btn-secondary" type="button" onClick={() => onAction('revoke_device', null, { device })}>Revoke computer</button>}
    </div>
  </article>);
}

export function AutoCountActionModal({ action, entry, book, device, entities, onClose, onSaved }) {
  const [provider, setProvider] = useState('');
  const [entity, setEntity] = useState(entry?.connection.legalEntityId ?? '');
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pairingMode = action === 'pair';
  const title = { pair: device ? 'Replace computer' : 'Connect provider', bind: 'Connect Account Book', retry: 'Request connector sync', revoke: 'Revoke book access', revoke_device: 'Revoke computer' }[action];
  const verb = { pair: pairing ? 'Confirm device' : 'Review device', bind: 'Connect', retry: 'Request sync', revoke: 'Revoke access', revoke_device: 'Revoke computer' }[action];
  const normalizedCode = code.replace(/[-\s]/g, '').toUpperCase();
  const disabled = busy || (pairingMode && ((!device && !provider) || !/^[A-F0-9]{16}$/.test(normalizedCode))) || (action === 'bind' && !entity);
  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      if (pairingMode) {
        if (pairing) {
          await manageAutoCountDevice('confirm', { code: normalizedCode, deviceId: device?.id });
          onSaved(action);
        } else {
          setPairing(await manageAutoCountDevice('preview', { code: normalizedCode }));
          setBusy(false);
        }
        return;
      }
      if (action === 'bind' || action === 'revoke_device') {
        await manageAutoCountDevice(action, { deviceId: device?.id, bookId: book?.id, legalEntityId: entity || undefined });
      } else {
        await manageAccountingConnector(action, { connectionId: entry.connection.id });
      }
      onSaved(action);
    } catch (failure) {
      const message = failure?.message === 'Legacy binding requires a history review'
        ? 'This book has a previous manual connection. Ask FeedX support to review its history before transferring it.'
        : pairingMode && failure?.code === 'PT404'
          ? 'This pairing code expired or has already been used. Generate a new code in Windows.'
          : commandErrors[failure?.code];
      setError(message ?? 'FeedX could not save the connector change. Try again.');
      setBusy(false);
    }
  }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}
    footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="autocount-management" disabled={disabled}>{busy ? 'Saving…' : verb}</button></>}>
    <form id="autocount-management" onSubmit={submit} className="grid gap-4">
      {pairingMode && !device && <SelectField label="Provider" value={provider} onChange={setProvider} disabled={busy}
        options={[{ value: 'autocount', label: 'AutoCount Desktop' }]} placeholder="Select provider" required />}
      {pairingMode && (provider || device) && <>
        <p>Install the Windows Connector and authorize the Account Books you want to connect. Generate a pairing code in Windows and enter it here.</p>
        <div><a className="btn-secondary" href={windowsInstaller} download>Download Windows Connector</a></div>
        {device && <p>Confirming the replacement revokes the previous computer. The existing book bindings and history stay in FeedX.</p>}
        <label className="grid gap-2">Pairing code
          <input className="control" autoComplete="off" spellCheck={false} maxLength={24} disabled={busy} value={code}
            onChange={(event) => { setCode(event.target.value); setPairing(null); setError(''); }} />
        </label>
        {pairing && <div className="rounded-lg border border-border p-3" aria-live="polite">
          <p>Confirm this matches the computer shown in Windows.</p>
          <p className="type-title font-semibold">{pairing.deviceLabel}</p>
        </div>}
      </>}
      {action === 'bind' && <>
        <p><strong>{book.company}</strong> · {book.name}</p>
        {entry ? <p>Resume this book for <strong>{entry.legalEntityLabel}</strong>. Its history stays with this Legal Entity.</p> :
          <SelectField label="Legal Entity" value={entity} onChange={setEntity} disabled={busy}
            options={entities.map((item) => ({ value: item.id, label: item.label }))} placeholder="Select Legal Entity" required searchable="auto" />}
        <p className="type-body-sm text-text-secondary">The Windows Connector starts the first sync after you connect this book.</p>
      </>}
      {action === 'retry' && <p>FeedX will queue a request for this book. Start Sync Now on the office PC to run it immediately, or wait for the next background check.</p>}
      {action === 'revoke' && <p>This immediately blocks uploads from this book. Accepted snapshots and receipts stay in Finance history.</p>}
      {action === 'revoke_device' && <p>This immediately blocks this computer and all of its books from uploading. Accepted snapshots and receipts stay in Finance history.</p>}
      {error && <p role="alert" className="type-body-sm text-red-700">{error}</p>}
    </form>
  </Modal>;
}
