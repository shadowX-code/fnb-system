import { analysisMargin, compatibleMetricBasis } from './metrics.js';
import { costRatio } from './costs.js';

export const conversionIds = ['cogs', 'labour', 'opex', 'ebitda'];
export function profitConversion(dataset) {
  const m = dataset.metrics, ids = ['revenue', 'gross_profit', ...conversionIds];
  const amountsComplete = dataset.profitDriverModel?.drivers.length === 4 && ['revenue','cogs','labour','opex'].every(id => dataset.profitDriverModel.drivers.includes(id))
    && ids.every(id => m[id]?.completeness === 'complete' && m[id].value !== null && m[id].value >= 0)
    && m.revenue.value > 0 && compatibleMetricBasis(...['revenue','cogs','labour','opex'].map(id => m[id]))
    && Math.abs(m.revenue.value - m.cogs.value - m.gross_profit.value) < .01
    && Math.abs(m.gross_profit.value - m.labour.value - m.opex.value - m.ebitda.value) < .01;
  const rows = conversionIds.map(id => ({id, metric:m[id], share:amountsComplete ? costRatio(dataset,id).value : null}));
  // Supplied ratios must also match their amounts; a rounded display never changes geometry.
  const complete = amountsComplete && rows.every(row => Number.isFinite(row.share) && row.share >= 0 && Math.abs(row.share - row.metric.value / m.revenue.value * 100) < .000001)
    && Math.abs(rows.reduce((sum,row) => sum + row.share,0) - 100) < .000001;
  return { complete, rows:rows.map(row => ({...row,share:complete ? row.share : null})) };
}
/** Never connect different evidence bases or substitute current evidence for a historical gap. */
export function overviewHistory(dataset, count = 6, ids = ['revenue','ebitda','cash','ebitda_margin']) {
  return (dataset.history ?? []).slice(-count).map(entry => {
    const metrics = entry.dataset?.metrics;
    const values = Object.fromEntries(ids.map(id => {
      const metric = metrics ? id === 'ebitda_margin' ? analysisMargin(entry.dataset) : metrics[id] : null;
      const reference = id === 'ebitda_margin' ? analysisMargin(dataset) : dataset.metrics[id];
      const actualCash = id !== 'cash' || metric?.provenance.every(source => source.semantic === 'ACTUAL');
      return [id, metric?.completeness === 'complete' && compatibleMetricBasis(metric,reference) && actualCash ? metric.value : null];
    }));
    return {period:entry.period, dataset:entry.dataset, ...values};
  });
}
export function overviewOutlets(dataset) {
  return (dataset.outlets ?? []).map(outlet => {
    const metric = outlet.dataset ? analysisMargin(outlet.dataset) : null;
    return {...outlet, metric, value:metric?.completeness === 'complete' ? metric.value : null};
  }).sort((a,b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}
