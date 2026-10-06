import { describe, expect, it, vi } from 'vitest';
import { appendEvidence, authoritySegments, capabilities, monthlyPeriod, validateAuthorityPeriods } from '../foundation.js';
import { metricRegistry, metricResults } from '../metrics.js';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { readFinanceOverview, validateDataset } from '../financeService.js';
import { operationalProvider } from '../providers/operationalProvider.js';
import { reportingService } from '../../../services/reportingService.js';
const request = { scope: { kind: 'legal_entity', id: 'demo-entity-a' }, period: monthlyPeriod('2026-09'), currency: 'MYR' };
const authorities = [
  { legalEntityId: 'entity', connectionId: 'provider-a', resource: 'statements', start: '2026-01-01', end: '2026-12-31' },
  { legalEntityId: 'entity', connectionId: 'provider-b', resource: 'statements', start: '2027-01-01', end: '2027-12-31' },
];
describe('Finance evidence boundary', () => {
  it('splits history across authority periods without changing provenance or filling gaps', () => {
    expect(authoritySegments(authorities, { legalEntityId: 'entity', resource: 'statements', period: { start: '2026-12-01', end: '2027-01-31' } })).toEqual([
      { ...authorities[0], start: '2026-12-01' }, { ...authorities[1], end: '2027-01-31' },
    ]);
    expect(authoritySegments(authorities, { legalEntityId: 'entity', resource: 'balances', period: request.period })).toEqual([]);
    expect(() => validateAuthorityPeriods([...authorities, { ...authorities[1], start: '2026-12-31' }])).toThrow('Overlapping');
  });
  it('deduplicates retries and preserves old provider evidence when a provider changes', () => {
    const first = { provenance: { identity: { providerId: 'a', connectionId: 'a', externalId: '1', revision: '1' } }, amount: 20 };
    const history = appendEvidence([], first);
    expect(appendEvidence(history, structuredClone(first))).toBe(history);
    expect(() => appendEvidence(history, { ...first, amount: 30 })).toThrow('Immutable');
    const next = { ...first, provenance: { identity: { ...first.provenance.identity, providerId: 'b', connectionId: 'b' } } };
    expect(appendEvidence(history, next)).toHaveLength(2);
    expect(history[0]).toEqual(first);
  });
  it('rejects invalid periods and capability declarations', () => {
    expect(monthlyPeriod('2024-02').end).toBe('2024-02-29');
    expect(() => monthlyPeriod('2026-13')).toThrow();
    expect(() => capabilities({ webhooks: 'yes' })).toThrow();
  });
  it('carries missing evidence without manufacturing zeros or working capital', () => {
    const metrics = metricResults(request);
    expect(Object.keys(metrics)).toHaveLength(16);
    expect(metrics.cash.value).toBeNull();
    expect(metrics.working_capital.completeness).toBe('unavailable');
    expect(metricRegistry.working_capital.definition).toContain('Current assets');
  });
  it('uses one provider boundary for a multi-entity demo and comparisons', async () => {
    expect(() => createFixtureProvider()).toThrow('development');
    const provider = createFixtureProvider({ development: true });
    const entity = await readFinanceOverview(provider, request, { allowDemo: true });
    expect(entity.metrics.revenue.value).toBe(430000);
    expect(entity.metrics.ebitda.value).toBe(106290);
    expect(entity.metrics.prime_cost.value).toBe(247210);
    expect(entity.metrics.cash.provenance.every((source) => source.demo)).toBe(true);
    expect(entity.metrics.revenue.comparison.value).toBe(419250);
    expect(entity.metrics.working_capital.value).toBeNull();
    const group = await provider.readOverview({ ...request, scope: { kind: 'group', id: 'demo-group' } });
    expect(group.metrics.revenue.value).toBe(562000);
    expect(group.metrics.revenue.provenance).toHaveLength(4);
    expect(() => validateDataset(group, { ...request, scope: group.scope })).toThrow();
    const corporate = await provider.readOverview({ ...request, scope: { kind: 'dimension', id: 'demo-corporate' } });
    expect(corporate.metrics.revenue.value).toBe(0);
    expect(corporate.metrics.gross_margin.value).toBeNull();
    expect(corporate.metrics.ebitda.value).toBe(-20500);
  });
  it('rejects scope substitution and unlabeled or non-finite financial values', async () => {
    const dataset = await createFixtureProvider({ development: true }).readOverview(request);
    const invalid = structuredClone(dataset); invalid.metrics.cash.value = NaN;
    expect(() => validateDataset(invalid, request, { allowDemo: true })).toThrow();
    expect(() => validateDataset(dataset, { ...request, scope: { kind: 'outlet', id: 'other' } }, { allowDemo: true })).toThrow();
    const unlabeled = structuredClone(dataset); unlabeled.metrics.cash.provenance = [];
    expect(() => validateDataset(unlabeled, request, { allowDemo: true })).toThrow('provenance');
  });
  it('preserves server EBITDA, purchase-based COGS and operational semantics', async () => {
    const spy = vi.spyOn(reportingService, 'getMonthlyScopeFinancialReport').mockResolvedValue({ financials: {
      revenue: { amount: 100, presence: 'present' }, purchaseBasedCogs: { amount: 30, presence: 'present' }, opex: { amount: 40, presence: 'present' }, netProfit: { amount: 30, presence: 'present' },
    } });
    const scope = { kind: 'authorized_outlets', id: null };
    const result = await operationalProvider.readOverview({ ...request, scope });
    expect(spy).toHaveBeenCalledWith({ outletId: null, year: 2026, month: 9 });
    expect(result.metrics.ebitda.value).toBe(30);
    expect(result.metrics.ebitda.provenance[0].semantic).toBe('OPERATIONAL');
    expect(result.metrics.labour.value).toBeNull();
    expect(result.metrics.gross_margin.value).toBeNull();
    expect(result.statements).toEqual([]);
    spy.mockRestore();
  });
});

