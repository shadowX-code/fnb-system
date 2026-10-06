import { financialClassifications } from './foundation.js';
import { compatibleMetricBasis, costGrowth, diagnosticRatio, metricMovement, revenueGrowth } from './metrics.js';
import { profitMovement } from './analysis.js';

export const costIds = Object.freeze(['cogs', 'labour', 'opex']);
export const costStateIds = Object.freeze(['cogs', 'labour', 'prime_cost', 'opex', 'ebitda']);
const ratioIds = { cogs: 'cogs_percent', labour: 'labour_percent', prime_cost: 'prime_cost_percent', opex: 'opex_percent', ebitda: 'ebitda_margin', gross_profit: 'gross_margin' };
export function costRatio(dataset, id) {
  const amount = dataset.metrics[id];
  return diagnosticRatio(amount, dataset.metrics.revenue, dataset.metrics[ratioIds[id]]);
}
function classifiedPair(pair, id) {
  const parent = id.split('.')[0];
  const dataset = (source) => {
    const metric = source.classifications?.find((value) => value.id === id) ?? { ...source.metrics[parent], id, value: null, completeness: 'unavailable', provenance: [], reason: 'No validated evidence for this classification.' };
    return { ...source, metrics: { ...source.metrics, [id]: metric } };
  };
  return { current: dataset(pair.current), previous: dataset(pair.previous) };
}
/** Children are a partition only when every canonical child ties to its supplied parent in both periods. */
function classifiedCoverage(pair, parent) {
  const children = financialClassifications.filter((value) => value.parentId === parent);
  return [pair.current, pair.previous].every((dataset) => {
    const values = children.map((child) => dataset.classifications?.find((value) => value.id === child.id));
    const total = dataset.metrics[parent];
    return total.completeness === 'complete' && Number.isFinite(total.value) && values.every((value) => Number.isFinite(value?.value) && value?.completeness === 'complete' && compatibleMetricBasis(value, total)) && Math.abs(values.reduce((sum, value) => sum + value.value, 0) - total.value) < .01;
  });
}
export function costDiagnostic(pair, id, contribution = null) {
  const current = pair.current.metrics[id], previous = pair.previous.metrics[id];
  const currentRatio = costRatio(pair.current, id), previousRatio = costRatio(pair.previous, id);
  const movement = metricMovement(current, previous), ratioMovement = metricMovement(currentRatio, previousRatio);
  const growth = costGrowth(current, previous), revenue = revenueGrowth(pair.current.metrics.revenue, pair.previous.metrics.revenue);
  // A descriptive tolerance, not a target or an inference of causal business health.
  const direction = ratioMovement.value === null ? 'unavailable' : Math.abs(ratioMovement.value) < .1 ? 'stable' : ratioMovement.value > 0 ? 'pressure' : 'improvement';
  return { id, current, previous, currentRevenue: pair.current.metrics.revenue, previousRevenue: pair.previous.metrics.revenue, currentRatio, previousRatio, movement, ratioMovement, growth, revenueGrowth: revenue, contribution, direction };
}
export function materialCostOrder(rows) {
  return [...rows].sort((a, b) => Number(b.ratioMovement.value !== null) - Number(a.ratioMovement.value !== null) || Math.abs(b.ratioMovement.value ?? 0) - Math.abs(a.ratioMovement.value ?? 0) || Number(b.movement.value !== null) - Number(a.movement.value !== null) || Math.abs(b.movement.value ?? 0) - Math.abs(a.movement.value ?? 0));
}
export function costChildren(pair, parent, model) {
  const attribution = profitMovement(pair, model);
  const parentContribution = attribution.rows.find((row) => row.id === parent)?.contribution;
  const coverage = classifiedCoverage(pair, parent);
  const ids = financialClassifications.filter((definition) => definition.parentId === parent && [pair.current, pair.previous].some((dataset) => dataset.classifications?.some((metric) => metric.id === definition.id)));
  const rows = ids.map((definition) => {
    const childPair = classifiedPair(pair, definition.id);
    const movement = metricMovement(childPair.current.metrics[definition.id], childPair.previous.metrics[definition.id]);
    return { ...costDiagnostic(childPair, definition.id, coverage && parentContribution !== null && parentContribution !== undefined && movement.value !== null ? -movement.value : null), label: definition.label, pair: childPair };
  });
  return { rows: materialCostOrder(rows), coverage, reason: !ids.length ? 'No validated classified evidence is available for this cost layer.' : !coverage ? 'Classifications do not establish a complete partition of this layer in both periods. Their movements are shown without EBITDA attribution.' : 'Classified evidence ties to the parent in both periods; contributions retain the parent EBITDA basis.' };
}
export function costIntelligence(analysis) {
  const attribution = profitMovement(analysis, analysis.profitDriverModel);
  return { ...analysis, attribution, rows: materialCostOrder(costIds.map((id) => costDiagnostic(analysis, id, attribution.rows.find((row) => row.id === id)?.contribution ?? null))) };
}
