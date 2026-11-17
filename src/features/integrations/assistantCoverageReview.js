// Coverage evidence is separate from server-enforced AI access policy.
export const coverageLabels = {"full": "Full", "partial": "Partial", "shared": "Shared", "missing": "Not integrated", "blocked": "Not integrated", "not_applicable": "Not applicable"};
export const assistantCoverageReview = {
  "employees": {
    "classification": "partial",
    "available": "Authorized unique headcount and employment-status totals, filtered employee directory and effective-dated assignment details. Summary totals cover the requested human scope; directory pages contain at most 20 employees.",
    "missing": "Contacts, identity documents, compensation, bank details, disciplinary records and historical headcount reconstruction are not exposed. Employment status is not login access; HR raw classifications retain unspecified values.",
    "reads": ["read_employee_directory", "read_employee_assignment", "read_workforce_distribution"],
    "evidence": ["src/services/employeeService.js", "supabase/functions/_shared/people/employeeDirectory.js", "supabase/functions/_shared/people/employeeDirectoryRead.js"]
  },
  "hr_dashboard": {
    "classification": "partial",
    "available": "RLS-scoped complete workforce distributions and authorized payroll period/run statuses.",
    "missing": "Individual payroll amounts and unrestricted employee enumeration are intentionally excluded.",
    "reads": [
      "read_workforce_distribution",
      "read_payroll_run_status",
      "read_legal_entities",
      "read_employee_assignment"
    ],
    "evidence": [
      "src/features/hr/HrDashboardPage.jsx",
      "supabase/functions/_shared/people/platformReads.js",
      "supabase/functions/_shared/people/employmentRead.js",
      "supabase/functions/_shared/people/gapReads.js"
    ]
  },
  "platform_organizations": {
    "classification": "partial",
    "available": "Visible organization team roles, Brand assignments and access status.",
    "missing": "Only assignments visible through existing human organization/Brand authority; no machine grants or changes.",
    "reads": [
      "read_platform_team_access"
    ],
    "evidence": [
      "src/features/integrations/businessModuleProjection.js",
      "docs/architecture/platform.md",
      "supabase/functions/_shared/marketing/gapReads.js"
    ]
  },
  "platform_customers": {
    "classification": "partial",
    "available": "Brand-scoped customer directory, contact eligibility and aggregate subscription states.",
    "missing": "Private contacts, consent-history bodies and POS/customer-detail drilldowns are excluded.",
    "reads": [
      "read_brand_customer_directory"
    ],
    "evidence": [
      "src/features/marketing/MarketingCustomersView.jsx",
      "src/features/marketing/customerContact.js",
      "src/features/integrations/businessModuleProjection.js",
      "supabase/functions/_shared/marketing/gapReads.js"
    ]
  },
  "marketing_whatsapp_templates": {
    "classification": "blocked",
    "available": "Existing human template-management service, distinct from campaign/FAQ reads.",
    "missing": "The actual canonical template read decrypts provider credentials, verifies current WABA/generation and is limited to explicit Staging test/configuration authority. A general persisted template read does not exist. Reusing unrelated provider credentials or implying general template access is not authorized.",
    "reads": [],
    "evidence": [
      "supabase/functions/_shared/whatsappSignupHandler.ts"
    ]
  },
  "marketing_ads": {
    "classification": "partial",
    "available": "Exact-period stored paid-ad snapshots with scope, currency and observed timestamps.",
    "missing": "No provider refresh; missing snapshots remain unavailable. Large responses fail closed; at most five reports.",
    "reads": [
      "read_marketing_ads_evidence"
    ],
    "evidence": [
      "src/features/marketing/adsService.js:read",
      "supabase/functions/_shared/marketing/platformReads.js",
      "supabase/functions/_shared/marketing/gapReads.js"
    ]
  },
  "finance_cash": {
    "classification": "blocked",
    "available": "No verified Assistant cash-flow or account-balance evidence.",
    "missing": "Operational revenue and expenses do not establish liquidity, commitments or cash balances. Validated accounting evidence and its authorized AI read are required.",
    "reads": [],
    "evidence": [
      "src/features/finance/providers/operationalProvider.js",
      "src/features/finance/FinanceWorkspacePage.jsx"
    ]
  },
  "finance_planning": {
    "classification": "blocked",
    "available": "No authoritative forecasts or scenario outputs exist in the current planning surface.",
    "missing": "Forecasting, scenarios and capital allocation require a validated baseline, assumptions and approved model; monthly historical figures are not forecasts.",
    "reads": [],
    "evidence": [
      "src/features/finance/FinanceReadinessPages.jsx"
    ]
  },
  "finance_data_sources": {
    "classification": "partial",
    "available": "Owner-visible accounting source status, retry counts and synchronization freshness.",
    "missing": "No authority-period decisions, reconciliation details, credentials or source changes.",
    "reads": [
      "read_accounting_source_health"
    ],
    "evidence": [
      "src/features/finance/FinanceDataSourcesPage.jsx",
      "src/features/finance/dataSources.js",
      "supabase/functions/_shared/finance/gapReads.js"
    ]
  },
  "finance_statements": {
    "classification": "partial",
    "available": "Monthly operational management P&L, with Reporting completeness flags.",
    "missing": "Yearly/YTD statement assembly, statutory accounts, balance sheets and cash-flow statements are not provided. Purchase-based costs are not accounting COGS.",
    "reads": [
      "read_operational_financials"
    ],
    "evidence": [
      "src/features/finance/FinanceReadinessPages.jsx",
      "supabase/functions/_shared/finance/reportRead.js"
    ]
  },
  "guest_ai_overview": {
    "classification": "blocked",
    "available": "Guest AI owns an isolated prototype and local device/runtime state.",
    "missing": "No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence.",
    "reads": [],
    "evidence": [
      "src/features/guest-ai/pages/GuestAiWorkspacePages.jsx",
      "docs/domains/guest-ai.md"
    ]
  },
  "guest_ai_devices": {
    "classification": "blocked",
    "available": "Guest AI owns an isolated prototype and local device/runtime state.",
    "missing": "No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence.",
    "reads": [],
    "evidence": [
      "src/features/guest-ai/pages/GuestAiWorkspacePages.jsx",
      "docs/domains/guest-ai.md"
    ]
  },
  "guest_ai_interactions": {
    "classification": "blocked",
    "available": "Guest AI owns an isolated prototype and local device/runtime state.",
    "missing": "No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence.",
    "reads": [],
    "evidence": [
      "src/features/guest-ai/pages/GuestAiWorkspacePages.jsx",
      "docs/domains/guest-ai.md"
    ]
  },
  "guest_ai_studio": {
    "classification": "blocked",
    "available": "Guest AI owns an isolated prototype and local device/runtime state.",
    "missing": "No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence.",
    "reads": [],
    "evidence": [
      "src/features/guest-ai/pages/GuestAiWorkspacePages.jsx",
      "docs/domains/guest-ai.md"
    ]
  },
  "guest_ai_developer": {
    "classification": "blocked",
    "available": "Guest AI owns an isolated prototype and local device/runtime state.",
    "missing": "No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence.",
    "reads": [],
    "evidence": [
      "src/features/guest-ai/pages/GuestAiWorkspacePages.jsx",
      "docs/domains/guest-ai.md"
    ]
  },
  "sales-comparison": {
    "classification": "partial",
    "available": "Canonical monthly gross/net/deduction evidence for requested and prior years.",
    "missing": "Per-channel share/trend presentation is not returned; absent source records must not be treated as zero business activity.",
    "reads": [
      "read_sales_comparison",
      "read_sales_records"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/SalesComparisonPage.jsx",
      "supabase/functions/_shared/restaurant/catalogueReads.js",
      "supabase/functions/_shared/restaurant/gapReads.js"
    ]
  },
  "purchase-comparison": {
    "classification": "partial",
    "available": "Complete-source monthly purchase efficiency, previous-period values and variance percentages.",
    "missing": "Supplier/category drilldown remains in source records; purchase-based estimates are not accounting COGS.",
    "reads": [
      "read_purchase_comparison",
      "read_purchase_records"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/PurchaseComparisonPage.jsx",
      "supabase/functions/_shared/restaurant/catalogueReads.js",
      "supabase/functions/_shared/restaurant/gapReads.js"
    ]
  },
  "roles": {
    "classification": "partial",
    "available": "Role definitions, stored permission assignments and outlet assignments.",
    "missing": "Protected-role effective behavior remains canonical; stored assignments alone do not enumerate all effective rights.",
    "reads": [
      "read_role_directory"
    ],
    "evidence": [
      "src/services/roleService.js",
      "supabase/functions/_shared/people/gapReads.js"
    ]
  },
  "recipe_intelligence": {
    "classification": "partial",
    "available": "Saved recipe quantities, units, wastage allowance, serving size and catalogue metadata.",
    "missing": "Authoritative full cost/yield analysis, product mapping and complete sales attribution remain unavailable; no inferred zero ingredient costs.",
    "reads": [
      "read_recipe_ingredients",
      "read_inventory_recipe_catalogue"
    ],
    "evidence": [
      "src/features/sales-purchase/inventory/recipeIntelligence/useRecipeIntelligenceRead.js",
      "supabase/functions/_shared/restaurant/catalogueReads.js",
      "supabase/functions/_shared/restaurant/gapReads.js"
    ]
  },
  "brands": {
    "classification": "partial",
    "available": "Human-authorized Brand identities, status and outlet assignments.",
    "missing": "Branding assets, audit bodies and configuration changes are excluded.",
    "reads": [
      "read_platform_brands"
    ],
    "evidence": [
      "src/services/brandService.js",
      "supabase/functions/_shared/marketing/gapReads.js"
    ]
  },
  "external_agents": {
    "classification": "not_applicable",
    "available": "AI Integrations is a management surface for Native Assistant policies and independent external-agent access.",
    "missing": "It is not an independent business-data read. External Agent identities, grants and MCP operations never become Native Assistant access.",
    "reads": [],
    "evidence": [
      "src/features/integrations/ExternalAgentsPage.jsx",
      "src/features/integrations/businessModuleProjection.js"
    ]
  },
  "alerts": {
    "classification": "partial",
    "available": "Canonical alert calculations over count-checked authorized sales/purchase records.",
    "missing": "Two-year source window; no persistent special-month annotation authority exists. Not a complete all-time risk assessment.",
    "reads": [
      "read_restaurant_alerts"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/AlertsInsightsPage.jsx",
      "src/features/sales-purchase/utils/analytics.js",
      "supabase/functions/_shared/restaurant/gapReads.js"
    ]
  },
  "data-health": {
    "classification": "partial",
    "available": "Shared canonical source-check warnings, channel completeness and scores.",
    "missing": "No financial month closing authority; special-month annotations excluded. Underlying source permissions remain independently required.",
    "reads": [
      "read_restaurant_data_health"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/DataHealthPage.jsx",
      "supabase/functions/_shared/restaurant/gapReads.js"
    ]
  },
  "audit-logs": {
    "classification": "partial",
    "available": "RLS-scoped event action, module, actor label and timestamp.",
    "missing": "Sensitive before/after bodies, descriptions, arbitrary metadata, IP and device data are excluded.",
    "reads": [
      "read_audit_event_metadata"
    ],
    "evidence": [
      "src/services/auditLogService.js",
      "src/features/factory/pages/FactoryAuditTrailPage.jsx",
      "supabase/functions/_shared/people/gapReads.js"
    ]
  },
  "factory_dashboard": {
    "classification": "partial",
    "available": "Dated scheduled/released/in-progress/completed pipeline and canonical status totals.",
    "missing": "No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics.",
    "reads": [
      "read_factory_operational_pipeline",
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_production_planning": {
    "classification": "partial",
    "available": "Dated scheduled/released/in-progress/completed pipeline and canonical status totals.",
    "missing": "No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics.",
    "reads": [
      "read_factory_operational_pipeline",
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_job_orders": {
    "classification": "partial",
    "available": "Dated scheduled/released/in-progress/completed pipeline and canonical status totals.",
    "missing": "No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics.",
    "reads": [
      "read_factory_operational_pipeline",
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_batch_traceability": {
    "classification": "partial",
    "available": "Canonical finished-good batch source allocations, raw receiving lineage and approved stock adjustments.",
    "missing": "Downstream dispatch/customer lineage is not supplied by this source-detail contract.",
    "reads": [
      "read_factory_batch_lineage"
    ],
    "evidence": [
      "src/services/factoryService.js:getFinishedGoodBatchTraceabilityDetail",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_mesti_health_declaration": {
    "classification": "partial",
    "available": "Declaration workflow register with entry decision, work action and review timestamps.",
    "missing": "Medical answers, symptoms, employee/visitor identity, contacts, notes and signatures are intentionally excluded.",
    "reads": [
      "read_factory_health_register"
    ],
    "evidence": [
      "src/services/factoryService.js",
      "docs/domains/factory-master-data.md",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_mesti_operator_hygiene": {
    "classification": "partial",
    "available": "Monthly inspection entry and verification states with source timestamps.",
    "missing": "Personnel identity, detailed hygiene/health findings, notes and signatures are intentionally excluded.",
    "reads": [
      "read_factory_hygiene_register"
    ],
    "evidence": [
      "src/services/factoryService.js",
      "docs/domains/factory-master-data.md",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "factory_audit_logs": {
    "classification": "partial",
    "available": "Canonical event metadata, actor label, business reference, result and timestamp.",
    "missing": "Sensitive before/after bodies, descriptions, actor email, IP and device data are excluded.",
    "reads": [
      "read_factory_audit_events"
    ],
    "evidence": [
      "src/services/auditLogService.js",
      "src/features/factory/pages/FactoryAuditTrailPage.jsx",
      "supabase/functions/_shared/factory/gapReads.js"
    ]
  },
  "crew_dashboard": {
    "classification": "partial",
    "available": "Canonical daily brief, permission-filtered summaries, attention, upcoming events, Crew and task state.",
    "missing": "Lists are bounded; no missing-instance creation or hidden domain authority is inferred.",
    "reads": [
      "read_crew_daily_brief"
    ],
    "evidence": [
      "src/services/crewService.js:dashboardAdminData",
      "supabase/migrations/20260922003000_crew_dashboard_operational_detail.sql",
      "supabase/migrations/20260921234500_crew_dashboard_30_day_upcoming.sql",
      "supabase/functions/_shared/crew/platformReads.js",
      "supabase/functions/_shared/crew/gapReads.js"
    ]
  },
  "crew_operations": {
    "classification": "partial",
    "available": "Canonical recorded task definitions/review queue without maintenance writes.",
    "missing": "Missing instances are not materialized; stored lifecycle states are not refreshed by a read. Missing records cannot establish no work is due.",
    "reads": [
      "read_crew_task_snapshot"
    ],
    "evidence": [
      "src/services/crewService.js:tasksAdminPage",
      "supabase/migrations/20260920110000_crew_tasks_admin_page_next_run.sql",
      "supabase/functions/_shared/crew/gapReads.js"
    ]
  },
  "crew_learning": {
    "classification": "partial",
    "available": "Onboarding curriculum versions and recorded progress plus published SOP text.",
    "missing": "No automatic enrollment, Crew impersonation, quiz answers or signed media access; absent assignments remain absent.",
    "reads": [
      "read_crew_onboarding_catalogue",
      "read_crew_onboarding_progress",
      "read_crew_sop_catalogue",
      "read_crew_published_sop"
    ],
    "evidence": [
      "src/services/crewService.js:learningHome/learningAssignment",
      "supabase/functions/_shared/crew/platformReads.js",
      "docs/domains/crew-learning.md",
      "supabase/functions/_shared/crew/gapReads.js"
    ]
  },
  "crew_performance": {
    "classification": "partial",
    "available": "Canonical recorded performance scores/status with employment/outlet revalidation.",
    "missing": "No recalculation or refresh; private review notes excluded. Unrecorded scores are unavailable, not zero.",
    "reads": [
      "read_crew_performance_snapshot"
    ],
    "evidence": [
      "src/services/crewService.js:performanceAdminData",
      "supabase/migrations/20260901132039_crew_performance_progressive_current_score.sql",
      "supabase/functions/_shared/crew/gapReads.js"
    ]
  },
  "crew_google_reviews": {
    "classification": "blocked",
    "available": "Canonical context reports pending provider allowlisting, not verified review metrics.",
    "missing": "No authoritative provider review evidence is returned. Customer feedback and team reviews cannot substitute for Google review counts or settlement.",
    "reads": [],
    "evidence": [
      "supabase/migrations/20261102131640_crew_customer_automatic_settlement.sql"
    ]
  },
  "ai_assistant": {
    "classification": "not_applicable",
    "available": "Private conversation, History and Memory use the existing session authority.",
    "missing": "Do not add an Assistant tool that recursively reads all conversations. Existing owner-scoped history and explicit recall remain the authority.",
    "reads": [],
    "evidence": [
      "src/features/ai-assistant/nativeAssistantService.js",
      "docs/architecture/trusted-authorities.md"
    ]
  },
  "operations_network": {
    "classification": "not_applicable",
    "available": "The network visualizes existing authorized structural and execution evidence.",
    "missing": "A visual relationship is not business READ authority. Use each registered domain operation; no independent network-to-business access is implied.",
    "reads": [],
    "evidence": [
      "src/features/operations-network/OperationsNetworkPage.jsx",
      "docs/architecture/platform.md"
    ]
  }
};
