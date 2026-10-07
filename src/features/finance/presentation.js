import { money, periodLabel } from '../reports/components/reportingFormatters.js';
export function financialValue(metric) {
  if (metric?.value === null || metric?.value === undefined) return '—';
  if (metric.unit === 'days') return `${metric.value.toFixed(1)} days`;
  if (metric.unit === 'ratio') return `${metric.value.toFixed(2)}×`;
  return metric.unit === 'percent' ? `${metric.value.toFixed(1)}%` : money({ amount: metric.value, presence: 'present' });
}
export function movementValue(movement, unit = 'money') {
  if (movement.value === null) return '—';
  const displayZero = ['percent', 'days', 'ratio'].includes(unit) && Number(Math.abs(movement.value).toFixed(unit === 'ratio' ? 2 : 1)) === 0;
  const sign = displayZero ? '' : movement.value > 0 ? '+' : movement.value < 0 ? '−' : '';
  if (unit === 'days') return `${sign}${Math.abs(movement.value).toFixed(1)} days`;
  if (unit === 'ratio') return `${sign}${Math.abs(movement.value).toFixed(2)}×`;
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

export function costObservation(row, label) {
  if (row.movement.value === null) return `${label}: ${row.movement.reason}`;
  const spend = row.movement.value === 0 ? 'was unchanged' : `${row.movement.value > 0 ? 'increased' : 'decreased'} by ${financialValue({ value: Math.abs(row.movement.value), unit: 'money' })}`;
  const ratio = row.direction === 'unavailable' ? 'Its share of Revenue cannot be compared with the available evidence.' : row.direction === 'stable' ? 'Its share of Revenue remained broadly stable (less than 0.1pp movement).' : `Its share of Revenue ${row.direction === 'pressure' ? 'rose' : 'fell'} ${movementValue({ value: Math.abs(row.ratioMovement.value) }, 'percent').replace('+', '')}.`;
  return `${label} ${spend}. ${ratio}`;
}
export function growthValue(growth) {
  return growth.value === null ? '—' : `${growth.value > 0 ? '+' : ''}${growth.value.toFixed(1)}%`;
}
