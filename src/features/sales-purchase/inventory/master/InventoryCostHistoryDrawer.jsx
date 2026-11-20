import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil } from 'lucide-react';
import Drawer from '../../../../components/ui/Drawer.jsx';
import DatePickerField from '../../../../components/forms/DatePickerField.jsx';
import Badge from '../../../../components/ui/Badge.jsx';
import DataTable from '../../../../components/tables/DataTable.jsx';
import AdminDateTimeCell from '../../../../components/tables/AdminDateTimeCell.jsx';
import { AdminChart, AdminChartMark, AdminChartTooltipContent, adminChartLinePath, adminChartScale } from '../../../../components/ui/AdminChart.jsx';
import { formatOperationalMoment } from '../../../../lib/dateTime.js';
import { getBusinessDateInput } from '../InventorySharedPresentation.jsx';
import { loadInventoryCostHistory, reviseInventoryCost } from './inventoryMasterService.js';
import { formatInventoryCost, formatInventoryCostChange, inventoryRevisionChanges, parseInventoryCostInput } from './inventoryCostPresentation.js';

const malaysia = 'Asia/Kuala_Lumpur';
const effectiveDateFormat = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeZone: malaysia });
const displayDate = value => effectiveDateFormat.format(new Date(`${value}T00:00:00+08:00`));

const trendColor = 'var(--primary-ink)';

function CostChange({ change }) {
  if (!change) return <span className="text-text-secondary">—</span>;
  const increase = change.delta > 0;
  const decrease = change.delta < 0;
  const Icon = increase ? ArrowUp : ArrowDown;
  const tone = increase ? 'text-[var(--factory-danger-text)]' : decrease ? 'text-[var(--factory-success-text)]' : 'text-text-secondary';
  return <span className={`inline-flex flex-wrap items-center gap-x-1 font-semibold tabular-nums ${tone}`}>
    {change.delta ? <Icon size={13} aria-hidden="true" /> : null}
    <span className="sr-only">{increase ? 'Increase' : decrease ? 'Decrease' : 'No change'}</span>
    <span>{change.amount}</span>
    {change.percentage ? <span>({change.percentage})</span> : <span title="Percentage unavailable from RM 0">
      <span className="sr-only">Percentage unavailable from RM 0</span><span aria-hidden="true">(—)</span>
    </span>}
  </span>;
}

