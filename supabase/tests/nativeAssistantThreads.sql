-- Transactional canonical Staging test. No provider call, no lasting fixture rows.
begin;
set local lock_timeout='2s';
do $test$
declare
 owner_id uuid; other_id uuid; candidate record; sid uuid; r jsonb; payload jsonb;
 voice_before bigint; evidence_before bigint; older bigint;
begin
 select count(*) into voice_before from feedx_integrations.native_assistant_requests where voice_lease_id is not null;
 select count(*) into evidence_before from feedx_integrations.native_assistant_requests where evidence is not null;
 for candidate in
  select distinct u.id,u.email from auth.users u
   where exists(select 1 from public.employees e where e.auth_user_id=u.id or e.id=u.id)
      or exists(select 1 from public.user_profiles p where p.id=u.id)
 loop
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',candidate.id,'email',candidate.email)::text,true);
  perform set_config('request.jwt.claim.sub',candidate.id::text,true);
  if public.current_user_role_id() is not null then
   if owner_id is null then owner_id:=candidate.id; else other_id:=candidate.id; exit; end if;
  end if;
 end loop;
 if other_id is null then raise exception 'Two active Admin identities are required for this check'; end if;
 insert into feedx_integrations.native_assistant_sessions(user_id,created_at) values(owner_id,now()-interval '2 days') returning id into sid;
 payload:=jsonb_build_object('session_id',sid);
 insert into feedx_integrations.native_assistant_requests(user_id,request_id,session_id,kind,prompt,reply,provider_revision,model,reserved_tokens,state,finished_at)
 select owner_id,gen_random_uuid(),sid,'turn',case when i=1 then 'Hello' else 'Fixture work planning '||i end,'Fixture reply',0,'gpt-4o-mini',1,'completed',now()
 from generate_series(1,21) i;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'history',payload);
 if (r->>'title') is distinct from 'Fixture work planning 2' or jsonb_array_length(r->'turns')<>20 or r->>'has_more'<>'true'
  then raise exception 'Auto-title or first message page invalid'; end if;
 older:=(r->'turns'->0->>'seq')::bigint;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'history',payload||jsonb_build_object('before_seq',older));
 if jsonb_array_length(r->'turns')<>1 or r->'turns'->0->>'prompt'<>'Hello' or r->>'has_more'<>'false' then raise exception 'Older message page invalid'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_service(owner_id,'session_rename',payload||'{"title":"Private fixture renamed"}'::jsonb);
 update feedx_integrations.native_assistant_requests set prompt='Different automatic title' where seq=older;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'session_list','{"query":"PRIVATE FIXTURE"}');
 if jsonb_array_length(r->'sessions')<>1 or r->'sessions'->0->>'title'<>'Private fixture renamed' then raise exception 'Search or manual title invalid'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(other_id,'session_list','{"query":"PRIVATE FIXTURE"}');
 if jsonb_array_length(r->'sessions')<>0 then raise exception 'Cross-user history leak'; end if;
 for candidate in select unnest(array['history','session_context','session_rename','session_delete','session_check']) as action loop
  begin
   perform set_config('request.jwt.claims','{"role":"service_role"}',true);
   perform public.native_assistant_service(other_id,candidate.action,payload||'{"title":"Unauthorized"}'::jsonb);
   raise exception 'Cross-user thread access: %',candidate.action;
  exception when insufficient_privilege then null; end;
 end loop;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'memory_save','{"enabled":true,"language":"mixed","reply_style":"steps","work_preference":"sources_first"}');
 if r->'memory'->>'language'<>'mixed' then raise exception 'Memory write failed'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(other_id,'memory_get');
 if r->'memory'->>'language'='mixed' then raise exception 'Cross-user memory leak'; end if;
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(owner_id,'memory_save','{"enabled":true,"language":"arbitrary text"}');
  raise exception 'Unstructured memory accepted';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'memory_save','{"enabled":false,"language":"mixed","reply_style":"steps","work_preference":"sources_first"}');
 if r->'memory'->>'enabled'<>'false' or r->'memory'->>'language'<>'mixed' then raise exception 'Memory disable removed preferences'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'memory_delete');
 if r->'memory' is distinct from '{"enabled":false}'::jsonb then raise exception 'Memory delete did not clear preferences'; end if;
 insert into feedx_integrations.native_assistant_sessions(user_id) select owner_id from generate_series(1,21);
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(owner_id,'session_new');
  raise exception 'Creation limit did not apply';
 exception when program_limit_exceeded then null; end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'session_list');
 if jsonb_array_length(r->'sessions')<>20 or r->>'has_more'<>'true' then raise exception 'History limit or pagination invalid'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'session_list',jsonb_build_object('before_activity',r->'sessions'->19->>'last_activity_at','before_id',r->'sessions'->19->>'id'));
 if jsonb_array_length(r->'sessions')<2 then raise exception 'History cursor lost saved conversations'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 r:=public.native_assistant_service(owner_id,'session_context',payload);
 if jsonb_array_length(r->'context')<>6 then raise exception 'Context not bounded'; end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_service(owner_id,'session_delete',payload);
 begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.native_assistant_service(owner_id,'history',payload);
  raise exception 'Deleted thread remains visible';
 exception when insufficient_privilege then null; end;
 if (select count(*) from feedx_integrations.native_assistant_requests where session_id=sid)<>21 then raise exception 'Deletion discarded retained audit data'; end if;
 if (select count(*) from feedx_integrations.native_assistant_requests where voice_lease_id is not null)<>voice_before
  or (select count(*) from feedx_integrations.native_assistant_requests where evidence is not null)<>evidence_before then
  raise exception 'Existing voice or evidence rows changed'; end if;
 if exists(select 1 from feedx_integrations.native_assistant_requests where session_id=sid and (prompt<>'[Deleted conversation]' or reply is not null)) then
  raise exception 'Deleted chat content remains stored';
 end if;
 if has_function_privilege('authenticated','public.native_assistant_service(uuid,text,jsonb)','execute')
  or has_table_privilege('authenticated','feedx_integrations.native_assistant_memory','select') then raise exception 'Direct client access exists'; end if;
end $test$;
select 'Thread pagination, owner isolation, audit retention, and memory controls verified' as result;
rollback;
