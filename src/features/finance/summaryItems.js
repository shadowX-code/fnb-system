import { metricMovement, metricRegistry } from './metrics.js';
import { financialSemantics, financialValue, movementValue } from './presentation.js';

/** Data adapter only. Shared MetricCard and AdminSummaryGrid own all UI. */
export function financeSummaryItems(pair, ids, { primary = [], selectedId, onSelect, supporting = {} } = {}) {
  return ids.map(id => {
    const metric = pair.current.metrics[id];
    const movement = pair.previous?.metrics[id] ? metricMovement(metric, pair.previous.metrics[id]) : { value: null };
    // Cost/balance increases alone do not establish improvement. Preserve neutral semantics.
    const performance = ['ebitda', 'ebitda_margin', 'revenue', 'gross_margin'].includes(id);
    return { key: id, label: metricRegistry[id].label, value: financialValue(metric),
      state: metric.value === null ? 'unavailable' : 'ready', emphasis: primary.includes(id) ? 'primary' : 'normal',
      delta: movement.value === null ? null : `${movementValue(movement, metric.unit)} vs previous period`,
      deltaTone: performance && movement.value ? movement.value > 0 ? 'positive' : 'negative' : 'neutral',
      supportingValue: supporting[id], helper: metric.value === null ? null : `${financialSemantics(metric)} · ${metric.completeness}`,
      helperClassName: 'whitespace-normal leading-relaxed',
      ...(onSelect ? { onClick: () => onSelect(id), active: selectedId === id } : {}),
    };
  });
}
