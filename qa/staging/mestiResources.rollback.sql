-- Role/key fixtures only. MeSTI business data is read, never changed.
begin;
create function pg_temp.reject_resource(p_token text,p_queries jsonb,p_code text) returns void language plpgsql as $$
begin
 begin perform public.factory_mesti_resource_query(p_token,p_queries);raise exception 'Unsafe resource request succeeded.';
 exception when others then if sqlstate<>p_code then raise;end if;end;
end $$;
do $qa$
declare owner_id uuid;v_identity_id uuid;result jsonb;token text;limited_token text;limited_id uuid;query jsonb;queries jsonb;response jsonb;data jsonb;first_id text;cursor text;first_page jsonb;second_page jsonb;
 v_from date:='2026-10-01';v_to date:='2026-10-31';v_range jsonb;baseline text;projection text;business_counts jsonb;expected_count bigint;actual_count bigint;all_tools text[];operation text;resource text;cap text;raw_count bigint;
begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null and e.enable_system_login and e.access_state='active' limit 1;
 select md5(jsonb_build_object('identity',to_jsonb(m),'keys',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(permission_id order by permission_id) from public.role_permissions where role_id=m.role_id))::text) into baseline from feedx_integrations.machine_identities m where name='QA Executive MeSTI Staging';
 select md5(pg_get_functiondef('feedx_integrations.mesti_rows(date,date)'::regprocedure)) into projection;
 select jsonb_build_object('area',(select count(*) from public.factory_mesti_cleaning_occurrences),'equipment',(select count(*) from public.factory_mesti_equipment_cleaning_occurrences),'calibration',(select count(*) from public.factory_mesti_calibration_records),'health',(select count(*) from public.factory_mesti_health_declarations),'hygiene',(select count(*) from public.factory_mesti_operator_hygiene_sessions),'waste',(select count(*) from public.factory_mesti_waste_disposal_events)) into business_counts;
 if exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id join feedx_integrations.machine_identities m on m.role_id=rp.role_id where m.name='QA Executive MeSTI Staging' and p.code like 'factory_mesti_resource_%') then raise exception 'Legacy grants silently broadened.';end if;
 select array_agg(tool_id order by sort_order) into all_tools from feedx_integrations.capabilities where resource_key is not null;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 result:=public.external_agents_register(gen_random_uuid(),'Resource QA '||gen_random_uuid(),'Rollback QA','factory_mesti',all_tools);
 v_identity_id:=(result->>'identity_id')::uuid;token:=result->>'one_time_credential';
 result:=public.external_agents_register(gen_random_uuid(),'Limited Resource QA '||gen_random_uuid(),'Rollback QA','factory_mesti',array['mesti_requirements_list']);
 limited_id:=(result->>'identity_id')::uuid;limited_token:=result->>'one_time_credential';
 execute 'set local role postgres';
 -- Management API runs the file under one request timestamp; adjust only the disposable keys.
 update feedx_integrations.machine_credentials set created_at=statement_timestamp() where machine_credentials.identity_id in (v_identity_id,limited_id);
 execute 'set local role anon';
 data:=public.factory_mesti_inspection(token,'authorize');
 if data->'tools'<>'["query_mesti_resources"]'::jsonb or jsonb_array_length(data->'resource_actions')<>20 then raise exception 'Resource-only identity gained legacy tools or incorrect actions.';end if;
 data:=public.factory_mesti_inspection(limited_token,'authorize');
 if jsonb_array_length(data->'resource_actions')<>1 then raise exception 'Limited action discovery broadened access.';end if;
 v_range:=jsonb_build_object('from',v_from,'to',v_to);
 query:=jsonb_build_object('resource','requirements','action','list','date_range',v_range,'limit',1);
 first_page:=public.factory_mesti_resource_query(token,jsonb_build_array(query))->'results'->0;
 if jsonb_array_length(first_page->'items')<>1 then raise exception 'Expected real Staging requirement data.';end if;
 first_id:=first_page->'items'->0->>'id';cursor:=first_page->>'next_cursor';
 if cursor is null then raise exception 'Expected multiple Staging requirements for pagination QA.';end if;
 second_page:=public.factory_mesti_resource_query(token,jsonb_build_array(query||jsonb_build_object('cursor',cursor)))->'results'->0;
 if second_page->'items'->0->>'id'=first_id or jsonb_array_length(second_page->'items')<>1 then raise exception 'Keyset pagination repeated or skipped its next page.';end if;
 data:=public.factory_mesti_resource_query(token,jsonb_build_array(jsonb_build_object('resource','requirements','action','read','date_range',v_range,'id',first_id)));
 if data->'results'->0->'items'->0->>'id'<>first_id then raise exception 'Resource Read did not resolve its exact ID.';end if;
 -- Every implemented resource/action is independently callable with the corresponding grant.
 foreach resource in array array['requirements','occurrences','statuses','schedules','evidence'] loop
  foreach operation in array array['list','read','search','filter'] loop
   query:=jsonb_build_object('resource',resource,'action',operation,'date_range',v_range);
   if operation='read' then query:=query||jsonb_build_object('id','qa_nonexistent_resource');
   elsif operation='search' then query:=query||jsonb_build_object('search','QA_LITERAL_NOT_PRESENT');
   elsif operation='filter' then query:=query||jsonb_build_object('filters',case when resource='schedules' then '{"source_type":"scheduled"}'::jsonb else '{"record_status":"active"}'::jsonb end);end if;
   response:=public.factory_mesti_resource_query(token,jsonb_build_array(query));
   if response->'results'->0->>'resource'<>resource or (response->>'read_only')::boolean is not true then raise exception 'Resource/action mapping failed.';end if;
   if response::text ~ '"(employee_id|employee_snapshot|health_status|symptoms|notes|remarks|visitor_name|visitor_contact|checked_by|recorded_by|recommended_follow_up|severity)":' then raise exception 'Sensitive fields or analysis leaked from resource authority.';end if;
  end loop;
 end loop;
 query:=jsonb_build_object('resource','requirements','action','list','date_range',v_range);
 perform pg_temp.reject_resource(limited_token,jsonb_build_array(query,jsonb_build_object('resource','evidence','action','list','date_range',v_range)),'42501');
 perform pg_temp.reject_resource(limited_token,jsonb_build_array(query||'{"action":"read","id":"anything"}'::jsonb),'42501');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"resource":"production"}'::jsonb),'42501');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"action":"execute"}'::jsonb),'42501');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"sql":"select * from employees"}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"limit":101}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"date_range":{"from":"2026-10-01","to":"2026-11-01"}}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"date_range":{"from":"2026-02-30","to":"2026-03-01"}}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"action":"filter","filters":{"employee_id":"hidden"}}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"action":"filter","filters":{"health_status":"cleared"}}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||jsonb_build_object('resource','evidence','cursor',cursor,'limit',1)),'22023');
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"include":["evidence"]}'::jsonb),'22023');
 perform pg_temp.reject_resource(token,'[]'::jsonb,'22023');
 response:=public.factory_mesti_resource_query(token,jsonb_build_array(query||jsonb_build_object('action','search','search','literal_OR_1_EQ_1_percent_%_underscore_')));
 if (response->'results'->0->>'returned')::integer<>0 then raise exception 'Literal search became an expression or wildcard.';end if;
 execute 'set local role authenticated';
 perform public.external_agents_set_capability(v_identity_id,'mesti_evidence_list',false,true);
 execute 'set local role anon';
 perform pg_temp.reject_resource(token,jsonb_build_array(query||'{"resource":"evidence"}'::jsonb),'42501');
 execute 'set local role authenticated';
 perform public.external_agents_set_capability(v_identity_id,'mesti_evidence_list',true,false);
 execute 'set local role anon';
 response:=public.factory_mesti_resource_query(token,jsonb_build_array(query||'{"resource":"evidence","module":"health_declaration","limit":100}'::jsonb));
 execute 'set local role postgres';
 select coalesce(sum((v->>'record_count')::bigint),0) into actual_count from jsonb_array_elements(response->'results'->0->'items') v;
 select count(*) into expected_count from public.factory_mesti_health_declarations where voided_at is null and (declared_at at time zone 'Asia/Kuala_Lumpur')::date between v_from and v_to;
 if actual_count<>expected_count then raise exception 'Health aggregates do not match canonical non-voided Malaysia dates.';end if;
 select count(*) into actual_count from feedx_integrations.mesti_resource_occurrences(v_from,v_to) v where v->>'module'='cleaning_of_area';
 select count(*) into expected_count from public.factory_mesti_cleaning_occurrences where due_date between v_from and v_to;
 if actual_count<>expected_count then raise exception 'Occurrences invented or omitted saved cleaning records.';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_occurrences(v_from,v_to) v join public.factory_mesti_cleaning_occurrences o on v->>'id'='cleaning_of_area:'||o.id where v->>'record_status'<>o.status or (v->>'business_date')::date<>o.due_date) then raise exception 'Canonical lifecycle/date was replaced by a compliance verdict.';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_schedules(v_from,v_to) v where v->>'schedule_basis'='current_requirement_binding' and ((v->>'effective_from')::date>(v->>'business_date')::date or (v->>'effective_until' is not null and (v->>'business_date')::date>=(v->>'effective_until')::date))) then raise exception 'Effective interval boundary violated.';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_schedules(v_from,v_to) v join public.factory_mesti_cleaning_occurrences o on v->>'id'='cleaning_of_area:'||o.due_date||':'||o.id where v->'version' is distinct from o.requirement_snapshot->'version_no') then raise exception 'Issued requirement version was reconstructed.';end if;
 if exists(select 1 from feedx_integrations.mesti_resource_schedules(v_from,v_to) v join public.factory_productions p on p.id=(v->>'production_id')::uuid where v->>'source_type' in ('production_end','after_production') and (v->>'business_date')::date<>p.end_date) then raise exception 'Production End date attribution violated.';end if;
 if not public.factory_mesti_recurrence_due('weekly',array[1],'2026-10-26') or public.factory_mesti_recurrence_due('weekly',array[1],'2026-10-27') or not public.factory_mesti_recurrence_due('daily','{}','2026-10-27') then raise exception 'Canonical Daily/Weekly semantics failed.';end if;
 -- Resource telemetry may store operation names, never request text, filters or secret values.
 perform public.external_agents_record_resource_access(encode(extensions.digest(token,'sha256'),'hex'),'success',null,'external','[{"resource":"requirements","action":"list","search":"PRIVATE_SENTINEL"}]');
 if exists(select 1 from feedx_integrations.access_events where access_events.identity_id=v_identity_id and (resource_actions::text like '%PRIVATE_SENTINEL%' or resource_actions::text like '%'||token||'%')) then raise exception 'Resource telemetry stored unapproved data.';end if;
 if not exists(select 1 from public.audit_logs where trusted_external_agent and action='external_agent_capability_revoked' and user_id=owner_id and metadata->>'identity_id'=v_identity_id::text and metadata->>'tool'='mesti_evidence_list') then raise exception 'Resource permission change lost canonical audit compatibility.';end if;
 if baseline is distinct from (select md5(jsonb_build_object('identity',to_jsonb(m),'keys',(select jsonb_agg(to_jsonb(c) order by c.id) from feedx_integrations.machine_credentials c where c.identity_id=m.id),'permissions',(select jsonb_agg(permission_id order by permission_id) from public.role_permissions where role_id=m.role_id))::text) from feedx_integrations.machine_identities m where name='QA Executive MeSTI Staging') then raise exception 'Existing agent identity, credential or grants changed.';end if;
 if projection<>md5(pg_get_functiondef('feedx_integrations.mesti_rows(date,date)'::regprocedure)) then raise exception 'Legacy compliance projection changed.';end if;
 if business_counts is distinct from jsonb_build_object('area',(select count(*) from public.factory_mesti_cleaning_occurrences),'equipment',(select count(*) from public.factory_mesti_equipment_cleaning_occurrences),'calibration',(select count(*) from public.factory_mesti_calibration_records),'health',(select count(*) from public.factory_mesti_health_declarations),'hygiene',(select count(*) from public.factory_mesti_operator_hygiene_sessions),'waste',(select count(*) from public.factory_mesti_waste_disposal_events)) then raise exception 'Read operation materialized business records.';end if;
end $qa$;
rollback;
select 'PASS: 20 independent resource actions, atomic cross-resource denial, exact grants/revocation, field redaction, bounded queries/cursors, real canonical lifecycle/date/count accuracy, recurrence/snapshot/Production End semantics, audit and unchanged legacy identity/key/grants; no business records materialized' as result;
