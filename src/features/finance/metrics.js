// Definitions describe canonical semantics; only adapters/trusted read authorities supply values.
const definitions = [
  ['revenue', 'Revenue', 'money', 'Recognized revenue', []],
  ['cogs', 'COGS', 'money', 'Cost of goods sold; valuation basis must be disclosed', []],
  ['cogs_percent', 'COGS %', 'percent', 'COGS ÷ Revenue × 100; retains the disclosed COGS basis', ['cogs', 'revenue']],
  ['gross_profit', 'Gross Profit', 'money', 'Revenue − COGS', ['revenue', 'cogs']],
  ['gross_margin', 'Gross Margin', 'percent', 'Gross Profit ÷ Revenue × 100', ['gross_profit', 'revenue']],
  ['labour', 'Labour Cost', 'money', 'Salary + overtime + statutory + other labour', []],
  ['labour_percent', 'Labour %', 'percent', 'Labour ÷ Revenue × 100', ['labour', 'revenue']],
  ['prime_cost', 'Prime Cost', 'money', 'COGS + Labour', ['cogs', 'labour']],
  ['prime_cost_percent', 'Prime Cost %', 'percent', 'Prime Cost ÷ Revenue × 100', ['prime_cost', 'revenue']],
  ['opex', 'OPEX', 'money', 'Operating expenses excluding separately classified labour, COGS, interest, tax, depreciation and amortisation', []],
  ['opex_percent', 'OPEX %', 'percent', 'OPEX ÷ Revenue × 100', ['opex', 'revenue']],
  ['ebitda', 'EBITDA', 'money', 'Revenue − COGS − Labour − OPEX', ['revenue', 'cogs', 'labour', 'opex']],
  ['ebitda_margin', 'EBITDA Margin', 'percent', 'EBITDA ÷ Revenue × 100', ['ebitda', 'revenue']],
  ['cash', 'Cash', 'money', 'Cash and cash equivalents at period end', []],
  ['ap', 'Accounts Payable', 'money', 'Trade payables at period end', []],
  ['ar', 'Accounts Receivable', 'money', 'Trade receivables at period end', []],
  ['working_capital', 'Working Capital', 'money', 'Current assets − current liabilities; cash + AR − AP is insufficient', []],
];
export const metricRegistry = Object.freeze(Object.fromEntries(definitions.map(([id, label, unit, definition, dependencies]) => [id, Object.freeze({ id, label, unit, definition, dependencies: Object.freeze(dependencies), aggregation: ['cash', 'ap', 'ar', 'working_capital'].includes(id) ? 'closing_balance' : unit === 'percent' ? 'ratio' : 'period_flow' })])));
export function metricResults(request, evidence = {}, previous = null) {
  return Object.fromEntries(Object.values(metricRegistry).map((definition) => {
    const source = evidence[definition.id];
    const present = Number.isFinite(source?.value) && ['complete', 'partial'].includes(source?.completeness);
    const prior = previous?.metrics?.[definition.id];
    return [definition.id, {
      id: definition.id, unit: definition.unit, currency: request.currency, scope: request.scope, period: request.period,
      value: present ? source.value : null, completeness: present ? source.completeness : 'unavailable',
      provenance: source?.provenance ?? [], reason: source?.reason ?? (present ? null : 'No validated evidence available'),
      comparison: previous ? { value: prior?.value ?? null, period: previous.period, provenance: prior?.provenance ?? [], completeness: prior?.completeness ?? 'unavailable' } : null,
      target: source?.target ?? null,
    }];
  }));
}

/** Demo calculations only; production adapters return trusted canonical results. */
export function calculateDemoMetrics(inputs) {
  const values = { ...inputs };
  values.gross_profit = values.revenue - values.cogs;
  values.prime_cost = values.cogs + values.labour;
  values.ebitda = values.gross_profit - values.labour - values.opex;
  for (const [id, numerator] of [['cogs_percent', 'cogs'], ['gross_margin', 'gross_profit'], ['labour_percent', 'labour'], ['prime_cost_percent', 'prime_cost'], ['opex_percent', 'opex'], ['ebitda_margin', 'ebitda']]) values[id] = ratioValue(values[numerator], values.revenue);
  return values;
}

