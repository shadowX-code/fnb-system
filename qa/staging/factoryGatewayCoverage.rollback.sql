-- Supplemental read-coverage checks. Security fixtures only; no Factory record writes.
begin;
do $qa$
declare owner_id uuid;res jsonb;agent_id uuid;token text;all_token text;all_id uuid;data jsonb;record_row jsonb;source jsonb;q jsonb;mid text;count_source integer;next_page jsonb;before_roles text;
begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 res:=public.external_agents_register(gen_random_uuid(),'SOP read coverage QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['nav_factory_production_sop_view']);agent_id:=(res->>'identity_id')::uuid;token:=res->>'one_time_credential';
 res:=public.external_agents_register(gen_random_uuid(),'Source read coverage QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['nav_factory_job_orders_view','nav_factory_job_order_records_view','nav_factory_production_view','nav_factory_production_planning_view','nav_factory_finished_goods_view','nav_factory_mesti_food_processing_control_view','nav_factory_mesti_finished_product_storage_control_view']);all_id:=(res->>'identity_id')::uuid;all_token:=res->>'one_time_credential';
 execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id in (agent_id,all_id);
 -- Actual SOP data is exposed, with counts and fields matching the owning service tables.
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(token,'[{"business_module":"factory_production_sop","resource":"sop_qc_checks","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"},"limit":100}]')->'results'->0;
 execute 'set local role postgres';select count(*) into count_source from public.factory_production_sop_step_qc_checks;
 if (data->>'returned')::integer<>count_source or count_source=0 then raise exception 'SOP QC source coverage mismatch';end if;
 for record_row in select value from jsonb_array_elements(data->'items') loop
  select jsonb_build_object('qc_type',r.qc_type,'is_required',r.is_required,'qc_result_mode',t.result_mode) into source from public.factory_production_sop_step_qc_checks r left join public.factory_qc_checklist_templates t on t.id=r.checklist_template_id where r.id=(record_row->>'id')::uuid;
  if record_row->'qc_type' is distinct from source->'qc_type' or record_row->'is_required' is distinct from source->'is_required' or record_row->'qc_result_mode' is distinct from source->'qc_result_mode' then raise exception 'QC definition changed canonical values';end if;
 end loop;
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(token,'[{"business_module":"factory_production_sop","resource":"sop_equipment","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"},"limit":100}]')->'results'->0;
 if exists(select 1 from jsonb_array_elements(data->'items')r where r ? 'equipment_id') then raise exception 'SOP leaked Equipment identity';end if;
 data:=public.factory_agent_resource_query(token,'[{"business_module":"factory_production_sop","resource":"sop_material_bindings","action":"list","date_range":{"from":"2026-10-01","to":"2026-10-31"},"limit":100}]')->'results'->0;
 if exists(select 1 from jsonb_array_elements(data->'items')r where r ?|array['current_balance','manual_unit_cost']) then raise exception 'SOP leaked independent inventory/costs';end if;
 -- Discover supported records, without advertising unavailable dependencies/foreign filters.
 data:=public.factory_agent_authorize(token);
 if not exists(select 1 from jsonb_array_elements(data->'resource_catalog')r where r->>'resource'='sop_material_bindings' and r->'fields' ? 'raw_material_id') then raise exception 'Discovery omitted intrinsic material reference';end if;
 begin perform public.factory_agent_resource_query(token,'[{"business_module":"factory_production_sop","resource":"sop_material_bindings","action":"filter","filters":{"current_balance":"hidden"},"date_range":{"from":"2026-10-01","to":"2026-10-31"}}]');raise exception 'Hidden material filter allowed';exception when invalid_parameter_value then null;end;
 -- Select one core pipeline day, then compare source counts and states exactly.
 data:=public.factory_agent_resource_query(all_token,'[{"business_module":"factory_job_orders","resource":"production_pipeline","action":"list","date_range":{"from":"2026-10-28","to":"2026-10-28"},"limit":100}]')->'results'->0;
 execute 'set local role postgres';source:=feedx_integrations.factory_get_production_operational_pipeline_snapshot_core('2026-10-28',false,all_token);
 if data->>'has_more'<>'false' then raise exception 'Narrow this pipeline equivalence test rather than ignore pages';end if;
 for mid in select unnest(array['scheduled','released','in_progress','completed_today']) loop
  select count(*) into count_source from jsonb_array_elements(data->'items')r where r->>'pipeline_bucket'=mid;
  if count_source<>jsonb_array_length(source->mid) then raise exception 'Pipeline bucket mismatch: %',mid;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(data->'items')r where r ?|array['step_executions','finished_good','remarks','operator_name','production_operator_id','assigned_team']) then raise exception 'Nested pipeline payload escaped projection';end if;
 -- New pipeline pagination is exact and deterministic, including current open jobs.
 execute 'set local role anon';q:='[{"business_module":"factory_job_orders","resource":"production_pipeline","action":"list","date_range":{"from":"2026-10-28","to":"2026-10-28"},"limit":1}]';
 data:=public.factory_agent_resource_query(all_token,q)->'results'->0;
 if (data->>'has_more')::boolean then next_page:=public.factory_agent_resource_query(all_token,jsonb_build_array(q->0||jsonb_build_object('cursor',data->>'next_cursor')))->'results'->0;if next_page->'items'->0->>'id'=data->'items'->0->>'id' then raise exception 'Pipeline pagination repeated row';end if;end if;
 data:=public.factory_agent_resource_query(all_token,'[{"business_module":"factory_production_planning","resource":"planning_open_orders","action":"list","date_range":{"from":"2026-10-28","to":"2026-10-28"},"limit":100}]')->'results'->0;
 execute 'set local role postgres';source:=feedx_integrations.factory_get_open_job_order_qty_by_sku_core(all_token);
 if (data->>'returned')::integer<>jsonb_array_length(source->'aggregates')+1 then raise exception 'Open-order aggregate/diagnostics coverage mismatch';end if;
 for record_row in select value from jsonb_array_elements(data->'items') where value->>'id'<>'planning:diagnostics' loop
  if not exists(select 1 from jsonb_array_elements(source->'aggregates')r where r->>'packaging_sku_id'=record_row->>'packaging_sku_id' and r->'open_job_order_qty'=record_row->'open_job_order_qty' and r->'invalid_job_order_count'=record_row->'invalid_job_order_count') then raise exception 'Open-order quantities do not match canonical aggregate';end if;
 end loop;
 -- Synthetic JSON projection tests cover privacy where real transactional evidence is empty.
 record_row:=feedx_integrations.navigation_project_row(token,'factory_mesti_food_processing_control','evidence','{"id":"context","module":"food_processing_control","qc_required_count":2,"qc_evidence_count":1,"qc_requirement_status":"evidence_unavailable","employee_id":"private","job_order_no":"JO-private","production_no":"PR-private","unknown_nested":{"private":"value"}}');
 if record_row->>'qc_required_count'<>'2' or record_row ?|array['employee_id','unknown_nested'] then raise exception 'Processing proof fields or cross-module redaction failed';end if;
 record_row:=feedx_integrations.navigation_project_row(token,'factory_product_stock_check','product_stock_adjustments','{"id":"allocation","stock_check_item_id":"own","batch_balance_id":"private","quantity":4,"notes":"private"}');
 if record_row->>'quantity'<>'4' or record_row ?|array['notes','current_balance'] then raise exception 'Allocation evidence leaked ungranted batch';end if;
 -- Removing a contributing source grant changes discovery and query enforcement immediately.
 execute 'set local role authenticated';perform public.external_agents_set_capability(all_id,'nav_factory_production_view',false,true);
 execute 'set local role anon';data:=public.factory_agent_authorize(all_token);
 if exists(select 1 from jsonb_array_elements(data->'resource_actions')r where r->>'resource'='production_pipeline') then raise exception 'Discovery advertised pipeline without source grant';end if;
 if not exists(select 1 from jsonb_array_elements(data->'resource_catalog')r where r->>'resource'='production_pipeline' and r->>'query_available'='false' and r->'missing_required_modules' @> '[{"id":"factory_production"}]') then raise exception 'Missing dependency was not explained';end if;
 begin perform public.factory_agent_resource_query(all_token,q);raise exception 'Cached pipeline grant bypassed source revoke';exception when insufficient_privilege then null;end;
 -- Anonymous callers cannot invoke shared cores or catalog/read internals directly.
 begin perform feedx_integrations.factory_get_open_job_order_qty_by_sku_core(all_token);raise exception 'Private core publicly callable';exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
end $qa$;
select 'PASS' as source_equivalence_discovery_redaction_and_revocation;
rollback;
