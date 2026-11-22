// Independent acceptance specifications. Paths refer to fields displayed by the
// owning read model and projected by the Assistant, never to record values.
const money=(path,label)=>({path,label,unit:'MYR'});
const metric=(path,label,unit)=>({path,label,unit});
const alias=(path,sourcePath,label)=>({path,sourcePath,label});
const rows=(operation,collection,identity,question,facts)=>({operation,collection,identity,question,facts});
const summary=(operation,question,facts)=>({operation,question,facts});

const restaurant=[
 rows('read_recipe_ingredients','rows','id','Give the recipe name, recorded serving size and recipe code for one recipe on the selected page.', ['recipe_name','serving_size','recipe_code']),
 rows('read_restaurant_alerts','rows','id','Give one recorded operational alert with its title and severity.', ['title','severity']),
 summary('read_restaurant_data_health','What are the sales and purchase data-health scores? Label each score separately.',[metric('sales_score','sales score'),metric('purchase_score','purchase score')]),
 rows('read_purchase_comparison','months','month','For the specified reporting month, give net sales and recorded purchases on the purchase-efficiency view.',[money('values.netSales','net sales'),money('values.totalPurchase','purchases')]),
 rows('read_outlet_tax_policy','rows','id','For one recorded tax setting, give its tax type, recorded rate and effective start date.', ['tax_type',metric('rate','rate'),'effective_from']),
 rows('read_inventory_waste','rows','id','Give the date, waste type and recorded quantity with its unit for one waste entry.', ['waste_date','waste_type',metric('quantity','quantity',{field:'unit'})]),
 rows('read_inventory_checks','rows','id','Identify one inventory count by its check name, date and recorded status.', ['check_name','check_date','status']),
 rows('read_inventory_orders','rows','id','Give one inventory order reference and its current recorded status.', ['po_no','status']),
 rows('read_inventory_par_levels','rows','id','For a visible item-to-outlet position, give its recorded par and storage location. Do not infer current stock.', [metric('par_level','par level'),'storage_location']),
 rows('read_inventory_check_groups','rows','id','For one stock-check group give its name, frequency and shift.', ['name','frequency_type','shift']),
 rows('read_inventory_recipe_catalogue','rows','id','Give the recipe name, code and menu category for one catalogue entry.', ['recipe_name','recipe_code','menu_category']),
];
const hr=[
 summary('read_workforce_distribution','What are the total, active and inactive workforce counts for my scope? Label each measure.', [metric('total','total'),metric('active','active'),metric('inactive','inactive')]),
 rows('read_role_directory','rows','id','Name one role and its recorded outlet-access type without changing access.', ['name','outlet_access_type']),
 rows('read_audit_event_metadata','rows','id','For one recorded audit event give its module and action.', ['module','action']),
 rows('read_payroll_run_status','rows','id','Give the start and end dates for a recorded payroll period. Do not include pay or employee identities.', ['period_start','period_end']),
 summary('read_employee_assignment','What is the verified employment type and position of the selected employee on the returned assignment?', ['assignment.employment_type','assignment.position']),
 rows('read_recruitment_openings','rows','id','Name one recruitment opening and its status.', ['title','status']),
 summary('read_employee_compliance','Give labeled counts of compliant employees and employees needing verification.', [metric('summary.compliant','compliant'),metric('summary.needs_verification','needs verification')]),
 rows('read_legal_entities','rows','id','For one legal entity give its display name and the number of active linked employees.', ['display_name',metric('active_linked_employee_count','active linked employees')]),
 rows('read_employment_document_status','rows','id','Give the title and status of one employment document for the selected employee. Omit its contents.', ['title','status']),
 rows('read_employee_notice_status','rows','id','What type and delivery status are recorded on one notice for the selected employee? Omit its contents.', ['document_type','status']),
];
const finance=[
 rows('read_accounting_source_health','rows','id','For one accounting source give the book name and recorded synchronization state.', ['sourceBook','syncState']),
 summary('read_reporting_product_sales','What is the product-sales data status and reported product-sales revenue in the selected monthly report?', ['report.product_data_status',money('report.total_product_sales_revenue','product sales revenue')]),
];
const factory=[
 summary('read_factory_operational_pipeline','How many jobs are scheduled, released and in progress in the production pipeline? Label each count.', [metric('summary.scheduled','scheduled'),metric('summary.released','released'),metric('summary.in_progress','in progress')]),
 summary('read_factory_batch_lineage','Which job order supplied the selected finished-good batch, and what recorded pack size and unit does its trace show?', ['batch.job_order_no',metric('batch.pack_size_qty','pack size',{field:'batch.pack_size_uom'})]),
 rows('read_factory_audit_events','rows','id','Give the event label, business module and recorded outcome of one Factory audit event.', ['event_label','module_label','result']),
 rows('read_factory_health_register','rows','id','For one health declaration give the declaration type and work action. Omit personal health details.', ['declaration_type','work_action']),
 rows('read_factory_hygiene_register','rows','entry_id','Give the date and recorded state for one observed operator-hygiene entry.', ['date','state']),
 rows('read_factory_waste_disposal','rows','logical_requirement_id+location_id','Give the location and required frequency for one waste-disposal requirement.', ['location_name','frequency']),
 rows('read_factory_raw_control_standards','rows','raw_material_id','Name one raw material and its material code from the acceptance standards.', ['item','material_code']),
 rows('read_factory_raw_control_evidence','rows','id','Give one receiving reference with the observed item, recorded quantity and unit.', ['receiving_no','item_name',metric('received_qty','received quantity',{field:'uom'})]),
 rows('read_factory_label_configuration','rows','id','For one product, give its code, template name and label configuration status.', ['product_code','template_name','configuration_status']),
 rows('read_factory_storage_control','rows','id','For one finished batch give its batch number, storage location and recorded expiry date.', ['batch_no','storage_location_name','expiry_date']),
 rows('read_factory_processing_control','rows','id','For one production batch, give its product name, batch number and recorded QC status.', ['product_name','batch_no','qc_status']),
 rows('read_factory_feedback_campaigns','rows','id','Name one feedback campaign, its status and its recorded response count.', ['name','status',metric('response_count','responses')]),
 rows('read_factory_transfers','rows','id','Give the transfer number, date and status of one recorded Factory transfer.', ['transfer_no','transfer_date','status']),
 summary('read_factory_cash','What is the current petty cash balance and how many transactions are recorded for the current month? Label the two different scopes.', [money('summary.current_balance','current balance'),metric('summary.transactions_month','transactions this month')]),
 summary('read_factory_job_summary','How many Factory job orders are in draft and released states? Label each count.', [metric('summary.draft','draft'),metric('summary.released','released')]),
 summary('read_factory_production_summary','Give the completed production run count and the number of recorded traceability gaps.', [metric('summary.completed_runs','completed runs'),metric('summary.traceability_gaps','traceability gaps')]),
 summary('read_factory_dispatch_summary','How many drafts and completions today does the dispatch summary show?', [metric('summary.draft','draft'),metric('summary.completed_today','completed today')]),
 summary('read_factory_raw_checks','Give the reported counts for submitted raw-material checks and critical rows.', [metric('summary.submitted','submitted'),metric('summary.critical_rows','critical rows')]),
 summary('read_factory_product_checks','Give the product stock-check summary counts for variance rows and skipped rows.', [metric('summary.variance_rows','variance rows'),metric('summary.skipped_rows','skipped rows')]),
 summary('read_factory_receiving_summary','How many receiving documents and item rows were recorded in the requested period?', [metric('summary.documents','documents'),metric('summary.items','items')]),
 rows('read_factory_calibration','rows','id','Give the equipment name, calibration type and status of one scheduled calibration.', ['equipment_name','calibration_type','status']),
 rows('read_factory_production_records','rows','id','For one production record, give its batch, product and good output with its recorded unit.', ['batch_no','product_name',metric('good_output_qty','good output',{field:'uom'})]),
 rows('read_factory_suppliers','rows','id','Give the name, supplier code and recorded status of one Factory supplier.', ['supplier_name','supplier_code','status']),
 rows('read_factory_customers','rows','id','Give one Factory customer name, code and customer type.', ['customer_name','customer_code','customer_type']),
 rows('read_factory_locations','rows','id','Give the name, code and location type of one Factory storage location.', ['location_name','location_code','location_type']),
 rows('read_factory_recipe_versions','rows','id','For one recipe version, give the recipe code, version, and yield with its unit.', ['recipe_code',metric('version','version'),metric('yield_quantity','yield',{field:'uom'})]),
 rows('read_factory_equipment_cleaning_requirements','rows','id','Name a recorded equipment-cleaning task with its recurrence and effective date.', ['task_name','recurrence_type','effective_from']),
];
const crew=[
 rows('read_crew_task_snapshot','rows','id','Give the name, task type and recorded status of one Crew task in the saved queue.', ['name','task_type','status']),
 rows('read_crew_onboarding_progress','rows','employee.id','For the selected Crew member, give their recorded onboarding status and progress percentage when available.', ['status',metric('progress_percentage','progress','%')]),
 summary('read_crew_performance_snapshot','Give the reviewed and awaiting-review counts in the recorded Crew performance summary.', [metric('summary.reviewed','reviewed'),metric('summary.awaiting_review','awaiting review')]),
 rows('read_crew_daily_brief','tasks_today.rows','id','Name one task on the outlet daily brief and its recorded operational status.', ['name','status']),
 summary('read_crew_access_status','For Crew access, how many are locked and how many are not enabled? Label each count.', [metric('summary.locked','locked'),metric('summary.not_enabled','not enabled')]),
 summary('read_crew_feedback_summary','Give the total feedback count and the count requiring review.', [metric('summary.total_feedback','total feedback'),metric('summary.review_required_feedback','requires review')]),
 rows('read_crew_roster','rows','id','Give the roster date, start and end times for one scheduled shift.', ['roster_date','start_time','end_time']),
 rows('read_crew_attendance','rows','id','For one attendance record, give the roster date, attendance status and recorded clock-in variance in minutes.', ['roster_date','status',metric('clock_in_variance_minutes','clock-in variance','minutes')]),
 rows('read_crew_cash_checkouts','rows','id','For a recorded cash checkout give the business date, counted cash and expected POS cash.', ['business_date',money('counted_cash','counted cash'),money('pos_expected_cash','expected POS cash')]),
 rows('read_crew_cash_ledger','rows','id','For a deposit-ledger entry give the activity and the recorded amount in and amount out.', ['activity',money('amount_in','amount in'),money('amount_out','amount out')]),
 rows('read_crew_sop_catalogue','rows','id','Name one published SOP and its recorded category in this outlet library.', ['title','category']),
 rows('read_crew_reward_cycles','rows','id','Give the cycle status and the participant and qualified counts for one recorded reward cycle.', ['status',metric('participant_count','participants'),metric('qualified_count','qualified')]),
 rows('read_crew_skill_requirements','rows','id','Name one skill and its certification method and validity in months.', ['name','certification_method',metric('validity_months','validity','months')]),
 summary('read_crew_team_review_summary','Give the eligible crew and reviews received counts for the team-review window.', [metric('summary.eligible_crew','eligible crew'),metric('summary.reviews_received','reviews received')]),
];
const marketing=[
 summary('read_brand_customer_directory','Give the subscribed and do-not-contact counts for the Brand customer directory.', [metric('summary.subscribed','subscribed'),metric('summary.do_not_contact','do not contact')]),
 rows('read_marketing_ads_evidence','rows','connection_id+date_from+date_to+observed_at','Give the recorded start and end dates for one observed paid-ad report. Do not substitute another period.', ['date_from','date_to']),
 rows('read_platform_team_access','rows','id','Name one visible team member and their assigned role. Do not change their access.', ['name','role_name']),
 rows('read_platform_brands','rows','id','Name one Brand and state whether its recorded active flag is enabled.', ['name',metric('is_active','active')]),
 rows('read_marketing_connection_health','rows','channel','Name a Brand channel and its recorded connection status.', ['channel','status']),
 rows('read_marketing_creator_posts','rows','id','For one recorded creator post give its platform, content type and recorded metadata source.', ['platform','content_type','metadata_source']),
 summary('read_marketing_inbox_metrics','How many conversations and unresolved conversations are in the Social Inbox cohort for this period?', [metric('summary.volume','conversation volume'),metric('summary.unresolved','unresolved')]),
 summary('read_marketing_whatsapp_metrics','How many WhatsApp conversations and human handovers are recorded for this period?', [metric('summary.volume','conversation volume'),metric('summary.human_handovers','human handovers')]),
 summary('read_marketing_overview','Give separate all-time counts of scheduled and published content for this Brand.', [metric('summary.scheduled','scheduled'),metric('summary.published','published')]),
 rows('read_marketing_calendar','rows','id','Give the title, recorded status and revision of one item on the Brand calendar.', [alias('title','payload.title'),'status',metric('revision','revision')]),
 rows('read_marketing_media','rows','id','Give the file name, MIME type and recorded byte size for one ready media entry.', ['filename','mime_type',metric('size_bytes','size','bytes')]),
 rows('read_marketing_social_performance','rows','kind+starting+ending+channel+metric','For a recorded social performance observation window give the metric, channel and the observed and available post counts.', ['metric','channel',metric('observed_posts','observed posts'),metric('available_posts','available posts')]),
 rows('read_marketing_campaigns','rows','id','Give one campaign title and its recorded status in this Brand.', ['title','status']),
 rows('read_marketing_audiences','rows','id','Give one audience name and its recorded eligible count.', ['name',metric('eligible_count','eligible')]),
 rows('read_marketing_workflows','rows','id','Name one WhatsApp workflow and its recorded revision and state.', ['title',metric('revision','revision'),'state']),
];

export const operationalCases=Object.entries({Restaurant:restaurant,HR:hr,Finance:finance,Factory:factory,Crew:crew,Marketing:marketing})
 .flatMap(([domain,cases])=>cases.map(entry=>({...entry,domain,facts:entry.facts.map(f=>typeof f==='string'?{path:f}:f)})));
