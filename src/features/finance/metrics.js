import { ratioValue } from '../../../supabase/functions/_shared/finance/metricComparisons.js';
export { analysisMargin, metricMovement, compatibleMetricBasis, ratioValue, revenueGrowth, costGrowth, diagnosticRatio } from '../../../supabase/functions/_shared/finance/metricComparisons.js';
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
  ['inventory', 'Inventory', 'money', 'Accounting inventory valuation at period end; operational stock is not a substitute', []],
  ['debt', 'Debt / Borrowings', 'money', 'Authoritative outstanding borrowings at period end', []],
  ['current_assets', 'Current Assets', 'money', 'Supplied complete current-assets total', []],
  ['current_liabilities', 'Current Liabilities', 'money', 'Supplied complete current-liabilities total', []],
  ['average_inventory', 'Average Inventory', 'money', 'Supplied period-average accounting inventory valuation', []],
  ['average_ar', 'Average Receivables', 'money', 'Supplied period-average trade receivables', []],
  ['average_ap', 'Average Payables', 'money', 'Supplied period-average trade payables', []],
  ['credit_sales', 'Credit Sales', 'money', 'Supplied credit sales for the selected period', []],
  ['credit_purchases', 'Credit Purchases', 'money', 'Supplied credit purchases for the selected period', []],
  ['daily_operating_cash_outflow', 'Daily Operating Cash Outflow', 'money', 'Supplied historical average daily operating cash payments; not recognized expenses', []],
  ['current_ratio', 'Current Ratio', 'ratio', 'Current Assets ÷ positive Current Liabilities', ['current_assets', 'current_liabilities']],
  ['inventory_days', 'Inventory Days', 'days', 'Average accounting Inventory ÷ accounting COGS × calendar days in the selected period', ['average_inventory', 'cogs']],
  ['ar_days', 'AR Days', 'days', 'Average Receivables ÷ Credit Sales × calendar days in the selected period; not invoice aging', ['average_ar', 'credit_sales']],
  ['ap_days', 'AP Days', 'days', 'Average Payables ÷ Credit Purchases × calendar days in the selected period; not overdue aging', ['average_ap', 'credit_purchases']],
  ['cash_coverage', 'Cash Coverage', 'days', 'Book Cash ÷ historical average Daily Operating Cash Outflow; historical coverage, not forecast runway', ['cash', 'daily_operating_cash_outflow']],
  ['operating_cash_flow', 'Operating Cash Generation', 'money', 'Supplied authoritative operating cash movement; EBITDA is not cash generation', []],
  ['financing_cash_flow', 'Financing Movement', 'money', 'Supplied authoritative financing cash movement', []],
  ['investing_cash_flow', 'Investing / CAPEX Movement', 'money', 'Supplied authoritative investing cash movement; not recognized depreciation', []],
  ['working_capital', 'Working Capital', 'money', 'Current assets − current liabilities; cash + AR − AP is insufficient', []],
];
export const metricRegistry = Object.freeze(Object.fromEntries(definitions.map(([id, label, unit, definition, dependencies]) => [id, Object.freeze({ id, label, unit, definition, dependencies: Object.freeze(dependencies), aggregation: ['cash', 'ap', 'ar', 'inventory', 'debt', 'current_assets', 'current_liabilities', 'working_capital'].includes(id) ? 'closing_balance' : ['average_inventory', 'average_ar', 'average_ap', 'daily_operating_cash_outflow'].includes(id) ? 'period_average' : ['percent', 'ratio', 'days'].includes(unit) ? 'ratio' : 'period_flow' })])));
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

/** Illustrative cash evidence only, consumed exclusively by the DEV provider. */
export function calculateDemoCashInputs(inputs) {
  const inventory = Math.round(inputs.cash * .18), debt = Math.round(inputs.cash * .12);
  const current_assets = inputs.cash + inputs.ar + inventory + 8000;
  const current_liabilities = inputs.ap + debt + 11000;
  return { inventory, debt, current_assets, current_liabilities, working_capital: current_assets - current_liabilities,
    average_inventory: inventory, average_ar: inputs.ar, average_ap: inputs.ap,
    credit_sales: 45000, credit_purchases: 32000, daily_operating_cash_outflow: 2800,
    operating_cash_flow: 18500, financing_cash_flow: -6000, investing_cash_flow: -4200 };
}
