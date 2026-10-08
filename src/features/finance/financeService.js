import { capabilityKeys, capabilityStates, financialClassifications, previousPeriod, sourceSemantics, sourceIdentityKey, validatePeriod } from './foundation.js';
import { validateLiquiditySchedule } from './cash.js';
import { metricRegistry } from './metrics.js';
import { operationalProvider } from './providers/operationalProvider.js';

export const financeDemoEnabled = import.meta.env.DEV;
export async function getFinanceProvider(mode = 'operational') {
  if (mode === 'operational') return operationalProvider;
  if (mode !== 'demo' || !financeDemoEnabled) throw new Error('Financial demo is unavailable');
  const { createFixtureProvider } = await import('./providers/fixtureProvider.js');
  return createFixtureProvider({ development: financeDemoEnabled });
}
/** Reject vendor-shaped or malformed evidence at the adapter boundary. */
export function validateDataset(dataset, request, { allowDemo = false } = {}) {
  validatePeriod(request.period);
  if (JSON.stringify(dataset.scope) !== JSON.stringify(request.scope) || JSON.stringify(dataset.period) !== JSON.stringify(request.period) || dataset.currency !== request.currency || typeof dataset.demo !== 'boolean' || (dataset.demo && !allowDemo)) throw new Error('Financial scope or evidence mismatch');
  if (capabilityKeys.some((key) => !capabilityStates.includes(dataset.capabilities?.[key]))) throw new Error('Incomplete provider capability declaration');
  for (const id of Object.keys(metricRegistry)) {
    const result = dataset.metrics?.[id];
    if (!result || result.id !== id || result.unit !== metricRegistry[id].unit || result.currency !== request.currency || JSON.stringify(result.scope) !== JSON.stringify(request.scope) || JSON.stringify(result.period) !== JSON.stringify(request.period) || !['complete', 'partial', 'unavailable', 'unverified'].includes(result.completeness) || (result.value !== null && !Number.isFinite(result.value)) || (!['complete', 'partial'].includes(result.completeness) && result.value !== null)) throw new Error('Invalid canonical metric result');
    if (result.value !== null && !result.provenance?.length) throw new Error('Financial value requires provenance');
    for (const source of result.provenance) {
      sourceIdentityKey(source.identity);
      if (!sourceSemantics.includes(source.semantic) || source.demo !== dataset.demo) throw new Error('Invalid financial provenance');
    }
  }
  if (dataset.classifications !== undefined) {
    if (!Array.isArray(dataset.classifications)) throw new Error('Invalid canonical classifications');
    const seen = new Set();
    for (const result of dataset.classifications) {
      const definition = financialClassifications.find((entry) => entry.id === result.id && entry.parentId);
      if (!definition || seen.has(result.id)) throw new Error('Unknown or duplicate financial classification');
      seen.add(result.id);
      if (result.unit !== 'money' || result.currency !== request.currency || JSON.stringify(result.scope) !== JSON.stringify(request.scope) || JSON.stringify(result.period) !== JSON.stringify(request.period) || !['complete', 'partial', 'unavailable', 'unverified'].includes(result.completeness) || (result.value !== null && !Number.isFinite(result.value)) || (!['complete', 'partial'].includes(result.completeness) && result.value !== null)) throw new Error('Invalid classified metric result');
      if (!Array.isArray(result.provenance) || (result.value !== null && !result.provenance.length)) throw new Error('Classified value requires provenance');
      for (const source of result.provenance) {
        sourceIdentityKey(source.identity);
        if (!sourceSemantics.includes(source.semantic) || source.demo !== dataset.demo) throw new Error('Invalid classified provenance');
      }
    }
  }
  if (dataset.liquiditySchedule !== undefined) validateLiquiditySchedule(dataset.liquiditySchedule, dataset);
  if (!Array.isArray(dataset.statements)) throw new Error('Invalid canonical statements');
  dataset.statements.forEach((statement) => validateStatement(statement, request, { allowDemo, demo: dataset.demo }));
  return dataset;
}
export function validateStatement(statement, request, { allowDemo = false, demo = false } = {}) {
  if (!['profit_loss', 'balance_sheet', 'cash_flow'].includes(statement.kind) || JSON.stringify(statement.scope) !== JSON.stringify(request.scope) || JSON.stringify(statement.period) !== JSON.stringify(request.period) || statement.currency !== request.currency || !['complete', 'partial', 'unavailable', 'unverified'].includes(statement.completeness) || !['reconciled', 'unreconciled', 'unverified'].includes(statement.reconciliation?.status) || !Array.isArray(statement.lines) || !statement.provenance?.length) throw new Error('Invalid canonical statement');
  for (const source of statement.provenance) {
    sourceIdentityKey(source.identity);
    if (!sourceSemantics.includes(source.semantic) || source.demo !== demo || (source.demo && !allowDemo)) throw new Error('Invalid statement provenance');
  }
  for (const line of statement.lines) if (line.amount !== null && !Number.isFinite(line.amount)) throw new Error('Invalid statement amount');
  return statement;
}
export async function readFinanceStatement(provider, request, options) {
  const capability = { profit_loss: 'profit_loss_report', balance_sheet: 'balance_sheet_report', cash_flow: 'cash_flow_report' }[request.kind];
  if (!capability) throw new Error('Unknown statement kind');
  if (!['supported', 'partial'].includes(provider.capabilities[capability]) || !provider.readStatement) return null;
  const statement = await provider.readStatement(request);
  return statement ? validateStatement(statement, request, { ...options, demo: statement.provenance?.[0]?.demo }) : null;
}
/** Overview history is bounded, deduplicated and validated through the same provider boundary. */
export async function readFinanceOverview(provider, request, options = {}) {
  const { outlets = [], signal } = options;
  const cache = new Map(), queue = []; let active = 0;
  const read = (scope, period) => {
    const key = JSON.stringify([scope, period]);
    if (!cache.has(key)) cache.set(key, new Promise((resolve, reject) => {
      const run = async () => {
        active++;
        try {
          if (signal?.aborted) throw new DOMException('Finance read cancelled', 'AbortError');
          const query = { ...request, scope, period };
          resolve(validateDataset(await provider.readOverview(query), query, options));
        } catch (error) { reject(error); }
        finally { active--; queue.shift()?.(); }
      };
      if (active < 4) run(); else queue.push(run);
    }));
    return cache.get(key);
  };
  const comparisonPeriod = previousPeriod(request.period);
  const [current, previous] = await Promise.all([read(request.scope, request.period), read(request.scope, comparisonPeriod)]);
  const periods = [request.period];
  for (let index = 1; index < 12; index++) periods.unshift(previousPeriod(periods[0]));
  const history = await Promise.all(periods.map(async period => {
    try { return { period, dataset: await read(request.scope, period) }; }
    catch { return { period, dataset: null }; }
  }));
  const eligible = [...new Map(outlets.filter(outlet => outlet.id && outlet.name
    && (request.scope.kind !== 'outlet' || request.scope.id === outlet.id)
    && (request.scope.kind !== 'legal_entity' || request.scope.id === outlet.legalEntityId)
    && request.scope.kind !== 'dimension').map(outlet => [outlet.id, outlet])).values()];
  const outletResults = await Promise.all(eligible.map(async outlet => {
    const scope = { kind: 'outlet', id: outlet.id, ...(outlet.legalEntityId ? { legalEntityId: outlet.legalEntityId } : {}) };
    try { return { ...outlet, dataset: await read(scope, request.period) }; }
    catch { return { ...outlet, dataset: null }; }
  }));
  return { ...current, history, outlets: outletResults, comparisonDataset: previous, profitDriverModel: provider.profitDriverModel ?? null,
    metrics: Object.fromEntries(Object.entries(current.metrics).map(([id, metric]) => [id, { ...metric, comparison: { value: previous.metrics[id].value, period: comparisonPeriod, provenance: previous.metrics[id].provenance, completeness: previous.metrics[id].completeness } }])) };
}
