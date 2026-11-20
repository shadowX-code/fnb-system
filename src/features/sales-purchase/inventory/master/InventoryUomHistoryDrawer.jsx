import { useEffect, useRef, useState } from 'react';
import Drawer from '../../../../components/ui/Drawer.jsx';
import DataTable from '../../../../components/tables/DataTable.jsx';
import AdminDateTimeCell from '../../../../components/tables/AdminDateTimeCell.jsx';
import DatePickerField from '../../../../components/forms/DatePickerField.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import AdminFormField from '../../../../components/forms/AdminFormField.jsx';
import TextareaField from '../../../../components/forms/TextareaField.jsx';
import { AdminEvidenceDisclosure } from '../../../../components/layout/AdminAnalyticalSurface.jsx';
import { getBusinessDateInput } from '../InventorySharedPresentation.jsx';
import { loadInventoryUomHistory, reviseInventoryUom } from './inventoryMasterService.js';
import { formatOperationalMoment } from '../../../../lib/dateTime.js';

const numberLabel = value => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 6 });
const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
const formatEffectiveDate = date => dateLabel.format(new Date(`${date}T00:00:00+08:00`));
const pluralUnits = { bag: 'bags', bottle: 'bottles', box: 'boxes', can: 'cans', carton: 'cartons', pack: 'packs', tray: 'trays' };
function purchaseQuantity(count, unit, stockUnit, factor) {
  const purchaseUnit = count !== 1 && Object.hasOwn(pluralUnits, unit) ? pluralUnits[unit] : unit;
  return `${count} ${purchaseUnit} = ${numberLabel(count * factor)} ${stockUnit}`;
}

const historyColumns = [
  { key: 'purchase_unit', header: 'Change', render: row => {
    if (!row.purchase_unit) return `Stock unit recorded as ${row.stock_unit}`;
    if (row.purchase_unit === row.stock_unit) return `Use stock unit (${row.stock_unit}) for purchases`;
    return purchaseQuantity(1, row.purchase_unit, row.stock_unit, row.stock_units_per_purchase_unit);
  } },
  { key: 'effective_date', header: 'Effective', render: row => row.effective_date ? formatEffectiveDate(row.effective_date) : 'Undated baseline' },
  { key: 'reason', header: 'Reason / Evidence', className: '[overflow-wrap:anywhere]' },
  { key: 'recorded_at', header: 'Recorded by / at', render: row => (
    <AdminDateTimeCell date={row.actor_name || (row.effective_date ? 'Inventory user' : '—')} time={formatOperationalMoment(row.recorded_at)} />
  ) },
];

