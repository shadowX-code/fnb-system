-- No provider request or retained fixture. Test only the existing owner/service boundaries.
begin;
do $$
declare actor_id uuid; sid uuid; rid uuid:=gen_random_uuid(); result jsonb; due timestamptz:=now()+interval '30 seconds';
begin
 select actor,session_id into actor_id,sid from feedx_integrations.assistant_voice_leases order by created_at desc limit 1;
 insert into feedx_integrations.assistant_voice_leases(actor,request_id,session_id,provider,expires_at,state,cleanup_after)
 values(actor_id,rid,sid,'openai',now()+interval '30 seconds','closing',due);
 perform set_config('request.jwt.claim.role','service_role',true);perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_voice_lease(actor_id,'end',jsonb_build_object('request_id',rid,'session_id',sid,'provider','openai'));
 if (select cleanup_after from feedx_integrations.assistant_voice_leases where actor=actor_id and request_id=rid)<>due then raise exception 'Repeated End reset cleanup claim'; end if;
 perform set_config('request.jwt.claim.role','service_role',true);perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.native_assistant_voice_connection('owned_cleanup',jsonb_build_object('actor',actor_id,'request_id',rid,'session_id',sid));
 if result<>'{"state":"closing"}'::jsonb then raise exception 'Unexpected cleanup projection'; end if;
 begin
  perform public.native_assistant_voice_connection('owned_cleanup',jsonb_build_object('actor',actor_id,'request_id',rid,'session_id',gen_random_uuid()));
  raise exception 'Cross-session cleanup accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.role','authenticated',true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin
  perform public.native_assistant_voice_connection('owned_cleanup',jsonb_build_object('actor',actor_id,'request_id',rid,'session_id',sid));
  raise exception 'Non-service cleanup accepted';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'owner/session scoping, service-only guard and repeated End claim preservation passed; all fixture writes rolled back' as verification;
