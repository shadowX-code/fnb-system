import { useEffect, useId, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import Drawer from '../../../../components/ui/Drawer.jsx';
import DatePickerField from '../../../../components/forms/DatePickerField.jsx';
import { AdminChart, AdminChartMark, adminChartLinePath, adminChartScale } from '../../../../components/ui/AdminChart.jsx';
import { getBusinessDateInput } from '../InventorySharedPresentation.jsx';
import { loadInventoryCostHistory, reviseInventoryCost } from './inventoryMasterService.js';
import { formatInventoryCost, formatInventoryCostChange, parseInventoryCostInput } from './inventoryCostPresentation.js';

const malaysia = 'Asia/Kuala_Lumpur';
const effectiveDateFormat = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: malaysia });
const recordedAtFormat = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: malaysia });
const displayDate = value => effectiveDateFormat.format(new Date(`${value}T00:00:00+08:00`));

function CostTrend({ revisions, unit }) {
  const [selected, setSelected] = useState(null);
  const observations = revisions.filter(row => row.effective_date).slice().reverse()
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  return (
    <section aria-label="Cost trend">
      <h3 className="mb-2 type-body-sm font-semibold text-text-primary">Cost Trend</h3>
      {observations.length ? <>
        <p className="type-caption text-text-secondary">RM per {unit} · Effective revisions</p>
        <AdminChart label={`Unit cost by effective revision, RM per ${unit}`} height={138} dataKey={observations.at(-1).id}>
          {(width, height) => {
            const scale = adminChartScale(observations.map(row => Number(row.unit_cost)), 3);
            const left = 67;
            const right = width - 18;
            const bottom = height - 28;
            const x = index => left + (right - left) * (observations.length === 1 ? 0.5 : index / (observations.length - 1));
            const y = value => bottom - (bottom - 15) * (value - scale.min) / (scale.max - scale.min);
            return <>
              {scale.ticks.map(tick => <g key={tick} aria-hidden="true">
                <line className="chart-grid" x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
                <text fill="var(--text-secondary)" x={left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick.toLocaleString('en-MY', { maximumFractionDigits: 4, notation: tick >= 10000 ? 'compact' : 'standard' })}
                </text>
              </g>)}
              {observations.length > 1 ? <path d={adminChartLinePath(observations.map((row, index) => [x(index), y(row.unit_cost)]))}
                fill="none" stroke="var(--primary-ink)" strokeWidth="2" /> : null}
              {observations.map((row, index) => {
                const label = `${displayDate(row.effective_date)} · ${formatInventoryCost(row.unit_cost, unit)}`;
                return <AdminChartMark key={row.id} label={label} tooltip={label}
                  selected={selected === row.id} onSelect={() => setSelected(row.id)}
                  tooltipAnchor={{ x: x(index), y: y(row.unit_cost) }}>
                  <circle cx={x(index)} cy={y(row.unit_cost)} r="12" fill="transparent" />
                  <circle className="chart-point" cx={x(index)} cy={y(row.unit_cost)} r="4" fill="var(--primary-ink)" />
                </AdminChartMark>;
              })}
              <text fill="var(--text-secondary)" x={x(0)} y={height - 7} textAnchor={observations.length === 1 ? 'middle' : 'start'}>
                {displayDate(observations[0].effective_date)}
              </text>
              {observations.length > 1 ? <text fill="var(--text-secondary)" x={right} y={height - 7} textAnchor="end">
                {displayDate(observations.at(-1).effective_date)}
              </text> : null}
            </>;
          }}
        </AdminChart>
      </> : <p className="type-body-sm text-text-secondary">Dated revisions will appear here.</p>}
    </section>
  );
}

