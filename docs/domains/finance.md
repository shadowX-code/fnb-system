# Finance

## Ownership And Phase 1 Boundary

Finance is the canonical Admin workspace for financial statements, analysis, intelligence and future planning. Its primary Finance navigation is Overview, Analysis, Costs, Cash, Planning and Statements; secondary Manage contains Data Sources at `/finance/data-sources`. Cash and Planning intentionally expose foundation states, not completed future products. Restaurant retains operational financial input, purchasing and the existing Reporting authority described in `restaurant-finance-and-purchasing.md`.

Phase 1 introduces read/adapter contracts and executable validation policy under `src/features/finance/`; it introduces no persistent accounting ledger, credential storage, ingestion mutation or provider integration. People `legal_entities`, existing outlets, suppliers, products and UOMs remain their canonical masters. Finance contracts reference their IDs. Group and provider dimension bindings are financial context, not a second outlet master. A provider tenant must bind to a legal entity; a provider location is a financial dimension and may represent an outlet, central kitchen, warehouse, corporate unit or department.

## Canonical Contracts And Provider Boundary

`contracts.ts` defines periods, scopes, connections, capability states, accounts, financial dimensions, effective-dated mappings, transactions/lines, settlements, balance snapshots, sync/reconciliation state, metric results and statement results. These are adapter contracts, not an instruction to mechanically create tables. Account/source identity is separate from financial classification. Supplier/product/UOM/outlet mapping refers to existing master owners and pins mapping versions in transaction evidence. Provider connection, tenant and entity identity are separate.

`foundation.js` owns inclusive calendar-period validation, capabilities, classification hierarchy, historical authority query planning and append-only evidence reference policy. Capabilities explicitly include chart of accounts, transactions, journal lines, balances, dimensions, inventory valuation, P&L, Balance Sheet, Cash Flow, incremental sync and webhooks; each is supported, partial, unsupported or unverified. Undeclared capability is unverified, never implicitly supported.

`financeService.js` is the Overview boundary. Adapters return the same canonical dataset and are validated for scope, period, currency, finite values, completeness and per-value provenance. Statements may be supplied by validated provider reports or account balances; journal access is not assumed to be a complete GL. UI consumes canonical results and never vendor schemas or credentials.

Every value carries Actual, Operational, Derived or Forecast semantics, provider/connection/external/revision identity, demo status, observed time and evidence time. Observed time means read time; it does not prove source freshness. Unavailable evidence is null, including zero-denominator ratios. Reconciliation defaults to unverified. Forecast and analysis never silently replace accounting statement evidence.

## Metrics And Classifications

`metrics.js` owns the 17 metric definitions, unit/aggregation semantics and result construction: Revenue, COGS, COGS %, Gross Profit, Gross Margin, Labour, Labour %, Prime Cost, Prime Cost %, OPEX, OPEX %, EBITDA, EBITDA Margin, Cash, AP, AR and Working Capital. Results include scope, period, currency, source provenance, completeness, reason, previous-period comparison and optional sourced target. Cash/AP/AR are closing balances, not additive period flows. Working Capital requires current assets less current liabilities; it is not invented from cash + AR − AP.

Canonical accounting EBITDA excludes separately classified Labour and OPEX, with no double counting. The existing operational Reporting EBITDA has its established definition and is explicitly disclosed by its adapter. Real adapters must supply trusted calculated results. Demo arithmetic is centralized in the registry and only used by the development fixture; UI does not calculate business totals.

Classifications include Revenue; COGS (Food, Beverage, Packaging); Labour (Salary, Overtime, Statutory, Other); OPEX (Occupancy, Utilities, Marketing, Delivery, Repairs & Maintenance, Software, Professional Fees, Other); Assets; Liabilities; Equity. Financial account identity remains separate from these classifications.

## Historical Provider Authority

Authority periods bind legal entity + resource (statements, balances, transactions) + connection to inclusive effective dates. Overlapping periods for the same entity/resource are rejected, regardless of vendor. Queries spanning a provider switch are segmented across original connections; uncovered dates are explicit gaps. No automatic fallback to today's provider is permitted.

Evidence identity includes provider, connection, external ID and revision. The reference append policy deduplicates identical retries, rejects conflicting changes to a pinned revision and retains prior-provider records when new connections/revisions arrive. Corrections require append-only revisions/reversals. The policy is tested in memory; durable enforcement must be implemented in a trusted persistent ingestion authority before a real adapter is enabled. Provider disconnection must not delete historical evidence or prevent reads of retained snapshots.

## Data Sources Management

Data Sources is the canonical provider-agnostic management surface for connection, authority, capabilities, mapping, reconciliation and data health. The read-only projection in `dataSources.js` wraps existing connection, authority-period, sync and reconciliation contracts; it has no vendor schema, credential or mutation path. Phase 1 has no real accounting connection store, so the current read returns empty accounting collections and the established operational provider capabilities.

