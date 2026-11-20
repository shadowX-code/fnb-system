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

// Compare against the current basis at the time of recording, or the exact revision a correction replaced.
export function inventoryRevisionChanges(revisions) {
  const byId = new Map(revisions.map(row => [row.id, row]));
  const changes = new Map();
  let current;
  for (const row of [...revisions].reverse()) {
    const previous = row.supersedes_revision_id ? byId.get(row.supersedes_revision_id) : current;
    const unit = row.unit?.trim().toLowerCase();
    if (row.effective_date && unit && unit === previous?.unit?.trim().toLowerCase()) {
      changes.set(row.id, formatInventoryCostChange(row.unit_cost, previous.unit_cost));
    }
    if (!row.supersedes_revision_id || current?.id === row.supersedes_revision_id) current = row;
  }
  return changes;
}
