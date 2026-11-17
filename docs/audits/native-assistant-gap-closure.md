# Native Assistant gap closure — 17 November 2026

Baseline adab6290. 109 READ / 2 unchanged draft ACTION contracts. 24 new READs default Disabled; existing policies are preserved. 116 of 128 modules have listed operations.

Coverage: {"partial":108,"shared":8,"blocked":9,"not_applicable":3}. Full coverage is not claimed merely because an operation exists. Shared means reuse of a listed operation, not blanket module authority. The reviewed 37 now comprise 25 partial, 9 not integrated, 3 not applicable.

## All 128 modules

| Module | Coverage | Operations | Remaining boundary |
|---|---|---|---|
| alerts | partial | read_restaurant_alerts | Two-year source window; no persistent special-month annotation authority exists. Not a complete all-time risk assessment. |
| dashboard | shared | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| outlet-pnl | shared | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| product_analytics | shared | read_reporting_product_sales | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| purchase-comparison | partial | read_purchase_comparison | Supplier/category drilldown remains in source records; purchase-based estimates are not accounting COGS. |
| reports | partial | read_reporting_product_sales | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| sp-dashboard | shared | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| sales-comparison | partial | read_sales_comparison | Per-channel share/trend presentation is not returned; absent source records must not be treated as zero business activity. |
| sales-channels | partial | read_sales_channels | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| sales-input | partial | read_sales_records | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| tax-settings | partial | read_outlet_tax_policy | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| purchase-input | partial | read_purchase_records | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| purchase-categories | partial | read_purchase_categories | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| suppliers | partial | read_supplier_directory | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| asset_tracking | partial | read_asset_catalogue | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| data-health | partial | read_restaurant_data_health | No financial month closing authority; special-month annotations excluded. Underlying source permissions remain independently required. |
| operating-expenses | partial | read_operating_expenses | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_dashboard | partial | read_inventory_stock_evidence | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_movements | partial | read_inventory_movements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_master | partial | read_inventory_items | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_par_levels | partial | read_inventory_par_levels | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_orders | partial | read_inventory_orders | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| recipe_intelligence | partial | read_recipe_ingredients | Authoritative full cost/yield analysis, product mapping and complete sales attribution remain unavailable; no inferred zero ingredient costs. |
| inventory_recipes | partial | read_inventory_recipe_catalogue | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_stock_check | partial | read_inventory_checks | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_groups | partial | read_inventory_check_groups | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| inventory_waste | partial | read_inventory_waste | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| outlets | partial | read_outlet_directory | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| hr_dashboard | partial | read_workforce_distribution, read_payroll_run_status | Individual payroll amounts and unrestricted employee enumeration are intentionally excluded. |
| employees | partial | read_employee_assignment | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| employee_employment_documents | partial | read_employment_document_status | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| employee_disciplinary | partial | read_employee_notice_status | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| payroll | partial | read_payroll_holiday_policy | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| recruitment | partial | read_recruitment_openings | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| departments | partial | read_departments | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| employment_contract_templates | partial | read_published_contract_templates | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| job-positions | partial | read_job_positions | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| legal-entities | partial | read_legal_entities | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| employee_compliance | partial | read_employee_compliance | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| finance_analysis | shared | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| finance_cash | blocked | None | Operational revenue and expenses do not establish liquidity, commitments or cash balances. Validated accounting evidence and its authorized AI read are required. |
| finance_costs | shared | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| finance_overview | partial | read_operational_financials | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| finance_planning | blocked | None | Forecasting, scenarios and capital allocation require a validated baseline, assumptions and approved model; monthly historical figures are not forecasts. |
| finance_statements | partial | read_operational_financials | Yearly/YTD statement assembly, statutory accounts, balance sheets and cash-flow statements are not provided. Purchase-based costs are not accounting COGS. |
| finance_data_sources | partial | read_accounting_source_health | No authority-period decisions, reconciliation details, credentials or source changes. |
| marketing_overview | partial | read_marketing_overview | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_calendar | partial | prepare_marketing_draft, prepare_marketing_caption, read_marketing_calendar | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_planner | partial | read_marketing_plan | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_media | partial | read_marketing_media | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_planning_insights | shared | read_marketing_plan | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_inbox | partial | read_marketing_inbox_metrics | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_whatsapp_workflows | partial | read_marketing_workflows | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_campaigns | partial | read_marketing_campaigns | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_audience | partial | read_marketing_audiences | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_whatsapp_chat | partial | read_marketing_whatsapp_metrics | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_whatsapp_templates | blocked | None | The actual canonical template read decrypts provider credentials, verifies current WABA/generation and is limited to explicit Staging test/configuration authority. A general persisted template read does not exist. Reusing unrelated provider credentials or implying general template access is not authorized. |
| marketing_creators | partial | read_marketing_creator_posts | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_ads | partial | read_marketing_ads_evidence | No provider refresh; missing snapshots remain unavailable. Large responses fail closed; at most five reports. |
| marketing_analytics | partial | read_marketing_social_performance | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_knowledge | partial | read_marketing_knowledge_sources | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_connections | partial | read_marketing_connection_health | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| marketing_faq | partial | read_marketing_usable_faq | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_label_management | partial | read_factory_label_configuration | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_batch_traceability | partial | read_factory_batch_lineage | Downstream dispatch/customer lineage is not supplied by this source-detail contract. |
| factory_dashboard | partial | read_factory_operational_pipeline | No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics. |
| factory_job_order_records | partial | read_factory_job_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_petty_cash | partial | read_factory_cash | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_product_feedback | partial | read_factory_feedback_campaigns | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_job_orders | partial | read_factory_operational_pipeline | No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics. |
| factory_production_planning | partial | read_factory_operational_pipeline | No due-job release or material allocation. Bounded stage rows do not include complete scheduling/readiness or all monthly dashboard analytics. |
| factory_production | partial | read_factory_production_records | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_production_reports | partial | read_factory_production_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_finished_goods | partial | read_factory_finished_goods | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_finished_goods_dispatch | partial | read_factory_dispatch_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_internal_transfer | partial | read_factory_transfers | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_product_movements | partial | read_factory_product_movements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_product_stock_check | partial | read_factory_product_checks | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_raw_inventory | partial | read_factory_raw_catalogue | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_raw_movements | partial | read_factory_raw_movements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_raw_receiving | partial | read_factory_receiving_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_raw_stock_check | partial | read_factory_raw_checks | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_calibration | partial | read_factory_calibration | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_cleaning | partial | read_factory_cleaning_methods | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_equipment_cleaning | partial | read_factory_equipment_cleaning_requirements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_finished_product_storage_control | partial | read_factory_storage_control | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_food_processing_control | partial | read_factory_processing_control | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_health_declaration | partial | read_factory_health_register | Medical answers, symptoms, employee/visitor identity, contacts, notes and signatures are intentionally excluded. |
| factory_mesti_operator_hygiene | partial | read_factory_hygiene_register | Personnel identity, detailed hygiene/health findings, notes and signatures are intentionally excluded. |
| factory_mesti_raw_material_control | partial | read_factory_raw_control_standards, read_factory_raw_control_evidence | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_mesti_waste_disposal | partial | read_factory_waste_disposal | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_equipment | partial | read_factory_equipment | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_product_recipes | partial | read_factory_recipe_versions | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_production_sop | partial | read_factory_sop_versions | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_audit_logs | partial | read_factory_audit_events | Sensitive before/after bodies, descriptions, actor email, IP and device data are excluded. |
| factory_customers | partial | read_factory_customers | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_storage_locations | partial | read_factory_locations | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| factory_suppliers | partial | read_factory_suppliers | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_dashboard | partial | read_crew_daily_brief | Lists are bounded; no missing-instance creation or hidden domain authority is inferred. |
| crew_cash_checkout | partial | read_crew_cash_checkouts | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_cash_deposit | partial | read_crew_cash_ledger | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_operations | partial | read_crew_task_snapshot | Missing instances are not materialized; stored lifecycle states are not refreshed by a read. Missing records cannot establish no work is due. |
| crew_attendance | partial | read_crew_attendance | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_roster | partial | read_crew_roster | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_employees | partial | read_crew_access_status | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_leave | partial | read_crew_leave | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_learning | partial | read_crew_onboarding_progress, read_crew_onboarding_catalogue | No automatic enrollment, Crew impersonation, quiz answers or signed media access; absent assignments remain absent. |
| crew_sop_library | partial | read_crew_sop_catalogue, read_crew_published_sop | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_growth | partial | read_crew_skill_requirements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_growth_skills | shared | read_crew_skill_requirements | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_customer_feedback | partial | read_crew_feedback_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_google_reviews | blocked | None | No authoritative provider review evidence is returned. Customer feedback and team reviews cannot substitute for Google review counts or settlement. |
| crew_performance | partial | read_crew_performance_snapshot | No recalculation or refresh; private review notes excluded. Unrecorded scores are unavailable, not zero. |
| crew_team_review | partial | read_crew_team_review_summary | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| crew_reward | partial | read_crew_reward_cycles | Only listed operations and their stated scope are covered; no blanket module access or unlisted workflow is implied. |
| guest_ai_studio | blocked | None | No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence. |
| guest_ai_developer | blocked | None | No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence. |
| guest_ai_devices | blocked | None | No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence. |
| guest_ai_interactions | blocked | None | No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence. |
| guest_ai_overview | blocked | None | No approved Native Assistant cross-boundary read exists. Local serial snapshots and prototype interactions are not FeedX business evidence. |
| ai_assistant | not_applicable | None | Do not add an Assistant tool that recursively reads all conversations. Existing owner-scoped history and explicit recall remain the authority. |
| external_agents | not_applicable | None | It is not an independent business-data read. External Agent identities, grants and MCP operations never become Native Assistant access. |
| audit-logs | partial | read_audit_event_metadata | Sensitive before/after bodies, descriptions, arbitrary metadata, IP and device data are excluded. |
| brands | partial | read_platform_brands | Branding assets, audit bodies and configuration changes are excluded. |
| roles | partial | read_role_directory | Protected-role effective behavior remains canonical; stored assignments alone do not enumerate all effective rights. |
| platform_customers | partial | read_brand_customer_directory | Private contacts, consent-history bodies and POS/customer-detail drilldowns are excluded. |
| operations_network | not_applicable | None | A visual relationship is not business READ authority. Use each registered domain operation; no independent network-to-business access is implied. |
| platform_organizations | partial | read_platform_team_access | Only assignments visible through existing human organization/Brand authority; no machine grants or changes. |