Connection presentation preserves legal-entity binding, active/historical status, effective resource periods, capabilities and available successful-sync timestamps. Sync time alone does not establish source freshness. Historical connections and their authority periods remain visible; deactivation must not imply deleting ingested history. Connect/manage/sync/deactivate controls are disabled future boundaries.

Authority distinguishes Accounting Actual, FeedX Operational, Derived and Forecast and displays original providers across historical resource periods. Readiness does not assume complete coverage merely because periods exist: a selected entity/resource/period is required for the existing authority planner to establish coverage or gaps. Mapping counts require assessed records for accounts, outlet/dimensions, suppliers and product/UOM, with source, scope and period context. Reconciliation comparisons require validated evidence and retain period, source, metric/balance, currency, difference and state. Empty collections mean not assessed or unavailable, never zero balances or inferred completeness. Data health reports these available facts and known blockers without a percentage.

## Overview And Fixture

Overview defaults to the existing, server-authorized `reportingService.getMonthlyScopeFinancialReport` read. Its Reporting adapter supports individual outlet and all authorized outlets, not invented legal-entity consolidation. Revenue, purchase-based COGS, recorded OPEX and established server EBITDA retain their existing values and Operational label. Labour, Prime Cost, accounting Gross Margin, cash/AP/AR and Working Capital remain unavailable until validated evidence exists. Comparisons independently read the prior month and retain missing values.

Development builds offer an explicitly labelled demo through the same adapter/read-validation boundary. The fixture uses two illustrative legal entities, three outlets and a non-outlet corporate dimension; it exercises revenue, COGS, labour, OPEX, EBITDA, balances and comparisons. It has no database writes. The demo selector/imports are guarded by `import.meta.env.DEV`; release builds must exclude fixture data and offer only live operational evidence. All fixture provenance is marked demo even when illustrating Actual semantics. Demo balances are partial capability evidence, not a complete Balance Sheet. Working Capital remains unavailable.

Overview exposes source semantics, source-evidence freshness and completeness alongside a Data Sources management link. A read timestamp is never reported as source freshness; absent timestamps remain unverified. Accounting sync belongs to Data Sources, not a generic Overview Refresh action. Failure retry only repeats the authorized read.

Overview uses financial-state hierarchy, a prominent EBITDA result, compact typography-led measures, a Profit Flow and progressive source/definition disclosure. Missing measures are visible, not zero or extrapolation. Finance statements is the convergence entry point: its P&L link opens the single existing Reports component/service for Monthly and Yearly/YTD reporting. Legacy Restaurant Reports and Outlet P&L remain functional. Balance Sheet and Cash Flow expose unavailable states until their authorities are validated. No duplicated P&L renderer or changed Reporting calculation is introduced.

## Analysis: Business Performance And Profit Drivers

Phase 2A replaces Analysis's foundation state with a read-only performance workspace at the existing `/finance/analysis` owner. It retains `reports.view`, authorized outlet scope and original Reporting calculations. Current and comparison periods are complete calendar-month request shapes; comparison must precede current. Presets cover previous month and the same month last year, with an explicit custom prior month. These requests do not imply an accounting month-close state.

`analysis.js` reads and validates both periods through the Phase 1 adapter boundary. Overall scope totals remain the provider's scope read, never sums of browser outlet rows. Outlet reads use only eligible caller-visible master identities and retain server permission/outlet checks. Reads are deduplicated and concurrency-bounded; failed outlet/history reads remain explicit and stale requests cannot replace a new selection.

The existing metric registry owns diagnostic subtraction, Revenue Growth and ratio arithmetic. Original canonical amounts and accounting metrics remain unchanged. The Analysis-only EBITDA Margin projection uses existing complete EBITDA and positive Revenue, carries Derived provenance plus original input provenance, and preserves the input EBITDA basis. It does not infer accounting Actual, accounting Gross Margin, Prime Cost or labour from operational reporting. Incomplete, missing, nonpositive-denominator, nonfinite and incompatible-semantic comparisons remain unavailable. Development fixtures exercise the same read/provenance boundary and are never enabled in release builds.

Profit Driver Explorer starts at canonical EBITDA movement. A provider may declare its supported driver relationship; signed contributions are displayed only if complete inputs tie to canonical EBITDA in both periods and their comparisons are compatible. The operational relationship uses Revenue minus purchase-based COGS minus recorded OPEX; separately classified Labour remains unavailable. Accounting illustration uses the registry's Revenue/COGS/Labour/OPEX relationship. Missing or unexplained relationships are unresolved, not residuals silently assigned to a driver. Attribution explains arithmetic movement, not business causation.

