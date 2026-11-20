const money = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const percentage = new Intl.NumberFormat('en-MY', { style: 'percent', maximumFractionDigits: 2, signDisplay: 'exceptZero' });

export function formatInventoryCost(value, unit = '') {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return '—';
  return `RM ${money.format(value)}${unit ? ` / ${unit}` : ''}`;
}

export function parseInventoryCostInput(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d{0,4})?$/.test(raw) || Number(raw) >= 100000000) return null;
  return Number(raw);
}

export function formatInventoryCostChange(next, previous) {
  if (next == null || previous == null) return null;
  const delta = Math.round((Number(next) - Number(previous)) * 10000) / 10000;
  const amount = `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${formatInventoryCost(Math.abs(delta))}`;
  return { amount, percentage: Number(previous) > 0 ? percentage.format(delta / previous) : null };
}
