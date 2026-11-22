import { analysisMargin, compatibleMetricBasis, metricMovement, revenueGrowth } from './metricComparisons.js';

export const profitDriverIds = Object.freeze(['revenue', 'cogs', 'labour', 'opex']);
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
