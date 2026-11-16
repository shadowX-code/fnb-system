# Native Assistant business inventory reconciliation

17 November 2026. Presentation-only projection; no registry, navigation, permissions, MCP or dispatcher mutations.

Before: 286 registry entries. After: 128 business/management modules; 12 aliases; 8 permission-only resources; 138 External Agent entries; 0 additional technical-only entries. All entries accounted for exactly once. Platform is an ownership group, not a new navigable workspace.

Evidence: config/modules.ts generates Agent entries from the Agent module/action/coverage JSON files. src/app/routeOwnership.js owns redirects; routes.jsx additionally documents Crew Progress and legacy Marketing CRM compatibility. docs/architecture/platform.md owns shared settings, Brands and customer identity. Non-routable HR document/disciplinary lifecycles and the Crew Deposit Ledger remain distinct. Factory Reports is not merged solely because agentNavigationOwner points to Production Overview.

Permission-only resources attach to verified owning modules; workspace-level Marketing/Guest AI grants have no single business-module owner and remain unlinked. No ownership is guessed. External bindings use canonical module IDs/actions and Factory resource bindings; they never count as Native Assistant connectivity.

Unresolved single-module mappings: factory_agent_mesti_review and factory_mesti_inspection are Factory-wide MeSTI authorities, not a verified single business module. They remain external and unlinked.