/** Read-only diagnostics share the metric registry. Never reconstruct EBITDA or accounting COGS. */
export function ratioValue(numerator, denominator) {
  const value = Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator * 100 : null;
  return Number.isFinite(value) ? value : null;
}
export function analysisMargin(dataset) {
  const existing = dataset.metrics.ebitda_margin;
  if (existing.value !== null) return existing;
  const profit = dataset.metrics.ebitda, revenue = dataset.metrics.revenue;
  const value = revenue.value > 0 ? ratioValue(profit.value, revenue.value) : null;
  const available = value !== null && profit.completeness === 'complete' && revenue.completeness === 'complete' && revenue.value > 0;
  return {
    ...existing, value: available ? value : null,
    inputProvenance: available ? [...profit.provenance, ...revenue.provenance] : [],
    completeness: available ? 'complete' : 'unavailable',
    provenance: available ? [...profit.provenance, ...revenue.provenance].map((source) => ({ ...source, semantic: 'DERIVED' })) : [],
    reason: available ? 'Derived EBITDA ÷ Revenue; retains the input EBITDA basis. Operational inputs are not accounting Actual.' : 'EBITDA Margin needs complete EBITDA and positive Revenue.',
  };
}
export function metricMovement(current, previous) {
  const semantics = (metric) => [...new Set((metric.inputProvenance ?? metric.provenance).map((source) => source.semantic))].sort().join(',');
  if (current.value === null || previous.value === null || current.completeness !== 'complete' || previous.completeness !== 'complete') return { value: null, reason: 'Complete evidence is required in both periods.' };
  if (semantics(current) !== semantics(previous)) return { value: null, reason: 'The periods use different evidence semantics.' };
  const value = current.value - previous.value;
  return { value: Number.isFinite(value) ? value : null, reason: Number.isFinite(value) ? null : 'Movement exceeds the supported range.' };
}
export function revenueGrowth(current, previous) {
  const movement = metricMovement(current, previous);
  const value = movement.value !== null && previous.value > 0 ? ratioValue(movement.value, previous.value) : null;
  return { value, reason: movement.reason ?? (previous.value > 0 ? value === null ? 'Revenue growth exceeds the supported range.' : null : 'Revenue growth needs positive comparison Revenue.') };
}

/** Compatible input bases only; Derived diagnostics retain their original evidence semantics. */
export function compatibleMetricBasis(...metrics) {
  const basis = (metric) => [...new Set((metric.inputProvenance ?? metric.provenance ?? []).map((source) => source.semantic))].sort().join(',');
  return metrics.length > 0 && metrics.every((metric) => basis(metric) && basis(metric) === basis(metrics[0]) && !basis(metric).includes(','));
}
export function diagnosticRatio(amount, revenue, existing) {
  if (existing?.value !== null && existing?.value !== undefined) return existing;
  const available = amount.completeness === 'complete' && revenue.completeness === 'complete' && revenue.value > 0 && compatibleMetricBasis(amount, revenue);
  const value = available ? ratioValue(amount.value, revenue.value) : null;
  const inputProvenance = value !== null ? [...amount.provenance, ...revenue.provenance] : [];
  return { ...(existing ?? amount), unit: 'percent', value, completeness: value !== null ? 'complete' : 'unavailable',
    inputProvenance, provenance: inputProvenance.map((source) => ({ ...source, semantic: 'DERIVED' })),
    reason: value !== null ? 'Derived share of complete positive Revenue; retains the input cost basis.' : 'A cost ratio needs complete cost evidence, positive Revenue and compatible evidence semantics.' };
}
export function costGrowth(current, previous) {
  const movement = metricMovement(current, previous);
  const value = movement.value !== null && previous.value > 0 ? ratioValue(movement.value, previous.value) : null;
  return { value, reason: movement.reason ?? (value === null ? 'Cost growth needs positive comparison cost.' : null) };
}
