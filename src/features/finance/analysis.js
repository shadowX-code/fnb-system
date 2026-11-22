import { monthlyPeriod, previousPeriod, validatePeriod } from './foundation.js';
import { validateDataset } from './financeService.js';
import { analysisPair, outletPosition } from '../../../supabase/functions/_shared/finance/periodAnalysis.js';
export { analysisPair, outletPosition, performanceZone, profitDriverIds, profitMovement } from '../../../supabase/functions/_shared/finance/periodAnalysis.js';

export const performanceIds = Object.freeze(['revenue', 'gross_margin', 'prime_cost', 'ebitda', 'ebitda_margin']);
export function shiftMonth(period, offset) {
  validatePeriod(period);
  const date = new Date(`${period.start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return monthlyPeriod(date.toISOString().slice(0, 7));
}
function monthIndex(period) { return Number(period.start.slice(0, 4)) * 12 + Number(period.start.slice(5, 7)); }
/** Cache identical reads; bound concurrency. Each outlet read retains the existing server scope check. */
export async function readFinanceAnalysis(provider, request, { comparisonPeriod = previousPeriod(request.period), outlets = [], includeHistory = false, allowDemo = false, signal } = {}) {
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
  // Thirteen observations support twelve visible months plus the first month's comparison.
  // Reuse the validated, concurrency-limited cache; Costs/Cash do not request this history.
  const historyRead = includeHistory ? Promise.all(Array.from({length:13}, (_, index) => shiftMonth(request.period, index-12)).map(async period => {
    try { return {period, dataset:await read(request.scope, period)}; }
    catch { return {period, dataset:null}; }
  })) : Promise.resolve([]);
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
  return { ...scopePair, history: await historyRead, outlets: results, comparisonPeriod, lag, profitDriverModel: provider.profitDriverModel ?? null };
}
