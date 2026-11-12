import { useState } from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { manageAccountingConnector } from './dataSources.js';

const connectionLabels = {
  pending: ['pending', 'Pending verification'],
  connected: ['success', 'Connected'],
  revoked: ['neutral', 'Revoked'],
  error: ['error', 'Legal entity inactive'],
};
const syncErrors = {
  source_read: 'Check the AED_TEST reader and source tables on the office PC, then run Sync Now.',
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
  PT422: 'Check that the legal entity is active and the fingerprint is new and complete.',
};

export function AutoCountStatus({ entry, timestamp }) {
  const [tone, label] = connectionLabels[entry.state];
  const { connector } = entry;
  return <>
    <div className="flex flex-wrap gap-2" aria-live="polite">
      <StatusBadge status={tone}>{label}</StatusBadge>
      {entry.state === 'connected' && connector.syncState === 'running' && <StatusBadge status="in_progress">Syncing</StatusBadge>}
      {entry.state === 'connected' && ['failed', 'interrupted'].includes(connector.syncState) && <StatusBadge status="error">Sync failed</StatusBadge>}
      {entry.state === 'connected' && connector.retryRequestedAt && <StatusBadge status="scheduled">Sync requested</StatusBadge>}
    </div>
    <dl className="finance-source-facts">
      <div><dt>Source book</dt><dd>AED_TEST · {connector.verifiedAt ? 'Verified by connector' : 'Awaiting verification'}</dd></div>
      <div><dt>Last completed sync</dt><dd>{timestamp(connector.lastSyncAt)}</dd></div>
      <div><dt>Source rows in latest reported run</dt><dd>{connector.sourceRows ?? 'Not reported'}</dd></div>
      <div><dt>Pending upload retries</dt><dd>{connector.pendingRetries ?? 'Not reported'}</dd></div>
    </dl>
    {entry.state === 'pending' && <p className="finance-source-note">Return to setup on the office PC and complete its connection test with the current connector package.</p>}
    {entry.state === 'connected' && connector.retryRequestedAt && <p className="finance-source-note">The next scheduled run or Sync Now on the office PC will pick up this request.</p>}
    {entry.state === 'connected' && connector.syncState === 'failed' && <p className="finance-source-note">{syncErrors[connector.syncError] ?? syncErrors.local}</p>}
    {entry.state === 'connected' && connector.syncState === 'interrupted' && <p className="finance-source-note">The connector did not report an outcome. Check the office PC and run Sync Now.</p>}
  </>;
}

export function AutoCountActionModal({ action, entry, entities, onClose, onSaved }) {
  const [provider, setProvider] = useState('');
  const [entity, setEntity] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const enrolling = action === 'enroll';
  const needsFingerprint = enrolling || action === 'reenroll';
  const title = { enroll: 'Connect provider', reenroll: 'Re-enroll AutoCount', retry: 'Request connector sync', revoke: 'Revoke connector access' }[action];
  const verb = { enroll: 'Register connector', reenroll: 'Replace enrollment', retry: 'Request sync', revoke: 'Revoke access' }[action];
  const validFingerprint = /^[a-f0-9]{64}$/i.test(fingerprint.trim());
  const disabled = busy || (enrolling && (!provider || !entity)) || (needsFingerprint && !validFingerprint);
  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
    setBusy(true);
    setError('');
    try {
      await manageAccountingConnector(action, {
        connectionId: entry?.connection.id,
        legalEntityId: enrolling ? entity : undefined,
        fingerprint: needsFingerprint ? fingerprint.trim().toLowerCase() : undefined,
      });
      onSaved(action);
    } catch (failure) {
      setError(commandErrors[failure?.code] ?? 'FeedX could not save the connector change. Try again.');
      setBusy(false);
    }
  }
  return <Modal title={title} onClose={() => { if (!busy) onClose(); }}
    footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" type="submit" form="autocount-management" disabled={disabled}>{busy ? 'Saving…' : verb}</button></>}>
    <form id="autocount-management" onSubmit={submit} className="grid gap-4">
      {enrolling && <SelectField label="Provider" value={provider} onChange={setProvider} disabled={busy}
        options={[{ value: 'autocount', label: 'AutoCount Desktop' }]} placeholder="Select provider" required />}
      {enrolling && provider && <SelectField label="Legal entity" value={entity} onChange={setEntity} disabled={busy}
        options={entities.map((item) => ({ value: item.id, label: item.label }))} placeholder="Select legal entity" required searchable="auto" />}
      {needsFingerprint && (!enrolling || provider) && <>
        <p className="type-body-sm text-text-secondary">Source book: <strong>AED_TEST</strong>. {enrolling ? 'Use the fingerprint shown by Windows Connector setup.' : 'Use the fresh fingerprint from Windows Connector re-enrollment. Replacing it immediately revokes the previous credential.'}</p>
        {!enrolling && <p className="type-body-sm">Legal entity: <strong>{entry.legalEntityLabel}</strong></p>}
        <label className="grid gap-1">Enrollment fingerprint
          <input className="control" disabled={busy} autoComplete="off" spellCheck={false} value={fingerprint} maxLength={80} onChange={(event) => setFingerprint(event.target.value)} aria-describedby="fingerprint-help" required />
          <span id="fingerprint-help" className="type-caption text-text-secondary">Enter the 64 hexadecimal characters printed by the connector.</span>
        </label>
      </>}
      {action === 'retry' && <p>FeedX will queue a request for AED_TEST. Start Sync Now on the office PC to run it immediately, or wait for the next scheduled run.</p>}
      {action === 'revoke' && <p>This immediately blocks uploads from AED_TEST. Accepted snapshots and receipts stay in Finance history.</p>}
      {error && <p role="alert" className="type-body-sm text-red-700">{error}</p>}
    </form>
  </Modal>;
}
