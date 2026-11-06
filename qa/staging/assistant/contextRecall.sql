-- L3 disposable fixtures only; no provider calls, business writes, grants or retained records.
-- Run against canonical Staging only. Every mutation is rolled back.
begin;
set local lock_timeout='3s';
do $qa$
declare actor uuid; other_actor uuid; sid uuid; snapshot jsonb; result jsonb; before_count bigint; source_seq bigint;
begin
 select ns.user_id into actor from feedx_integrations.native_assistant_sessions ns
  join public.employees e on e.auth_user_id=ns.user_id where e.role_id is not null order by ns.created_at limit 1;
 if actor is null then raise exception 'No existing Admin fixture owner'; end if;
 select auth_user_id into other_actor from public.employees where auth_user_id is not null and role_id is not null and enable_system_login and access_state='active' and coalesce(is_active,true) and auth_user_id<>actor limit 1;
 if other_actor is null then raise exception 'A second existing identity is required for privacy QA'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'session_new','{}');sid:=(result->>'session_id')::uuid;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'session_list','{}');
 if exists(select 1 from jsonb_array_elements(result->'sessions') x where x->>'id'=sid::text) then raise exception 'Empty thread listed'; end if;
 insert into feedx_integrations.native_assistant_requests(user_id,request_id,session_id,kind,prompt,reply,state,provider_revision,model,reserved_tokens,finished_at)
 select actor,gen_random_uuid(),sid,'turn','Context QA menu '||n,'Decision: approve the teal menu. Pending: confirm the source.','completed',c.provider_revision,c.model,500,now()
 from generate_series(1,10) n cross join feedx_integrations.native_assistant_config c;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 snapshot:=public.native_assistant_service(actor,'context_snapshot',jsonb_build_object('session_id',sid));
 if jsonb_array_length(snapshot->'context')<>10 then raise exception 'Complete context unavailable'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_service(actor,'context_summary',jsonb_build_object('session_id',sid,'version','extractive-v1','fingerprint',snapshot->>'fingerprint','text','QA derived summary'));
 if (select context_summary is null from feedx_integrations.native_assistant_sessions where id=sid) then raise exception 'Summary not cached'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'history_recall','{"query":"Context QA menu"}');
 if jsonb_array_length(result->'sources')>3 or not exists(select 1 from jsonb_array_elements(result->'sources') x where x->>'session_id'=sid::text) then raise exception 'Recall missing/beyond bound'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'session_list','{"query":"confirm the source"}');
 if not exists(select 1 from jsonb_array_elements(result->'sessions') x where x->>'id'=sid::text) then raise exception 'Content search failed'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(other_actor,'history_recall','{"query":"Context QA menu"}');
 if exists(select 1 from jsonb_array_elements(result->'sources') x where x->>'session_id'=sid::text) then raise exception 'Cross-user history leaked'; end if;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(other_actor,'context_snapshot',jsonb_build_object('session_id',sid));
  raise exception 'Foreign context accepted';
 exception when insufficient_privilege then null;
 end;
 update feedx_integrations.native_assistant_requests set prompt='Revised QA decision' where session_id=sid and seq=(select min(seq) from feedx_integrations.native_assistant_requests where session_id=sid);
 if (select context_summary is not null from feedx_integrations.native_assistant_sessions where id=sid) then raise exception 'Summary not invalidated'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_service(actor,'session_delete',jsonb_build_object('session_id',sid));
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_service(actor,'history_recall','{"query":"Context QA menu"}');
 if exists(select 1 from jsonb_array_elements(result->'sources') x where x->>'session_id'=sid::text) then raise exception 'Deleted history recalled'; end if;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(actor,'history',jsonb_build_object('session_id',sid));
  raise exception 'Deleted history returned';
 exception when insufficient_privilege then null;
 end;
 if has_function_privilege('authenticated','public.native_assistant_service(uuid,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.native_assistant_service(uuid,text,jsonb)','EXECUTE') then raise exception 'Dispatcher client grant'; end if;
end $qa$;
rollback;
select 'PASS: rollback-only empty/history/content-search/summary-invalidation/recall/privacy/deletion/grants' as outcome;