Outlet Performance Field plots Revenue Growth against EBITDA Margin for eligible outlets with sufficient evidence. Zero growth and zero margin define operating zones without assumed health targets; boundary values are explicit. All eligible outlets remain in the accessible selection table, including unpositioned or failed reads. Three monthly trajectory observations use the selected comparison lag, connecting only adjacent validated points; missing history is never bridged. Coincident points retain true coordinates. Non-outlet dimensions are not plotted as outlets.

`AnalysisContext.jsx` owns the reusable Explain / Compare / Break down interaction grammar. Metric, driver and outlet selection retain one analysis context, exposing definitions, completeness, provenance, period comparison and available outlet/input breakdowns inline near the selection. No chatbot or permanent generic insight sidebar is introduced. Deeper classifications and product, supplier, labour, cash, forecast, simulation and planning analysis remain unavailable. Cash and Planning retain their foundation states.

## Costs Intelligence

Phase 2B replaces the `/finance/costs` foundation with a read-only Costs workspace. `FinanceComparisonWorkspace.jsx` now owns the shared Analysis/Costs evidence mode, authorized outlet scope, current calendar month, prior-month/year/custom comparison, stable scope identity, cancellation and error recovery. Costs reads only the selected provider scope and comparison through the same validated Analysis boundary; it does not consolidate outlet rows or read deeper operational sources.

The registry adds COGS % and centralized diagnostic cost growth/Revenue-share arithmetic. Complete supplied ratios retain their provenance; diagnostic ratios require complete compatible cost and positive Revenue, retain original input provenance and carry Derived semantics. Missing, partial, nonpositive-denominator, mixed-semantic and incompatible-period diagnostics remain unavailable. Original provider amounts, EBITDA definitions and accounting statement authority remain unchanged; purchase-based COGS never becomes accounting COGS, and Gross Profit, Labour or Prime Cost are not reconstructed from operational inputs.

`costs.js` projects supplied cost evidence into amount movement, cost growth versus Revenue growth, current/prior Revenue shares and percentage-point movement. The movement treatment in `CostMovement.jsx` presents those relationships with progressive ratio/input-basis disclosure. Higher absolute spend is not inherently adverse: interpretation follows cost Revenue share, with less than 0.1pp described as broadly stable, not a financial target. Root movements rank by absolute Revenue-share movement, then amount movement when meaningful; unavailable movements remain explicit. Prime Cost is shown in the financial state but is not added again as an independent EBITDA driver.

The selectable Revenue → COGS → Gross Profit → Labour → OPEX → EBITDA flow preserves supplied amounts and Revenue-share context. Unavailable stages remain visible. Its declared provider basis explicitly preserves the existing operational Revenue − purchase-based COGS − OPEX relationship, with Labour not separately included. Signed cost contributions reuse Analysis's validated driver relationship and require compatible complete input bases that reconcile to supplied EBITDA in both periods. Unexplained residuals are not assigned to costs.

Datasets may optionally supply `classifications` as canonical money metric results using the existing child classification IDs. The adapter boundary validates IDs, duplicates, scope, period, currency, completeness, finite values, provenance and demo semantics. Account identity remains separate. Classified values are supplied evidence, never totals inferred by the browser. All canonical children must be present, complete, basis-compatible and sum to the supplied parent in both periods before child EBITDA contributions are exposed. Partial coverage retains individual values/comparisons with unavailable attribution. No child classifications are inferred from current operational Reporting.

Cost layer and classification selections retain one parent/child path and reuse `AnalysisContext.jsx` Explain / Compare / Break down actions, evidence disclosure and keyboard behavior. Costs supplies domain-specific explanations/comparisons/breakdowns through that common owner. Observations are deterministic financial descriptions, not causal claims or fixture-specific prose. Development-only classified illustrations exercise the same optional dataset contract without changing existing demo parent totals; release builds exclude the fixture provider and its classifications.

Supplier exposure/prices, labour operations, recipes, actual-versus-theoretical COGS, cash, forecasting, scenario/planning, Bukku and AI Copilot remain outside Phase 2B.

## Gates Before A Real Accounting Adapter

- Validate actual provider capabilities, statement/balance semantics, journal coverage, currencies, pagination, revisions and historical retrieval against evidence.
- Add trusted, credential-isolated persistent connection/ingestion authorities with RLS, permission/entity/outlet scope and audit; enforce authority overlap, immutable provenance and retry rules in the database.
- Validate legal-entity/tenant bindings, dimension/outlet mappings, account classifications and effective mapping versions; do not infer ownership from labels.
- Reconcile representative P&L/Balance Sheet/balance periods to authoritative provider reports, with explicit gaps, corrections and provider-switch continuity.
- Define Finance-specific grants if product access needs diverge from existing `reports.view`. Phase 1 reuses that grant and its server outlet scope; it grants no additional data access.

Bukku integration, secrets, forecasting, Profit Levers, scenario planning, supplier/labour/product intelligence and capital/dividend planning remain outside Phase 1, Phase 2A and Phase 2B.
