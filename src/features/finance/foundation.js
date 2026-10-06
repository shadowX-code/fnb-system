export const sourceSemantics = Object.freeze(['ACTUAL', 'OPERATIONAL', 'DERIVED', 'FORECAST']);
export const capabilityStates = Object.freeze(['supported', 'partial', 'unsupported', 'unverified']);
export const capabilityKeys = Object.freeze(['chart_of_accounts', 'transactions', 'journal_lines', 'account_balances', 'financial_dimensions', 'inventory_valuation', 'profit_loss_report', 'balance_sheet_report', 'cash_flow_report', 'incremental_sync', 'webhooks']);
export function capabilities(overrides = {}) {
  for (const [key, state] of Object.entries(overrides)) {
    if (!capabilityKeys.includes(key) || !capabilityStates.includes(state)) throw new Error('Invalid provider capability');
  }
  return Object.freeze(Object.fromEntries(capabilityKeys.map((key) => [key, overrides[key] ?? 'unverified'])));
}
const classificationGroups = {
  revenue: [], cogs: ['food', 'beverage', 'packaging'],
  labour: ['salary', 'overtime', 'statutory', 'other_labour'],
  opex: ['occupancy', 'utilities', 'marketing', 'delivery', 'repairs_maintenance', 'software', 'professional_fees', 'other_operating_expense'],
  assets: [], liabilities: [], equity: [],
};
export const financialClassifications = Object.freeze(Object.entries(classificationGroups).flatMap(([parent, children]) => [
  Object.freeze({ id: parent, parentId: null }), ...children.map((child) => Object.freeze({ id: `${parent}.${child}`, parentId: parent, label: child.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') })),
]));
function validDate(value) { const date = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
export function validatePeriod(period) {
  if (!period || !validDate(period.start) || !validDate(period.end) || period.start > period.end) throw new Error('Invalid financial period');
  return period;
}
export function monthlyPeriod(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Invalid month');
  const [year, month] = value.split('-').map(Number);
  return { start: `${value}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
}
export function previousPeriod(period) {
  validatePeriod(period);
  const date = new Date(`${period.start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return monthlyPeriod(date.toISOString().slice(0, 7));
}
/** Inclusive periods cannot overlap for the same entity/resource, even across vendors. */
export function validateAuthorityPeriods(periods) {
  periods.forEach((item) => { validatePeriod(item); if (!item.legalEntityId || !item.connectionId || !['statements', 'balances', 'transactions'].includes(item.resource)) throw new Error('Invalid authority binding'); });
  for (let i = 0; i < periods.length; i++) for (let j = i + 1; j < periods.length; j++) {
    const a = periods[i], b = periods[j];
    if (a.legalEntityId === b.legalEntityId && a.resource === b.resource && a.start <= b.end && b.start <= a.end) throw new Error('Overlapping provider authority');
  }
  return periods;
}
/** Split cross-provider queries; gaps remain unavailable, never fall back to the current vendor. */
export function authoritySegments(periods, { legalEntityId, resource, period }) {
  validateAuthorityPeriods(periods); validatePeriod(period);
  return periods.filter((p) => p.legalEntityId === legalEntityId && p.resource === resource && p.start <= period.end && period.start <= p.end)
    .sort((a, b) => a.start.localeCompare(b.start)).map((p) => ({ ...p, start: p.start > period.start ? p.start : period.start, end: p.end < period.end ? p.end : period.end }));
}
export function sourceIdentityKey(identity) {
  const keys = ['providerId', 'connectionId', 'externalId', 'revision'];
  if (keys.some((key) => typeof identity?.[key] !== 'string' || !identity[key])) throw new Error('Missing source identity');
  return JSON.stringify(keys.map((key) => identity[key]));
}
/** Reference append-only ingest policy: retries deduplicate; corrections require a new revision. */
export function appendEvidence(history, record) {
  const key = sourceIdentityKey(record.provenance.identity);
  const existing = history.find((item) => sourceIdentityKey(item.provenance.identity) === key);
  if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('Immutable evidence conflict');
  return existing ? history : [...history, structuredClone(record)];
}

/** Query plans explicitly expose uncovered dates; incomplete history cannot become zero. */
export function authorityPlan(periods, request) {
  const segments = authoritySegments(periods, request);
  const shift = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  const gaps = [];
  let next = request.period.start;
  for (const segment of segments) {
    if (next < segment.start) gaps.push({ start: next, end: shift(segment.start, -1) });
    next = shift(segment.end, 1);
  }
  if (next <= request.period.end) gaps.push({ start: next, end: request.period.end });
  return { segments, gaps, completeness: gaps.length ? 'partial' : 'complete' };
}

/** Effective mappings pin a version; provider account IDs never become classifications. */
export function resolveMapping(mappings, { identity, kind, legalEntityId, date }) {
  if (!validDate(date) || !['account', 'supplier', 'product_uom', 'outlet_dimension'].includes(kind)) throw new Error('Invalid mapping request');
  const key = sourceIdentityKey(identity);
  const matches = mappings.filter((mapping) => mapping.kind === kind && mapping.legalEntityId === legalEntityId && sourceIdentityKey(mapping.identity) === key).filter((mapping) => {
    validatePeriod(mapping);
    if (!mapping.version || !mapping.canonicalId) throw new Error('Unversioned financial mapping');
    return mapping.start <= date && date <= mapping.end;
  });
  if (matches.length > 1) throw new Error('Ambiguous effective financial mapping');
  return matches[0] ?? null;
}
