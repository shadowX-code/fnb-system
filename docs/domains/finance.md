# Finance

## Ownership And Phase 1 Boundary

Finance is the canonical Admin workspace for financial statements, analysis, intelligence and future planning. Its registered IA is Overview, Analysis, Costs, Cash, Planning and Statements. Analysis, Costs, Cash and Planning intentionally expose foundation states, not completed future products. Restaurant retains operational financial input, purchasing and the existing Reporting authority described in `restaurant-finance-and-purchasing.md`.

Phase 1 introduces read/adapter contracts and executable validation policy under `src/features/finance/`; it introduces no persistent accounting ledger, credential storage, ingestion mutation or provider integration. People `legal_entities`, existing outlets, suppliers, products and UOMs remain their canonical masters. Finance contracts reference their IDs. Group and provider dimension bindings are financial context, not a second outlet master. A provider tenant must bind to a legal entity; a provider location is a financial dimension and may represent an outlet, central kitchen, warehouse, corporate unit or department.

## Canonical Contracts And Provider Boundary

`contracts.ts` defines periods, scopes, connections, capability states, accounts, financial dimensions, effective-dated mappings, transactions/lines, settlements, balance snapshots, sync/reconciliation state, metric results and statement results. These are adapter contracts, not an instruction to mechanically create tables. Account/source identity is separate from financial classification. Supplier/product/UOM/outlet mapping refers to existing master owners and pins mapping versions in transaction evidence. Provider connection, tenant and entity identity are separate.

`foundation.js` owns inclusive calendar-period validation, capabilities, classification hierarchy, historical authority query planning and append-only evidence reference policy. Capabilities explicitly include chart of accounts, transactions, journal lines, balances, dimensions, inventory valuation, P&L, Balance Sheet, Cash Flow, incremental sync and webhooks; each is supported, partial, unsupported or unverified. Undeclared capability is unverified, never implicitly supported.

`financeService.js` is the Overview boundary. Adapters return the same canonical dataset and are validated for scope, period, currency, finite values, completeness and per-value provenance. Statements may be supplied by validated provider reports or account balances; journal access is not assumed to be a complete GL. UI consumes canonical results and never vendor schemas or credentials.

Every value carries Actual, Operational, Derived or Forecast semantics, provider/connection/external/revision identity, demo status, observed time and evidence time. Observed time means read time; it does not prove source freshness. Unavailable evidence is null, including zero-denominator ratios. Reconciliation defaults to unverified. Forecast and analysis never silently replace accounting statement evidence.

## Metrics And Classifications

`metrics.js` owns the 16 metric definitions, unit/aggregation semantics and result construction: Revenue, COGS, Gross Profit, Gross Margin, Labour, Labour %, Prime Cost, Prime Cost %, OPEX, OPEX %, EBITDA, EBITDA Margin, Cash, AP, AR and Working Capital. Results include scope, period, currency, source provenance, completeness, reason, previous-period comparison and optional sourced target. Cash/AP/AR are closing balances, not additive period flows. Working Capital requires current assets less current liabilities; it is not invented from cash + AR − AP.

Canonical accounting EBITDA excludes separately classified Labour and OPEX, with no double counting. The existing operational Reporting EBITDA has its established definition and is explicitly disclosed by its adapter. Real adapters must supply trusted calculated results. Demo arithmetic is centralized in the registry and only used by the development fixture; UI does not calculate business totals.

Classifications include Revenue; COGS (Food, Beverage, Packaging); Labour (Salary, Overtime, Statutory, Other); OPEX (Occupancy, Utilities, Marketing, Delivery, Repairs & Maintenance, Software, Professional Fees, Other); Assets; Liabilities; Equity. Financial account identity remains separate from these classifications.

## Historical Provider Authority

Authority periods bind legal entity + resource (statements, balances, transactions) + connection to inclusive effective dates. Overlapping periods for the same entity/resource are rejected, regardless of vendor. Queries spanning a provider switch are segmented across original connections; uncovered dates are explicit gaps. No automatic fallback to today's provider is permitted.

Evidence identity includes provider, connection, external ID and revision. The reference append policy deduplicates identical retries, rejects conflicting changes to a pinned revision and retains prior-provider records when new connections/revisions arrive. Corrections require append-only revisions/reversals. The policy is tested in memory; durable enforcement must be implemented in a trusted persistent ingestion authority before a real adapter is enabled. Provider disconnection must not delete historical evidence or prevent reads of retained snapshots.

## Overview And Fixture

Overview defaults to the existing, server-authorized `reportingService.getMonthlyScopeFinancialReport` read. Its Reporting adapter supports individual outlet and all authorized outlets, not invented legal-entity consolidation. Revenue, purchase-based COGS, recorded OPEX and established server EBITDA retain their existing values and Operational label. Labour, Prime Cost, accounting Gross Margin, cash/AP/AR and Working Capital remain unavailable until validated evidence exists. Comparisons independently read the prior month and retain missing values.

Development builds offer an explicitly labelled demo through the same adapter/read-validation boundary. The fixture uses two illustrative legal entities, three outlets and a non-outlet corporate dimension; it exercises revenue, COGS, labour, OPEX, EBITDA, balances and comparisons. It has no database writes. The demo selector/imports are guarded by `import.meta.env.DEV`; release builds must exclude fixture data and offer only live operational evidence. All fixture provenance is marked demo even when illustrating Actual semantics. Demo balances are partial capability evidence, not a complete Balance Sheet. Working Capital remains unavailable.

Overview uses financial-state hierarchy, a prominent EBITDA result, compact typography-led measures, a Profit Flow and progressive source/definition disclosure. Missing measures are visible, not zero or extrapolation. Finance statements is the convergence entry point: its P&L link opens the single existing Reports component/service for Monthly and Yearly/YTD reporting. Legacy Restaurant Reports and Outlet P&L remain functional. Balance Sheet and Cash Flow expose unavailable states until their authorities are validated. No duplicated P&L renderer or changed Reporting calculation is introduced.

## Gates Before A Real Accounting Adapter

- Validate actual provider capabilities, statement/balance semantics, journal coverage, currencies, pagination, revisions and historical retrieval against evidence.
- Add trusted, credential-isolated persistent connection/ingestion authorities with RLS, permission/entity/outlet scope and audit; enforce authority overlap, immutable provenance and retry rules in the database.
- Validate legal-entity/tenant bindings, dimension/outlet mappings, account classifications and effective mapping versions; do not infer ownership from labels.
- Reconcile representative P&L/Balance Sheet/balance periods to authoritative provider reports, with explicit gaps, corrections and provider-switch continuity.
- Define Finance-specific grants if product access needs diverge from existing `reports.view`. Phase 1 reuses that grant and its server outlet scope; it grants no additional data access.

Bukku integration, secrets, forecasting, Profit Levers, scenario planning, supplier/labour/product intelligence and capital/dividend planning are outside Phase 1.
