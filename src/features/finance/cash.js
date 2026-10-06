import { sourceIdentityKey, validatePeriod } from './foundation.js';
import { compatibleMetricBasis, metricMovement, metricRegistry } from './metrics.js';

export const cashPositionIds = Object.freeze(['cash', 'ar', 'inventory', 'ap', 'debt', 'working_capital']);
export const cashDiagnosticIds = Object.freeze(['current_ratio', 'inventory_days', 'ar_days', 'ap_days', 'cash_coverage']);
export const cashEventKinds = Object.freeze(['receivable', 'supplier', 'payroll', 'rent', 'tax', 'debt', 'other']);
const states = ['complete', 'partial', 'unavailable', 'unverified'];
const accounting = (metric) => metric?.value !== null && metric?.completeness === 'complete' && metric.provenance.length > 0 && (metric.inputProvenance ?? metric.provenance).every((source) => source.semantic === 'ACTUAL');

/** Read-only diagnostics. Period averages and credit flows must be supplied, never approximated. */
export function cashDiagnostics(dataset) {
  const metrics = { ...dataset.metrics };
  const days = (Date.parse(dataset.period.end) - Date.parse(dataset.period.start)) / 86400000 + 1;
  for (const id of cashDiagnosticIds) {
    const existing = metrics[id];
    if (existing.value !== null) continue;
    const [numeratorId, denominatorId] = metricRegistry[id].dependencies;
    const numerator = metrics[numeratorId], denominator = metrics[denominatorId];
    const inventoryReady = id !== 'inventory_days' || ['supported', 'partial'].includes(dataset.capabilities.inventory_valuation);
    const ready = accounting(numerator) && accounting(denominator) && compatibleMetricBasis(numerator, denominator) && numerator.value >= 0 && denominator.value > 0 && inventoryReady;
    const value = ready ? numerator.value / denominator.value * (['inventory_days', 'ar_days', 'ap_days'].includes(id) ? days : 1) : null;
    const present = Number.isFinite(value);
    const inputProvenance = present ? [...numerator.provenance, ...denominator.provenance] : [];
    metrics[id] = { ...existing, value: present ? value : null, completeness: present ? 'complete' : 'unavailable', inputProvenance,
      provenance: inputProvenance.map((source) => ({ ...source, semantic: 'DERIVED' })),
      reason: present ? `${metricRegistry[id].definition}. Derived from complete accounting inputs; retains their provenance.` : `${metricRegistry[id].label} requires complete accounting inputs, a positive denominator${id === 'inventory_days' ? ' and accounting inventory valuation evidence' : ''}.` };
  }
  return { ...dataset, metrics };
}
export function cashPair(analysis) { return { ...analysis, current: cashDiagnostics(analysis.current), previous: cashDiagnostics(analysis.previous) }; }

/** Canonical optional forward evidence. Complete coverage is explicit, including a complete empty horizon. */
export function validateLiquiditySchedule(schedule, dataset) {
  const fail = () => { throw new Error('Invalid canonical liquidity schedule'); };
  if (!schedule || JSON.stringify(schedule.scope) !== JSON.stringify(dataset.scope) || schedule.currency !== dataset.currency || schedule.asOf !== dataset.period.end || !states.includes(schedule.completeness) || !Array.isArray(schedule.events)) fail();
  validatePeriod(schedule.horizon);
  if (schedule.horizon.start !== nextCashDate(schedule.asOf)) fail();
  const provenance = (sources) => {
    if (!Array.isArray(sources) || !sources.length) fail();
    for (const source of sources) {
      sourceIdentityKey(source.identity);
      // Expected future events and coverage are Forecast, even when a commitment is contractually known.
      if (source.semantic !== 'FORECAST' || source.demo !== dataset.demo) fail();
    }
  };
  provenance(schedule.provenance);
  const ids = new Set(), identities = new Set();
  for (const event of schedule.events) {
    if (typeof event.id !== 'string' || !event.id.trim() || ids.has(event.id) || typeof event.label !== 'string' || !event.label.trim() || !['inflow', 'outflow'].includes(event.direction) || !cashEventKinds.includes(event.kind) || !states.includes(event.completeness)) fail();
    ids.add(event.id);
    validatePeriod({ start: event.date, end: event.date });
    if (event.date < schedule.horizon.start || event.date > schedule.horizon.end || (event.amount !== null && (!Number.isFinite(event.amount) || event.amount < 0)) || (!['complete', 'partial'].includes(event.completeness) && event.amount !== null) || (event.completeness === 'complete' && event.amount === null)) fail();
    provenance(event.provenance);
    for (const source of event.provenance) {
      const key = sourceIdentityKey(source.identity);
      if (identities.has(key)) fail();
      identities.add(key);
    }
    if (schedule.completeness === 'complete' && event.completeness !== 'complete') fail();
  }
  return schedule;
}
export function nextCashDate(date) { return new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10); }

