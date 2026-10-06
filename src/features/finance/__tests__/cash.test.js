import { expect, it } from 'vitest';
import { cashDiagnostics, cashPair, liquidityTimeline } from '../cash.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { validateDataset } from '../financeService.js';
import { financialValue, movementValue } from '../presentation.js';
import { metricMovement } from '../metrics.js';
const request = { scope: { kind: 'outlet', id: 'demo-kl' }, period: monthlyPeriod('2026-09'), currency: 'MYR' };
async function fixture() { return createFixtureProvider({ development: true }).readOverview(request); }
it('derives historical accounting diagnostics from complete canonical averages and credit flows', async () => {
  const data = cashDiagnostics(await fixture());
  expect(data.metrics.inventory_days.value).toBeCloseTo(30060 / 77490 * 30);
  expect(data.metrics.ar_days.value).toBeCloseTo(6200 / 45000 * 30);
  expect(data.metrics.ap_days.value).toBeCloseTo(34800 / 32000 * 30);
  expect(data.metrics.current_ratio.value).toBeCloseTo(211260 / 65840);
  expect(data.metrics.cash_coverage.value).toBeCloseTo(167000 / 2800);
  expect(data.metrics.ar_days.provenance.every((source) => source.semantic === 'DERIVED')).toBe(true);
  expect(data.metrics.ar_days.inputProvenance.every((source) => source.semantic === 'ACTUAL')).toBe(true);
});
it('rejects partial averages, nonpositive credit flows, operational valuation and operational COGS', async () => {
  const data = await fixture();
  data.metrics.average_ar.completeness = 'partial'; data.metrics.credit_purchases.value = 0;
  data.metrics.cogs.provenance = data.metrics.cogs.provenance.map((source) => ({ ...source, semantic: 'OPERATIONAL' }));
  data.metrics.daily_operating_cash_outflow.value = -1;
  const result = cashDiagnostics(data);
  for (const id of ['ar_days', 'ap_days', 'inventory_days', 'cash_coverage']) expect(result.metrics[id].value).toBeNull();
  const fresh = await fixture(); fresh.capabilities = { ...fresh.capabilities, inventory_valuation: 'unsupported' };
  expect(cashDiagnostics(fresh).metrics.inventory_days.value).toBeNull();
});
it('preserves supplied diagnostics and refuses comparison across different original semantics', async () => {
  const data = await fixture(); data.metrics.ar_days = { ...data.metrics.ar_days, value: 8, completeness: 'complete', provenance: data.metrics.ar.provenance };
  expect(cashDiagnostics(data).metrics.ar_days.value).toBe(8);
  const prior = await fixture(); prior.metrics.cash.provenance[0].semantic = 'OPERATIONAL';
  const pair = cashPair({ current: data, previous: prior });
  expect(metricMovement(pair.current.metrics.cash, pair.previous.metrics.cash).value).toBeNull();
});
it('nets same-day events, identifies dated low and ranks known collections and pressure', async () => {
  const data = await fixture(); validateDataset(data, request, { allowDemo: true });
  const model = liquidityTimeline(data);
  expect(model.rows).toHaveLength(5);
  expect(model.rows[0].position.value).toBe(125000);
  expect(model.lowest.date).toBe('2026-10-12'); expect(model.lowest.position.value).toBe(65000);
  expect(model.largestCommitment.kind).toBe('payroll'); expect(model.largestCollection.kind).toBe('receivable');
  expect(model.rows[0].position.provenance.every((source) => source.semantic === 'FORECAST')).toBe(true);
});
it('makes no projection from partial coverage, missing cash or EBITDA / expenses alone', async () => {
  const data = await fixture(); data.liquiditySchedule.completeness = 'partial';
  let model = liquidityTimeline(data); expect(model.rows).toHaveLength(5); expect(model.rows.every((row) => row.position === null)).toBe(true); expect(model.lowest).toBeNull();
  data.liquiditySchedule.completeness = 'complete'; data.metrics.cash.value = null; data.metrics.cash.completeness = 'unavailable';
  expect(liquidityTimeline(data).projected).toBe(false);
  delete data.liquiditySchedule; model = liquidityTimeline(data);
  expect(model.rows).toEqual([]); expect(model.lowest).toBeNull(); expect(model.reason).toContain('Expenses and EBITDA');
});
it('accepts explicit complete empty coverage and includes opening position in the lowest checkpoint', async () => {
  const data = await fixture(); data.liquiditySchedule.events = [];
  validateDataset(data, request, { allowDemo: true });
  expect(liquidityTimeline(data).lowest.position.value).toBe(167000);
  data.metrics.cash.value = -10;
  expect(liquidityTimeline(data).constrained).toEqual([{ start: '2026-10-01', end: '2026-10-30' }]);
});
it.each([
  ['scope', (data) => { data.liquiditySchedule.scope = { kind: 'outlet', id: 'hidden' }; }],
  ['currency', (data) => { data.liquiditySchedule.currency = 'USD'; }],
  ['as of', (data) => { data.liquiditySchedule.asOf = '2026-09-29'; }],
  ['coverage gap', (data) => { data.liquiditySchedule.horizon.start = '2026-10-02'; }],
  ['duplicate ID', (data) => { data.liquiditySchedule.events.push(structuredClone(data.liquiditySchedule.events[0])); }],
  ['duplicate identity', (data) => { data.liquiditySchedule.events[1].provenance = data.liquiditySchedule.events[0].provenance; }],
  ['date', (data) => { data.liquiditySchedule.events[0].date = '2026-10-31'; }],
  ['amount', (data) => { data.liquiditySchedule.events[0].amount = -1; }],
  ['partial event', (data) => { data.liquiditySchedule.events[0].completeness = 'partial'; }],
  ['actual future', (data) => { data.liquiditySchedule.events[0].provenance[0].semantic = 'ACTUAL'; }],
  ['unlabeled source', (data) => { data.liquiditySchedule.events[0].provenance = []; }],
  ['demo leakage', (data) => { data.liquiditySchedule.events[0].provenance[0].demo = false; }],
])('rejects invalid forward evidence: %s', async (_, mutate) => { const data = await fixture(); mutate(data); expect(() => validateDataset(data, request, { allowDemo: true })).toThrow(); });
it('withholds the entire projection on numerical overflow', async () => {
  const data = await fixture(); data.metrics.cash.value = Number.MAX_VALUE; data.liquiditySchedule.events[0].direction = 'inflow'; data.liquiditySchedule.events[0].amount = Number.MAX_VALUE;
  expect(liquidityTimeline(data).rows.every((row) => row.position === null)).toBe(true);
  expect(liquidityTimeline(data).lowest).toBeNull();
});

it('formats days and ratio comparisons without money or negative rounded zero', () => {
  expect(financialValue({ value: 2.1, unit: 'ratio' })).toBe('2.10×');
  expect(financialValue({ value: 9.25, unit: 'days' })).toBe('9.3 days');
  expect(movementValue({ value: -.0001 }, 'ratio')).toBe('0.00×');
  expect(movementValue({ value: -.001 }, 'days')).toBe('0.0 days');
});