export default function InventoryUomHistoryDrawer({ item, uoms, canEdit, onClose }) {
  const [history, setHistory] = useState(null);
  const [form, setForm] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const request = useRef(null);
  useEffect(() => {
    let active = true;
    setError('');
    loadInventoryUomHistory(item.id).then(
      data => { if (active) setHistory(data); },
      cause => { if (active) setError(cause.message || 'Unable to load UOM history.'); },
    );
    return () => { active = false; };
  }, [item.id, attempt]);

  const stockUnit = history?.stock_unit;
  const current = history?.current;
  const latest = history?.revisions?.[0];
  const today = getBusinessDateInput();
  const minimumDate = latest?.effective_date > today ? latest.effective_date : today;
  const reasonRequired = Boolean(latest?.effective_date);
  const options = [
    { value: stockUnit, label: `Same as stock unit (${stockUnit})` },
    ...uoms.filter(unit => unit.isActive && unit.code.toLowerCase() !== stockUnit?.toLowerCase())
      .map(unit => ({ value: unit.code, label: `${unit.code} · ${unit.displayName}` })),
  ];
  const factor = Number(form?.factor);
  const validFactor = /^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(form?.factor || '')
    && Number.isFinite(factor) && factor > 0 && factor < 1000000000;
  const reason = form?.reason.trim() || '';
  const needsReason = reasonRequired && !reason;
  const valid = form?.unit && validFactor && form.date >= minimumDate && !needsReason && reason.length <= 500;

  function begin() {
    setError('');
    setForm({ unit: latest?.purchase_unit || stockUnit, factor: String(latest?.stock_units_per_purchase_unit || 1), date: today, reason: '' });
  }
  async function save() {
    if (!valid || saving) return;
    const payload = { itemId: item.id, stockUnit, purchaseUnit: form.unit, factor, effectiveDate: form.date,
      reason: reason || 'Initial purchase unit setup', expectedRevisionId: latest?.id || null };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setSaving(true);
    setError('');
    try {
      setHistory(await reviseInventoryUom({ ...payload, requestId: request.current.id }));
      setForm(null);
      request.current = null;
    } catch (cause) {
      setError(cause.message || 'Unable to save the purchase unit.');
    } finally {
      setSaving(false);
    }
  }

  return <Drawer title="Manage Units" description={item.name} onClose={saving ? undefined : onClose} closeOnEscape={!saving} closeOnOverlay={!saving} width="lg">
    {error && <div className="mb-3 space-y-2">
      <p role="alert" className="type-body-sm text-danger">{error}</p>
      {history && <button type="button" className="btn-secondary" onClick={() => { setHistory(null); setForm(null); setAttempt(value => value + 1); }}>Reload history</button>}
    </div>}
    {!history ? (error
      ? <button type="button" className="btn-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      : <p role="status" className="type-body-sm text-text-secondary">Loading units…</p>) : <>
      {!form ? <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div><dt className="type-caption text-text-secondary">Stock Unit</dt><dd className="type-title font-semibold">{stockUnit || '—'}</dd></div>
          <div><dt className="type-caption text-text-secondary">Purchase Unit</dt><dd className="type-title font-semibold">{current?.purchase_unit || stockUnit || '—'}</dd>
            {current?.purchase_unit && current.purchase_unit !== stockUnit && <dd className="type-caption text-text-secondary">
              {purchaseQuantity(1, current.purchase_unit, stockUnit, current.stock_units_per_purchase_unit)}
            </dd>}
          </div>
        </dl>
        {canEdit && stockUnit && <button type="button" className="btn-primary" onClick={begin}>Change Purchase Unit</button>}
      </div> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="grid items-start gap-3 sm:grid-cols-3">
          <AdminFormField label="Stock Unit">
            <input className="control w-full" value={stockUnit} readOnly />
          </AdminFormField>
          <SelectField label="Purchase Unit" value={form.unit} options={options} onChange={unit => setForm({ ...form, unit, factor: unit === stockUnit ? '1' : '' })} disabled={saving} />
          <AdminFormField label="Quantity per Purchase Unit" error={form.factor && !validFactor ? 'Enter a positive amount with up to 6 decimal places.' : undefined}>
            <input className="control w-full tabular-nums" type="number" inputMode="decimal" step="any" value={form.factor}
              required readOnly={form.unit === stockUnit} disabled={saving} onChange={event => setForm({ ...form, factor: event.target.value })} />
          </AdminFormField>
        </div>
        {validFactor && <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border px-3 py-2 type-body-sm font-semibold tabular-nums" aria-label="Purchase unit examples" aria-live="polite">
          <p>{purchaseQuantity(1, form.unit, stockUnit, factor)}</p>
          <p>{purchaseQuantity(2, form.unit, stockUnit, factor)}</p>
        </div>}
        <AdminEvidenceDisclosure label="Advanced Details">
          <DatePickerField label="Effective Date (MYT)" value={form.date} minDate={minimumDate} onChange={date => setForm({ ...form, date })} disabled={saving} required />
          <TextareaField label={reasonRequired ? 'Reason / Evidence' : 'Reason / Evidence (optional)'} rows={2}
            value={form.reason} onChange={value => setForm({ ...form, reason: value })} required={reasonRequired} maxLength={500} disabled={saving} />
        </AdminEvidenceDisclosure>
        {needsReason && <p className="type-caption text-text-secondary">Add a reason in Advanced Details to save this change.</p>}
        {form.date < minimumDate && <p className="type-caption text-text-secondary">Choose {formatEffectiveDate(minimumDate)} or later in Advanced Details.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setForm(null); setError(''); }}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save Purchase Unit'}</button>
        </div>
      </form>}
      <div className="mt-4 border-t border-border">
        <AdminEvidenceDisclosure label="UOM History">
          {history.revisions.length ? <DataTable density="compact" mobileLayout="stack" minWidth={0} columns={historyColumns} rows={history.revisions} getRowKey={row => row.id} /> :
            <p className="type-body-sm text-text-secondary">No purchase unit changes recorded.</p>}
        </AdminEvidenceDisclosure>
      </div>
    </>}
  </Drawer>;
}