function CostTrend({ revisions, unit }) {
  const [selected, setSelected] = useState(null);
  const observations = revisions.filter(row => row.effective_date)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  return (
    <section aria-label="Cost trend">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="type-section-title font-semibold text-text-primary">Cost Trend</h3>
        {observations.length ? <span className="type-caption text-text-secondary">RM per {unit}</span> : null}
      </div>
      {observations.length ? (
        <AdminChart label={`Unit cost by effective revision, RM per ${unit}`} height={132}
          className="!mb-0 !mt-1" dataKey={observations.map(row => row.id).join(':')}>
          {(width, height) => {
            const values = observations.map(row => Number(row.unit_cost));
            const flat = values.every(value => value === values[0]);
            const padding = Math.max(0.01, values[0] * 0.08);
            const scaleValues = flat ? [Math.max(0, values[0] - padding), values[0] + padding] : values;
            const scale = adminChartScale(scaleValues, 3, { includeZero: false });
            const min = Math.max(0, scale.min);
            const left = 59;
            const right = width - 20;
            const bottom = height - 25;
            const startDate = Date.parse(observations[0].effective_date);
            const endDate = Date.parse(observations.at(-1).effective_date);
            const x = row => left + (right - left) * (endDate === startDate ? 0.5 : (Date.parse(row.effective_date) - startDate) / (endDate - startDate));
            const y = value => bottom - (bottom - 15) * (value - min) / (scale.max - min);
            const dateLabels = observations.length === 1 ? observations : [observations[0], observations.at(-1)];
            return <>
              <g aria-hidden="true" fill="var(--text-secondary)">
                {scale.ticks.filter(tick => tick >= min).map(tick => <g key={tick}>
                  <line className="chart-grid" x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
                  <text x={left - 8} y={y(tick) + 4} textAnchor="end">
                    {tick.toLocaleString('en-MY', { maximumFractionDigits: 5, notation: tick >= 10000 ? 'compact' : 'standard' })}
                  </text>
                </g>)}
                {dateLabels.map((row, index) => <text key={row.id} x={x(row)} y={height - 5}
                  textAnchor={dateLabels.length === 1 ? 'middle' : index === 0 ? 'start' : 'end'}>
                  {displayDate(row.effective_date)}
                </text>)}
              </g>
              {observations.length > 1 ? <path className="admin-chart-series"
                d={adminChartLinePath(observations.map((row, index) => [x(row), y(values[index])]))}
                fill="none" stroke={trendColor} strokeWidth="2" /> : null}
              {observations.map((row, index) => {
                const date = displayDate(row.effective_date);
                const value = formatInventoryCost(row.unit_cost, unit);
                const anchor = { x: x(row), y: y(values[index]) };
                return <AdminChartMark key={row.id} label={`${date} · ${value}`} selected={selected === row.id}
                  tooltip={<AdminChartTooltipContent title={date} rows={[{ label: 'Unit cost', value, color: trendColor }]} />}
                  onSelect={() => setSelected(row.id)} tooltipAnchor={anchor}>
                  <circle cx={anchor.x} cy={anchor.y} r="12" fill="transparent" />
                  <circle className="chart-focus" cx={anchor.x} cy={anchor.y} r="8" />
                  <circle className="chart-point" cx={anchor.x} cy={anchor.y} r="4" fill={trendColor} />
                </AdminChartMark>;
              })}
            </>;
          }}
        </AdminChart>
      ) : <p className="mt-1 type-caption text-text-secondary">Dated revisions will appear here.</p>}
    </section>
  );
}

function CostRevisions({ history, canUpdate, formOpen, supersededIds, onCorrect }) {
  const changes = inventoryRevisionChanges(history.revisions);
  const columns = [
    { key: 'effective_date', header: 'Effective date', className: 'whitespace-nowrap', render: row => <>
      {row.effective_date ? <time dateTime={row.effective_date} className="font-semibold">{displayDate(row.effective_date)}</time>
        : <Badge>Baseline</Badge>}
      {row.id === history.current_revision_id ? <div className="type-caption text-text-secondary">Current</div> :
        supersededIds.has(row.id) ? <div className="type-caption text-text-secondary">Superseded</div> : null}
    </> },
    { key: 'unit_cost', header: 'Unit cost', align: 'right', render: row => <>
      <span className="whitespace-nowrap font-semibold tabular-nums">{formatInventoryCost(row.unit_cost)}</span>
      {row.unit ? <div className="type-caption text-text-secondary">per {row.unit}</div> : null}
    </> },
    { key: 'change', header: 'Change', align: 'right', render: row => <CostChange change={changes.get(row.id)} /> },
    { key: 'reason', header: 'Reason', className: 'max-[700px]:w-full [overflow-wrap:anywhere]', render: row => <>
      {row.reason}
      {row.supersedes_revision_id ? <div className="type-caption text-text-secondary">Correction</div> : null}
    </> },
    { key: 'recorded_at', header: 'Recorded (MYT)', className: '[overflow-wrap:anywhere]', render: row => (
      <AdminDateTimeCell date={row.actor_name} time={formatOperationalMoment(row.recorded_at)} />
    ) },
  ];
  if (canUpdate) columns.push({
    key: 'correct', header: '', align: 'right',
    render: row => row.effective_date && !supersededIds.has(row.id) ? <button type="button"
      className="btn-secondary h-9 min-h-9 px-2.5 type-caption" disabled={formOpen}
      aria-label={`Correct cost for ${displayDate(row.effective_date)}`}
      onClick={event => onCorrect(row, event.currentTarget)}>Correct</button> : null,
  });

  return <section aria-label="Cost revisions" className="border-t border-border pt-3">
    <h3 className="mb-2 type-section-title font-semibold text-text-primary">Revisions</h3>
    {history.revisions.length ? <div className="overflow-hidden rounded-xl border border-border">
      <DataTable density="compact" columnSpacing="compact" mobileLayout="stack" minWidth={0}
        columns={columns} rows={history.revisions} getRowKey={row => row.id} />
    </div> : <p className="type-caption text-text-secondary">No cost revisions yet.</p>}
  </section>;
}

