/** Finance read/adapter contracts. IDs reference existing master owners; no second master. */
export type SourceSemantic = 'ACTUAL' | 'OPERATIONAL' | 'DERIVED' | 'FORECAST';
export type CapabilityState = 'supported' | 'partial' | 'unsupported' | 'unverified';
export type Capability = 'chart_of_accounts' | 'transactions' | 'journal_lines' | 'account_balances' | 'financial_dimensions' | 'inventory_valuation' | 'profit_loss_report' | 'balance_sheet_report' | 'cash_flow_report' | 'incremental_sync' | 'webhooks';
export type Period = { start: string; end: string }; // inclusive ISO calendar dates
export type Scope = { kind: 'group' | 'legal_entity' | 'outlet' | 'dimension' | 'authorized_outlets'; id: string | null; legalEntityId?: string; groupId?: string };
export type SourceIdentity = { providerId: string; connectionId: string; externalId: string; revision: string };
export type Provenance = { identity: SourceIdentity; semantic: SourceSemantic; demo: boolean; observedAt: string | null; evidenceAt: string | null };
export type Connection = { id: string; providerId: string; legalEntityId: string; externalTenantId: string; currency: string; capabilities: Record<Capability, CapabilityState> };
export type AuthorityPeriod = Period & { legalEntityId: string; connectionId: string; resource: 'statements' | 'balances' | 'transactions' };
export type Account = { identity: SourceIdentity; legalEntityId: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'income' | 'expense' };
export type Dimension = { identity: SourceIdentity; legalEntityId: string; kind: 'outlet' | 'central_kitchen' | 'warehouse' | 'corporate' | 'department' | 'other'; outletId?: string; name: string };
export type Mapping = Period & { identity: SourceIdentity; legalEntityId: string; kind: 'account' | 'supplier' | 'product_uom' | 'outlet_dimension'; canonicalId: string; canonicalUomId?: string; version: string };
export type TransactionLine = { identity: SourceIdentity; accountIdentity: SourceIdentity; dimensionIdentities: SourceIdentity[]; debit: number; credit: number; currency: string; classificationId: string | null; mappingVersion: string | null; supplierId?: string; productId?: string; uomId?: string };
export type Transaction = { provenance: Provenance; legalEntityId: string; date: string; lines: TransactionLine[]; reversalOf?: SourceIdentity };
export type Settlement = { provenance: Provenance; transactionIdentity: SourceIdentity; date: string; amount: number; currency: string };
export type BalanceSnapshot = { provenance: Provenance; scope: Scope; accountIdentity: SourceIdentity; asOf: string; amount: number; currency: string };
export type SyncState = { connectionId: string; resource: Capability; cursor: string | null; lastSuccessAt: string | null; status: 'idle' | 'running' | 'failed'; errorCode?: string };
export type Completeness = 'complete' | 'partial' | 'unavailable' | 'unverified';
export type Reconciliation = { status: 'reconciled' | 'unreconciled' | 'unverified'; evidence: SourceIdentity[]; checkedAt: string | null };
export type MetricResult = { id: string; value: number | null; unit: 'money' | 'percent'; currency: string; scope: Scope; period: Period; provenance: Provenance[]; completeness: Completeness; reason: string | null; comparison: { value: number | null; period: Period; provenance: Provenance[]; completeness: Completeness } | null; target: { value: number; source: string } | null };
export type Statement = { kind: 'profit_loss' | 'balance_sheet' | 'cash_flow'; provenance: Provenance[]; scope: Scope; period: Period; currency: string; completeness: Completeness; reconciliation: Reconciliation; lines: { accountIdentity?: SourceIdentity; classificationId: string | null; label: string; amount: number | null }[] };
export type FinanceRequest = { scope: Scope; period: Period; currency: string };
export type FinanceDataset = FinanceRequest & { metrics: Record<string, MetricResult>; statements: Statement[]; capabilities: Record<Capability, CapabilityState>; sourceLabel: string; demo: boolean };
/** Adapters return validated canonical evidence, never credentials or raw vendor payloads. */
export interface AccountingProvider {
  id: string;
  capabilities: Record<Capability, CapabilityState>;
  readOverview(request: FinanceRequest): Promise<FinanceDataset>;
  readStatement?(request: FinanceRequest & { kind: Statement['kind'] }): Promise<Statement | null>;
}