## Read semantics

Crew's existing interactive services and new snapshots share one domain core. Existing calls retain maintenance; snapshots pass false and cannot enroll employees, create task instances or refresh scores. Their evidence explicitly describes recorded state. Restaurant calculations are extracted unchanged into shared domain code used by the existing pages and Assistant; complete count-checked RLS reads fail closed above 5,000 rows/source. Source permissions are checked separately. Special-month annotations are not sourced from mock data.

## Remaining 12 without operations

Five Guest AI surfaces retain the documented isolation boundary. Finance Cash has no approved cash/account-balance evidence; Finance Planning has no authoritative forecasts. WhatsApp template reads are provider-generation/test-authority gated, not a general persisted read. Google Reviews lacks authoritative provider metrics. AI Integrations, private Assistant History/Memory and Operations Network are not independent business-data authorities. No new machine credentials or grants were borrowed.

## Acceptance

77 server tests, 19 focused management tests and 21 Restaurant analytics regressions passed; Vite build passed. Missing monthly sales/purchase source rows produce null values with record counts, not fabricated zero business activity. Staging read-only transactions under the existing settings actor with SQL role authenticated executed HR/workforce/payroll, Crew snapshots, Brand/customer/Ads/team, Factory pipeline/batch/audit/health/hygiene sources. Empty onboarding/health/hygiene fixtures are recorded as empty, not fabricated successful business evidence. Twelve missing-user source calls returned 42501. Three cross-organization Marketing calls returned 42501. All 24 adapters have deterministic disconnected and human-denial tests, and outlet adapters deny failed scope checks before querying.

The existing all-outlet Owner scope permits nonexistent outlet IDs to return empty snapshots; that is not a limited-user scope-denial test. A physical limited-user authenticated denial remains a verification limitation unless an existing suitable actor can be exercised without changing permissions.

Authenticated canonical Staging browser verification: 128 modules, 82 previously enabled READs and 0 enabled ACTIONs. Batch Traceability shows Partial coverage, its missing downstream lineage, mandatory human permission and Disabled policy after refresh. Desktop viewport measured 1600×1000; mobile measured 400×800 with document scrollWidth 400. Search, drawer open/close and policy presentation passed. Evidence: `/private/tmp/feedx-gap-desktop.jpg` and `/private/tmp/feedx-gap-mobile.jpg`. The initial implementation deployment 62048a04 was READY; the delivery follow-up preserves missing monthly source records as unavailable. No paid model/audio calls or policy enablement performed. New adapters remain disabled, so source-RPC checks and authenticated management checks are not claims of live Assistant invocation of those adapters. Limited-user outlet denial and nonempty fixtures for currently empty onboarding/health/hygiene sources remain acceptance limitations.
