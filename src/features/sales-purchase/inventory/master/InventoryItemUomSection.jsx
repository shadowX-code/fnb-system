import { useEffect, useRef, useState } from 'react';
import DataTable from '../../../../components/tables/DataTable.jsx';
import AdminDateTimeCell from '../../../../components/tables/AdminDateTimeCell.jsx';
import AdminFormField from '../../../../components/forms/AdminFormField.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import { AdminEvidenceDisclosure } from '../../../../components/layout/AdminAnalyticalSurface.jsx';
import { formatInventoryCost } from './inventoryCostPresentation.js';
import { getBusinessDateInput } from '../InventorySharedPresentation.jsx';
import { formatOperationalMoment } from '../../../../lib/dateTime.js';
import { changeInventoryStockUom, loadInventoryStockUomHistory } from './inventoryMasterService.js';

const quantityLabel = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 6 });
const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium' });
const formatEffectiveDate = value => dateLabel.format(new Date(`${value}T00:00:00+08:00`));

function decimalUnits(value, precision) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(precision, '0')}`);
}

const historyColumns = [
  { key: 'old_unit', header: 'Previous UOM', render: row => row.old_unit || '—' },
  { key: 'new_unit', header: 'New UOM' },
  { key: 'effective_date', header: 'Effective', render: row => row.effective_date ? formatEffectiveDate(row.effective_date) : '—' },
  { key: 'new_quantity', header: 'Conversion', render: row => row.new_quantity == null ? '—' : `${quantityLabel.format(row.new_quantity)} ${row.new_unit} = ${quantityLabel.format(row.old_quantity)} ${row.old_unit || ''}` },
  { key: 'reason', header: 'Reason', className: '[overflow-wrap:anywhere]' },
  { key: 'recorded_at', header: 'Changed by / at', render: row => (
    <AdminDateTimeCell date={row.actor_name || 'Inventory user'} time={formatOperationalMoment(row.recorded_at)} />
  ) },
];

export default function InventoryItemUomSection({ item, uoms, onChanged, onSavingChange, onUpdateCost }) {
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
  const requiresConversion = history?.requires_conversion === true;
  const conversion = change?.conversion || '';
  const validConversion = /^(?:\d{1,9}(?:\.\d{0,6})?|\.\d{1,6})$/.test(conversion) && Number(conversion) > 0;
  const configuredCost = history?.current_cost == null ? null : Number(history.current_cost);
  const convertedCostUnits = validConversion && configuredCost != null
    ? decimalUnits(configuredCost.toFixed(4), 4) * decimalUnits(conversion, 6)
    : null;
  const equivalentCost = convertedCostUnits == null ? null : Number(convertedCostUnits / 1000000n) / 10000;
  const costFits = convertedCostUnits == null || (convertedCostUnits % 1000000n === 0n && equivalentCost < 100000000);
  const valid = canChange && change?.unit && change.unit !== currentUnit && (!requiresConversion || validConversion) && costFits;

  function reload() {
    setHistory(null);
    setChange(null);
    setError('');
    setAttempt(value => value + 1);
  }

  async function save() {
    if (!valid || saving) return;
    const payload = { itemId: item.id, unit: change.unit, expectedUnit: currentUnit,
      expectedChangeId: history.changes[0]?.id || null, conversion: requiresConversion ? conversion : null,
      expectedCostRevisionId: history.current_cost_revision_id || null };
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
      onChanged(saved);
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
      {!change && <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={!canChange} onClick={() => setChange({ unit: '', conversion: '' })}>Change UOM</button>
        {onUpdateCost && <button type="button" className="btn-secondary" onClick={onUpdateCost}>Update Cost</button>}
      </div>}
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
        <SelectField label="New UOM" value={change.unit} options={options} onChange={unit => setChange({ unit, conversion: '' })} disabled={saving} required />
        {requiresConversion && change.unit && <AdminFormField label={`1 ${change.unit} = how many ${currentUnit}?`} required
          error={conversion && !validConversion ? 'Enter a positive quantity with up to 6 decimal places.' : undefined}>
          <input className="control w-full" type="number" min="0" step="any" inputMode="decimal" value={conversion}
            disabled={saving} onChange={event => setChange({ ...change, conversion: event.target.value })} />
        </AdminFormField>}
      </div>
      {change.unit && (!requiresConversion || validConversion) && <div className="rounded-xl border border-border px-3 py-2 type-body-sm" aria-live="polite">
        {requiresConversion && <p className="font-semibold tabular-nums">1 {change.unit} = {quantityLabel.format(Number(conversion))} {currentUnit}</p>}
        {configuredCost != null && <p className="tabular-nums">
          {formatInventoryCost(configuredCost, currentUnit)} → {costFits ? formatInventoryCost(equivalentCost, change.unit) : 'Equivalent cost exceeds supported precision'}
        </p>}
        <p className="type-caption text-text-secondary">Effective on save · {formatEffectiveDate(getBusinessDateInput())} (MYT)</p>
      </div>}
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
