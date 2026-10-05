-- Settle ended interviews independently of a departed candidate browser.
create function public.recruitment_finalize_settled(p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; v_recording text; v_status text;
begin
  select * into a from public.recruitment_interview_attempts where id=p_attempt_id for update;
  if a.id is null then raise exception using errcode='42501',message='Interview unavailable.'; end if;
  if a.status in ('completed','partial','failed') then return jsonb_build_object('status',a.status,'recording_state',a.recording_state); end if;
  if a.status<>'finalizing' or a.interview_ended_at is null then raise exception using errcode='55000',message='Interview must end before finalization.'; end if;
  if exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and status in ('pending','capturing')) then return jsonb_build_object('status','finalizing','recording_state','pending'); end if;
  if not exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and status='verified') then v_recording:='failed';
  elsif exists(select 1 from public.recruitment_recording_units where attempt_id=a.id and (status<>'verified' or coalesce(end_reason,'')<>'completed')) or exists(select 1 from public.recruitment_events where attempt_id=a.id and action='recording_gap') or exists(select 1 from (select elapsed_start_ms,lag(elapsed_end_ms) over(order by sequence) prior_end from public.recruitment_recording_units where attempt_id=a.id) gaps where elapsed_start_ms>prior_end+2000) or (select min(elapsed_start_ms) from public.recruitment_recording_units where attempt_id=a.id)>5000 or (select max(elapsed_end_ms) from public.recruitment_recording_units where attempt_id=a.id)<(extract(epoch from a.interview_ended_at-a.interview_started_at)*1000)::integer-5000 then v_recording:='partial';
  else v_recording:='complete'; end if;
  v_status:=case when v_recording='failed' then 'failed' when v_recording='partial' or a.completion_reason='candidate_stop' or not exists(select 1 from public.recruitment_transcript_turns where attempt_id=a.id and speaker='candidate') or exists(select 1 from public.recruitment_transcript_annotations where attempt_id=a.id and kind='transcription_failed') or exists(select 1 from public.recruitment_events where attempt_id=a.id and action='provider_disconnected') then 'partial' else 'completed' end;
  update public.recruitment_interview_attempts set status=v_status,recording_state=v_recording,lease_expires_at=clock_timestamp() where id=a.id;
  insert into public.recruitment_events(attempt_id,application_id,opening_id,action,details) values(a.id,a.application_id,a.opening_id,'interview_finalized',jsonb_build_object('status',v_status,'recording_state',v_recording));
  return jsonb_build_object('status',v_status,'recording_state',v_recording);
end $$;


-- Candidate authorization stays at the existing session boundary. Classification
-- has one owner, independent of browser lease liveness for trusted reconciliation.
create or replace function public.recruitment_finalize_phase2(p_token text,p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype;
begin
 a:=public.recruitment_session(p_token,p_client_id);
 return public.recruitment_finalize_settled(a.id);
end $$;

create function public.recruitment_reconcile_finalizing() returns integer
language plpgsql security definer set search_path=public as $$
declare a public.recruitment_interview_attempts%rowtype; result jsonb; n integer:=0;
begin
 -- Give the active candidate time to flush final transcript/recording. Never
 -- abandon a pending upload or mutate a recording unit, receipt or transcript.
 for a in select * from public.recruitment_interview_attempts t
   where t.status='finalizing' and t.interview_ended_at<clock_timestamp()-interval '2 minutes'
   and coalesce(t.lease_expires_at,'-infinity'::timestamptz)<=clock_timestamp()
   and not exists(select 1 from public.recruitment_recording_units u
     where u.attempt_id=t.id and u.status in ('pending','capturing'))
   order by t.interview_ended_at limit 50 for update skip locked
 loop
   result:=public.recruitment_finalize_settled(a.id);
   if result->>'status' in ('completed','partial','failed') then
     perform public.recruitment_report_enqueue(a.id,gen_random_uuid());
     n:=n+1;
   end if;
 end loop;
 return n;
end $$;
revoke all on function public.recruitment_finalize_settled(uuid),public.recruitment_reconcile_finalizing() from public,anon,authenticated;
grant execute on function public.recruitment_finalize_settled(uuid),public.recruitment_reconcile_finalizing() to service_role;
-- Existing FeedX database scheduler; no new media/report service or credentials.
select cron.schedule('feedx_recruitment_settled_finalization','* * * * *',
 'select public.recruitment_reconcile_finalizing();');
