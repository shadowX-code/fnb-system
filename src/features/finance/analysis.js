import { monthlyPeriod, previousPeriod, validatePeriod } from './foundation.js';
import { validateDataset } from './financeService.js';
import { analysisMargin, compatibleMetricBasis, metricMovement, revenueGrowth } from './metrics.js';

export const profitDriverIds = Object.freeze(['revenue', 'cogs', 'labour', 'opex']);
export const performanceIds = Object.freeze(['revenue', 'gross_margin', 'prime_cost', 'ebitda', 'ebitda_margin']);
export function shiftMonth(period, offset) {
  validatePeriod(period);
  const date = new Date(`${period.start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthlyPeriod(date.toISOString().slice(0, 7));
}
function monthIndex(period) { return Number(period.start.slice(0, 4)) * 12 + Number(period.start.slice(5, 7)); }
function enrich(dataset) { return { ...dataset, metrics: { ...dataset.metrics, ebitda_margin: analysisMargin(dataset) } }; }
export function analysisPair(current, previous) {
  return { current: enrich(current), previous: enrich(previous) };
}
export function performanceZone(growth, margin) {
  if (growth === null || margin === null) return 'Insufficient evidence';
  if (growth === 0 || margin === 0) return 'On the growth / profit boundary';
  return growth > 0 ? margin > 0 ? 'Growing & profitable' : 'Growing with margin pressure' : margin > 0 ? 'Profitable but slowing' : 'Needs attention';
}
export function outletPosition(pair) {
  const growth = revenueGrowth(pair.current.metrics.revenue, pair.previous.metrics.revenue);
  const margin = pair.current.metrics.ebitda_margin;
  const y = margin.completeness === 'complete' ? margin.value : null;
  return { x: growth.value, y, zone: performanceZone(growth.value, y), reason: growth.reason ?? (y === null ? margin.reason : null) };
}
/** Attribution only after the provider declares the EBITDA relationship and it ties in both periods. */
export function profitMovement(pair, model) {
  const total = metricMovement(pair.current.metrics.ebitda, pair.previous.metrics.ebitda);
  const rows = profitDriverIds.map((id) => {
    const movement = metricMovement(pair.current.metrics[id], pair.previous.metrics[id]);
    const included = Boolean(model?.drivers.includes(id));
    return { id, included, movement, contribution: included && movement.value !== null ? movement.value * (id === 'revenue' ? 1 : -1) : null };
  });
  const ties = (dataset) => {
    if (!model || !model.drivers.includes('revenue') || new Set(model.drivers).size !== model.drivers.length || model.drivers.some((id) => !profitDriverIds.includes(id))) return false;
    if (dataset.metrics.ebitda.completeness !== 'complete' || model.drivers.some((id) => dataset.metrics[id].completeness !== 'complete')) return false;
    if (!compatibleMetricBasis(...model.drivers.map((id) => dataset.metrics[id]))) return false;
    const explained = model.drivers.reduce((sum, id) => sum + dataset.metrics[id].value * (id === 'revenue' ? 1 : -1), 0);
    return Math.abs(explained - dataset.metrics.ebitda.value) < 0.01;
  };
  const attributable = total.value !== null && ties(pair.current) && ties(pair.previous) && rows.filter((row) => row.included).every((row) => row.contribution !== null);
  return {
    total, rows: rows.map((row) => ({ ...row, contribution: attributable ? row.contribution : null })),
    attributable, label: model?.label ?? 'Driver relationship has not been validated',
    reason: attributable ? null : 'EBITDA movement cannot be fully attributed with the available evidence and provider relationship.',
  };
}
/** Cache identical reads; bound concurrency. Each outlet read retains the existing server scope check. */
export async function readFinanceAnalysis(provider, request, { comparisonPeriod = previousPeriod(request.period), outlets = [], allowDemo = false, signal } = {}) {
  validatePeriod(request.period); validatePeriod(comparisonPeriod);
  const isMonth = (period) => period.start.endsWith('-01') && monthlyPeriod(period.start.slice(0, 7)).end === period.end;
  if (!isMonth(request.period) || !isMonth(comparisonPeriod) || comparisonPeriod.end >= request.period.start) throw new Error('Choose a complete comparison month before the current period.');
  if (!['outlet', 'authorized_outlets', 'group', 'legal_entity', 'dimension'].includes(request.scope.kind)) throw new Error('Unsupported financial scope');
  const lag = monthIndex(request.period) - monthIndex(comparisonPeriod);
  const cache = new Map();
  let active = 0;
  const queue = [];
  const read = (scope, period) => {
    const key = JSON.stringify([scope, period]);
    if (!cache.has(key)) cache.set(key, new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
          const query = { ...request, scope, period };
          resolve(validateDataset(await provider.readOverview(query), query, { allowDemo }));
        } catch (error) { reject(error); }
        finally { active--; queue.shift()?.(); }
      };
      if (active < 4) run(); else queue.push(run);
    }));
    return cache.get(key);
  };
  const pairFor = async (scope, period, comparison) => {
    const [current, previous] = await Promise.all([read(scope, period), read(scope, comparison)]);
    return analysisPair(current, previous);
  };
  const scopePair = await pairFor(request.scope, request.period, comparisonPeriod);
  const eligible = [...new Map(outlets.filter((outlet) => outlet.id && outlet.name && (request.scope.kind !== 'outlet' || outlet.id === request.scope.id) && (request.scope.kind !== 'legal_entity' || outlet.legalEntityId === request.scope.id) && request.scope.kind !== 'dimension').map((outlet) => [outlet.id, outlet])).values()];
  const results = await Promise.all(eligible.map(async (outlet) => {
    const scope = { kind: 'outlet', id: outlet.id, ...(outlet.legalEntityId ? { legalEntityId: outlet.legalEntityId } : {}) };
    let pair;
    try { pair = await pairFor(scope, request.period, comparisonPeriod); }
    catch { return { ...outlet, pair: null, history: [], error: 'Financial evidence could not be loaded for this outlet.' }; }
    const history = await Promise.all([-2, -1, 0].map(async (offset) => {
      const period = shiftMonth(request.period, offset);
      try {
        const value = offset === 0 ? pair : await pairFor(scope, period, shiftMonth(period, -lag));
        return { period, ...outletPosition(value) };
      } catch { return { period, x: null, y: null, reason: 'Historical evidence unavailable.' }; }
    }));
    return { ...outlet, pair, position: outletPosition(pair), history, error: null };
  }));
  return { ...scopePair, outlets: results, comparisonPeriod, lag, profitDriverModel: provider.profitDriverModel ?? null };
}
