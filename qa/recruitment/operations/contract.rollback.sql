begin;
select set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
do $$
declare app uuid; tok text; attempt uuid; client uuid:=gen_random_uuid(); candidate_turn bigint; ai_turn bigint; row jsonb; before_events integer; before_profile uuid; observed timestamptz;
begin
 if to_regprocedure('recruitment_observe_preference(text,uuid,text,integer)') is not null or has_function_privilege('anon','recruitment_set_preference(uuid,text)','EXECUTE') or has_function_privilege('authenticated','recruitment_set_preference_internal(uuid,text,uuid,bigint)','EXECUTE') then raise exception 'Preference authority exposed';end if;
 select config_version_id into before_profile from recruitment_interview_attempts where id='88af34fa-7af7-4e52-9d5f-a5313d5b3063';
 app:=recruitment_register_application('e553e849-1644-4c91-a7d2-42c3573e26b1',jsonb_build_object('full_name','QA Operations rollback fixture','contact','000000009','employment_preference','both'));
 row:=recruitment_workspace('e553e849-1644-4c91-a7d2-42c3573e26b1','all',1,false,'Operations rollback','both')->'applications'->0;
 if row->>'id'<>app::text or row->>'employment_preference'<>'both' or row->>'registered_at' is null then raise exception 'Candidate projection/filter failed'; end if;
 if (recruitment_workspace('e553e849-1644-4c91-a7d2-42c3573e26b1','all',1,false,'Operations rollback','part_time')->>'applications_total')::int<>0 then raise exception 'Preference filter leaked rows';end if;
 begin perform recruitment_set_preference(app,'positive');raise exception 'Invalid preference accepted';exception when sqlstate '22023' then null;end;
 tok:=recruitment_issue_invitation(app,clock_timestamp()+interval '7 days');
 select id into attempt from recruitment_interview_attempts where application_id=app;
 update recruitment_interview_attempts set status='interviewing',lease_owner=client,lease_expires_at=clock_timestamp()+interval '45 seconds',interview_started_at=clock_timestamp(),provider_generation=1 where id=attempt;
 insert into recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript) values(attempt,1,1,'qa-candidate','candidate','I would like part time.') returning id,received_at into candidate_turn,observed;
 insert into recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript) values(attempt,2,1,'qa-interviewer','ai','Would you prefer full time?') returning id into ai_turn;
 perform recruitment_set_preference_internal(app,'part_time',null,candidate_turn);
 if (select employment_preference from recruitment_applications where id=app)<>'part_time' then raise exception 'Explicit cited change not saved';end if;
 select count(*) into before_events from recruitment_events where application_id=app and action='employment_preference_changed';
 perform recruitment_set_preference_internal(app,'part_time',null,candidate_turn);
 if (select count(*) from recruitment_events where application_id=app and action='employment_preference_changed')<>before_events then raise exception 'Retry duplicated preference event';end if;
 begin perform recruitment_set_preference_internal(app,'full_time',null,ai_turn);raise exception 'AI citation accepted';exception when sqlstate '22023' then null;end;

 perform recruitment_set_preference(app,'both');
 perform recruitment_set_preference_internal(app,'part_time',null,candidate_turn);
 if (select employment_preference from recruitment_applications where id=app)<>'both' then raise exception 'Late observation overwrote newer preference';end if;
 if (select decision_state from recruitment_applications where id=app)<>'review' or exists(select 1 from recruitment_topic_coverage where attempt_id=attempt and state<>'unresolved') then raise exception 'Preference mutated fit/lifecycle/coverage';end if;
 row:=recruitment_admin_evidence(app,null);
 if jsonb_array_length(row->'lifecycle_events')<3 then raise exception 'Lifecycle history missing';end if;
 if (select config_version_id from recruitment_interview_attempts where id='88af34fa-7af7-4e52-9d5f-a5313d5b3063')<>before_profile then raise exception 'Historical pin changed';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 begin perform recruitment_workspace();raise exception 'Unauthorized workspace read allowed';exception when insufficient_privilege then null;end;
 begin perform recruitment_set_preference('6f926d57-ffe5-45bf-97aa-9b318857a034','both');raise exception 'Unauthorized preference write allowed';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin begin perform recruitment_workspace();raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