/** Dated expected cash only. Same-day events are netted; no unsupported intraday ordering. */
export function liquidityTimeline(dataset) {
  const cash = dataset.metrics.cash, schedule = dataset.liquiditySchedule;
  const events = [...(schedule?.events ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const complete = accounting(cash) && schedule?.completeness === 'complete' && events.every((event) => event.completeness === 'complete' && event.amount !== null);
  let position = cash.value;
  const rows = [];
  for (const event of events) {
    let row = rows.at(-1);
    if (!row || row.date !== event.date) { row = { date: event.date, events: [], position: null }; rows.push(row); }
    row.events.push(event);
  }
  let valid = Boolean(complete);
  for (const row of rows) {
    if (!valid) continue;
    position += row.events.reduce((sum, event) => sum + (event.direction === 'inflow' ? event.amount : -event.amount), 0);
    if (!Number.isFinite(position)) { valid = false; break; }
    row.position = { ...cash, value: position, period: schedule.horizon, inputProvenance: [...cash.provenance, ...schedule.provenance, ...events.filter((event) => event.date <= row.date).flatMap((event) => event.provenance)], provenance: schedule.provenance.map((source) => ({ ...source, semantic: 'FORECAST' })), reason: 'Expected end-of-day book cash under the complete supplied schedule; not live bank availability.' };
  }
  if (!valid) rows.forEach((row) => { row.position = null; });
  const checkpoints = valid ? [{ date: schedule.asOf, position: { ...cash, provenance: schedule.provenance, inputProvenance: cash.provenance } }, ...rows] : [];
  const lowest = checkpoints.reduce((result, row) => !result || row.position.value < result.position.value ? row : result, null);
  const largest = (direction) => events.filter((event) => event.direction === direction && event.amount !== null && (direction !== 'inflow' || event.kind === 'receivable')).sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))[0] ?? null;
  const constrained = checkpoints.filter((row) => row.position.value <= 0).map((row) => ({ start: row.date === schedule.asOf ? schedule.horizon.start : row.date, end: checkpoints[checkpoints.indexOf(row) + 1]?.date ?? schedule.horizon.end }));
  return { cash, schedule, rows, projected: valid, lowest, constrained, largestCollection: largest('inflow'), largestCommitment: largest('outflow'), reason: valid ? 'Forecast checkpoints depend on complete supplied coverage. Same-day events are netted; intraday availability is unknown.' : !schedule ? 'No validated dated collections or commitments are available. Expenses and EBITDA cannot supply a cash schedule.' : 'Projection requires complete accounting opening Cash and complete coverage of the entire horizon. Known events do not prove that all commitments are covered.' };
}
export function cashMovements(pair) {
  return ['ebitda', 'cash', 'working_capital', 'operating_cash_flow', 'financing_cash_flow', 'investing_cash_flow'].map((id) => ({ id, current: pair.current.metrics[id], previous: pair.previous.metrics[id], movement: metricMovement(pair.current.metrics[id], pair.previous.metrics[id]), isFlow: id.endsWith('_cash_flow') || id === 'ebitda' }));
}