it('exposes authority gaps and rejects invalid calendar dates', async () => {
  const { authorityPlan, validatePeriod } = await import('../foundation.js');
  expect(authorityPlan(authorities, { legalEntityId: 'entity', resource: 'statements', period: { start: '2025-12-01', end: '2026-01-31' } }).gaps).toEqual([{ start: '2025-12-01', end: '2025-12-31' }]);
  expect(() => validatePeriod({ start: '2026-02-30', end: '2026-03-31' })).toThrow();
});

it('keeps unavailable statement capabilities closed and validates demo statement evidence', async () => {
  const { readFinanceStatement } = await import('../financeService.js');
  const provider = createFixtureProvider({ development: true });
  expect(await readFinanceStatement(provider, { ...request, kind: 'balance_sheet' }, { allowDemo: true })).toBeNull();
  expect((await readFinanceStatement(provider, { ...request, kind: 'profit_loss' }, { allowDemo: true })).kind).toBe('profit_loss');
  await expect(readFinanceStatement(provider, { ...request, kind: 'profit_loss' })).rejects.toThrow();
});

it('resolves only entity-scoped effective mapping versions and rejects ambiguous history', async () => {
  const { resolveMapping } = await import('../foundation.js');
  const identity = { providerId: 'vendor', connectionId: 'connection', externalId: 'account-123', revision: '1' };
  const old = { identity, kind: 'account', legalEntityId: 'entity', start: '2026-01-01', end: '2026-12-31', canonicalId: 'cogs.food', version: '1' };
  const next = { ...old, start: '2027-01-01', end: '2027-12-31', canonicalId: 'cogs.beverage', version: '2' };
  const request = { identity, kind: 'account', legalEntityId: 'entity', date: '2026-09-30' };
  expect(resolveMapping([old, next], request)).toBe(old);
  expect(resolveMapping([old, next], { ...request, date: '2027-01-01' })).toBe(next);
  expect(resolveMapping([old, next], { ...request, legalEntityId: 'other' })).toBeNull();
  expect(() => resolveMapping([old, { ...old, version: '3' }], request)).toThrow('Ambiguous');
});
