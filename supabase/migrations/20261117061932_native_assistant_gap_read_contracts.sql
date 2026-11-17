-- Split maintenance from canonical Crew reads without changing existing interactive behavior.
CREATE OR REPLACE FUNCTION public.crew_admin_onboarding_progress_read_core(p_refresh boolean, p_outlet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view onboarding progress for this outlet.';
  end if;

  if p_refresh then perform public.crew_sync_onboarding_enrollments(p_outlet_id); end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employee', jsonb_build_object(
        'id', e.id,
        'full_name', e.full_name,
        'nickname', e.nickname,
        'position', e.position,
        'employee_code', e.employee_code
      ),
      'assignment_id', a.id,
      'journey_id', a.journey_id,
      'modules', (select coalesce(jsonb_agg(jsonb_build_object('id',x.item->'module'->>'id','title',x.item->'module'->>'title','sort_order',x.n,'completed',public.crew_snapshot_module_completed(a.id,(x.item->'module'->>'id')::uuid)) order by x.n),'[]'::jsonb) from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]')) with ordinality x(item,n)),
      'journey_version', (select version from public.crew_journeys where id=a.journey_id),
      'status', coalesce(a.status, 'not_started'),
      'started_at', a.started_at,
      'completed_at', a.completed_at,
      'progress_percentage', case
        when a.id is null or stats.required_total = 0 then 0
        else round(100.0 * stats.required_completed / stats.required_total)
      end,
      'completed_modules', coalesce(stats.completed_modules, 0),
      'total_modules', coalesce(stats.total_modules, 0),
      'knowledge_checks_passed', coalesce(stats.knowledge_checks_passed, 0),
      'knowledge_checks_total', coalesce(stats.knowledge_checks_total, 0),
      'current_module', stats.current_module
    ) order by e.full_name)
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    left join lateral (
      select assignment.*
      from public.crew_journey_assignments assignment
      join public.crew_journeys journey on journey.id = assignment.journey_id
      where assignment.employee_id = e.id
        and journey.outlet_id = p_outlet_id
        and journey.is_mandatory_onboarding
      order by assignment.assigned_at desc
      limit 1
    ) a on true
    left join lateral (
      select
        count(*) filter (where lesson.required) as required_total,
        count(*) filter (where lesson.required and lesson.completed) as required_completed,
        count(distinct module.module_id) as total_modules,
        count(distinct module.module_id) filter (where module.completed) as completed_modules,
        count(*) filter (where lesson.quiz_required) as knowledge_checks_total,
        count(*) filter (where lesson.quiz_required and lesson.quiz_passed) as knowledge_checks_passed,
        (
          select module_name
          from (
            select
              module_item->'module'->>'title' as module_name,
              module_ordinality,
              public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
            from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb))
              with ordinality modules(module_item, module_ordinality)
          ) current_module_row
          where not completed
          order by module_ordinality
          limit 1
        ) as current_module
      from (
        select
          module_item->'module'->>'id' as module_id,
          public.crew_snapshot_module_completed(a.id, (module_item->'module'->>'id')::uuid) as completed
        from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
      ) module
      cross join lateral (
        select
          coalesce((lesson_item->'lesson'->>'required')::boolean, true) as required,
          exists (
            select 1 from public.crew_lesson_progress lp
            where lp.assignment_id = a.id
              and lp.lesson_id = (lesson_item->'lesson'->>'id')::uuid
              and lp.status = 'completed'
          ) as completed,
          coalesce((lesson_item->'quiz'->>'required')::boolean, false) as quiz_required,
          exists (
            select 1 from public.crew_quiz_attempts qa
            where qa.employee_id = e.id
              and qa.quiz_id = (lesson_item->'quiz'->>'id')::uuid
              and qa.passed
          ) as quiz_passed
        from jsonb_array_elements(coalesce((
          select module_item->'lessons'
          from jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module_item
          where module_item->'module'->>'id' = module.module_id
        ), '[]'::jsonb)) lesson_item
      ) lesson
    ) stats on a.id is not null
    where ca.primary_outlet_id = p_outlet_id
      and ca.access_state = 'active'
      and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
  ), '[]'::jsonb);
