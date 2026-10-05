-- Metadata-only fixtures; no media or physical candidate transcript is copied.
-- All mutations roll back. Run only on Staging after the forward migration.
begin;
do $$
declare base recruitment_interview_attempts%rowtype; issuer uuid; inv uuid; aid uuid; uid uuid;
 kind text; result jsonb; before_unit jsonb; rid uuid; n integer;
begin
 select * into base from recruitment_interview_attempts where profile_name like 'QA Synthetic%' order by created_at desc limit 1;
 if base.id is null then raise exception 'Synthetic QA fixture required'; end if;
 select issued_by into issuer from recruitment_invitations where id=base.invitation_id;
 foreach kind in array array['invalid','mixed','pending','capturing','live_lease','recent_end','active'] loop
   inv:=gen_random_uuid(); aid:=gen_random_uuid(); uid:=gen_random_uuid();
   insert into recruitment_invitations(id,application_id,token_hash,expires_at,issued_by)
     values(inv,base.application_id,encode(extensions.digest(inv::text,'sha256'),'hex'),clock_timestamp()+interval '1 hour',issuer);
   insert into recruitment_interview_attempts(id,invitation_id,application_id,opening_id,config_version_id,status,
     profile_name,interview_started_at,interview_ended_at,completion_reason,lease_expires_at,recording_state)
   values(aid,inv,base.application_id,base.opening_id,base.config_version_id,
     case when kind='active' then 'interviewing' else 'finalizing' end,'QA rollback finalization',
     clock_timestamp()-interval '10 minutes',case when kind='active' then null when kind='recent_end' then clock_timestamp() else clock_timestamp()-interval '5 minutes' end,
     'coverage',case when kind='live_lease' then clock_timestamp()+interval '1 minute' else clock_timestamp()-interval '1 minute' end,'pending');
   insert into recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript)
     values(aid,1,1,'qa_metadata_fixture','candidate','Synthetic evidence for terminal classification only.');
   insert into recruitment_recording_units(id,attempt_id,sequence,status,object_path,mime_type,elapsed_start_ms,end_reason)
     values(uid,aid,1,case when kind in ('pending','capturing') then kind else 'invalid' end,aid||'/invalid.mp4','video/mp4',0,'invalid_media');
   select to_jsonb(u) into before_unit from recruitment_recording_units u where id=uid;
   if kind='mixed' then
     -- Classification fixture only: no real file is represented or persisted.
     insert into recruitment_recording_units(id,attempt_id,sequence,status,object_path,mime_type,elapsed_start_ms,elapsed_end_ms,end_reason)
       values(gen_random_uuid(),aid,2,'verified',aid||'/metadata_only.mp4','video/mp4',0,300000,'completed');
   end if;
   if kind in ('invalid','mixed') then
     perform recruitment_reconcile_finalizing();
     select jsonb_build_object('status',status,'recording_state',recording_state) into result from recruitment_interview_attempts where id=aid;
     if result->>'status'<>(case when kind='invalid' then 'failed' else 'partial' end) or result->>'recording_state'<>(case when kind='invalid' then 'failed' else 'partial' end) then raise exception 'Wrong classification: % %',kind,result; end if;
     select id into rid from recruitment_reports where attempt_id=aid;
     if rid is null or recruitment_report_source(aid) is null then raise exception 'Report/review source unavailable'; end if;
     if recruitment_finalize_settled(aid) is distinct from result then raise exception 'Terminal retry changed result'; end if;
     perform recruitment_reconcile_finalizing();
     if (select count(*) from recruitment_events where attempt_id=aid and action='interview_finalized')<>1 or (select count(*) from recruitment_reports where attempt_id=aid)<>1 then raise exception 'Duplicate finalization/report'; end if;
   elsif kind='active' then
     begin perform recruitment_finalize_settled(aid); raise exception 'Active interview finalized'; exception when sqlstate '55000' then null; end;
   else
     perform recruitment_reconcile_finalizing();
     if (select status from recruitment_interview_attempts where id=aid)<>'finalizing' then raise exception 'Premature reconciliation: %',kind; end if;
     if kind in ('pending','capturing') and recruitment_finalize_settled(aid)->>'status'<>'finalizing' then raise exception 'Unsettled recording finalized'; end if;
   end if;
   if before_unit is distinct from (select to_jsonb(u) from recruitment_recording_units u where id=uid) then raise exception 'Invalid evidence mutated'; end if;
 end loop;
 if has_function_privilege('anon','public.recruitment_finalize_settled(uuid)','EXECUTE') or has_function_privilege('authenticated','public.recruitment_reconcile_finalizing()','EXECUTE') then raise exception 'Trusted reconciliation exposed'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform recruitment_reconcile_finalizing(); raise exception 'Anonymous reconciliation exposed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
