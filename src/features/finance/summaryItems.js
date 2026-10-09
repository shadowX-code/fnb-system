import { BarChart3, Banknote, Percent, Receipt, Wallet, Users, Building2, ArrowLeftRight, HandCoins, Boxes, CreditCard, Landmark } from 'lucide-react';
import { financeMetricColor } from './FinanceChart.jsx';
import { overviewHistory } from './overviewDashboard.js';
import { compatibleMetricBasis, metricMovement, metricRegistry } from './metrics.js';
import { financialValue, movementValue } from './presentation.js';

/** Data adapter only. Shared MetricCard and AdminSummaryGrid own all UI. */
export function financeSummaryItems(pair, ids, { primary = [], selectedId, onSelect, supporting = {} } = {}) {
  return ids.map(id => {
    const metric = pair.current.metrics[id];
    const movement = pair.previous?.metrics[id] ? metricMovement(metric, pair.previous.metrics[id]) : { value: null };
    // Cost/balance increases alone do not establish improvement. Preserve neutral semantics.
    const visibleMovement = movement.value !== null && (metric.unit === 'percent' ? Math.abs(movement.value) >= .05 : Math.abs(movement.value) >= .005);
    const performance = ['ebitda', 'ebitda_margin', 'revenue', 'gross_margin'].includes(id);
    return { key: id, label: metricRegistry[id].label, value: financialValue(metric),
      state: metric.value === null ? 'unavailable' : 'ready', emphasis: primary.includes(id) ? 'primary' : 'normal',
      delta: movement.value === null ? null : `${movementValue(movement, metric.unit)} vs previous period`,
      deltaTone: performance && visibleMovement ? movement.value > 0 ? 'positive' : 'negative' : 'neutral',
      supportingValue: supporting[id], evidenceStatus: {state:metric.completeness,label:metric.completeness === 'partial' ? 'Partial evidence' : undefined},
      helperClassName: 'whitespace-normal leading-relaxed',
      ...(onSelect ? { onClick: () => onSelect(id), active: selectedId === id } : {}),
    };
  });
}

const icons = {ebitda:BarChart3,ebitda_margin:Percent,revenue:Banknote,gross_margin:Percent,prime_cost:Receipt,cash:Wallet,cogs:Receipt,labour:Users,opex:Building2,working_capital:ArrowLeftRight,ar:HandCoins,inventory:Boxes,ap:CreditCard,debt:Landmark};
const tones = {ebitda:'bg-emerald-50 text-emerald-700',ebitda_margin:'bg-blue-50 text-blue-700',revenue:'bg-blue-50 text-blue-700',gross_margin:'bg-violet-50 text-violet-700',prime_cost:'bg-rose-50 text-rose-700',cash:'bg-cyan-50 text-cyan-700',cogs:'bg-rose-50 text-rose-700',labour:'bg-blue-50 text-blue-700',opex:'bg-slate-100 text-slate-700',working_capital:'bg-violet-50 text-violet-700',ar:'bg-blue-50 text-blue-700',inventory:'bg-slate-100 text-slate-700',ap:'bg-violet-50 text-violet-700',debt:'bg-slate-100 text-slate-700'};

/** Finance pages share presentation data; the canonical Admin cards own rendering. */
export function financeDashboardSummaryItems(pair, ids, { history = pair.current.history, comparisonLabel = 'previous month', ...options } = {}) {
  const metrics = pair.current.metrics;
  const rows = overviewHistory({...pair.current, history});
  return financeSummaryItems(pair, ids, options).map(item => {
    const points = rows.map(row => {
      const metric = row.dataset?.metrics[item.key];
      const value = ['revenue','ebitda','cash','ebitda_margin'].includes(item.key) ? row[item.key] : metric?.completeness === 'complete' && compatibleMetricBasis(metric,metrics[item.key]) ? metric.value : null;
      return {label:row.period.start,value};
    });
    // Ratios unchanged at displayed precision do not earn exaggerated sparklines.
    const meaningful = metrics[item.key].unit !== 'percent' || new Set(points.filter(point => point.value !== null).map(point => point.value.toFixed(1))).size > 1;
    const previous = pair.previous?.metrics[item.key];
    return {...item, icon:icons[item.key], iconClassName:tones[item.key],
      supportingValue:item.supportingValue ?? (previous?.value != null ? `${financialValue(previous)} ${comparisonLabel}` : null),
      sparklineData:meaningful ? points : null, sparklineColor:financeMetricColor(item.key),
      sparklineLabel:`${item.label} monthly evidence`, sparklinePlacement:'inline',
      sparklineFormatValue:value => financialValue({value,unit:metrics[item.key].unit})};
  });
}
