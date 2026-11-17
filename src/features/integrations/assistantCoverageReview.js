// Presentation-only reconciliation of the 37 gaps at 7b8df5356. Never used for dispatch, grants or enabled counts.
export const coverageLabels = {"full": "Fully covered by verified shared capability", "partial": "Partially covered", "missing": "Missing authorized AI integration", "blocked": "Blocked by authority/data contract", "not_applicable": "Not applicable for independent AI integration"};
export const assistantCoverageReview = {
  "hr_dashboard": {
    "classification": "partial",
    "available": "Legal-entity names and linked employee counts; effective assignment for a known employee.",
    "missing": "Complete workforce distributions, company-wide employee enumeration and payroll-run status are not returned. Holiday policies are not payroll-run evidence.",
    "reads": [
      "read_legal_entities",
      "read_employee_assignment"
    ],
    "evidence": [
      "src/features/hr/HrDashboardPage.jsx",
      "supabase/functions/_shared/people/platformReads.js",
      "supabase/functions/_shared/people/employmentRead.js"
    ]
  },
  "platform_organizations": {
    "classification": "missing",
    "available": "Canonical Platform team/brand access management exists.",
    "missing": "Legal entities are employers, not security tenancy or membership. No sanitized Assistant tenancy/access-management read exists.",
    "reads": [],
    "evidence": [
      "src/features/integrations/businessModuleProjection.js",
      "docs/architecture/platform.md"
    ]
  },
  "platform_customers": {
    "classification": "missing",
    "available": "Customer master/contact ownership is separate from Factory customers and audience counts.",
    "missing": "No Assistant customer/contact read with verified consent, identity and brand scope exists. Audience metrics do not expose customer records.",
    "reads": [],
    "evidence": [
      "src/features/marketing/MarketingCustomersView.jsx",
      "src/features/marketing/customerContact.js",
      "src/features/integrations/businessModuleProjection.js"
    ]
  },
  "marketing_whatsapp_templates": {
    "classification": "missing",
    "available": "Existing human template-management service, distinct from campaign/FAQ reads.",
    "missing": "No Assistant template metadata read exists. Provider synchronization and template approval/activation cannot be inferred from campaigns or FAQs.",
    "reads": [],
    "evidence": [
      "src/features/marketing/marketingService.js:whatsappTemplates"
    ]
  },
  "marketing_ads": {
    "classification": "missing",
    "available": "Human Ads read service exists for brand-scoped provider reports.",
    "missing": "No verified Assistant Ads report projection exists. Organic social-performance evidence is not paid-ad spend, attribution or currency coverage.",
    "reads": [],
    "evidence": [
      "src/features/marketing/adsService.js:read",
      "supabase/functions/_shared/marketing/platformReads.js"
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
    "classification": "missing",
    "available": "The human management view has provider connections, mapping and reconciliation information.",
    "missing": "Operational monthly financial reads omit provider configuration, authority-period decisions and reconciliation state. A sanitized authorized management read is missing.",
    "reads": [],
    "evidence": [
      "src/features/finance/FinanceDataSourcesPage.jsx",
      "src/features/finance/dataSources.js"
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
    "available": "Recorded sales amounts by outlet and month, including channel identity, in bounded pages.",
    "missing": "Channel shares, tax-adjusted comparisons, complete trend windows and YoY/MoM calculations are not supplied by this read.",
    "reads": [
      "read_sales_records"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/SalesComparisonPage.jsx",
      "supabase/functions/_shared/restaurant/catalogueReads.js"
    ]
  },
  "purchase-comparison": {
    "classification": "partial",
    "available": "Recorded purchase amounts by outlet/month, supplier and category, in bounded pages.",
    "missing": "Complete comparison periods, supplier/category totals and variance calculations are not supplied. A page is not a complete monthly total.",
    "reads": [
      "read_purchase_records"
    ],
    "evidence": [
      "src/features/sales-purchase/pages/PurchaseComparisonPage.jsx",
      "supabase/functions/_shared/restaurant/catalogueReads.js"
    ]
  },
  "roles": {
    "classification": "missing",
    "available": "Canonical role/permission management exists.",
    "missing": "Per-operation authorization checks are not a role catalogue or permission-assignment report. A dedicated sanitized human-authorized read is missing.",
    "reads": [],
    "evidence": [
      "src/services/roleService.js"
    ]
  },
  "recipe_intelligence": {
    "classification": "partial",
    "available": "Recipe catalogue identity, status and serving-size metadata for an authorized outlet.",
    "missing": "Ingredient quantities, cost/yield calculations, product mappings and complete sales history needed for recipe intelligence are excluded.",
    "reads": [
      "read_inventory_recipe_catalogue"
    ],
    "evidence": [
      "src/features/sales-purchase/inventory/recipeIntelligence/useRecipeIntelligenceRead.js",
      "supabase/functions/_shared/restaurant/catalogueReads.js"
    ]
  },
  "brands": {
    "classification": "missing",
    "available": "Canonical Brand management read exists.",
    "missing": "Marketing brand-scoped output does not cover Brand ownership, outlet assignments or access configuration.",
    "reads": [],
    "evidence": [
      "src/services/brandService.js"
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
    "classification": "missing",
    "available": "The existing page derives alerts from loaded sales, purchases, suppliers and tax configuration.",
    "missing": "Raw records do not reproduce canonical alert type, severity, thresholds or full-period coverage. No authorized Assistant alert-result read exists.",
    "reads": [],
    "evidence": [
      "src/features/sales-purchase/pages/AlertsInsightsPage.jsx",
      "src/features/sales-purchase/utils/analytics.js"
    ]
  },
  "data-health": {
    "classification": "missing",
    "available": "The existing page calculates loaded-source checks and completeness.",
    "missing": "Reporting completeness and paged records are not equivalent to channel completeness, missing supplier/category checks or this page\u2019s risk classification.",
    "reads": [],
    "evidence": [
      "src/features/sales-purchase/pages/DataHealthPage.jsx"
    ]
  },
  "audit-logs": {
    "classification": "blocked",
    "available": "No sanitized Assistant audit-evidence read.",
    "missing": "Audit before/after payloads may expose cross-module sensitive data. Current business reads cannot substitute for actor, change and event evidence.",
    "reads": [],
    "evidence": [
      "src/services/auditLogService.js",
      "src/features/factory/pages/FactoryAuditTrailPage.jsx"
    ]
  },
  "factory_dashboard": {
    "classification": "partial",
    "available": "Existing job-order status totals and bounded production records.",
    "missing": "The operational-date pipeline, scheduling/readiness, material allocation and full dashboard metrics are not covered. The operational job-list wrapper releases due jobs and must not be reused as a read.",
    "reads": [
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js"
    ]
  },
  "factory_production_planning": {
    "classification": "partial",
    "available": "Existing job-order status totals and bounded production records.",
    "missing": "The operational-date pipeline, scheduling/readiness, material allocation and full dashboard metrics are not covered. The operational job-list wrapper releases due jobs and must not be reused as a read.",
    "reads": [
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js"
    ]
  },
  "factory_job_orders": {
    "classification": "partial",
    "available": "Existing job-order status totals and bounded production records.",
    "missing": "The operational-date pipeline, scheduling/readiness, material allocation and full dashboard metrics are not covered. The operational job-list wrapper releases due jobs and must not be reused as a read.",
    "reads": [
      "read_factory_job_summary",
      "read_factory_production_records"
    ],
    "evidence": [
      "src/services/factoryService.js:listOperationalJobOrders",
      "supabase/functions/_shared/factory/platformReads.js",
      "supabase/functions/_shared/factory/catalogueReads.js"
    ]
  },
  "factory_batch_traceability": {
    "classification": "missing",
    "available": "Human batch lineage/detail services exist.",
    "missing": "Production metadata and QC records do not establish linked receiving allocations, transformations or downstream dispatch lineage. A bounded authorized trace read is missing.",
    "reads": [],
    "evidence": [
      "src/services/factoryService.js:getFinishedGoodBatchTraceabilityDetail"
    ]
  },
  "factory_mesti_health_declaration": {
    "classification": "blocked",
    "available": "No authorized Assistant health or personnel-inspection projection.",
    "missing": "These records contain employee health/personnel information. Field-specific disclosure and document/signature boundaries must be verified; other QC reads are not equivalent.",
    "reads": [],
    "evidence": [
      "src/services/factoryService.js",
      "docs/domains/factory-master-data.md"
    ]
  },
  "factory_mesti_operator_hygiene": {
    "classification": "blocked",
    "available": "No authorized Assistant health or personnel-inspection projection.",
    "missing": "These records contain employee health/personnel information. Field-specific disclosure and document/signature boundaries must be verified; other QC reads are not equivalent.",
    "reads": [],
    "evidence": [
      "src/services/factoryService.js",
      "docs/domains/factory-master-data.md"
    ]
  },
  "factory_audit_logs": {
    "classification": "blocked",
    "available": "No sanitized Assistant audit-evidence read.",
    "missing": "Audit before/after payloads may expose cross-module sensitive data. Current business reads cannot substitute for actor, change and event evidence.",
    "reads": [],
    "evidence": [
      "src/services/auditLogService.js",
      "src/features/factory/pages/FactoryAuditTrailPage.jsx"
    ]
  },
  "crew_dashboard": {
    "classification": "partial",
    "available": "Authorized attendance, roster and leave records are available through their owning reads.",
    "missing": "The dashboard brief, joined today/upcoming timeline and task-attention projection are not exposed. Its current v3/v2 dashboard service is read-only; the earlier task-materialization blocker did not apply to this dashboard.",
    "reads": [
      "read_crew_attendance",
      "read_crew_roster",
      "read_crew_leave"
    ],
    "evidence": [
      "src/services/crewService.js:dashboardAdminData",
      "supabase/migrations/20260922003000_crew_dashboard_operational_detail.sql",
      "supabase/migrations/20260921234500_crew_dashboard_30_day_upcoming.sql",
      "supabase/functions/_shared/crew/platformReads.js"
    ]
  },
  "crew_operations": {
    "classification": "blocked",
    "available": "No mutation-free Assistant task lifecycle read.",
    "missing": "Task list authorities refresh/materialize lifecycle state. SOPs and roster records do not establish task execution or completion.",
    "reads": [],
    "evidence": [
      "src/services/crewService.js:tasksAdminPage",
      "supabase/migrations/20260920110000_crew_tasks_admin_page_next_run.sql"
    ]
  },
  "crew_learning": {
    "classification": "partial",
    "available": "Current published SOP catalogue and published SOP text within authorized outlet scope.",
    "missing": "Onboarding journeys, employee assignments, progress, quizzes and signed media retrieval are not covered. Admin reads cannot impersonate a Crew session.",
    "reads": [
      "read_crew_sop_catalogue",
      "read_crew_published_sop"
    ],
    "evidence": [
      "src/services/crewService.js:learningHome/learningAssignment",
      "supabase/functions/_shared/crew/platformReads.js",
      "docs/domains/crew-learning.md"
    ]
  },
  "crew_performance": {
    "classification": "blocked",
    "available": "No approved Assistant performance-score projection.",
    "missing": "Existing performance reads can refresh mutable scores. Team-review windows or feedback counts are not complete performance results.",
    "reads": [],
    "evidence": [
      "src/services/crewService.js:performanceAdminData",
      "supabase/migrations/20260901132039_crew_performance_progressive_current_score.sql"
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