function CostUpdateForm({ id, item, history, correction, onSaved, onCancel, onReload, onSaving }) {
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
    const nextRequestId = requestId || crypto.randomUUID();
    setRequestId(nextRequestId);
    setSaving(true);
    onSaving(true);
    setError(null);
    try {
      const result = await reviseInventoryCost({
        itemId: item.id, cost: amount, unit: history.unit, effectiveDate: date,
        reason: reason.trim(), requestId: nextRequestId, expectedRevisionId: history.revisions[0]?.id ?? null,
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
    <form id={id} onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-surface p-4">
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
  const formId = useId();
  const updateButton = useRef(null);
  const formOpener = useRef(null);
  useEffect(() => {
    if (!form && formOpener.current) {
      const trigger = formOpener.current.isConnected ? formOpener.current : updateButton.current;
      trigger?.focus();
      formOpener.current = null;
    }
  }, [form]);
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

  function openForm(correction, trigger) {
    formOpener.current = trigger;
    setForm({ correction });
  }

  const change = formatInventoryCostChange(history?.current_cost, history?.previous_cost);
  const supersededIds = new Set(history?.revisions.map(row => row.supersedes_revision_id));
  const activeRevisions = history?.revisions.filter(row => !supersededIds.has(row.id)) ?? [];
  const canUpdate = canEdit && Boolean(history?.unit);

  return <Drawer title="Cost History" description={item.name} onClose={saving ? undefined : onClose}
    closeOnOverlay={!saving} closeOnEscape={!saving} width="lg" bodyClassName="space-y-4">
    {error ? <div className="space-y-2"><p role="alert" className="type-body-sm text-rose-700">{error}</p>
      <button type="button" className="btn-secondary" onClick={reloadHistory}>Try Again</button></div> : null}
    {!history && !error ? <p role="status" className="type-body-sm text-text-secondary">Loading cost history…</p> : null}
    {history ? <>
      <section className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="type-caption font-semibold text-text-secondary">Current Cost</h3>
          {history.current_cost == null
            ? <p className="mt-1 type-section-title font-semibold text-text-primary">Unconfigured</p>
            : <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="type-display-lg font-bold tabular-nums text-text-primary">{formatInventoryCost(history.current_cost)}</span>
              {history.unit ? <span className="type-body-sm text-text-secondary">per {history.unit}</span> : null}
            </p>}
          {change ? <p className="mt-1 flex flex-wrap items-baseline gap-x-2 type-caption text-text-secondary">
            <span>Latest change</span><CostChange change={change} />
          </p> : null}
        </div>
        {canUpdate ? <button ref={updateButton} className="btn-primary shrink-0" type="button" disabled={Boolean(form)}
          aria-expanded={Boolean(form && !form.correction)} aria-controls={form && !form.correction ? formId : undefined}
          onClick={event => openForm(null, event.currentTarget)}>
          <Pencil size={15} aria-hidden="true" /> Update Cost
        </button> : null}
      </section>
      {canEdit && !history.unit ? <p className="type-body-sm text-text-secondary">Set the item’s UOM before updating its cost.</p> : null}
      {canUpdate && form ? <CostUpdateForm id={formId} key={form.correction?.id || 'new'} item={item} history={history} correction={form.correction}
        onCancel={() => setForm(null)} onReload={reloadHistory} onSaving={setSaving}
        onSaved={result => { setHistory(result); setForm(null); onSaved(); }} /> : null}
      <CostTrend revisions={activeRevisions} unit={history.unit} />
      <CostRevisions history={history} canUpdate={canUpdate} formOpen={Boolean(form)} supersededIds={supersededIds} onCorrect={openForm} />
    </> : null}
  </Drawer>;
}
