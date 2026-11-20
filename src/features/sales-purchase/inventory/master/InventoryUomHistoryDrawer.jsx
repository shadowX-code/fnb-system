import { useEffect, useRef, useState } from 'react';
import Drawer from '../../../../components/ui/Drawer.jsx';
import DataTable from '../../../../components/tables/DataTable.jsx';
import AdminDateTimeCell from '../../../../components/tables/AdminDateTimeCell.jsx';
import DatePickerField from '../../../../components/forms/DatePickerField.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import { Field, TextArea, getBusinessDateInput } from '../InventorySharedPresentation.jsx';
import { loadInventoryUomHistory, reviseInventoryUom } from './inventoryMasterService.js';
import { formatOperationalMoment } from '../../../../lib/dateTime.js';
import { formatInventoryCost } from './inventoryCostPresentation.js';

const numberLabel = value => Number(value).toLocaleString('en-MY', { maximumFractionDigits: 6 });
const conversionLabel = row => `1 ${row.purchase_unit} = ${numberLabel(row.stock_units_per_purchase_unit)} ${row.stock_unit}`;
const historyColumns = [
  { key: 'effective_date', header: 'Effective', render: row => row.effective_date || 'Undated baseline' },
  { key: 'purchase_unit', header: 'Conversion', render: row => row.purchase_unit ? conversionLabel(row) : row.stock_unit },
  { key: 'reason', header: 'Reason / Evidence' },
  { key: 'recorded_at', header: 'Recorded', render: row => <AdminDateTimeCell date={row.actor_name || (row.effective_date ? 'Inventory user' : '—')} time={formatOperationalMoment(row.recorded_at)} /> },
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
  const minimumDate = [getBusinessDateInput(), latest?.effective_date || ''].sort().at(-1);
  const options = [
    { value: stockUnit, label: `Use Stock UOM (${stockUnit})` },
    ...uoms.filter(unit => unit.isActive && unit.code.toLowerCase() !== stockUnit?.toLowerCase())
      .map(unit => ({ value: unit.code, label: `${unit.code} · ${unit.displayName}` })),
  ];
  const factor = Number(form?.factor);
  const valid = Boolean(form?.unit && form?.date && form?.reason.trim() && /^\d+(\.\d{1,6})?$/.test(form.factor)
    && Number.isFinite(factor) && factor > 0 && factor < 1000000000 && form.date >= minimumDate && form.reason.trim().length <= 500);
  const standardCost = item.costRevisionId ? item.cost : null;
  const begin = () => {
    setError('');
    setForm({ unit: latest?.purchase_unit || stockUnit, factor: String(latest?.stock_units_per_purchase_unit || 1), date: minimumDate, reason: '' });
  };
  async function save() {
    if (!valid || saving) return;
    const payload = { itemId: item.id, stockUnit, purchaseUnit: form.unit, factor, effectiveDate: form.date,
      reason: form.reason.trim(), expectedRevisionId: latest?.id || null };
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
    {error && <p role="alert" className="type-body-sm text-danger">{error} {history && <button type="button" className="btn-secondary" onClick={() => { setHistory(null); setForm(null); setAttempt(value => value + 1); }}>Reload history</button>}</p>}
    {!history ? (error
      ? <button type="button" className="btn-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button>
      : <p role="status">Loading UOM history…</p>) : <div className="space-y-4">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border px-3 py-2">
        <div><p className="type-caption text-text-muted">Stock UOM · Standard Cost UOM</p><p className="type-title font-semibold">{stockUnit || '—'}</p></div>
        <div><p className="type-caption text-text-muted">Purchase UOM</p><p className="type-title font-semibold">{current?.purchase_unit || stockUnit || '—'}</p>
          {stockUnit && <p className="type-caption text-text-secondary">{current?.purchase_unit ? conversionLabel(current) : `1 ${stockUnit} per ${stockUnit}`}</p>}</div>
        {canEdit && stockUnit && !form && <button type="button" className="btn-primary" onClick={begin}>Change Purchase UOM</button>}
      </section>
      {form && <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Purchase UOM" value={form.unit} options={options} onChange={unit => setForm({ ...form, unit, factor: unit === stockUnit ? '1' : '' })} required />
          {form.unit !== stockUnit && <Field label={`Stock units (${stockUnit}) per purchase unit`} value={form.factor} onChange={value => setForm({ ...form, factor: value })} required />}
          <DatePickerField label="Effective Date (MYT)" value={form.date} onChange={date => setForm({ ...form, date })} required />
        </div>
        <TextArea label="Reason / Evidence" value={form.reason} onChange={reason => setForm({ ...form, reason })} />
        {form.unit && factor > 0 && Number.isFinite(factor) && <div className="type-body-sm text-text-secondary" aria-label="Conversion preview">
          <p>{conversionLabel({ purchase_unit: form.unit, stock_units_per_purchase_unit: factor, stock_unit: stockUnit })}</p>
          <p>Standard-cost equivalent for 1 {form.unit} · {formatInventoryCost(standardCost == null ? null : Number(standardCost) * factor)}</p>
        </div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setForm(null); setError(''); }}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!valid || saving}>{saving ? 'Saving…' : 'Save Purchase UOM'}</button>
        </div>
      </form>}
      <section aria-label="UOM History">
        <h3 className="type-section-title font-semibold">UOM History</h3>
        {history.revisions.length ? <DataTable density="compact" mobileLayout="stack" minWidth={0} columns={historyColumns} rows={history.revisions} getRowKey={row => row.id} /> :
          <p className="type-body-sm text-text-secondary">No purchase unit changes recorded.</p>}
      </section>
    </div>}
  </Drawer>;
}