function CostUpdateForm({ item, history, correction, onSaved, onCancel, onReload, onSaving }) {
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const today = getBusinessDateInput(malaysia);
  const [date, setDate] = useState(correction?.effective_date || today);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState(null);
  const costId = useId();
  const costInput = useRef(null);
  useEffect(() => { costInput.current?.focus(); }, []);
  const reasonId = useId();
  const latest = history.revisions.find(row => row.id === history.current_revision_id);
  const previous = correction?.unit_cost ?? history.current_cost;
  const amount = parseInventoryCostInput(cost);
  const change = formatInventoryCostChange(amount, previous);
  const invalidDate = date > today ? 'Choose today or an earlier date (MYT).'
    : !correction && date && latest?.effective_date >= date
      ? `Choose a date after ${displayDate(latest.effective_date)}, or correct a revision below.` : '';
  const update = (setValue, value) => {
    setValue(value);
    setRequestId(null);
    if (error?.code !== '40001') setError(null);
  };

  async function submit(event) {
    event.preventDefault();
    if (saving || amount == null || !reason.trim() || !date || invalidDate || amount === previous) return;
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    setSaving(true);
    onSaving(true);
    setError(null);
    try {
      const result = await reviseInventoryCost({
        itemId: item.id, cost: amount, unit: history.unit, effectiveDate: date,
        reason: reason.trim(), requestId: id, expectedRevisionId: history.revisions[0]?.id ?? null,
        correctedRevisionId: correction?.id ?? null,
      });
      onSaved(result);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="type-body-sm font-semibold text-text-primary">{correction ? 'Correct Cost' : 'Update Cost'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={costId} className="block">
          <span className="mb-1 block type-caption font-semibold text-text-secondary">New cost (RM / {history.unit})</span>
          <input ref={costInput} id={costId} className="control h-11 w-full" inputMode="decimal" placeholder="0.00"
            required value={cost} disabled={saving} onChange={event => update(setCost, event.target.value)} />
          {cost && amount == null ? <span className="mt-1 block type-caption text-rose-700">Use up to 4 decimals and a value below RM 100,000,000.</span> : null}
          {amount != null && amount === previous ? <span className="mt-1 block type-caption text-rose-700">Enter a different cost.</span> : null}
        </label>
        <DatePickerField label="Effective date" value={date} onChange={value => update(setDate, value)}
          required disabled={saving || Boolean(correction)} error={invalidDate} />
      </div>
      <label htmlFor={reasonId} className="block">
        <span className="mb-1 block type-caption font-semibold text-text-secondary">Reason</span>
        <textarea id={reasonId} className="control min-h-20 w-full py-2" rows={2} required maxLength={500}
          value={reason} disabled={saving} onChange={event => update(setReason, event.target.value)} />
      </label>
      <div className="type-body-sm text-text-secondary" aria-live="polite">
        {amount != null ? <>
          <span className="font-semibold text-text-primary">{formatInventoryCost(amount, history.unit)}</span>
          {change ? <> · {change.amount}{change.percentage ? ` (${change.percentage})` : ' · percentage unavailable from RM 0'}</> : ' · First configured cost'}
        </> : 'Enter a cost to preview the change.'}
      </div>
      {error ? <p role="alert" className="type-body-sm text-rose-700">{error.message || 'Unable to save the cost revision.'}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
        {error?.code === '40001' ? <button type="button" className="btn-secondary" onClick={onReload}>Reload History</button> :
          <button type="submit" className="btn-primary" disabled={saving || amount == null || amount === previous || !reason.trim() || !date || Boolean(invalidDate)}>
            {saving ? 'Saving…' : 'Save Cost Revision'}
          </button>}
      </div>
    </form>
  );
}

export default function InventoryCostHistoryDrawer({ item, canEdit, onSaved, onClose }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    loadInventoryCostHistory(item.id).then(result => {
      if (active) setHistory(result);
    }, failure => {
      if (active) setError(failure.message || 'Unable to load cost history.');
    });
    return () => { active = false; };
  }, [item.id, reload]);

  function reloadHistory() {
    setForm(null);
    setHistory(null);
    setError(null);
    setReload(value => value + 1);
  }

  const change = formatInventoryCostChange(history?.current_cost, history?.previous_cost);
  const supersededIds = new Set(history?.revisions.map(row => row.supersedes_revision_id));
  const activeRevisions = history?.revisions.filter(row => !supersededIds.has(row.id)) ?? [];
  const canUpdate = canEdit && Boolean(history?.unit);

  return <Drawer title="Cost History" description={item.name} onClose={saving ? undefined : onClose}
    closeOnOverlay={!saving} closeOnEscape={!saving} width="lg" bodyClassName="space-y-5">
    {error ? <div className="space-y-2"><p role="alert" className="type-body-sm text-rose-700">{error}</p>
      <button type="button" className="btn-secondary" onClick={reloadHistory}>Try Again</button></div> : null}
    {!history && !error ? <p role="status" className="type-body-sm text-text-secondary">Loading cost history…</p> : null}
    {history ? <>
      <section className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h3 className="type-caption font-semibold text-text-secondary">Current Cost</h3>
          <p className="mt-1 type-section-title font-bold tabular-nums text-text-primary">
            {history.current_cost == null ? 'Unconfigured' : formatInventoryCost(history.current_cost, history.unit)}
          </p>
          {change ? <p className="mt-1 type-caption tabular-nums text-text-secondary">
            Latest change {change.amount}{change.percentage ? ` (${change.percentage})` : ' · percentage unavailable from RM 0'}
          </p> : null}
        </div>
        {canUpdate && !form ? <button className="btn-primary" type="button" onClick={() => setForm({})}>
          <Pencil size={15} aria-hidden="true" /> Update Cost
        </button> : null}
      </section>
      {canEdit && !history.unit ? <p className="type-body-sm text-text-secondary">Set the item’s UOM before updating its cost.</p> : null}
      {canUpdate && form ? <CostUpdateForm key={form.correction?.id || 'new'} item={item} history={history} correction={form.correction}
        onCancel={() => setForm(null)} onReload={reloadHistory} onSaving={setSaving}
        onSaved={result => { setHistory(result); setForm(null); onSaved(); }} /> : null}
      <CostTrend revisions={activeRevisions} unit={history.unit} />
      <section aria-label="Cost revisions">
        <h3 className="mb-2 type-body-sm font-semibold text-text-primary">Revisions</h3>
        {history.revisions.length ? <div className="overflow-x-auto">
          <table className="data-table w-full text-left">
            <thead><tr><th scope="col">Effective date</th><th scope="col">Unit cost</th><th scope="col">Reason</th><th scope="col">Recorded (MYT)</th>
              {canUpdate ? <th scope="col"><span className="sr-only">Actions</span></th> : null}</tr></thead>
            <tbody>{history.revisions.map(row => <tr key={row.id}>
              <td className="whitespace-nowrap align-top">
                {row.effective_date ? displayDate(row.effective_date) : 'Baseline'}
                {row.id === history.current_revision_id ? <div className="type-caption text-text-secondary">Current</div> :
                  supersededIds.has(row.id) ? <div className="type-caption text-text-secondary">Superseded</div> : null}
              </td>
              <td className="whitespace-nowrap align-top font-semibold tabular-nums">{formatInventoryCost(row.unit_cost, row.unit)}</td>
              <td className="min-w-28 max-w-52 whitespace-normal break-words align-top">{row.reason}
                {row.supersedes_revision_id ? <div className="type-caption text-text-secondary">Correction</div> : null}
              </td>
              <td className="whitespace-nowrap align-top">{row.actor_name || '—'}
                <div className="type-caption text-text-secondary">{recordedAtFormat.format(new Date(row.recorded_at))}</div>
              </td>
              {canUpdate ? <td className="align-top">{row.effective_date && !supersededIds.has(row.id) ? <button type="button"
                className="btn-secondary" disabled={Boolean(form)} aria-label={`Correct cost for ${displayDate(row.effective_date)}`}
                onClick={() => setForm({ correction: row })}>Correct</button> : null}</td> : null}
            </tr>)}</tbody>
          </table>
        </div> : <p className="type-body-sm text-text-secondary">No cost revisions yet.</p>}
      </section>
    </> : null}
  </Drawer>;
}
