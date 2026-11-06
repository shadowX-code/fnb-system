-- Non-provider regression on existing authorized Staging identity; all fixture writes roll back.
begin;
do $$
declare r feedx_integrations.native_assistant_realtime_reservations%rowtype;
 lease uuid:=gen_random_uuid(); turn uuid:=gen_random_uuid(); a jsonb; b jsonb;
begin
 select * into r from feedx_integrations.native_assistant_realtime_reservations order by created_at desc limit 1;
 insert into feedx_integrations.native_assistant_realtime_reservations(actor,request_id,session_id,provider) values(r.actor,lease,r.session_id,r.provider);
 a:=jsonb_build_object('session_id',r.session_id,'request_id',lease,'provider',r.provider,'turn_id',turn);
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform public.native_assistant_voice_history(r.actor,a||'{"step":"start","text":""}');
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 b:=public.native_assistant_voice_history(r.actor,a||jsonb_build_object('step','unfinished','text','真正的部分回答','details',jsonb_build_object('reason','max_output_tokens')));
 if b->>'reply'<>'真正的部分回答' or b->>'error_code'<>'voice_unfinished' or b->'voice_details'->>'reason'<>'max_output_tokens' then raise exception 'Partial outcome regression'; end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 b:=public.native_assistant_voice_history(r.actor,a||'{"step":"complete","text":"late overwrite"}');
 if b->>'reply'='late overwrite' then raise exception 'Terminal overwrite'; end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if not (public.native_assistant_service(r.actor,'history',jsonb_build_object('session_id',r.session_id))::text like '%voice_details%') then raise exception 'History omitted reason'; end if;
end $$;
rollback;
select 'partial transcript, reason, immutable outcome and private history projection passed; fixture writes rolled back' as verification;
