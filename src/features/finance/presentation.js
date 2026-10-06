import { money, periodLabel } from '../reports/components/reportingFormatters.js';
export function financialValue(metric) {
  if (metric?.value === null || metric?.value === undefined) return '—';
  return metric.unit === 'percent' ? `${metric.value.toFixed(1)}%` : money({ amount: metric.value, presence: 'present' });
}
export function movementValue(movement, unit = 'money') {
  if (movement.value === null) return 'Unavailable';
  const sign = movement.value > 0 ? '+' : movement.value < 0 ? '−' : '';
  return unit === 'percent' ? `${sign}${Math.abs(movement.value).toFixed(1)} pp` : `${sign}${money({ amount: Math.abs(movement.value), presence: 'present' })}`;
}
export function financialSemantics(metric) {
  return [...new Set(metric?.provenance?.map((source) => source.semantic) ?? [])].map((value) => value[0] + value.slice(1).toLowerCase()).join(' / ') || 'Unavailable';
}
export function financialPeriod(period) { return periodLabel({ year: Number(period.start.slice(0, 4)), month: Number(period.start.slice(5, 7)) }); }
export function currentFinanceMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`;
}
