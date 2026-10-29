-- Security fixtures only; all identities, credentials, grants and audit events roll back.
begin;
do $$declare owner_id uuid;fixture jsonb;agent uuid;plan jsonb;token text;before_data jsonb;after_data jsonb;before_hash text;begin
 select e.auth_user_id into owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 select md5(jsonb_build_object('identity',to_jsonb(m),'credentials',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(p.permission_id order by p.permission_id) from public.role_permissions p where p.role_id=m.role_id))::text) into before_hash from feedx_integrations.machine_identities m where m.name='QA Executive MeSTI Staging';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);execute 'set local role authenticated';
 plan:=public.external_agents_review_access(null,array['nav_factory_mesti_calibration_view']);
 if jsonb_array_length(plan->'changes')<>1 or jsonb_array_length(plan->'effective_diff'->'before')<>0 or jsonb_array_length(plan->'effective_diff'->'after')<>5 or plan->'effective_diff'->'blockers'<>'[]' then raise exception 'Single addition diff incorrect';end if;
 fixture:=public.external_agents_register(gen_random_uuid(),'Effective review QA '||gen_random_uuid(),'QA','factory_mesti',array['nav_factory_job_orders_view'],90);agent:=(fixture->>'identity_id')::uuid;token:=fixture->>'one_time_credential';
 execute 'set local role postgres';update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id=agent;execute 'set local role authenticated';
 plan:=public.external_agents_review_access(agent,array['nav_factory_job_orders_view','nav_factory_production_view']);
 if (select count(*) from jsonb_array_elements(plan->'effective_diff'->'material_changes')v where v->>'effect'='added' and v->>'owner'='Production Overview')<>2 then raise exception 'Cross-module source unlock hidden';end if;
 if exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'blockers')v where v->>'kind'<>'pre_existing') then raise exception 'Existing limitation reported as new blocker';end if;
 before_data:=plan->'effective_diff'->'after';
 perform public.external_agents_confirm_access(agent,array['nav_factory_job_orders_view','nav_factory_production_view'],plan->>'review_hash');
 execute 'set local role anon';
 perform public.factory_agent_resource_query(token,'[{"business_module":"factory_job_orders","resource":"material_usage","action":"list","date_range":{"from":"2026-10-23","to":"2026-10-29"}}]');
 begin perform public.factory_agent_resource_query(token,'[{"business_module":"factory_job_orders","resource":"receiving_costs","action":"list","date_range":{"from":"2026-10-23","to":"2026-10-29"}}]');raise exception 'Diff implied cost access without source grant';exception when insufficient_privilege then null;end;
 execute 'set local role authenticated';
 begin perform public.external_agents_confirm_access(agent,array['nav_factory_job_orders_view','nav_factory_production_view'],plan->>'review_hash');raise exception 'Stale review accepted';exception when serialization_failure then null;end;
 plan:=public.external_agents_review_access(agent,array['nav_factory_job_orders_view']);
 if (select count(*) from jsonb_array_elements(plan->'effective_diff'->'blockers')v where v->>'kind'='new_blocker')<>2 then raise exception 'New blockers incorrect';end if;
 if (select count(*) from jsonb_array_elements(plan->'effective_diff'->'material_changes')v where v->>'effect'='removed' and v->>'owner'='Production Overview')<>2 then raise exception 'Lost retained-module data hidden';end if;
 -- Changes involving multiple added/removed grants have one before/after snapshot.
 plan:=public.external_agents_review_access(agent,array['nav_factory_mesti_cleaning_view','nav_factory_mesti_calibration_view']);
 if jsonb_array_length(plan->'changes')<>4 or jsonb_array_length(plan->'effective_diff'->'after')<>10 then raise exception 'Multi-grant diff incorrect';end if;
 fixture:=public.external_agents_register(gen_random_uuid(),'Shared review QA '||gen_random_uuid(),'QA','factory_mesti',array['nav_factory_mesti_cleaning_view','nav_factory_mesti_calibration_view'],90);agent:=(fixture->>'identity_id')::uuid;
 execute 'set local role postgres';insert into public.role_permissions(role_id,permission_id) select m.role_id,p.id from feedx_integrations.machine_identities m cross join public.permissions p where m.id=agent and p.code='factory_agent_mesti_review.view';execute 'set local role authenticated';
 plan:=public.external_agents_review_access(agent,array['nav_factory_mesti_calibration_view','factory_mesti_review_view']);
 if jsonb_array_length(plan->'effective_diff'->'remaining_shared_access')<>1 or plan->'effective_diff'->'remaining_shared_access'->0->>'via'<>'Compliance review records' then raise exception 'Retained redacted scope hidden or unrelated MeSTI scope conflated';end if;
 fixture:=public.external_agents_register(gen_random_uuid(),'Audit review QA '||gen_random_uuid(),'QA','factory_mesti',array['nav_factory_audit_logs_view'],90);agent:=(fixture->>'identity_id')::uuid;
 plan:=public.external_agents_review_access(agent,array['nav_factory_audit_logs_view','nav_factory_equipment_view']);
 if not exists(select 1 from jsonb_array_elements(plan->'effective_diff'->'material_changes')v where v->>'owner'='Audit Trail' and v->>'effect'='changed' and v->'before'->'audit_modules'='[]' and v->'after'->'audit_modules' @> '[{"id":"factory_equipment"}]') then raise exception 'Audit cross-module exposure hidden';end if;
 execute 'set local role postgres';
 if (select md5(jsonb_build_object('identity',to_jsonb(m),'credentials',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(p.permission_id order by p.permission_id) from public.role_permissions p where p.role_id=m.role_id))::text) from feedx_integrations.machine_identities m where m.name='QA Executive MeSTI Staging') is distinct from before_hash then raise exception 'Working QA Executive identity, key or grants changed';end if;
 if has_function_privilege('anon','feedx_integrations.review_effective_paths(text[])','execute') or has_function_privilege('authenticated','feedx_integrations.review_effective_paths(text[])','execute') then raise exception 'Private scope projection exposed';end if;
end $$;
rollback;
select 'PASS: single/multi changes, cross-module exposure and denial, blocker classification, retained review overlap, stale rejection and credential/grant continuity' result;
