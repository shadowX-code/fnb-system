import { capabilityKeys, capabilityStates, previousPeriod, sourceSemantics, sourceIdentityKey, validatePeriod } from './foundation.js';
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
export async function readFinanceOverview(provider, request, options) {
  const comparisonPeriod = previousPeriod(request.period);
  const [current, previous] = await Promise.all([provider.readOverview(request), provider.readOverview({ ...request, period: comparisonPeriod })]);
  validateDataset(current, request, options);
  validateDataset(previous, { ...request, period: comparisonPeriod }, options);
  return { ...current, metrics: Object.fromEntries(Object.entries(current.metrics).map(([id, metric]) => [id, { ...metric, comparison: { value: previous.metrics[id].value, period: comparisonPeriod, provenance: previous.metrics[id].provenance, completeness: previous.metrics[id].completeness } }])) };
}
