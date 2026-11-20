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
  return { delta, amount, percentage: Number(previous) > 0 ? percentage.format(delta / previous) : null };
}

export function inventoryEffectiveCostHistory(revisions) {
  const supersededIds = new Set(revisions.map(row => row.supersedes_revision_id).filter(Boolean));
  // Same-date versions retain the server's newest-first recording order.
  const rows = [...revisions].sort((a, b) => (b.effective_date ?? '').localeCompare(a.effective_date ?? ''));
  const effective = rows.filter(row => !supersededIds.has(row.id)).reverse();
  const previousByDate = new Map();
  let previous;
  for (const row of effective) {
    if (row.effective_date) previousByDate.set(row.effective_date, previous);
    previous = row;
  }
  const changes = new Map();
  for (const row of rows) {
    const basis = previousByDate.get(row.effective_date);
    const unit = row.unit?.trim().toLowerCase();
    if (unit && unit === basis?.unit?.trim().toLowerCase()) {
      changes.set(row.id, formatInventoryCostChange(row.unit_cost, basis.unit_cost));
    }
  }
  return { rows, effective, changes, supersededIds };
}
