import { useEffect, useRef, useState } from 'react';
import DataTable from '../../../../components/tables/DataTable.jsx';
import AdminDateTimeCell from '../../../../components/tables/AdminDateTimeCell.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import TextareaField from '../../../../components/forms/TextareaField.jsx';
import { AdminEvidenceDisclosure } from '../../../../components/layout/AdminAnalyticalSurface.jsx';
import { formatOperationalMoment } from '../../../../lib/dateTime.js';
import { changeInventoryStockUom, loadInventoryStockUomHistory } from './inventoryMasterService.js';

const historyColumns = [
  { key: 'old_unit', header: 'Previous UOM', render: row => row.old_unit || '—' },
  { key: 'new_unit', header: 'New UOM' },
  { key: 'reason', header: 'Reason', className: '[overflow-wrap:anywhere]' },
  { key: 'recorded_at', header: 'Changed by / at', render: row => (
    <AdminDateTimeCell date={row.actor_name || 'Inventory user'} time={formatOperationalMoment(row.recorded_at)} />
  ) },
];

export default function InventoryItemUomSection({ item, uoms, onChanged, onSavingChange }) {
  const [history, setHistory] = useState(null);
  const [change, setChange] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef(null);

  useEffect(() => {
    let active = true;
    loadInventoryStockUomHistory(item.id).then(
      data => { if (active) setHistory(data); },
      cause => { if (active) setError(cause.message || 'Unable to load UOM history.'); },
    );
    return () => { active = false; };
  }, [item.id, attempt]);

  const currentUnit = history ? history.unit : item.unit;
  const options = uoms.filter(uom => uom.isActive && uom.code !== currentUnit)
    .map(uom => ({ value: uom.code, label: uom.displayName && uom.displayName !== uom.code ? `${uom.code} · ${uom.displayName}` : uom.code }));
  const canChange = Boolean(history && !history.blocked_reason && options.length);
  const reason = change?.reason.trim() || '';
  const valid = canChange && change?.unit && change.unit !== currentUnit && reason.length > 0 && reason.length <= 500;

  function reload() {
    setHistory(null);
    setChange(null);
    setError('');
    setAttempt(value => value + 1);
  }

  async function save() {
    if (!valid || saving) return;
    const payload = { itemId: item.id, unit: change.unit, reason, expectedUnit: currentUnit,
      expectedChangeId: history.changes[0]?.id || null };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setSaving(true);
    onSavingChange(true);
    setError('');
    try {
      const saved = await changeInventoryStockUom({ ...payload, requestId: request.current.id });
      setHistory(saved);
      setChange(null);
      request.current = null;
      onChanged(saved.unit);
    } catch (cause) {
      setError(cause.message || 'Unable to change the item UOM.');
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return <section aria-label="Item UOM" className="min-w-0 space-y-3 border-y border-border py-3 md:col-span-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <dl><dt className="type-caption text-text-secondary">Current UOM</dt><dd className="type-body-sm font-semibold">{currentUnit || '—'}</dd></dl>
      {!change && <button type="button" className="btn-secondary" disabled={!canChange} onClick={() => setChange({ unit: '', reason: '' })}>Change UOM</button>}
    </div>
    {!history && !error && <p role="status" className="type-caption text-text-secondary">Checking whether this UOM can be changed…</p>}
    {history?.blocked_reason && <p className="type-caption text-text-secondary">{history.blocked_reason}</p>}
    {history && !history.blocked_reason && options.length === 0 && <p className="type-caption text-text-secondary">Add another active UOM in UOM Settings to make a change.</p>}
    {error && <div className="space-y-2">
      <p role="alert" className="type-body-sm text-danger">{error}</p>
      <button type="button" className="btn-secondary" onClick={reload}>Reload UOM</button>
    </div>}
    {change && <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="New UOM" value={change.unit} options={options} onChange={unit => setChange({ ...change, unit })} disabled={saving} required />
        <TextareaField label="Reason" rows={2} value={change.reason} onChange={value => setChange({ ...change, reason: value })}
          disabled={saving} maxLength={500} required />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setChange(null); setError(''); }}>Cancel UOM change</button>
        <button type="button" className="btn-primary" disabled={!valid || saving} onClick={save}>{saving ? 'Saving…' : 'Save UOM Change'}</button>
      </div>
    </div>}
    {history && <AdminEvidenceDisclosure label="UOM History">
      {history.changes.length ? <DataTable density="compact" mobileLayout="stack" minWidth={0} columns={historyColumns} rows={history.changes} getRowKey={row => row.id} /> :
        <p className="type-body-sm text-text-secondary">No UOM changes recorded.</p>}
    </AdminEvidenceDisclosure>}
  </section>;
}
