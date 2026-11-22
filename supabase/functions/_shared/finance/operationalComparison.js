import { monthlyFinancialDataset } from './monthlyReporting.js';
import { analysisPair, outletPosition, profitMovement } from './periodAnalysis.js';

export const operationalDriverModel = { label: 'Operational EBITDA · purchase-based COGS; labour is not separately classified', drivers: ['revenue', 'cogs', 'opex'] };

export function operationalEvidence(financials, provenance) {
  return Object.fromEntries([['revenue', 'revenue'], ['cogs', 'purchaseBasedCogs'], ['opex', 'opex'], ['ebitda', 'netProfit']].map(([id, field]) => {
    const source = financials[field];
    const present = source.presence === 'present' && Number.isFinite(source.amount);
    const reasons = {
      cogs: 'Purchase-based COGS from Reporting; not inventory valuation',
      ebitda: 'Existing Reporting EBITDA: Revenue − purchase-based COGS − recorded OPEX. Labour is not separately classified.',
    };
    return [id, { value: present ? source.amount : null, completeness: present ? 'complete' : 'unavailable',
      provenance, reason: reasons[id] ?? 'Existing operational Reporting evidence' }];
  }));
}

// This projection is the same operational cost basis and performance field shown in Finance Analysis.
// The calling contract validates the outlet and requested periods before comparing either report.
export function compareOperationalReports(currentReport, comparisonReport) {
  function dataset(report) {
    const { financials } = monthlyFinancialDataset(report);
    const metrics = operationalEvidence(financials, [{ semantic: 'OPERATIONAL' }]);
    const unavailable = { value: null, completeness: 'unavailable', provenance: [] };
    return { metrics: { ...metrics, labour: unavailable, ebitda_margin: unavailable } };
  }
  const pair = analysisPair(dataset(currentReport), dataset(comparisonReport));
  const drivers = profitMovement(pair, operationalDriverModel);
  const position = outletPosition(pair);
  const { revenue, cogs, opex } = Object.fromEntries(drivers.rows.map(row => [row.id, row]));
  return {
    currency: 'MYR', current_period: currentReport.period, comparison_period: comparisonReport.period,
    revenue_change_myr: revenue.movement.value, purchase_based_cogs_change_myr: cogs.movement.value,
    recorded_opex_change_myr: opex.movement.value, ebitda_change_myr: drivers.total.value,
    revenue_growth_percent: position.x, ebitda_margin_percent: position.y, performance_zone: position.zone,
    ebitda_contributions_myr: drivers.attributable ? {
      revenue: revenue.contribution, purchase_based_cogs: cogs.contribution, recorded_opex: opex.contribution,
    } : null,
    attribution: drivers.attributable ? 'Signed arithmetic contributions to operational EBITDA. Business causes require separate evidence.' : drivers.reason,
  };
}