end;
$function$
;
revoke all on function public.crew_admin_onboarding_progress_read_core(boolean,uuid) from public,anon,authenticated;
create or replace function public.crew_admin_onboarding_progress(p_outlet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$ begin return public.crew_admin_onboarding_progress_read_core(true,p_outlet_id); end $$;
revoke all on function public.crew_admin_onboarding_progress(uuid) from public,anon;
grant execute on function public.crew_admin_onboarding_progress(uuid) to authenticated;
create or replace function public.crew_admin_onboarding_progress_snapshot(p_outlet_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin return public.crew_admin_onboarding_progress_read_core(false,p_outlet_id); end $$;
revoke all on function public.crew_admin_onboarding_progress_snapshot(uuid) from public,anon;
grant execute on function public.crew_admin_onboarding_progress_snapshot(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.crew_performance_admin_data_read_core(p_refresh boolean, p_outlet_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare period date:=date_trunc('month',p_period)::date; employee record;
  v_result public.crew_performance_results%rowtype; v_employment jsonb;
  v_row jsonb; rows jsonb:='[]'::jsonb; review_rows jsonb:='[]'::jsonb;
  summary jsonb:='{}'::jsonb; can_performance boolean:=public.current_user_has_permission('crew_performance.view');
  can_review boolean:=public.current_user_has_permission('crew_performance.review');
begin
  if p_outlet_id is null or not (can_performance or can_review)
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Performance is unavailable for this outlet.';
  end if;
  if can_performance then
    for employee in
      select e.id,e.full_name,e.employee_code from public.employees e where
        exists(select 1 from public.employee_employment_assignment_revisions a
          join public.outlets o on o.id=p_outlet_id
          where a.employee_id=e.id and a.effective_from<(period+interval '1 month')::date
            and lower(btrim(coalesce(a.workplace,''))) in
              (lower(btrim(o.name)),lower(btrim(coalesce(o.code,''))))
            and not exists(select 1 from public.employee_employment_assignment_revisions newer
              where newer.supersedes_revision_id=a.id))
        or exists(select 1 from public.crew_performance_results r
          where r.employee_id=e.id and r.outlet_id=p_outlet_id and r.period_start=period)
        or exists(select 1 from public.crew_performance_reviews v
          where v.employee_id=e.id and v.outlet_id=p_outlet_id and v.period_start=period)
      order by e.full_name,e.id
    loop
      v_employment:=public.crew_performance_period_employment(employee.id,period);
      select * into v_result from public.crew_performance_results
        where employee_id=employee.id and period_start=period;
      if v_result.status='finalized' then
        if v_result.outlet_id<>p_outlet_id then continue; end if;
      elsif v_result.id is not null and v_result.outlet_id<>p_outlet_id then
        continue; -- a changed outlet remains in its old review queue until confirmed
      elsif v_employment->>'state'='eligible'
        and (v_employment->>'outlet_id')::uuid=p_outlet_id then
        if p_refresh then perform public.crew_refresh_performance(employee.id,period); end if;
        select * into v_result from public.crew_performance_results
          where employee_id=employee.id and period_start=period;
      elsif v_result.id is null then
        continue; -- no outlet evidence exists for unresolved/ineligible history
      end if;
      if not p_refresh and v_result.id is null then continue; end if;
      v_row:=jsonb_build_object('employee',jsonb_build_object('id',employee.id,
        'full_name',employee.full_name,'employee_code',employee.employee_code,
        'position',case when v_result.status='finalized'
          then v_result.components->'employment'->>'position'
          else v_employment->>'position' end),
        'result',public.crew_performance_period_result_projection(v_result,v_employment,can_review));
      rows:=rows||jsonb_build_array(v_row);
    end loop;
    select jsonb_build_object(
      'average_score',round(avg((value->'result'->>'total_score')::numeric)
        filter(where value->'result'->>'total_score' is not null),1),
      'reviewed',count(*) filter(where value->'result'->'components'->'service'->>'status'='reviewed'
        and jsonb_typeof(value->'result'->'components'->'peer'->'score')='number'
        and value->'result'->>'employment_review_required'='false'),
      'awaiting_review',count(*) filter(where value->'result'->'components'->'service'->>'status' is distinct from 'reviewed'
        or jsonb_typeof(value->'result'->'components'->'peer'->'score') is distinct from 'number'
        or value->'result'->>'employment_review_required'='true'),
      'crew_total',count(*)) into summary from jsonb_array_elements(rows);
  end if;
  if can_review then
    select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'employee_id',v.employee_id,
      'employee_name',e.full_name,'position',
        public.crew_performance_period_employment(v.employee_id,period)->>'position',
      'component',v.component,'criteria',v.criteria,'score',v.score,
      'max_score',v.max_score,'manager_note',v.manager_note,'reviewed_at',v.reviewed_at)
      order by v.reviewed_at desc),'[]'::jsonb) into review_rows
    from public.crew_performance_reviews v join public.employees e on e.id=v.employee_id
    where v.outlet_id=p_outlet_id and v.period_start=period and v.component='service';
  end if;
  return jsonb_build_object('period_start',period,'period',period,'summary',summary,
    'scoring_framework',case when can_performance then jsonb_build_array(
      jsonb_build_object('key','attendance','label','Attendance','max_score',30),
      jsonb_build_object('key','service','label','Service','max_score',30),
      jsonb_build_object('key','customer','label','Customer','max_score',20),
      jsonb_build_object('key','knowledge','label','Knowledge','max_score',15),
      jsonb_build_object('key','peer','label','Team Review','max_score',5)) else '[]'::jsonb end,
    'crew',rows,'reviews',review_rows);
end $function$
;
revoke all on function public.crew_performance_admin_data_read_core(boolean,uuid,date) from public,anon,authenticated;
create or replace function public.crew_performance_admin_data(p_outlet_id uuid, p_period date) returns jsonb language plpgsql security definer set search_path=public as $$ begin return public.crew_performance_admin_data_read_core(true,p_outlet_id,p_period); end $$;
revoke all on function public.crew_performance_admin_data(uuid,date) from public,anon;
grant execute on function public.crew_performance_admin_data(uuid,date) to authenticated;
create or replace function public.crew_performance_admin_data_snapshot(p_outlet_id uuid, p_period date) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin return public.crew_performance_admin_data_read_core(false,p_outlet_id,p_period); end $$;
revoke all on function public.crew_performance_admin_data_snapshot(uuid,date) from public,anon;
grant execute on function public.crew_performance_admin_data_snapshot(uuid,date) to authenticated;
CREATE OR REPLACE FUNCTION public.crew_tasks_admin_page_read_core(p_refresh boolean, p_outlet_id uuid, p_from date, p_to date, p_listing text DEFAULT 'definitions'::text, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer:=case when p_page_size in(20,50,100) then p_page_size else 20 end; v_total integer; v_rows jsonb; v_sops jsonb; v_employees jsonb; v_summary jsonb;
begin
 if not public.current_user_has_permission('crew_operations.view') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501',message='Tasks are unavailable for this outlet.'; end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>92 then raise exception using errcode='22023',message='Choose a valid Task period of 93 days or fewer.'; end if;
 if p_listing not in ('definitions','review_queue') then raise exception using errcode='22023',message='Unsupported Tasks listing.'; end if;
 if p_refresh then perform public.crew_tasks_refresh_lifecycle(p_outlet_id); perform public.crew_operations_ensure_instances(p_outlet_id,d::date) from generate_series(p_from,p_to,interval '1 day') g(d); end if;
 select coalesce(jsonb_agg(jsonb_build_object('sop_id',s.id,'title',s.title,'version_id',v.id,'version',v.version) order by s.title),'[]'::jsonb) into v_sops from public.crew_sops s join lateral(select * from public.crew_sop_versions v where v.sop_id=s.id and v.status='published' order by v.version desc limit 1)v on true where s.outlet_id is null or s.outlet_id=p_outlet_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into v_employees from public.employees e join public.crew_access ca on ca.employee_id=e.id and ca.primary_outlet_id=p_outlet_id and ca.access_state='active' where e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 if p_listing='review_queue' then
  select count(*) into v_total from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to and a.status='review_required';
  select coalesce(jsonb_agg(to_jsonb(x) order by x.business_date,x.employee_name),'[]'::jsonb) into v_rows from (select i.id instance_id,e.id employee_id,i.name task_name,e.full_name employee_name,i.business_date,a.status from public.crew_task_instance_assignees a join public.crew_operation_instances i on i.id=a.instance_id join public.employees e on e.id=a.employee_id where i.outlet_id=p_outlet_id and i.business_date between p_from and p_to and a.status='review_required' order by i.business_date,e.full_name offset (v_page-1)*v_size limit v_size)x;
 else
  with series as (select t.series_id,max(t.updated_at) updated_at from public.crew_operation_templates t where t.outlet_id=p_outlet_id group by t.series_id), canonical as (select s.*,coalesce((select t.id from public.crew_operation_templates t where t.series_id=s.series_id and t.status<>'draft' order by case t.status when 'active' then 1 when 'paused' then 2 when 'ended' then 3 else 4 end,t.revision desc limit 1),(select t.id from public.crew_operation_templates t where t.series_id=s.series_id and t.status='draft' order by t.revision desc limit 1)) template_id from series s), filtered as (select t.* from canonical c join public.crew_operation_templates t on t.id=c.template_id where (coalesce(p_filters->>'status','all')='all' or t.status=p_filters->>'status') and (coalesce(p_filters->>'assignment','all')='all' or t.assignment_type=p_filters->>'assignment') and (coalesce(p_filters->>'query','')='' or concat_ws(' ',t.name,t.task_type,t.assignment_type) ilike '%'||(p_filters->>'query')||'%')) select count(*) into v_total from filtered;
  with series as (select t.series_id,max(t.updated_at) updated_at from public.crew_operation_templates t where t.outlet_id=p_outlet_id group by t.series_id), canonical as (select s.*,coalesce((select t.id from public.crew_operation_templates t where t.series_id=s.series_id and t.status<>'draft' order by case t.status when 'active' then 1 when 'paused' then 2 when 'ended' then 3 else 4 end,t.revision desc limit 1),(select t.id from public.crew_operation_templates t where t.series_id=s.series_id and t.status='draft' order by t.revision desc limit 1)) template_id from series s), filtered as (select t.*,c.updated_at series_updated_at,public.crew_tasks_next_run(t) next_run from canonical c join public.crew_operation_templates t on t.id=c.template_id where (coalesce(p_filters->>'status','all')='all' or t.status=p_filters->>'status') and (coalesce(p_filters->>'assignment','all')='all' or t.assignment_type=p_filters->>'assignment') and (coalesce(p_filters->>'query','')='' or concat_ws(' ',t.name,t.task_type,t.assignment_type) ilike '%'||(p_filters->>'query')||'%')) select coalesce(jsonb_agg((to_jsonb(x)-'created_by'-'next_run')||jsonb_build_object('definition_status',x.status,'next_run',x.next_run,'task_created_at',(select min(t0.created_at) from public.crew_operation_templates t0 where t0.series_id=x.series_id),'created_by_name',(select coalesce(nullif(btrim(e.nickname),''),nullif(btrim(e.full_name),'')) from public.crew_operation_templates t0 left join public.employees e on e.auth_user_id=t0.created_by where t0.series_id=x.series_id order by t0.created_at,t0.id limit 1),'has_draft',exists(select 1 from public.crew_operation_templates d where d.series_id=x.series_id and d.status='draft'),'blocks',coalesce((select jsonb_agg((to_jsonb(i)-'sop_snapshot')||jsonb_build_object('sop_reference',i.sop_snapshot,'config',i.block_config) order by i.sort_order) from public.crew_operation_template_items i where i.template_id=x.id),'[]'::jsonb)) order by x.series_updated_at desc),'[]'::jsonb) into v_rows from (select * from filtered order by series_updated_at desc,id desc offset (v_page-1)*v_size limit v_size)x;
 end if;
 select jsonb_build_object('published_sops',v_sops,'employees',v_employees,'from',p_from,'to',p_to) into v_summary;
 return jsonb_build_object('rows',v_rows,'total_count',v_total,'page',v_page,'page_size',v_size,'summary',v_summary);
end; $function$
;
revoke all on function public.crew_tasks_admin_page_read_core(boolean,uuid,date,date,text,jsonb,integer,integer) from public,anon,authenticated;
create or replace function public.crew_tasks_admin_page(p_outlet_id uuid, p_from date, p_to date, p_listing text DEFAULT 'definitions'::text, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) returns jsonb language plpgsql security definer set search_path=public as $$ begin return public.crew_tasks_admin_page_read_core(true,p_outlet_id,p_from,p_to,p_listing,p_filters,p_page,p_page_size); end $$;
revoke all on function public.crew_tasks_admin_page(uuid,date,date,text,jsonb,integer,integer) from public,anon;
grant execute on function public.crew_tasks_admin_page(uuid,date,date,text,jsonb,integer,integer) to authenticated;
create or replace function public.crew_tasks_admin_page_snapshot(p_outlet_id uuid, p_from date, p_to date, p_listing text DEFAULT 'definitions'::text, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) returns jsonb language plpgsql stable security definer set search_path=public as $$ begin return public.crew_tasks_admin_page_read_core(false,p_outlet_id,p_from,p_to,p_listing,p_filters,p_page,p_page_size); end $$;
revoke all on function public.crew_tasks_admin_page_snapshot(uuid,date,date,text,jsonb,integer,integer) from public,anon;
grant execute on function public.crew_tasks_admin_page_snapshot(uuid,date,date,text,jsonb,integer,integer) to authenticated;

-- Aggregate the same RLS-scoped employee fields used by employeeService.readWorkforce.
create or replace function public.employee_workforce_summary_read() returns jsonb
language plpgsql stable security invoker set search_path=public as $$
begin
 if auth.uid() is null or not public.current_user_has_permission('employees.view') then
  raise exception using errcode='42501',message='Employee view permission required';
 end if;
 return (select jsonb_build_object('total',sum(n),'groups',coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb))
 from (select legal_entity_id,employment_type,employment_status,count(*) n from public.employees group by legal_entity_id,employment_type,employment_status) g);
end $$;
revoke all on function public.employee_workforce_summary_read() from public,anon;
grant execute on function public.employee_workforce_summary_read() to authenticated;

-- Register operations only. No connection, permission or ACTION policy updates.
do $$ declare d text:=pg_get_functiondef('public.native_assistant_service(uuid,text,jsonb)'::regprocedure); begin
if strpos(d,$old$coalesce(p_payload->>'operation','') not in ('read_factory_finished_goods','read_factory_cleaning_methods','read_employee_assignment','read_crew_leave','read_operational_financials','read_marketing_plan','prepare_marketing_draft','prepare_marketing_caption','read_factory_waste_disposal','read_factory_raw_control_standards','read_factory_raw_control_evidence','read_factory_label_configuration','read_factory_storage_control','read_factory_processing_control','read_factory_feedback_campaigns','read_factory_transfers','read_factory_cash','read_factory_job_summary','read_factory_production_summary','read_factory_dispatch_summary','read_factory_raw_checks','read_factory_product_checks','read_factory_receiving_summary','read_factory_calibration','read_factory_product_movements','read_crew_access_status','read_crew_feedback_summary','read_crew_roster','read_crew_attendance','read_crew_cash_checkouts','read_crew_cash_ledger','read_crew_sop_catalogue','read_crew_published_sop','read_crew_reward_cycles','read_crew_skill_requirements','read_crew_team_review_summary','read_marketing_connection_health','read_marketing_creator_posts','read_marketing_usable_faq','read_marketing_knowledge_sources','read_marketing_inbox_metrics','read_marketing_whatsapp_metrics','read_marketing_overview','read_marketing_calendar','read_marketing_media','read_marketing_social_performance','read_marketing_campaigns','read_marketing_audiences','read_marketing_workflows','read_recruitment_openings','read_employee_compliance','read_legal_entities','read_employment_document_status','read_employee_notice_status','read_published_contract_templates','read_payroll_holiday_policy','read_factory_raw_movements','read_factory_production_records','read_factory_equipment','read_factory_suppliers','read_factory_customers','read_factory_locations','read_factory_raw_catalogue','read_factory_recipe_versions','read_factory_sop_versions','read_factory_equipment_cleaning_requirements','read_departments','read_job_positions','read_outlet_tax_policy','read_inventory_movements','read_operating_expenses','read_purchase_records','read_sales_records','read_inventory_stock_evidence','read_inventory_waste','read_inventory_checks','read_inventory_orders','read_outlet_directory','read_sales_channels','read_purchase_categories','read_supplier_directory','read_inventory_items','read_inventory_par_levels','read_inventory_check_groups','read_inventory_recipe_catalogue','read_asset_catalogue','read_reporting_product_sales')$old$)=0 then raise exception 'capability_allowlist_changed'; end if;
execute replace(d,$old$coalesce(p_payload->>'operation','') not in ('read_factory_finished_goods','read_factory_cleaning_methods','read_employee_assignment','read_crew_leave','read_operational_financials','read_marketing_plan','prepare_marketing_draft','prepare_marketing_caption','read_factory_waste_disposal','read_factory_raw_control_standards','read_factory_raw_control_evidence','read_factory_label_configuration','read_factory_storage_control','read_factory_processing_control','read_factory_feedback_campaigns','read_factory_transfers','read_factory_cash','read_factory_job_summary','read_factory_production_summary','read_factory_dispatch_summary','read_factory_raw_checks','read_factory_product_checks','read_factory_receiving_summary','read_factory_calibration','read_factory_product_movements','read_crew_access_status','read_crew_feedback_summary','read_crew_roster','read_crew_attendance','read_crew_cash_checkouts','read_crew_cash_ledger','read_crew_sop_catalogue','read_crew_published_sop','read_crew_reward_cycles','read_crew_skill_requirements','read_crew_team_review_summary','read_marketing_connection_health','read_marketing_creator_posts','read_marketing_usable_faq','read_marketing_knowledge_sources','read_marketing_inbox_metrics','read_marketing_whatsapp_metrics','read_marketing_overview','read_marketing_calendar','read_marketing_media','read_marketing_social_performance','read_marketing_campaigns','read_marketing_audiences','read_marketing_workflows','read_recruitment_openings','read_employee_compliance','read_legal_entities','read_employment_document_status','read_employee_notice_status','read_published_contract_templates','read_payroll_holiday_policy','read_factory_raw_movements','read_factory_production_records','read_factory_equipment','read_factory_suppliers','read_factory_customers','read_factory_locations','read_factory_raw_catalogue','read_factory_recipe_versions','read_factory_sop_versions','read_factory_equipment_cleaning_requirements','read_departments','read_job_positions','read_outlet_tax_policy','read_inventory_movements','read_operating_expenses','read_purchase_records','read_sales_records','read_inventory_stock_evidence','read_inventory_waste','read_inventory_checks','read_inventory_orders','read_outlet_directory','read_sales_channels','read_purchase_categories','read_supplier_directory','read_inventory_items','read_inventory_par_levels','read_inventory_check_groups','read_inventory_recipe_catalogue','read_asset_catalogue','read_reporting_product_sales')$old$,$new$coalesce(p_payload->>'operation','') not in ('read_recipe_ingredients','read_restaurant_alerts','read_restaurant_data_health','read_sales_comparison','read_purchase_comparison','read_workforce_distribution','read_role_directory','read_audit_event_metadata','read_payroll_run_status','read_accounting_source_health','read_brand_customer_directory','read_marketing_ads_evidence','read_platform_team_access','read_platform_brands','read_factory_operational_pipeline','read_factory_batch_lineage','read_factory_audit_events','read_factory_health_register','read_factory_hygiene_register','read_crew_task_snapshot','read_crew_onboarding_progress','read_crew_performance_snapshot','read_crew_daily_brief','read_crew_onboarding_catalogue','read_factory_finished_goods','read_factory_cleaning_methods','read_employee_assignment','read_crew_leave','read_operational_financials','read_marketing_plan','prepare_marketing_draft','prepare_marketing_caption','read_factory_waste_disposal','read_factory_raw_control_standards','read_factory_raw_control_evidence','read_factory_label_configuration','read_factory_storage_control','read_factory_processing_control','read_factory_feedback_campaigns','read_factory_transfers','read_factory_cash','read_factory_job_summary','read_factory_production_summary','read_factory_dispatch_summary','read_factory_raw_checks','read_factory_product_checks','read_factory_receiving_summary','read_factory_calibration','read_factory_product_movements','read_crew_access_status','read_crew_feedback_summary','read_crew_roster','read_crew_attendance','read_crew_cash_checkouts','read_crew_cash_ledger','read_crew_sop_catalogue','read_crew_published_sop','read_crew_reward_cycles','read_crew_skill_requirements','read_crew_team_review_summary','read_marketing_connection_health','read_marketing_creator_posts','read_marketing_usable_faq','read_marketing_knowledge_sources','read_marketing_inbox_metrics','read_marketing_whatsapp_metrics','read_marketing_overview','read_marketing_calendar','read_marketing_media','read_marketing_social_performance','read_marketing_campaigns','read_marketing_audiences','read_marketing_workflows','read_recruitment_openings','read_employee_compliance','read_legal_entities','read_employment_document_status','read_employee_notice_status','read_published_contract_templates','read_payroll_holiday_policy','read_factory_raw_movements','read_factory_production_records','read_factory_equipment','read_factory_suppliers','read_factory_customers','read_factory_locations','read_factory_raw_catalogue','read_factory_recipe_versions','read_factory_sop_versions','read_factory_equipment_cleaning_requirements','read_departments','read_job_positions','read_outlet_tax_policy','read_inventory_movements','read_operating_expenses','read_purchase_records','read_sales_records','read_inventory_stock_evidence','read_inventory_waste','read_inventory_checks','read_inventory_orders','read_outlet_directory','read_sales_channels','read_purchase_categories','read_supplier_directory','read_inventory_items','read_inventory_par_levels','read_inventory_check_groups','read_inventory_recipe_catalogue','read_asset_catalogue','read_reporting_product_sales')$new$); end $$;
