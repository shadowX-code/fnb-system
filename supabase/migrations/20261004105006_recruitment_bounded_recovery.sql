-- Operational recovery ownership is separate from immutable interview evidence.
alter table public.recruitment_interview_attempts add column recovery_id uuid, add column recovery_result jsonb;

create function public.recruitment_recovery_state(p_token text,p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then return jsonb_build_object('state','TERMINAL','reason','Interview link is unavailable. Please contact your recruiter.'); end if;
 return jsonb_build_object('state',case when a.status in ('completed','partial','failed','finalizing') then 'TERMINAL' else 'RECOVERY_REQUIRED' end,'status',a.status,'recovery_id',a.recovery_id,'lease_owned',a.lease_owner=p_client_id,'lease_available',a.lease_expires_at is null or a.lease_expires_at<=clock_timestamp() or a.lease_owner=p_client_id,'lease_expires_at',a.lease_expires_at,'provider_generation',a.provider_generation,'remaining_seconds',greatest(0,extract(epoch from a.max_ends_at-coalesce(a.paused_at,case when a.lease_expires_at<=clock_timestamp() then a.last_heartbeat_at else clock_timestamp() end)))::integer);
end $$;

create function public.recruitment_recovery_begin(p_token text,p_client_id uuid,p_request_id uuid,p_expected_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; result jsonb;
begin
 if p_request_id is null or p_client_id is null then raise exception using errcode='22023',message='Recovery identifier is required.'; end if;
 a:=recruitment_public_attempt(p_token);
 if a.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
 select * into a from recruitment_interview_attempts where id=a.id for update;
 if a.recovery_id=p_request_id and a.lease_owner=p_client_id then return a.recovery_result; end if;
 if a.recovery_id is distinct from p_expected_id then raise exception using errcode='40001',message='Recovery was replaced. Please retry.'; end if;
 result:=recruitment_public_begin(p_token,p_client_id);
 update recruitment_interview_attempts set recovery_id=p_request_id,recovery_result=result,lease_expires_at=clock_timestamp()+interval '90 seconds' where id=a.id;
 return result;
end $$;

create function public.recruitment_recovery_pause(p_token text,p_client_id uuid,p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then return jsonb_build_object('state','TERMINAL'); end if;
 select * into a from recruitment_interview_attempts where id=a.id for update;
 if a.lease_owner is distinct from p_client_id or a.recovery_id is distinct from p_request_id then return jsonb_build_object('state','replaced'); end if;
 if a.status not in ('starting','interviewing','interrupted') then return jsonb_build_object('state','TERMINAL','status',a.status); end if;
 if a.paused_at is null then
   update recruitment_interview_attempts set status='interrupted',paused_at=clock_timestamp(),provider_requested_at=null where id=a.id;
   insert into recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'recording_gap',jsonb_build_object('reason',left(p_reason,80),'recovery_id',p_request_id));
 end if;
 return jsonb_build_object('state','RECOVERY_REQUIRED');
end $$;

create function public.recruitment_recovery_context(p_token text,p_client_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
 select * into a from recruitment_interview_attempts where id=a.id for update;
 if a.recovery_id is distinct from p_request_id or a.paused_at is not null then raise exception using errcode='40001',message='Recovery was replaced.'; end if;
 return recruitment_realtime_context(p_token,p_client_id);
end $$;

create function public.recruitment_recovery_connected(p_token text,p_client_id uuid,p_request_id uuid,p_generation integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null then raise exception using errcode='42501',message='Interview link is unavailable.'; end if;
 select * into a from recruitment_interview_attempts where id=a.id for update;
 if a.recovery_id is distinct from p_request_id or a.paused_at is not null then raise exception using errcode='40001',message='Recovery was replaced.'; end if;
 return recruitment_public_provider_connected(p_token,p_client_id,p_generation);
end $$;

alter function public.recruitment_recording_access(text,uuid,text,jsonb) rename to recruitment_recording_access_before_recovery;
revoke all on function public.recruitment_recording_access_before_recovery(text,uuid,text,jsonb) from public,anon,authenticated;
create function public.recruitment_recording_access(p_token text,p_client_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 if p_action='open' and p_payload ? 'recovery_id' then
   a:=recruitment_public_attempt(p_token);
   select * into a from recruitment_interview_attempts where id=a.id for update;
   if a.recovery_id is distinct from (p_payload->>'recovery_id')::uuid or a.paused_at is not null then raise exception using errcode='40001',message='Recovery was replaced.'; end if;
 end if;
 return recruitment_recording_access_before_recovery(p_token,p_client_id,p_action,p_payload);
end $$;

-- Available before media/provider setup. No raw client identity, device names, text or credentials.
create function public.recruitment_recovery_observe(p_token text,p_client_id uuid,p_key text,p_record jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=recruitment_public_attempt(p_token);
 if a.id is null or p_client_id is null then return; end if;
 if p_key is null or length(p_key)>200 or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>1200
 or exists(select 1 from jsonb_object_keys(p_record) k where k not in ('type','state','stage','code','request_id','at','hidden','tracks','audio_state'))
 or coalesce(p_record->>'type','') not in ('recovery.transition','recovery.error','recovery.bootstrap','recovery.visibility','recovery.media','recovery.command') then raise exception using errcode='22023',message='Recovery observation is invalid.'; end if;
 if (select count(*) from recruitment_realtime_traces where attempt_id=a.id)>=6000 then return; end if;
 insert into recruitment_realtime_traces(attempt_id,key,provider_generation,record) values(a.id,p_key,coalesce(a.provider_generation,0),p_record||jsonb_build_object('client_tag',md5(p_client_id::text))) on conflict do nothing;
end $$;
revoke all on function public.recruitment_recovery_state(text,uuid),public.recruitment_recovery_begin(text,uuid,uuid,uuid),public.recruitment_recovery_pause(text,uuid,uuid,text),public.recruitment_recovery_context(text,uuid,uuid),public.recruitment_recording_access(text,uuid,text,jsonb),public.recruitment_recovery_observe(text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.recruitment_recovery_connected(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.recruitment_recovery_connected(text,uuid,uuid,integer) to anon,authenticated;
grant execute on function public.recruitment_recovery_state(text,uuid),public.recruitment_recovery_begin(text,uuid,uuid,uuid),public.recruitment_recovery_pause(text,uuid,uuid,text),public.recruitment_recovery_observe(text,uuid,text,jsonb) to anon,authenticated;
grant execute on function public.recruitment_recovery_context(text,uuid,uuid),public.recruitment_recording_access(text,uuid,text,jsonb) to service_role;
