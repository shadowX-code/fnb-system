import { describe, expect, it } from 'vitest';
import { createFixtureProvider } from '../providers/fixtureProvider.js';
import { monthlyPeriod } from '../foundation.js';
import { validateDataset } from '../financeService.js';
import { readFinanceAnalysis, profitMovement } from '../analysis.js';
import { costChildren, costDiagnostic, costIntelligence, costRatio, materialCostOrder } from '../costs.js';
import { costObservation } from '../presentation.js';
const request = { scope: { kind: 'outlet', id: 'demo-kl', legalEntityId: 'demo-entity-a' }, period: monthlyPeriod('2026-09'), currency: 'MYR' };
async function fixture() { return readFinanceAnalysis(createFixtureProvider({ development: true }), request, { allowDemo: true }); }
function adjust(pair, current, previous) {
  const result = structuredClone(pair);
  for (const [dataset, values] of [[result.current, current], [result.previous, previous]]) {
    for (const [id, value] of Object.entries(values)) dataset.metrics[id].value = value;
    dataset.metrics.cogs_percent.value = null;
  }
  return result;
}
describe('Costs canonical diagnostics', () => {
  it('interprets larger spend against revenue growth rather than marking every increase adverse', async () => {
    const pair = adjust(await fixture(), { revenue: 200, cogs: 40 }, { revenue: 100, cogs: 30 });
    const row = costDiagnostic(pair, 'cogs');
    expect(row.movement.value).toBe(10); expect(row.growth.value).toBeCloseTo(100/3);
    expect(row.revenueGrowth.value).toBe(100); expect(row.ratioMovement.value).toBe(-10);
    expect(row.direction).toBe('improvement'); expect(costObservation(row, 'COGS')).toContain('share of Revenue fell');
  });
  it('finds margin pressure despite falling absolute spend and stable share despite growth', async () => {
    const source = await fixture();
    expect(costDiagnostic(adjust(source, { revenue: 50, cogs: 20 }, { revenue: 100, cogs: 30 }), 'cogs').direction).toBe('pressure');
    const stable = costDiagnostic(adjust(source, { revenue: 200, cogs: 60 }, { revenue: 100, cogs: 30 }), 'cogs');
    expect(stable.direction).toBe('stable'); expect(stable.growth.value).toBe(stable.revenueGrowth.value);
  });
  it('keeps zero-denominator, missing, partial and mixed semantic evidence unavailable', async () => {
    const source = await fixture(); const pair = adjust(source, { revenue: 0 }, {});
    expect(costRatio(pair.current, 'cogs').value).toBeNull();
    pair.current.metrics.revenue.value = 100; pair.current.metrics.cogs.completeness = 'partial';
    expect(costRatio(pair.current, 'cogs').value).toBeNull(); expect(costDiagnostic(pair, 'cogs').movement.value).toBeNull();
    pair.current.metrics.cogs.completeness = 'complete'; pair.current.metrics.cogs.provenance = pair.current.metrics.cogs.provenance.map((value) => ({ ...value, semantic: 'OPERATIONAL' }));
    expect(costRatio(pair.current, 'cogs').value).toBeNull(); expect(profitMovement(pair, pair.profitDriverModel).attributable).toBe(false);
  });
  it('preserves parent amounts and reconciles classified contributions only with complete child coverage', async () => {
    const pair = await fixture(), source = JSON.stringify(pair);
    const model = costIntelligence(pair), children = costChildren(pair, 'cogs', pair.profitDriverModel);
    expect(children.coverage).toBe(true); expect(children.rows).toHaveLength(3);
    expect(children.rows.reduce((sum, row) => sum + row.contribution, 0)).toBeCloseTo(model.rows.find((row) => row.id === 'cogs').contribution);
    expect(children.rows.every((row) => row.current.provenance.every((source) => source.demo))).toBe(true);
    expect(JSON.stringify(pair)).toBe(source);
  });
  it('never attributes a missing, partial or mismatched classification partition', async () => {
    const pair = await fixture(); pair.previous.classifications = pair.previous.classifications.filter((value) => value.id !== 'cogs.food');
    let children = costChildren(pair, 'cogs', pair.profitDriverModel);
    expect(children.coverage).toBe(false); expect(children.rows.every((row) => row.contribution === null)).toBe(true);
    expect(children.rows.find((row) => row.id === 'cogs.food').previous.value).toBeNull();
    pair.previous.classifications = structuredClone(pair.current.classifications).map((value) => ({ ...value, period: pair.previous.period }));
    children = costChildren(pair, 'cogs', pair.profitDriverModel);
    expect(children.coverage).toBe(false); expect(children.rows.every((row) => row.contribution === null)).toBe(true);
  });
  it('prioritizes ratio materiality with amount movement as a fallback without mutating order', async () => {
    const source = await fixture();
    const higher = costDiagnostic(adjust(source, { revenue: 100, cogs: 40 }, { revenue: 100, cogs: 30 }), 'cogs');
    const lower = costDiagnostic(adjust(source, { revenue: 10000, cogs: 3000 }, { revenue: 10000, cogs: 2900 }), 'cogs');
    const rows = [lower, higher]; expect(materialCostOrder(rows)[0]).toBe(higher); expect(rows[0]).toBe(lower);
  });
  it('rejects malformed classification records at the same adapter boundary', async () => {
    const source = (await fixture()).current;
    for (const update of [(s) => s.classifications.push(s.classifications[0]), (s) => s.classifications[0].id = 'vendor.unknown', (s) => s.classifications[0].currency = 'USD', (s) => s.classifications[0].provenance = [], (s) => s.classifications[0].value = NaN, (s) => s.classifications[0].scope = { kind: 'outlet', id: 'other' }, (s) => s.classifications[0].provenance[0].demo = false]) {
      const invalid = structuredClone(source); update(invalid);
      expect(() => validateDataset(invalid, request, { allowDemo: true })).toThrow();
    }
  });
  it('discloses absent child evidence without inventing expected account values', async () => {
    const pair = await fixture(); delete pair.current.classifications; delete pair.previous.classifications;
    const children = costChildren(pair, 'labour', pair.profitDriverModel);
    expect(children.rows).toEqual([]); expect(children.reason).toContain('No validated');
  });
});
