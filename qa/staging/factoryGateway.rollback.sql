-- Security fixtures only; all identities, grants, credentials and audit events are rolled back.
begin;
create temp table nav_qa_results(module_id text,resource text,outcome text,returned integer,detail text);
create function pg_temp.reject_nav(p_token text,p_queries jsonb,p_state text) returns void language plpgsql as $$begin
 begin perform public.factory_agent_resource_query(p_token,p_queries);raise exception 'Unauthorized module query succeeded';exception when others then if sqlstate<>p_state then raise;end if;end;
end $$;
do $qa$
declare owner_id uuid;all_caps text[];all_id uuid;all_token text;limited_id uuid;limited_token text;res jsonb;data jsonb;q jsonb;record_row jsonb;first_page jsonb;second_page jsonb;rec record;other record;before_hash text;v_role_id uuid;previous_cap text;counter integer:=0;cap text;fake text;v_role jsonb;codes text[];
 range jsonb:='{"from":"2026-10-01","to":"2026-10-31"}';
begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 select md5(jsonb_build_object('identity',to_jsonb(m),'keys',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(rp.permission_id order by rp.permission_id) from public.role_permissions rp where rp.role_id=m.role_id))::text) into before_hash from feedx_integrations.machine_identities m where name='QA Executive MeSTI Staging';
 select array_agg(tool_id) into all_caps from feedx_integrations.capabilities where navigation_module_id is not null and implemented;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 res:=public.external_agents_register(gen_random_uuid(),'All navigation QA '||gen_random_uuid(),'Rollback QA','factory_mesti',all_caps);all_id:=(res->>'identity_id')::uuid;all_token:=res->>'one_time_credential';
 res:=public.external_agents_register(gen_random_uuid(),'Isolated navigation QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['nav_factory_mesti_cleaning_view']);limited_id:=(res->>'identity_id')::uuid;limited_token:=res->>'one_time_credential';previous_cap:='nav_factory_mesti_cleaning_view';
 begin perform public.external_agents_register(gen_random_uuid(),'Raw grant QA','Rollback QA','factory_mesti',array['factory_mesti_review_view']);raise exception 'New raw grant accepted';exception when invalid_parameter_value then null;end;
 execute 'set local role postgres';
 update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id in (all_id,limited_id);
 select m.role_id into v_role_id from feedx_integrations.machine_identities m where id=limited_id;
 -- Catalog metadata is exact and ordinary responses never contain stored credential material.
 execute 'set local role authenticated';
 data:=public.external_agents_admin_data(limited_id);
 if jsonb_array_length(data->'connections'->0->'tools')<>33 or jsonb_array_length(data->'catalog'->0->'capabilities')<>33 or jsonb_array_length(data->'connections'->0->'preserved_access')<>0 then raise exception 'Navigation catalog incomplete';end if;
 if data::text like '%'||limited_token||'%' or data::text like '%token_hash%' then raise exception 'Credential leaked';end if;
 execute 'set local role anon';
 data:=public.factory_agent_authorize(limited_token);
 if data->'tools'<>'["query_factory_resources"]'::jsonb then raise exception 'Module grants gained legacy tools';end if;
 if exists(select 1 from jsonb_array_elements(data->'resource_actions')a where a->>'business_module' is distinct from 'factory_mesti_cleaning') then raise exception 'Discovery scope broadened';end if;
 q:=jsonb_build_object('business_module','factory_mesti_cleaning','resource','requirements','action','list','date_range',range,'limit',1);
 first_page:=public.factory_agent_resource_query(limited_token,jsonb_build_array(q))->'results'->0;
 if first_page->>'returned'='0' then raise exception 'Expected real Cleaning requirement data';end if;
 if exists(select 1 from jsonb_array_elements(first_page->'items')a where a->>'module'<>'cleaning_of_area' or a ?|array['employee_id','actor_name','notes']) then raise exception 'Cleaning scope or foreign-field isolation failed';end if;
 data:=public.factory_agent_resource_query(limited_token,jsonb_build_array((q-'limit')||jsonb_build_object('action','read','id',first_page->'items'->0->>'id')));
 if data->'results'->0->'items'->0 is distinct from first_page->'items'->0 then raise exception 'Module exact Read changed data';end if;
 if (first_page->>'has_more')::boolean then
  second_page:=public.factory_agent_resource_query(limited_token,jsonb_build_array(q||jsonb_build_object('cursor',first_page->>'next_cursor')))->'results'->0;
  if second_page->'items'->0->>'id'=first_page->'items'->0->>'id' then raise exception 'Repeated page record';end if;
  perform pg_temp.reject_nav(all_token,jsonb_build_array(q||jsonb_build_object('business_module','factory_mesti_calibration','cursor',first_page->>'next_cursor')),'22023');
 end if;
 perform pg_temp.reject_nav(limited_token,jsonb_build_array(q-'business_module'),'42501');
 perform pg_temp.reject_nav(limited_token,jsonb_build_array(q||'{"module":"calibration"}'),'22023');
 perform pg_temp.reject_nav(limited_token,jsonb_build_array((q-'limit')||'{"action":"filter","filters":{"employee_id":"hidden"}}'),'22023');
 perform pg_temp.reject_nav(limited_token,jsonb_build_array(q,q||'{"business_module":"factory_mesti_calibration"}'),'42501');
 perform pg_temp.reject_nav(limited_token,jsonb_build_array(q||'{"resource":"production_records"}'),'42501');
 execute 'set local role postgres';
 -- Every binding reads the existing source authority; empty results remain explicit.
 for rec in select n.id,r.slug,b.row_scope from feedx_integrations.navigation_modules n join feedx_integrations.navigation_resources b on b.module_id=n.id join feedx_integrations.resources r on r.key=b.resource_key order by n.sort_order,r.slug loop
  q:=jsonb_build_array(jsonb_build_object('business_module',rec.id,'resource',rec.slug,'action','list','date_range',range,'limit',100));
  begin
   execute 'set local role anon';data:=public.factory_agent_resource_query(all_token,q);execute 'set local role postgres';
   if rec.row_scope ? 'module' and exists(select 1 from jsonb_array_elements(data->'results'->0->'items')a where a->>'module' is distinct from rec.row_scope->>'module') then raise exception 'Shared source escaped module';end if;
   if data::text ~ '"(employee_id|employee_snapshot|health_status|symptoms|operator_name|actor_name|actor_email|phone|email|notes|remarks|receipt_path|public_token|token_hash)"[ ]*:' then raise exception 'Private field exposed';end if;
   insert into nav_qa_results values(rec.id,rec.slug,'PASS',(data->'results'->0->>'returned')::integer,null);
  exception when others then execute 'set local role postgres';insert into nav_qa_results values(rec.id,rec.slug,'FAIL',null,sqlstate||':'||sqlerrm);end;
 end loop;
 -- One fixture walks all selectable modules; another module grant is never inferred.
 for rec in select n.id,c.tool_id,(select r.slug from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=n.id order by r.slug limit 1) resource from feedx_integrations.navigation_modules n join feedx_integrations.capabilities c on c.navigation_module_id=n.id where c.implemented order by n.sort_order loop
  execute 'set local role authenticated';
  if previous_cap<>rec.tool_id then perform public.external_agents_set_capabilities(limited_id,jsonb_build_array(jsonb_build_object('name',previous_cap,'granted',false,'expected',true),jsonb_build_object('name',rec.tool_id,'granted',true,'expected',false)));end if;
  previous_cap:=rec.tool_id;
  execute 'set local role postgres';
  for other in select n.id,(select r.slug from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key where b.module_id=n.id order by r.slug limit 1) resource from feedx_integrations.navigation_modules n where n.id<>rec.id loop
   execute 'set local role anon';
   perform pg_temp.reject_nav(limited_token,jsonb_build_array(jsonb_build_object('business_module',other.id,'resource',coalesce(other.resource,'production_performance'),'action','list','date_range',range)),'42501');
   execute 'set local role postgres';counter:=counter+1;
  end loop;
  if rec.id in ('factory_dashboard','factory_job_orders','factory_batch_traceability','factory_production_reports') then
   execute 'set local role anon';perform pg_temp.reject_nav(limited_token,jsonb_build_array(jsonb_build_object('business_module',rec.id,'resource',case when rec.id='factory_batch_traceability' then 'traceability' else rec.resource end,'action','list','date_range',range)),'42501');execute 'set local role postgres';
  elsif rec.id='factory_audit_logs' then
   execute 'set local role anon';data:=public.factory_agent_resource_query(limited_token,jsonb_build_array(jsonb_build_object('business_module',rec.id,'resource',rec.resource,'action','list','date_range',range)));execute 'set local role postgres';
   if data->'results'->0->>'returned'<>'0' then raise exception 'Audit-only grant exposed ungranted module activity';end if;
  end if;
 end loop;
 insert into nav_qa_results values('cross_module_denials',null,'PASS',counter,null);
 -- Permission changes must reach source authorization immediately, even with cached discovery.
 execute 'set local role authenticated';perform public.external_agents_set_capability(limited_id,previous_cap,false,true);
 begin perform public.external_agents_set_capability(limited_id,previous_cap,true,true);raise exception 'Stale grant accepted';exception when serialization_failure then null;end;
 perform public.external_agents_set_capability(limited_id,'nav_factory_production_view',true,false);
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(limited_token,jsonb_build_array(jsonb_build_object('business_module','factory_production','resource','production_records','action','list','date_range',range)));
 if exists(select 1 from jsonb_array_elements(data->'results'->0->'items')a where a ?|array['notes','operator_name','current_balance','unit_cost']) then raise exception 'Production exposed linked ungranted records';end if;
 execute 'set local role authenticated';perform public.external_agents_set_capability(limited_id,'nav_factory_production_view',false,true);
 execute 'set local role anon';perform pg_temp.reject_nav(limited_token,jsonb_build_array(jsonb_build_object('business_module','factory_production','resource','production_records','action','list','date_range',range)),'42501');
 execute 'set local role postgres';
 select to_jsonb(ro) into v_role from public.roles ro where ro.id=v_role_id;
 execute 'set local role authenticated';
 begin perform public.save_role_configuration(gen_random_uuid(),v_role,array['factory_mesti_inspection.view','factory_agent_mesti_review.view'],'{}');raise exception 'Role Settings bypassed navigation grants';exception when insufficient_privilege then null;end;
 begin perform public.external_agents_set_capability(limited_id,'factory_mesti_review_view',true,false);raise exception 'Gateway granted raw resource';exception when invalid_parameter_value then null;end;
 execute 'set local role authenticated';
 res:=public.save_role_configuration(gen_random_uuid(),v_role,array['factory_mesti_inspection.view','factory_agent_nav_factory_mesti_cleaning.view'],'{}');
 if jsonb_array_length(res->'permissions')<>2 then raise exception 'Canonical Role Settings did not preserve exact module grants';end if;
 execute 'set local role anon';
 perform public.factory_agent_resource_query(limited_token,jsonb_build_array(jsonb_build_object('business_module','factory_mesti_cleaning','resource','evidence','action','list','date_range',range)));
 execute 'set local role postgres';
 if (select count(*) from jsonb_array_elements(feedx_integrations.capability_snapshot('a8fe4694-93e2-4f27-b87d-e49d30ca245a'))a where (a->>'limited_access')::boolean)<>8 then raise exception 'Preserved QA scope is not visible on its eight modules';end if;
 -- Projection assertions do not create synthetic business records.
 record_row:=feedx_integrations.navigation_project_row(all_token,'factory_mesti_operator_hygiene','evidence','{"id":"proof","module":"operator_hygiene","inspected_count":7,"non_compliant_count":2,"employee_id":"secret","nested":{"other_module":"secret"}}');
 if record_row->>'inspected_count'<>'7' or record_row->>'non_compliant_count'<>'2' or record_row ?|array['employee_id','nested'] then raise exception 'Proof count or nested field policy failed';end if;
 record_row:=feedx_integrations.navigation_project_row(all_token,'factory_mesti_waste_disposal','evidence','{"id":"waste_disposal:event_123","module":"waste_disposal","parent_id":"waste_disposal:session_456"}');
 data:=feedx_integrations.navigation_project_row(all_token,'factory_mesti_waste_disposal','evidence','{"id":"waste_disposal:session_456","module":"waste_disposal"}');
 if record_row->>'parent_id' is distinct from data->>'id' then raise exception 'Module-scoped evidence parent reference is broken';end if;
 if feedx_integrations.audit_navigation_owner('factory_mesti_health_declaration_recorded') is not null or feedx_integrations.audit_navigation_owner('unknown_action') is not null then raise exception 'Sensitive or unclassified audit event attributed';end if;
 if (select md5(jsonb_build_object('identity',to_jsonb(m),'keys',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(rp.permission_id order by rp.permission_id) from public.role_permissions rp where rp.role_id=m.role_id))::text) from feedx_integrations.machine_identities m where name='QA Executive MeSTI Staging') is distinct from before_hash then raise exception 'Existing QA identity/key/grants changed';end if;
 insert into nav_qa_results values('grant_revoke_and_preservation',null,'PASS',null,null);
end $qa$;
select jsonb_agg(to_jsonb(r) order by module_id,resource) results from nav_qa_results r;
rollback;
