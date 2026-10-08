import { capabilities, financialClassifications, validatePeriod } from '../foundation.js';
import { metricResults, calculateDemoMetrics, calculateDemoCashInputs } from '../metrics.js';

export const fixtureScopes = Object.freeze([
  { value: 'group:demo-group', label: 'Demo Group · 2 legal entities', kind: 'group', id: 'demo-group' },
  { value: 'legal_entity:demo-entity-a', label: 'Demo Dining Sdn Bhd · 2 outlets', kind: 'legal_entity', id: 'demo-entity-a' },
  { value: 'legal_entity:demo-entity-b', label: 'Demo Coffee Sdn Bhd · 1 outlet', kind: 'legal_entity', id: 'demo-entity-b' },
  { value: 'outlet:demo-kl', label: 'Demo · Kuala Lumpur', kind: 'outlet', id: 'demo-kl', legalEntityId: 'demo-entity-a' },
  { value: 'outlet:demo-pj', label: 'Demo · Petaling Jaya', kind: 'outlet', id: 'demo-pj', legalEntityId: 'demo-entity-a' },
  { value: 'outlet:demo-coffee', label: 'Demo · Coffee House', kind: 'outlet', id: 'demo-coffee', legalEntityId: 'demo-entity-b' },
  { value: 'dimension:demo-corporate', label: 'Demo · Corporate (non-outlet)', kind: 'dimension', id: 'demo-corporate', legalEntityId: 'demo-entity-a' },
]);
const rows = [
  { outlet: 'demo-kl', entity: 'demo-entity-a', revenue: 246000, cogs: 77490, labour: 54120, opex: 37400, cash: 167000, ap: 34800, ar: 6200 },
  { outlet: 'demo-pj', entity: 'demo-entity-a', revenue: 184000, cogs: 60400, labour: 43200, opex: 30600, cash: 98000, ap: 26300, ar: 4100 },
  { outlet: 'demo-coffee', entity: 'demo-entity-b', revenue: 132000, cogs: 38280, labour: 29040, opex: 21100, cash: 76000, ap: 17900, ar: 2800 },
  { outlet: null, dimension: 'demo-corporate', entity: 'demo-entity-a', revenue: 0, cogs: 0, labour: 12000, opex: 8500, cash: 51000, ap: 4300, ar: 0 },
];
export function createFixtureProvider({ development = false } = {}) {
  if (!development) throw new Error('Financial demo is available only in development');
  const supported = capabilities({ account_balances: 'partial', financial_dimensions: 'supported', profit_loss_report: 'supported', chart_of_accounts: 'partial', transactions: 'unsupported', journal_lines: 'unsupported', inventory_valuation: 'supported', balance_sheet_report: 'unsupported', cash_flow_report: 'unsupported', incremental_sync: 'unsupported', webhooks: 'unsupported' });
  return {
    id: 'development_fixture', capabilities: supported,
    profitDriverModel: { label: 'Development illustration · Revenue − COGS − Labour − OPEX', drivers: ['revenue', 'cogs', 'labour', 'opex'] },
    async readOverview(request) {
      validatePeriod(request.period);
      if (request.currency !== 'MYR' || !fixtureScopes.some((scope) => scope.id === request.scope.id && scope.kind === request.scope.kind)) throw new Error('Unknown financial demo scope');
      const selected = rows.filter((row) => request.scope.kind === 'group' || (request.scope.kind === 'legal_entity' && row.entity === request.scope.id) || (request.scope.kind === 'outlet' && row.outlet === request.scope.id) || (request.scope.kind === 'dimension' && row.dimension === request.scope.id));
      // DEV-only seasonal history. Independent input profiles exercise real margin/cash variation;
      // derived amounts still come exclusively from the metric registry below.
      const month = Number(request.period.start.slice(5, 7)) - 1;
      const profiles = {
        revenue: [.88,.84,.93,.90,.96,1.02,.95,1.01,1,1.025,1.06,1.12],
        cogs: [.91,.88,.95,.94,.98,1.01,.99,1.03,1,1.025,1.045,1.09],
        labour: [.95,.94,.98,.97,1,1.02,1.01,1.015,1,1.025,1.035,1.06],
        opex: [.97,1.02,.96,1.01,.98,1.04,1.02,1.01,1,1.025,1.04,1.07],
        cash: [.79,.75,.86,.82,.88,.91,.85,.96,1,1.025,1.04,1.10],
      };
      const yearFactor = 1.04 ** (Number(request.period.start.slice(0, 4)) - 2026);
      const values = Object.fromEntries(['revenue', 'cogs', 'labour', 'opex', 'cash', 'ap', 'ar'].map(id =>
        [id, Math.round(selected.reduce((sum, row) => sum + row[id], 0) * (profiles[id] ?? profiles.revenue)[month] * yearFactor)]));
      Object.assign(values, calculateDemoMetrics(values), calculateDemoCashInputs(values));
      const provenance = selected.map((row) => ({ identity: { providerId: 'development_fixture', connectionId: `demo-${row.entity}`, externalId: `${row.outlet ?? row.dimension}:${request.period.start}`, revision: '1' }, semantic: 'ACTUAL', demo: true, observedAt: '2026-10-01T02:00:00Z', evidenceAt: `${request.period.end}T23:59:59Z` }));
      const derived = ['cogs_percent', 'gross_profit', 'prime_cost', 'ebitda', 'gross_margin', 'labour_percent', 'prime_cost_percent', 'opex_percent', 'ebitda_margin'];
      const evidence = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { value, completeness: 'complete', provenance: provenance.map((source) => ({ ...source, semantic: derived.includes(id) ? 'DERIVED' : 'ACTUAL' })), reason: 'Development demo evidence; not business records' }]));
      const metrics = metricResults(request, evidence);
      // Illustrative classified evidence lives only in this development provider. Parent totals stay unchanged.
      const classifications = ['cogs', 'labour', 'opex'].flatMap((parent) => {
        const children = financialClassifications.filter((entry) => entry.parentId === parent);
        const weights = children.map((_, index) => (children.length - index) * (index === 0 ? 1 + Number(request.period.start.slice(5, 7)) * .02 : 1));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let remaining = values[parent];
        return children.map((child, index) => {
          const value = index === children.length - 1 ? remaining : Math.round(values[parent] * weights[index] / totalWeight);
          remaining -= value;
          return { ...metrics[parent], id: child.id, value, reason: 'Development classified illustration; not business records' };
        });
      });
      const date = (offset) => new Date(Date.parse(request.period.end) + offset * 86400000).toISOString().slice(0, 10);
      const forecastSource = (externalId) => provenance.map((source) => ({ ...source, semantic: 'FORECAST', identity: { ...source.identity, externalId: `${source.identity.externalId}:${externalId}` } }));
      const liquiditySchedule = { scope: request.scope, currency: request.currency, asOf: request.period.end, horizon: { start: date(1), end: date(30) }, completeness: 'complete', provenance: forecastSource('coverage'), reason: 'Complete illustrative 30-day schedule; not business commitments.', events: [
        { id: 'supplier', date: date(5), label: 'Illustrative supplier commitment', direction: 'outflow', kind: 'supplier', amount: 30000 },
        { id: 'rent', date: date(5), label: 'Illustrative rent commitment', direction: 'outflow', kind: 'rent', amount: 12000 },
        { id: 'payroll', date: date(12), label: 'Illustrative payroll commitment', direction: 'outflow', kind: 'payroll', amount: 60000 },
        { id: 'collection', date: date(19), label: 'Illustrative scheduled collection', direction: 'inflow', kind: 'receivable', amount: 45000 },
        { id: 'tax', date: date(24), label: 'Illustrative tax commitment', direction: 'outflow', kind: 'tax', amount: 8000 },
        { id: 'debt', date: date(28), label: 'Illustrative debt payment', direction: 'outflow', kind: 'debt', amount: 6000 },
      ].map((event) => ({ ...event, completeness: 'complete', provenance: forecastSource(event.id), reason: 'Development illustration; not inferred from recognized expenses.' })) };
      return { ...request, metrics, classifications, liquiditySchedule, capabilities: supported, sourceLabel: 'Development demo · illustrative accounting evidence', demo: true, statements: [{ kind: 'profit_loss', provenance, scope: request.scope, period: request.period, currency: 'MYR', completeness: 'complete', reconciliation: { status: 'unverified', evidence: [], checkedAt: null }, lines: ['revenue', 'cogs', 'gross_profit', 'labour', 'opex', 'ebitda'].map((id) => ({ classificationId: ['revenue', 'cogs', 'labour', 'opex'].includes(id) ? id : null, label: id, amount: metrics[id].value })) }] };
    },
    async readStatement(request) {
      if (request.kind !== 'profit_loss') return null;
      return (await this.readOverview(request)).statements[0];
    },
  };
}
