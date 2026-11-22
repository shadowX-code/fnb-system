import { operationalEvidence, operationalDriverModel } from '../../../../supabase/functions/_shared/finance/operationalComparison.js';
import { reportingService } from '../../../services/reportingService.js';
import { capabilities, monthlyPeriod, validatePeriod } from '../foundation.js';
import { metricResults } from '../metrics.js';

// Existing RPC evidence remains the authority. No account ledger or legal-entity scope is inferred.
export const operationalProvider = {
  id: 'feedx_reporting',
  profitDriverModel: operationalDriverModel,
  capabilities: capabilities({ profit_loss_report: 'partial', account_balances: 'unsupported', balance_sheet_report: 'unsupported', cash_flow_report: 'unsupported', journal_lines: 'unsupported' }),
  async readOverview(request) {
    validatePeriod(request.period);
    if (!['outlet', 'authorized_outlets'].includes(request.scope.kind) || request.currency !== 'MYR' || (request.scope.kind === 'outlet' && !request.scope.id) || request.period.end !== monthlyPeriod(request.period.start.slice(0, 7)).end || !request.period.start.endsWith('-01')) throw new Error('Reporting supports authorized outlet scope in MYR');
    const [year, month] = request.period.start.split('-').map(Number);
    const dataset = await reportingService.getMonthlyScopeFinancialReport({ outletId: request.scope.kind === 'outlet' ? request.scope.id : null, year, month });
    const observedAt = new Date().toISOString();
    const provenance = [{ identity: { providerId: this.id, connectionId: 'feedx-authorized-reporting', externalId: `${request.scope.id ?? 'authorized-outlets'}:${request.period.start}`, revision: 'live-read' }, semantic: 'OPERATIONAL', demo: false, observedAt, evidenceAt: null }];
    const evidence = operationalEvidence(dataset.financials, provenance);
    return { ...request, metrics: metricResults(request, evidence), statements: [], capabilities: this.capabilities, sourceLabel: 'FeedX Reporting · operational management P&L', demo: false };
  },
};
