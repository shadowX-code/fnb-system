-- Disposable security fixtures only; never changes business records.
begin;
create temp table gateway_qa_results(resource text,outcome text,returned integer,detail text);
do $qa$
declare owner_id uuid;all_caps text[];v_id uuid;limited_id uuid;res jsonb;token text;limited text;rec record;q jsonb;data jsonb;range jsonb:='{"from":"2026-10-01","to":"2026-10-31"}';baseline text;foreign_exists boolean;first_page jsonb;second_page jsonb;expected_count bigint;actual_count bigint;
begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 select array_agg(tool_id) into all_caps from feedx_integrations.capabilities where action_type='view';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 res:=public.external_agents_register(gen_random_uuid(),'Unified Rollback QA '||gen_random_uuid(),'Rollback QA','factory_mesti',all_caps);token:=res->>'one_time_credential';v_id:=(res->>'identity_id')::uuid;
 res:=public.external_agents_register(gen_random_uuid(),'Isolated Rollback QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['factory_job_orders_view']);limited:=res->>'one_time_credential';limited_id:=(res->>'identity_id')::uuid;
 execute 'set local role postgres';
 update feedx_integrations.machine_credentials set created_at=statement_timestamp() where identity_id in (v_id,limited_id);
 for rec in select slug from feedx_integrations.resources order by slug loop
  q:=jsonb_build_array(jsonb_build_object('resource',rec.slug,'action','list','date_range',range,'limit',100));
  begin
   execute 'set local role anon';data:=public.factory_agent_resource_query(token,q);execute 'set local role postgres';
   if data::text ~ '"(employee_id|employee_snapshot|symptoms|health_status|operator_name|operator_id|contact_person|phone|email|visitor_contact|notes|remarks|receipt_path|public_token|session_hash|token_hash|checked_by_name|actor_email|actor_name)"[ ]*:' then raise exception 'Sensitive field leaked in %',rec.slug;end if;
   insert into gateway_qa_results values(rec.slug,'PASS',(data->'results'->0->>'returned')::integer,null);
  exception when others then execute 'set local role postgres';insert into gateway_qa_results values(rec.slug,'FAIL',null,sqlstate||':'||sqlerrm);end;
 end loop;
 execute 'set local role anon';
 -- Reauthorize each operation; one View Records grant covers the four query shapes.
 execute 'set local role postgres';
 for rec in select slug from feedx_integrations.resources loop
  execute 'set local role anon';
  q:=jsonb_build_object('resource',rec.slug,'action','list','date_range',range,'limit',1);
  first_page:=public.factory_agent_resource_query(token,jsonb_build_array(q))->'results'->0;
  if (first_page->>'returned')::int>0 then
   data:=public.factory_agent_resource_query(token,jsonb_build_array((q-'limit')||jsonb_build_object('action','read','id',first_page->'items'->0->>'id')));
   if data->'results'->0->'items'->0 is distinct from first_page->'items'->0 then raise exception 'Exact read differs for %',rec.slug;end if;
  end if;
  if (first_page->>'has_more')::boolean then
   second_page:=public.factory_agent_resource_query(token,jsonb_build_array(q||jsonb_build_object('cursor',first_page->>'next_cursor')))->'results'->0;
   if second_page->'items'->0->>'id'=first_page->'items'->0->>'id' then raise exception 'Pagination repeated record';end if;
   begin perform public.factory_agent_resource_query(token,jsonb_build_array(q||jsonb_build_object('limit',2,'cursor',first_page->>'next_cursor')));raise exception 'Cursor scope escaped';exception when invalid_parameter_value then null;end;
  end if;
  execute 'set local role postgres';
 end loop;
 execute 'set local role anon';
 data:=public.factory_agent_resource_query(limited,jsonb_build_array(jsonb_build_object('resource','job_orders','action','list','date_range',range,'limit',100)));
 if exists(select 1 from jsonb_array_elements(data->'results'->0->'items')r where r ?| array['finished_good_id','production_sop_id','assigned_team','production_operator_id','remarks']) then raise exception 'Hidden fields exposed.';end if;
 begin perform public.factory_agent_resource_query(limited,jsonb_build_array(jsonb_build_object('resource','job_orders','action','filter','date_range',range,'filters',jsonb_build_object('finished_good_id',gen_random_uuid()))));raise exception 'Hidden-field filter accepted';exception when invalid_parameter_value then null;end;
 begin perform public.factory_agent_resource_query(limited,jsonb_build_array(jsonb_build_object('resource','job_orders','action','list','date_range',range),jsonb_build_object('resource','production_records','action','list','date_range',range)));raise exception 'Cross-resource permission escaped';exception when insufficient_privilege then null;end;
 begin perform public.factory_agent_resource_query(limited,jsonb_build_array(jsonb_build_object('resource','dashboard','action','list','date_range',range)));raise exception 'Summary permission escaped';exception when insufficient_privilege then null;end;
 execute 'set local role authenticated';
 perform public.external_agents_set_capabilities(limited_id,'[{"name":"factory_job_orders_view","granted":false,"expected":true}]');
 execute 'set local role anon';
 begin perform public.factory_agent_resource_query(limited,jsonb_build_array(jsonb_build_object('resource','job_orders','action','list','date_range',range)));raise exception 'Revocation not enforced';exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
 -- Disposable expiry and enabled state; QA credential remains untouched.
 update feedx_integrations.machine_credentials set expires_at=statement_timestamp()-interval '1 second',created_at=statement_timestamp()-interval '1 day' where identity_id=limited_id;
 execute 'set local role anon';
 begin perform public.factory_mesti_inspection(limited,'authorize');raise exception 'Expired credential accepted';exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
 if not public.factory_mesti_recurrence_due('weekly',array[1],'2026-10-26') or public.factory_mesti_recurrence_due('weekly',array[1],'2026-10-27') or not public.factory_mesti_recurrence_due('daily','{}','2026-10-27') then raise exception 'Canonical recurrence failed';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_schedules('2026-10-01','2026-10-31')v where v->>'schedule_basis'='current_requirement_binding' and ((v->>'effective_from')::date>(v->>'business_date')::date or (v->>'effective_until' is not null and (v->>'business_date')::date>=(v->>'effective_until')::date))) then raise exception 'Effective-date interval failed';end if;
 select count(*) into expected_count from public.factory_mesti_health_declarations where voided_at is null and (declared_at at time zone 'Asia/Kuala_Lumpur')::date between '2026-10-01' and '2026-10-31';
 select coalesce(sum((v->>'record_count')::bigint),0) into actual_count from feedx_integrations.mesti_resource_occurrences('2026-10-01','2026-10-31')v where v->>'module'='health_declaration';
 if actual_count<>expected_count then raise exception 'Health count differs from canonical source';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_schedules('2026-10-01','2026-10-31')v join public.factory_productions p on p.id=(v->>'production_id')::uuid where v->>'source_type' in ('production_end','after_production') and (v->>'business_date')::date<>p.end_date) then raise exception 'Production End attribution failed';end if;
 if exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id join feedx_integrations.machine_identities m on m.role_id=rp.role_id where m.name='QA Executive MeSTI Staging' and p.code not in ('factory_mesti_inspection.view','factory_agent_mesti_review.view')) then raise exception 'QA Executive scope expanded';end if;
 insert into gateway_qa_results values('isolation_and_revocation','PASS',null,null);
end $qa$;
select jsonb_agg(to_jsonb(r) order by resource) results from gateway_qa_results r;

rollback;
