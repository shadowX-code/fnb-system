-- Investigation/regression only: security fixtures and confirmations roll back; no business records change.
begin;
create temp table source_review_results(scenario text,checks integer,outcome text);
do $$declare owner_id uuid;fixture jsonb;agent uuid;token text;plan jsonb;wanted text[];full_grants text[];partial_grants text[];binding record;source_id text;source_tool text;partial_checks integer:=0;full_checks integer:=0;before_hash text;actual_agent uuid;actual_catalog jsonb;query jsonb;begin
 select e.auth_user_id into owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 select m.id,md5(jsonb_build_object('identity',to_jsonb(m),'credentials',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(p.permission_id order by p.permission_id) from public.role_permissions p where p.role_id=m.role_id))::text) into actual_agent,before_hash from feedx_integrations.machine_identities m where m.name='QA Executive MeSTI Staging';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);execute 'set local role authenticated';
 -- The exact counterfactual: Planning alone, then Finished Goods, with Job Order absent.
 fixture:=public.external_agents_register(gen_random_uuid(),'Planning source investigation '||gen_random_uuid(),'QA','factory_mesti',array['nav_factory_production_planning_view'],90);agent:=(fixture->>'identity_id')::uuid;token:=fixture->>'one_time_credential';
 execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id=agent;execute 'set local role authenticated';
 wanted:=array['nav_factory_production_planning_view','nav_factory_finished_goods_view'];plan:=public.external_agents_review_access(agent,wanted);
 if exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'after')p where p->>'resource'='planning_open_orders') or exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'material_changes')p where p->>'label'='Open planned quantities' and p->>'effect'='added') then raise exception 'False availability without Job Order';end if;
 if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'blockers')b where b->>'label'='Open planned quantities' and jsonb_array_length(b->'missing')=1 and b->'missing'->0->>'label'='Job Order') then raise exception 'Exact remaining Job Order source not reported';end if;
 perform public.external_agents_confirm_access(agent,wanted,plan->>'review_hash');
 query:='[{"business_module":"factory_production_planning","resource":"planning_open_orders","action":"list","date_range":{"from":"2026-10-23","to":"2026-10-29"},"limit":1}]';
 execute 'set local role anon';begin perform public.factory_agent_resource_query(token,query);raise exception 'MCP query allowed incomplete source grants';exception when insufficient_privilege then null;end;
 execute 'set local role authenticated';wanted:=wanted||'nav_factory_job_order_records_view'::text;plan:=public.external_agents_review_access(agent,wanted);
 if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'material_changes')p where p->>'label'='Open planned quantities' and p->>'effect'='added') then raise exception 'Final required grant did not unlock review';end if;
 perform public.external_agents_confirm_access(agent,wanted,plan->>'review_hash');execute 'set local role anon';perform public.factory_agent_resource_query(token,query);execute 'set local role postgres';
 insert into source_review_results values('Planning + Finished Goods denies; adding Job Order permits the MCP query',2,'PASS');
 -- Read the actual saved QA Executive grants, without confirming any changes to that agent.
 actual_catalog:=feedx_integrations.business_capability_catalog(actual_agent);
 if not exists(select 1 from jsonb_array_elements(actual_catalog)c where c->>'name'='nav_factory_job_order_records_view' and (c->>'granted')::boolean) then raise exception 'Actual baseline changed: inspect current Job Order grant';end if;
 select array_agg(name order by name) into wanted from (select c->>'name' name from jsonb_array_elements(actual_catalog)c where (c->>'granted')::boolean union select 'nav_factory_finished_goods_view')q;
 execute 'set local role authenticated';plan:=public.external_agents_review_access(actual_agent,wanted);execute 'set local role postgres';
 if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'after')p where p->>'resource'='planning_open_orders') then raise exception 'Actual fully satisfied source grants were not recognized';end if;
 insert into source_review_results values('Actual QA Executive already holds Job Order; Finished Goods satisfies final source',1,'PASS');
 -- Omit each required source in turn for every source-gated mapping, then restore it.
 for binding in select b.*,r.slug,r.label resource_label,c.tool_id from feedx_integrations.navigation_resources b join feedx_integrations.resources r on r.key=b.resource_key join feedx_integrations.capabilities c on c.navigation_module_id=b.module_id and c.action_type='view' where b.required_modules<>'[]' order by b.module_id,r.slug loop
  select array_agg(distinct tool order by tool) into full_grants from (select binding.tool_id tool union select c.tool_id from feedx_integrations.capabilities c where c.navigation_module_id in (select jsonb_array_elements_text(binding.required_modules)) and c.action_type='view' and c.implemented)g;
  execute 'set local role authenticated';fixture:=public.external_agents_register(gen_random_uuid(),'All sources regression '||gen_random_uuid(),'QA','factory_mesti',full_grants,90);agent:=(fixture->>'identity_id')::uuid;token:=fixture->>'one_time_credential';
  execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id=agent;
  query:=jsonb_build_array(jsonb_build_object('business_module',binding.module_id,'resource',binding.slug,'action','list','limit',1,'date_range',jsonb_build_object('from','2026-10-23','to','2026-10-29')));
  for source_id in select jsonb_array_elements_text(binding.required_modules) loop
   select c.tool_id into strict source_tool from feedx_integrations.capabilities c where c.navigation_module_id=source_id and c.action_type='view';
   partial_grants:=array_remove(full_grants,source_tool);execute 'set local role authenticated';plan:=public.external_agents_review_access(agent,partial_grants);
   if exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'after')p where p->>'module_id'=binding.module_id and p->>'resource'=binding.slug) then raise exception 'False positive %/% without %',binding.module_id,binding.slug,source_id;end if;
   if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'blockers')b where b->>'label'=binding.resource_label and jsonb_array_length(b->'missing')=1 and b->'missing'->0->>'name'=source_tool) then raise exception 'Missing-source report mismatch %/%',binding.module_id,binding.slug;end if;
   perform public.external_agents_confirm_access(agent,partial_grants,plan->>'review_hash');execute 'set local role anon';begin perform public.factory_agent_resource_query(token,query);raise exception 'MCP query bypassed omitted source %/%',binding.module_id,binding.slug;exception when insufficient_privilege then null;end;
   partial_checks:=partial_checks+1;execute 'set local role authenticated';plan:=public.external_agents_review_access(agent,full_grants);
   if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'after')p where p->>'module_id'=binding.module_id and p->>'resource'=binding.slug) then raise exception 'Fully satisfied resource absent from review %/%',binding.module_id,binding.slug;end if;
   perform public.external_agents_confirm_access(agent,full_grants,plan->>'review_hash');execute 'set local role anon';perform public.factory_agent_resource_query(token,query);full_checks:=full_checks+1;execute 'set local role postgres';
  end loop;
 end loop;
 insert into source_review_results values('Every required-source omission denied after confirmation',partial_checks,'PASS'),('Every complete source set authorized after confirmation',full_checks,'PASS');
 if (select md5(jsonb_build_object('identity',to_jsonb(m),'credentials',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(p.permission_id order by p.permission_id) from public.role_permissions p where p.role_id=m.role_id))::text) from feedx_integrations.machine_identities m where m.id=actual_agent) is distinct from before_hash then raise exception 'Existing agent changed';end if;
end $$;
select jsonb_agg(to_jsonb(r)) results from source_review_results r;
rollback;