| Registry entry | Classification | Verified linked owner(s) | Display ownership |
|---|---|---|---|
| employee_disciplinary | business | employee_disciplinary | hr |
| employee_employment_documents | business | employee_employment_documents | hr |
| employment_contract_templates | business | employment_contract_templates | hr |
| crew_feedback_follow_up | permission | crew_customer_feedback | Linked metadata only |
| hr_dashboard | business | hr_dashboard | hr |
| marketing_workspace | permission | No single verified owner | Linked metadata only |
| platform_organizations | business | platform_organizations | platform |
| marketing_overview | business | marketing_overview | marketing |
| marketing_content | alias | marketing_calendar | Linked metadata only |
| marketing_planner | business | marketing_planner | marketing |
| marketing_planning_insights | business | marketing_planning_insights | marketing |
| marketing_calendar | business | marketing_calendar | marketing |
| marketing_media | business | marketing_media | marketing |
| marketing_inbox | business | marketing_inbox | marketing |
| platform_customers | business | platform_customers | platform |
| marketing_crm_legacy | alias | marketing_campaigns | Linked metadata only |
| marketing_audience | business | marketing_audience | marketing |
| marketing_whatsapp_chat | business | marketing_whatsapp_chat | marketing |
| marketing_whatsapp_templates | business | marketing_whatsapp_templates | marketing |
| marketing_campaigns | business | marketing_campaigns | marketing |
| marketing_whatsapp_workflows | business | marketing_whatsapp_workflows | marketing |
| marketing_creators | business | marketing_creators | marketing |
| marketing_analytics | business | marketing_analytics | marketing |
| marketing_ads | business | marketing_ads | marketing |
| marketing_settings | permission | No single verified owner | Linked metadata only |
| marketing_connections | business | marketing_connections | marketing |
| marketing_knowledge | business | marketing_knowledge | marketing |
| marketing_faq | business | marketing_faq | marketing |
| marketing_brand_access | alias | platform_organizations | Linked metadata only |
| finance_overview | business | finance_overview | finance |
| finance_analysis | business | finance_analysis | finance |
| finance_costs | business | finance_costs | finance |
| finance_cash | business | finance_cash | finance |
| finance_planning | business | finance_planning | finance |
| finance_data_sources | business | finance_data_sources | finance |
| finance_statements | business | finance_statements | finance |
| guest_ai | permission | No single verified owner | Linked metadata only |
| guest_ai_overview | business | guest_ai_overview | guest_ai |
| guest_ai_devices | business | guest_ai_devices | guest_ai |
| guest_ai_interactions | business | guest_ai_interactions | guest_ai |
| guest_ai_studio | business | guest_ai_studio | guest_ai |
| guest_ai_developer | business | guest_ai_developer | guest_ai |
| guest_ai_device_console | alias | guest_ai_developer | Linked metadata only |
| dashboard | business | dashboard | restaurant |
| outlet-pnl | business | outlet-pnl | restaurant |
| reports | business | reports | restaurant |
| sp-dashboard | business | sp-dashboard | restaurant |
| product_analytics | business | product_analytics | restaurant |
| sales-input | business | sales-input | restaurant |
| sales-comparison | business | sales-comparison | restaurant |
| sales-channels | business | sales-channels | restaurant |
| tax-settings | business | tax-settings | restaurant |
| purchase-input | business | purchase-input | restaurant |
| purchase-comparison | business | purchase-comparison | restaurant |
| suppliers | business | suppliers | restaurant |
| purchase-categories | business | purchase-categories | restaurant |
| employees | business | employees | hr |
| recruitment | business | recruitment | hr |
| legal-entities | business | legal-entities | hr |
| payroll | business | payroll | hr |
| employee_compliance | business | employee_compliance | hr |
| job-positions | business | job-positions | hr |
| departments | business | departments | hr |
| roles | business | roles | platform |
| operating-expenses | business | operating-expenses | restaurant |
| duty-roster | alias | crew_roster | Linked metadata only |
| asset_tracking | business | asset_tracking | restaurant |
| inventory_dashboard | business | inventory_dashboard | restaurant |
| inventory_master | business | inventory_master | restaurant |
| inventory_categories | permission | inventory_master | Linked metadata only |
| inventory_uoms | permission | inventory_master | Linked metadata only |
| inventory_par_levels | business | inventory_par_levels | restaurant |
| inventory_groups | business | inventory_groups | restaurant |
| inventory_stock_check | business | inventory_stock_check | restaurant |
| inventory_orders | business | inventory_orders | restaurant |
| inventory_movements | business | inventory_movements | restaurant |
| inventory_waste | business | inventory_waste | restaurant |
| inventory_recipes | business | inventory_recipes | restaurant |
| recipe_intelligence | business | recipe_intelligence | restaurant |
| brands | business | brands | platform |
| external_agents | business | external_agents | platform |
| outlets | business | outlets | restaurant |
| alerts | business | alerts | restaurant |
| outlet_duty_roster | alias | crew_roster | Linked metadata only |
| data-health | business | data-health | restaurant |
| audit-logs | business | audit-logs | platform |
| factory_dashboard | business | factory_dashboard | factory |
| factory_production_planning | business | factory_production_planning | factory |
| factory_job_orders | business | factory_job_orders | factory |
| factory_job_order_records | business | factory_job_order_records | factory |
| factory_production | business | factory_production | factory |
| factory_production_reports | business | factory_production_reports | factory |
| factory_batch_traceability | business | factory_batch_traceability | factory |
| factory_finished_goods | business | factory_finished_goods | factory |
| factory_finished_goods_dispatch | business | factory_finished_goods_dispatch | factory |
| factory_product_movements | business | factory_product_movements | factory |
| factory_product_stock_check | business | factory_product_stock_check | factory |
| factory_internal_transfer | business | factory_internal_transfer | factory |
| factory_raw_receiving | business | factory_raw_receiving | factory |
| factory_raw_inventory | business | factory_raw_inventory | factory |
| factory_raw_movements | business | factory_raw_movements | factory |
| factory_raw_stock_check | business | factory_raw_stock_check | factory |
| factory_mesti_cleaning | business | factory_mesti_cleaning | factory |
| factory_mesti_equipment_cleaning | business | factory_mesti_equipment_cleaning | factory |
| factory_mesti_calibration | business | factory_mesti_calibration | factory |
| factory_mesti_finished_product_storage_control | business | factory_mesti_finished_product_storage_control | factory |
| factory_mesti_health_declaration | business | factory_mesti_health_declaration | factory |
| hr_agent_nav_hr_dashboard | external | hr_dashboard | Linked metadata only |
| hr_agent_nav_employees | external | employees | Linked metadata only |
| hr_agent_nav_recruitment | external | recruitment | Linked metadata only |
| hr_agent_nav_payroll | external | payroll | Linked metadata only |
| hr_agent_nav_legal_entities | external | legal-entities | Linked metadata only |
| hr_agent_nav_departments | external | departments | Linked metadata only |
| hr_agent_nav_job_positions | external | job-positions | Linked metadata only |
| hr_agent_nav_employee_compliance | external | employee_compliance | Linked metadata only |
| hr_agent_action_hr_employment | external | employees | Linked metadata only |
| hr_agent_action_hr_recruitment | external | recruitment | Linked metadata only |
| hr_agent_action_hr_payroll | external | payroll | Linked metadata only |
| hr_agent_action_hr_payroll_adjustment | external | payroll | Linked metadata only |
| hr_agent_action_hr_compliance | external | employee_compliance | Linked metadata only |
| hr_agent_action_hr_legal_entity | external | legal-entities | Linked metadata only |
| restaurant_agent_nav_outlet_pnl | external | outlet-pnl | Linked metadata only |
| restaurant_agent_nav_asset_tracking | external | asset_tracking | Linked metadata only |
| restaurant_agent_nav_inventory_master | external | inventory_master | Linked metadata only |
| restaurant_agent_nav_inventory_par_levels | external | inventory_par_levels | Linked metadata only |
| restaurant_agent_nav_inventory_stock_check | external | inventory_stock_check | Linked metadata only |
| restaurant_agent_nav_inventory_orders | external | inventory_orders | Linked metadata only |
| restaurant_agent_nav_inventory_movements | external | inventory_movements | Linked metadata only |
| restaurant_agent_nav_inventory_waste | external | inventory_waste | Linked metadata only |
| restaurant_agent_nav_inventory_recipes | external | inventory_recipes | Linked metadata only |
| restaurant_agent_action_restaurant_asset | external | asset_tracking | Linked metadata only |
| restaurant_agent_action_restaurant_inspection | external | asset_tracking | Linked metadata only |
| restaurant_agent_action_restaurant_maintenance | external | asset_tracking | Linked metadata only |
| restaurant_agent_action_restaurant_stock_check | external | inventory_stock_check | Linked metadata only |
| restaurant_agent_action_restaurant_purchase_order | external | inventory_orders | Linked metadata only |
| restaurant_agent_action_restaurant_movement | external | inventory_movements | Linked metadata only |
| restaurant_agent_action_restaurant_waste | external | inventory_waste | Linked metadata only |
| restaurant_agent_action_restaurant_recipe | external | inventory_recipes | Linked metadata only |
| factory_agent_action_job_order | external | factory_job_order_records | Linked metadata only |
| factory_agent_action_production | external | factory_production | Linked metadata only |
| factory_agent_action_receiving | external | factory_raw_receiving | Linked metadata only |
| factory_agent_action_product_stock_check | external | factory_product_stock_check | Linked metadata only |
| factory_agent_action_raw_stock_check | external | factory_raw_stock_check | Linked metadata only |
| factory_agent_action_area_cleaning | external | factory_mesti_cleaning | Linked metadata only |
| factory_agent_action_equipment_cleaning | external | factory_mesti_equipment_cleaning | Linked metadata only |
| factory_agent_action_calibration | external | factory_mesti_calibration | Linked metadata only |
| factory_agent_job_orders | external | factory_job_order_records | Linked metadata only |
| factory_agent_production_records | external | factory_job_orders, factory_production | Linked metadata only |
| factory_agent_execution_steps | external | factory_production | Linked metadata only |
| factory_agent_qc_results | external | factory_production | Linked metadata only |
| factory_agent_material_usage | external | factory_job_orders, factory_production | Linked metadata only |
| factory_agent_material_allocations | external | factory_batch_traceability | Linked metadata only |
| factory_agent_finished_goods | external | factory_finished_goods | Linked metadata only |
| factory_agent_finished_batches | external | factory_finished_goods | Linked metadata only |
| factory_agent_dispatches | external | factory_finished_goods_dispatch | Linked metadata only |
| factory_agent_dispatch_items | external | factory_finished_goods_dispatch | Linked metadata only |
| factory_agent_dispatch_allocations | external | factory_finished_goods_dispatch | Linked metadata only |
| factory_agent_product_movements | external | factory_job_orders, factory_product_movements | Linked metadata only |
| factory_agent_product_stock_checks | external | factory_product_stock_check | Linked metadata only |
| factory_agent_product_stock_counts | external | factory_product_stock_check | Linked metadata only |
| factory_agent_internal_transfers | external | factory_internal_transfer | Linked metadata only |
| factory_agent_transfer_items | external | factory_internal_transfer | Linked metadata only |
| factory_agent_raw_materials | external | factory_raw_inventory | Linked metadata only |
| factory_agent_raw_batches | external | factory_raw_inventory | Linked metadata only |
| factory_agent_receipts | external | factory_raw_receiving | Linked metadata only |
| factory_agent_receiving_items | external | factory_raw_receiving | Linked metadata only |
| factory_agent_raw_movements | external | factory_raw_movements | Linked metadata only |
| factory_agent_raw_stock_checks | external | factory_raw_stock_check | Linked metadata only |
| factory_agent_raw_stock_counts | external | factory_raw_stock_check | Linked metadata only |
| factory_agent_recipes | external | factory_product_recipes | Linked metadata only |
| factory_agent_recipe_ingredients | external | factory_product_recipes | Linked metadata only |
| factory_agent_production_sops | external | factory_production_sop | Linked metadata only |
| factory_agent_sop_steps | external | factory_production_sop | Linked metadata only |
| factory_agent_equipment | external | factory_equipment | Linked metadata only |
| factory_agent_locations | external | factory_storage_locations | Linked metadata only |
| factory_agent_suppliers | external | factory_suppliers | Linked metadata only |
| factory_agent_customers | external | factory_customers | Linked metadata only |
| factory_agent_product_families | external | factory_product_recipes | Linked metadata only |
| factory_agent_feedback_campaigns | external | factory_product_feedback | Linked metadata only |
| factory_agent_feedback_variants | external | factory_product_feedback | Linked metadata only |
| factory_agent_petty_cash | external | factory_petty_cash | Linked metadata only |
| factory_agent_petty_cash_categories | external | factory_petty_cash | Linked metadata only |
| factory_agent_raw_control_standards | external | factory_mesti_raw_material_control | Linked metadata only |
| factory_agent_raw_control_receipts | external | factory_mesti_raw_material_control | Linked metadata only |
| factory_agent_planning | external | factory_production_planning | Linked metadata only |
| factory_agent_dashboard | external | factory_dashboard | Linked metadata only |
| factory_agent_production_performance | external | factory_job_orders | Linked metadata only |
| factory_agent_traceability | external | factory_batch_traceability | Linked metadata only |
| factory_agent_feedback_counts | external | factory_product_feedback | Linked metadata only |
| factory_agent_audit_trail | external | factory_audit_logs | Linked metadata only |
| factory_agent_mesti_review | external | No single verified owner | Linked metadata only |
| factory_agent_requirements | external | factory_mesti_cleaning, factory_mesti_equipment_cleaning, factory_mesti_calibration, factory_mesti_waste_disposal | Linked metadata only |
| factory_agent_occurrences | external | factory_mesti_cleaning, factory_mesti_equipment_cleaning, factory_mesti_calibration, factory_mesti_finished_product_storage_control, factory_mesti_health_declaration, factory_mesti_operator_hygiene, factory_mesti_waste_disposal, factory_mesti_food_processing_control | Linked metadata only |
| factory_agent_statuses | external | factory_mesti_cleaning, factory_mesti_equipment_cleaning, factory_mesti_calibration, factory_mesti_finished_product_storage_control, factory_mesti_health_declaration, factory_mesti_operator_hygiene, factory_mesti_waste_disposal, factory_mesti_food_processing_control | Linked metadata only |
| factory_agent_schedules | external | factory_mesti_cleaning, factory_mesti_equipment_cleaning, factory_mesti_calibration, factory_mesti_finished_product_storage_control, factory_mesti_waste_disposal, factory_mesti_food_processing_control | Linked metadata only |
| factory_agent_evidence | external | factory_mesti_cleaning, factory_mesti_equipment_cleaning, factory_mesti_calibration, factory_mesti_finished_product_storage_control, factory_mesti_health_declaration, factory_mesti_operator_hygiene, factory_mesti_waste_disposal, factory_mesti_food_processing_control | Linked metadata only |
| factory_agent_production_pipeline | external | factory_job_orders | Linked metadata only |
| factory_agent_planning_open_orders | external | factory_production_planning | Linked metadata only |
| factory_agent_product_stock_adjustments | external | factory_product_stock_check | Linked metadata only |
| factory_agent_raw_stock_allocations | external | factory_raw_stock_check | Linked metadata only |
| factory_agent_receiving_costs | external | factory_job_orders, factory_raw_receiving | Linked metadata only |
| factory_agent_sop_substeps | external | factory_production_sop | Linked metadata only |
| factory_agent_sop_qc_checks | external | factory_production_sop | Linked metadata only |
| factory_agent_sop_equipment | external | factory_production_sop | Linked metadata only |
| factory_agent_raw_material_categories | external | factory_raw_inventory | Linked metadata only |
| factory_agent_product_tags | external | factory_product_recipes | Linked metadata only |
| factory_agent_sop_material_bindings | external | factory_production_sop | Linked metadata only |
| factory_agent_equipment_categories | external | factory_equipment | Linked metadata only |
| factory_agent_finished_good_categories | external | factory_finished_goods | Linked metadata only |
| factory_agent_production_qc_checkpoints | external | factory_production | Linked metadata only |
| factory_agent_supplier_material_links | external | factory_suppliers | Linked metadata only |
| factory_agent_nav_factory_dashboard | external | factory_dashboard | Linked metadata only |
| factory_agent_nav_factory_production_planning | external | factory_production_planning | Linked metadata only |
| factory_agent_nav_factory_job_orders | external | factory_job_orders | Linked metadata only |
| factory_agent_nav_factory_job_order_records | external | factory_job_order_records | Linked metadata only |
| factory_agent_nav_factory_production | external | factory_production | Linked metadata only |
| factory_agent_nav_factory_batch_traceability | external | factory_batch_traceability | Linked metadata only |
| factory_agent_nav_factory_product_feedback | external | factory_product_feedback | Linked metadata only |
| factory_agent_nav_factory_petty_cash | external | factory_petty_cash | Linked metadata only |
| factory_agent_nav_factory_finished_goods | external | factory_finished_goods | Linked metadata only |
| factory_agent_nav_factory_finished_goods_dispatch | external | factory_finished_goods_dispatch | Linked metadata only |
| factory_agent_nav_factory_product_movements | external | factory_product_movements | Linked metadata only |
| factory_agent_nav_factory_product_stock_check | external | factory_product_stock_check | Linked metadata only |
| factory_agent_nav_factory_internal_transfer | external | factory_internal_transfer | Linked metadata only |
| factory_agent_nav_factory_raw_receiving | external | factory_raw_receiving | Linked metadata only |
| factory_agent_nav_factory_raw_inventory | external | factory_raw_inventory | Linked metadata only |
| factory_agent_nav_factory_raw_movements | external | factory_raw_movements | Linked metadata only |
| factory_agent_nav_factory_raw_stock_check | external | factory_raw_stock_check | Linked metadata only |
| factory_agent_nav_factory_mesti_cleaning | external | factory_mesti_cleaning | Linked metadata only |
| factory_agent_nav_factory_mesti_equipment_cleaning | external | factory_mesti_equipment_cleaning | Linked metadata only |
| factory_agent_nav_factory_mesti_calibration | external | factory_mesti_calibration | Linked metadata only |
| factory_agent_nav_factory_mesti_finished_product_storage_control | external | factory_mesti_finished_product_storage_control | Linked metadata only |
| factory_agent_nav_factory_mesti_health_declaration | external | factory_mesti_health_declaration | Linked metadata only |
| factory_agent_nav_factory_mesti_operator_hygiene | external | factory_mesti_operator_hygiene | Linked metadata only |
| factory_agent_nav_factory_mesti_waste_disposal | external | factory_mesti_waste_disposal | Linked metadata only |
| factory_agent_nav_factory_mesti_raw_material_control | external | factory_mesti_raw_material_control | Linked metadata only |
| factory_agent_nav_factory_mesti_food_processing_control | external | factory_mesti_food_processing_control | Linked metadata only |
| factory_agent_nav_factory_product_recipes | external | factory_product_recipes | Linked metadata only |
| factory_agent_nav_factory_production_sop | external | factory_production_sop | Linked metadata only |
| factory_agent_nav_factory_equipment | external | factory_equipment | Linked metadata only |
| factory_agent_nav_factory_audit_logs | external | factory_audit_logs | Linked metadata only |
| factory_agent_nav_factory_storage_locations | external | factory_storage_locations | Linked metadata only |
| factory_agent_nav_factory_suppliers | external | factory_suppliers | Linked metadata only |
| factory_agent_nav_factory_customers | external | factory_customers | Linked metadata only |
| factory_mesti_inspection | external | No single verified owner | Linked metadata only |
| factory_mesti_operator_hygiene | business | factory_mesti_operator_hygiene | factory |
| factory_mesti_waste_disposal | business | factory_mesti_waste_disposal | factory |
| factory_mesti_raw_material_control | business | factory_mesti_raw_material_control | factory |
| factory_mesti_food_processing_control | business | factory_mesti_food_processing_control | factory |
| factory_product_feedback | business | factory_product_feedback | factory |
| factory_petty_cash | business | factory_petty_cash | factory |
| factory_product_recipes | business | factory_product_recipes | factory |
| factory_production_sop | business | factory_production_sop | factory |
| factory_equipment | business | factory_equipment | factory |
| factory_label_management | business | factory_label_management | factory |
| factory_audit_logs | business | factory_audit_logs | factory |
| factory_storage_locations | business | factory_storage_locations | factory |
| factory_suppliers | business | factory_suppliers | factory |
| factory_customers | business | factory_customers | factory |
| crew_dashboard | business | crew_dashboard | crew |
| crew_employees | business | crew_employees | crew |
| crew_attendance | business | crew_attendance | crew |
| crew_roster | business | crew_roster | crew |
| crew_leave | business | crew_leave | crew |
| crew_leave_balance | permission | crew_leave | Linked metadata only |
| crew_leave_settings | permission | crew_leave | Linked metadata only |
| crew_operations | business | crew_operations | crew |
| crew_cash_checkout | business | crew_cash_checkout | crew |
| crew_cash_deposit | business | crew_cash_deposit | crew |
| crew_operation_templates | alias | crew_operations | Linked metadata only |
| crew_learning | business | crew_learning | crew |
| crew_progress | alias | crew_learning | Linked metadata only |
| crew_sop_library | business | crew_sop_library | crew |
| crew_growth | business | crew_growth | crew |
| crew_growth_skills | business | crew_growth_skills | crew |
| crew_growth_people | alias | crew_growth | Linked metadata only |
| crew_growth_reviews | alias | crew_growth | Linked metadata only |
| crew_performance | business | crew_performance | crew |
| crew_performance_reviews | alias | crew_performance | Linked metadata only |
| crew_customer_feedback | business | crew_customer_feedback | crew |
| crew_google_reviews | business | crew_google_reviews | crew |
| crew_team_review | business | crew_team_review | crew |
| crew_reward | business | crew_reward | crew |
| crew_reward_cycles | alias | crew_reward | Linked metadata only |
| ai_assistant | business | ai_assistant | platform |
| operations_network | business | operations_network | platform |
