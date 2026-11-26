import { useState } from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { FinanceDisclosure } from './FinanceVisualSystem.jsx';
import { manageAccountingConnector, manageAutoCountDevice } from './dataSources.js';

const syncErrors = {
  source_read: 'The office connector could not read the Account Book. Check Windows connector diagnostics for the SQL error.',
  source_login: 'SQL Server rejected the saved reader login or could not open the Account Book. Check the reader on the office PC.',
  source_unreachable: 'The office connector could not reach local SQL Server. Check that SQL Server has started. The connector will retry.',
  source_permissions: 'The saved reader did not pass SQL permission checks. Review the Windows authorization diagnostics.',
  source_schema: 'The saved Account Book identity or source tables no longer match. Review the current book in Windows and connect its verified identity in FeedX. Historical bindings and accepted history are retained.',
  scope_limit: 'The connector reached its extraction limit. Review the posting scope in the Windows sync report.',
  upload_rejected: 'FeedX rejected an upload. Review Copy diagnostics on the Windows connector before retrying.',
  upload_date_format: 'FeedX rejected the posting date format. Update the Windows connector and retry the queued upload.',
  upload_envelope: 'FeedX rejected the dataset, reporting date, or batch envelope. Share the Windows diagnostics with FeedX support.',
  upload_record_shape: 'FeedX rejected the row count or required fields. Share the Windows diagnostics with FeedX support.',
  upload_record_values: 'FeedX rejected a field value or duplicate source key. Share the Windows diagnostics with FeedX support.',
  upload_request_conflict: 'FeedX already has this request ID with different content. Keep the queue and contact FeedX support.',
  network: 'Check the office PC’s access to FeedX Staging. The Windows connector retains queued uploads and retries on its next background run.',
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

// The Windows task polls every five minutes. Three missed intervals mark the device offline.
const pollMinutes = 5;
const offlineAfter = 3 * pollMinutes * 60 * 1000;
const scheduling = {
  signed_in: { policy: `Every ${pollMinutes} min while signed in`, resume: 'Sync resumes when the office PC is online and its Windows user signs in.' },
  unattended: { policy: `Every ${pollMinutes} min · unattended`, resume: 'Sync resumes when the office PC is running and back online.' },
  missing: { policy: 'Windows task missing', resume: 'Set up the Windows task or start sync on the office PC.' },
  disabled: { policy: 'Windows task disabled', resume: 'Enable the Windows task or start sync on the office PC.' },
};

export function autoCountOnline(entry, now = Date.now()) {
  const checkIn = Date.parse(entry.connector?.deviceLastSeenAt);
  return Number.isFinite(checkIn) && now - checkIn <= offlineAfter;
}

export function AutoCountStatus({ entry, timestamp, children }) {
  const { connector } = entry;
  const online = autoCountOnline(entry);
  const hasCheckIn = Number.isFinite(Date.parse(connector.deviceLastSeenAt));
  const deviceLabel = online ? 'Device online' : hasCheckIn ? 'Device offline' : 'Awaiting device check-in';
  const schedule = scheduling[connector.backgroundMode];
  const activeSchedule = ['signed_in', 'unattended'].includes(connector.backgroundMode);
  const failed = ['failed', 'interrupted'].includes(connector.syncState);

  const authorization = entry.state === 'error' ? ['warning', 'Legal entity inactive']
    : connector.bookAuthorized === false ? ['warning', 'Book authorization required']
    : connector.bookAuthorized || entry.state === 'connected' ? ['success', 'Book authorized']
    : ['pending', 'Book verification pending'];
  const status = connector.syncState === 'failed' ? 'Last sync failed'
    : connector.syncState === 'interrupted' || (connector.syncState === 'running' && !online) ? 'Sync outcome pending'
    : connector.syncState === 'running' ? 'Syncing' : null;
  const nextRun = activeSchedule && !online ? 'When the device returns'
    : connector.nextPollAt ? timestamp(connector.nextPollAt)
    : activeSchedule ? 'Awaiting schedule report' : 'Not scheduled';
  return <>
    <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
      <StatusBadge status={authorization[0]}>{authorization[1]}</StatusBadge>
      <StatusBadge status={online ? 'success' : 'neutral'}>{deviceLabel}</StatusBadge>
      {status && <StatusBadge status={failed ? 'warning' : 'info'}>{status}</StatusBadge>}
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 type-caption sm:grid-cols-3 xl:grid-cols-5">
      <div><dt className="text-text-secondary">Accepted data updated</dt><dd>{timestamp(connector.lastDataUpdateAt)}</dd></div>
      <div><dt className="text-text-secondary">Last successful sync</dt><dd>{timestamp(connector.lastSyncAt)}</dd></div>
      <div><dt className="text-text-secondary">Last device check-in</dt><dd>{timestamp(connector.deviceLastSeenAt)}</dd></div>
      <div><dt className="text-text-secondary">Automatic check-in</dt><dd>{schedule?.policy ?? 'Schedule not reported'}</dd></div>
      <div><dt className="text-text-secondary" title="Last count reported by the Windows Connector">Pending uploads</dt><dd>{connector.pendingRetries ?? 'Not reported'}</dd></div>
    </dl>
    {!online && schedule && <p className="type-caption text-text-secondary">{schedule.resume}</p>}
    <div className="grid gap-1">
      <FinanceDisclosure label="Diagnostics">
        <dl className="grid grid-cols-2 gap-2 type-caption">
          <div><dt>Last sync attempt</dt><dd>{timestamp(connector.lastAttemptAt)}</dd></div>
          <div><dt>Next check-in</dt><dd>{nextRun}</dd></div>
        </dl>
        {failed && <p className="type-caption text-text-secondary">
          {connector.syncState === 'interrupted' ? 'Sync did not report an outcome. The next eligible run will retry.' : syncErrors[connector.syncError] ?? syncErrors.local}
        </p>}
        <p className="type-caption text-text-secondary">Check-ins pick up queued work. Once GL coverage is current, the connector refreshes daily. Accepted data updates when FeedX stores a new snapshot, including an empty GL day.</p>
      </FinanceDisclosure>
      {children}
    </div>
  </>;
}

const windowsInstaller = '/downloads/FeedX-AutoCount-Connector-Setup.exe';

export function AutoCountDevices({ state, onAction }) {
  return state.connectorDevices?.map((device) => <article key={device.id} className="finance-source-connection">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3>{device.label || 'AutoCount Desktop Connector'}</h3>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={device.active ? 'info' : 'neutral'}>{device.active ? 'Paired' : 'Revoked'}</StatusBadge>
      </div>
    </div>
    {!device.books.length && <p className="finance-source-note">No books reported. Check book authorization on the Windows Connector.</p>}
    {device.books.length > 0 && <ul className="divide-y divide-border">
      {device.books.map((book) => {
        const entry = state.connections.find((item) => item.connection.id === book.connectionId);
        const duplicateName = device.books.filter((item) => item.name === book.name).length > 1;
        const canBind = device.active && book.ready && (!entry || entry.state === 'revoked');
        return <li key={book.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <p className="type-body-sm font-semibold">{book.company}</p>
            <p className="type-caption text-text-secondary">{book.name} · {book.ready ? entry ? entry.legalEntityLabel : 'Ready to connect' : 'Authorization Required'}</p>
            {duplicateName && <p className="type-caption text-text-secondary">Book reference: {book.id.slice(0, 8)} · {entry ? 'Existing binding retained' : 'Separate identity — confirm before connecting'}</p>}
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

export function AutoCountActionModal({ action, entry, book, device, queued, entities, onClose, onSaved }) {
  const [provider, setProvider] = useState('');
  const [entity, setEntity] = useState(entry?.connection.legalEntityId ?? '');
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pairingMode = action === 'pair';
  const title = { pair: device ? 'Replace computer' : 'Connect provider', bind: 'Connect Account Book', retry: queued ? 'Queue Sync' : 'Sync Now', revoke: 'Revoke book access', revoke_device: 'Revoke computer' }[action];
  const verb = { pair: pairing ? 'Confirm device' : 'Review device', bind: 'Connect', retry: queued ? 'Queue Sync' : 'Sync Now', revoke: 'Revoke access', revoke_device: 'Revoke computer' }[action];
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
        <p>Install the Windows Connector. Generate a pairing code in Windows and enter it here. You can authorize books before or after pairing.</p>
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
        <p className="type-body-sm text-text-secondary">Account Book reference: {book?.id?.slice(0, 8)}. Connecting this identity retains other books’ bindings and accepted history.</p>
        <p className="type-body-sm text-text-secondary">The Windows Connector starts the first sync after you connect this book.</p>
      </>}
      {action === 'retry' && <p>The Windows Connector will pick up this request on its next eligible check-in.</p>}
      {action === 'revoke' && <p>This immediately blocks uploads from this book. Accepted snapshots and receipts stay in Finance history.</p>}
      {action === 'revoke_device' && <p>This immediately blocks this computer and all of its books from uploading. Accepted snapshots and receipts stay in Finance history.</p>}
      {error && <p role="alert" className="type-body-sm text-red-700">{error}</p>}
    </form>
  </Modal>;
}
