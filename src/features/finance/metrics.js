// Definitions describe canonical semantics; only adapters/trusted read authorities supply values.
const definitions = [
  ['revenue', 'Revenue', 'money', 'Recognized revenue', []],
  ['cogs', 'COGS', 'money', 'Cost of goods sold; valuation basis must be disclosed', []],
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
  for (const [id, numerator] of [['gross_margin', 'gross_profit'], ['labour_percent', 'labour'], ['prime_cost_percent', 'prime_cost'], ['opex_percent', 'opex'], ['ebitda_margin', 'ebitda']]) values[id] = values.revenue === 0 ? null : values[numerator] / values.revenue * 100;
  return values;
}
