import { expect, it, vi } from 'vitest';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { analysisPair, outletPosition, performanceZone, profitMovement, readFinanceAnalysis } from '../analysis.js';
import { analysisMargin, metricMovement, ratioValue } from '../metrics.js';
import { operationalProvider } from '../providers/operationalProvider.js';
import { reportingService } from '../../../services/reportingService.js';
const request = { scope: { kind: 'group', id: 'demo-group' }, period: monthlyPeriod('2026-09'), currency: 'MYR' };
const comparisonPeriod = monthlyPeriod('2026-08');
const demoOutlets = [{ id: 'demo-kl', name: 'KL', legalEntityId: 'demo-entity-a' }, { id: 'demo-pj', name: 'PJ', legalEntityId: 'demo-entity-a' }];
it('reads arbitrary prior months and original canonical metrics through the development-safe boundary', async () => {
  const provider = createFixtureProvider({ development: true });
  const result = await readFinanceAnalysis(provider, request, { comparisonPeriod, outlets: demoOutlets, allowDemo: true });
  expect(result.current.metrics.revenue.value).toBe(562000);
  expect(result.previous.metrics.revenue.value).toBe(547950);
  expect(result.outlets).toHaveLength(2);
  expect(result.outlets[0].history.map((entry) => entry.period.start)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
  expect(result.outlets[0].position.zone).toBe('Growing & profitable');
  const movement = profitMovement(result, result.profitDriverModel);
  expect(movement.attributable).toBe(true);
  expect(movement.rows.reduce((sum, row) => sum + row.contribution, 0)).toBeCloseTo(movement.total.value);
  await expect(readFinanceAnalysis(provider, request)).rejects.toThrow('mismatch');
  await expect(readFinanceAnalysis(provider, request, { comparisonPeriod: request.period })).rejects.toThrow('before');
});
it('keeps zero/negative denominator growth and incomplete margins unavailable', async () => {
  const provider = createFixtureProvider({ development: true });
  const current = await provider.readOverview(request), previous = await provider.readOverview({ ...request, period: comparisonPeriod });
  for (const value of [0, -10, null]) {
    previous.metrics.revenue.value = value;
    expect(outletPosition(analysisPair(current, previous)).x).toBeNull();
  }
  current.metrics.ebitda_margin.value = null; current.metrics.revenue.value = 0;
  expect(analysisMargin(current).value).toBeNull();
  current.metrics.revenue.value = 100; current.metrics.revenue.completeness = 'partial';
  expect(analysisMargin(current).value).toBeNull();
  expect(ratioValue(Number.MAX_VALUE, 0.01)).toBeNull();
});
it('never attributes incompatible evidence or hides an unexplained residual', async () => {
  const provider = createFixtureProvider({ development: true });
  const pair = analysisPair(await provider.readOverview(request), await provider.readOverview({ ...request, period: comparisonPeriod }));
  const model = provider.profitDriverModel;
  expect(profitMovement(pair, model).attributable).toBe(true);
  pair.current.metrics.ebitda.value += 100;
  expect(profitMovement(pair, model).rows.every((row) => row.contribution === null)).toBe(true);
  pair.current.metrics.ebitda.value -= 100;
  pair.previous.metrics.revenue.provenance = pair.previous.metrics.revenue.provenance.map((source) => ({ ...source, semantic: 'OPERATIONAL' }));
  expect(metricMovement(pair.current.metrics.revenue, pair.previous.metrics.revenue).value).toBeNull();
  expect(profitMovement(pair, model).attributable).toBe(false);
  expect(profitMovement(pair, null).attributable).toBe(false);
});
it('preserves Reporting EBITDA and does not invent labour or accounting gross margin', async () => {
  const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockImplementation(async ({ month }) => ({ financials: {
    revenue: { amount: month === 9 ? 100 : 80, presence: 'present' },
    purchaseBasedCogs: { amount: 30, presence: 'present' }, opex: { amount: 40, presence: 'present' }, netProfit: { amount: month === 9 ? 30 : 10, presence: 'present' },
  } }));
  try {
    const result = await readFinanceAnalysis(operationalProvider, { ...request, scope: { kind: 'authorized_outlets', id: null } });
    expect(result.current.metrics.ebitda.value).toBe(30);
    expect(result.current.metrics.ebitda.provenance[0].semantic).toBe('OPERATIONAL');
    expect(result.current.metrics.ebitda_margin.value).toBe(30);
    expect(result.current.metrics.ebitda_margin.provenance[0].semantic).toBe('DERIVED');
    expect(result.current.metrics.ebitda_margin.inputProvenance[0].semantic).toBe('OPERATIONAL');
    expect(result.current.metrics.gross_margin.value).toBeNull();
    expect(result.current.metrics.prime_cost.value).toBeNull();
    const movement = profitMovement(result, result.profitDriverModel);
    expect(movement.total.value).toBe(20);
    expect(movement.attributable).toBe(true);
    expect(movement.rows.find((row) => row.id === 'labour').contribution).toBeNull();
  } finally { spy.mockRestore(); }
});
it('bounds concurrent reads, deduplicates scopes and preserves outlet/history failures', async () => {
  const provider = createFixtureProvider({ development: true });
  const original = provider.readOverview.bind(provider);
  let active = 0, maximum = 0;
  provider.readOverview = vi.fn(async (query) => {
    active++; maximum = Math.max(maximum, active);
    await Promise.resolve();
    try {
      if (query.scope.id === 'demo-pj') throw new Error('unavailable');
      if (query.scope.id === 'demo-kl' && query.period.start === '2026-07-01') throw new Error('history gap');
      return await original(query);
    } finally { active--; }
  });
  const result = await readFinanceAnalysis(provider, request, { outlets: [...demoOutlets, demoOutlets[0]], allowDemo: true });
  expect(maximum).toBeLessThanOrEqual(4);
  expect(result.outlets).toHaveLength(2);
  expect(result.outlets[1].pair).toBeNull();
  expect(result.outlets[0].history.find((entry) => entry.period.start === '2026-07-01').x).toBeNull();
  const keys = provider.readOverview.mock.calls.map(([query]) => JSON.stringify([query.scope, query.period]));
  expect(new Set(keys).size).toBe(keys.length);
});
it('filters scope eligibility and handles cancellation before any read', async () => {
  const provider = createFixtureProvider({ development: true });
  const result = await readFinanceAnalysis(provider, { ...request, scope: { kind: 'legal_entity', id: 'demo-entity-a' } }, { outlets: [...demoOutlets, { id: 'demo-coffee', name: 'Coffee', legalEntityId: 'demo-entity-b' }], allowDemo: true });
  expect(result.outlets.map((entry) => entry.id)).toEqual(['demo-kl', 'demo-pj']);
  const controller = new AbortController(); controller.abort();
  await expect(readFinanceAnalysis(provider, request, { signal: controller.signal, allowDemo: true })).rejects.toThrow('cancelled');
});
it('defines zones with explicit boundary states, without assumed targets', () => {
  expect(performanceZone(5, 10)).toBe('Growing & profitable');
  expect(performanceZone(-5, 10)).toBe('Profitable but slowing');
  expect(performanceZone(5, -10)).toBe('Growing with margin pressure');
  expect(performanceZone(-5, -10)).toBe('Needs attention');
  expect(performanceZone(0, 10)).toContain('boundary');
  expect(performanceZone(null, 10)).toBe('Insufficient evidence');
});
