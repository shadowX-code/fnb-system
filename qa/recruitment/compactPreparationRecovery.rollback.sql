-- Focused Staging contract rehearsal; all synthetic data rolls back, no Employee creation.
begin;
select set_config('request.jwt.claim.sub',
 (select e.auth_user_id::text from recruitment_applications a join employees e on e.id=a.created_by
  where a.id='bc0441c8-ca38-47bc-94be-60b8217d710a'),true);
do $$
declare token text; client uuid:=gen_random_uuid(); first uuid:=gen_random_uuid(); second uuid:=gen_random_uuid();
 unit uuid:=gen_random_uuid(); next_unit uuid:=gen_random_uuid(); result jsonb; saved jsonb; attempt uuid;
begin
 token:=recruitment_issue_invitation(recruitment_register_application('38611f75-363f-49a6-b3a4-62e09a47faea',
  '{"full_name":"Synthetic compact recovery rollback","contact":"0000000190"}'::jsonb),clock_timestamp()+interval '7 days');
 perform recruitment_public_confirm_profile(token,'Synthetic compact recovery rollback','0000000190');
 begin
  perform recruitment_public_ready(token,'{"camera":"ready","microphone":"ready"}');
  raise exception 'Readiness accepted without consent';
 exception when sqlstate '55000' then null; end;
 result:=recruitment_public_consent(token,'feedx-interview-v1-concise','{"ai":true,"recording":true,"review":true}');
 if result->>'copy_version'<>'feedx-interview-v1-concise' then raise exception 'Wrong displayed consent version'; end if;
 perform recruitment_public_ready(token,'{"camera":"ready","microphone":"ready"}');
 perform recruitment_recovery_begin(token,client,first,null);
 perform recruitment_recording_access(token,client,'open',jsonb_build_object('unit_id',unit,'recovery_id',first));
 result:=recruitment_recovery_context(token,client,first); attempt:=(result->>'attempt_id')::uuid;
 perform recruitment_recovery_connected(token,client,first,1);
 perform recruitment_public_transcript_turn(token,client,1,1,'synthetic-candidate','candidate','I worked in a café taking orders and serving food. I helped resolve a missing order with the kitchen.',0,1000);
 perform recruitment_apply_coverage(token,client,'{"topics":[{"index":0,"turn_number":1}],"scenarios":[]}');
 perform recruitment_recovery_pause(token,client,first,'page_backgrounded');
 saved:=recruitment_recovery_begin(token,client,second,first);
 result:=recruitment_recovery_begin(token,client,second,first);
 if result<>saved then raise exception 'Recovery retry changed canonical result'; end if;
 perform recruitment_recovery_pause(token,client,first,'late_old_provider');
 if (select paused_at is not null from recruitment_interview_attempts where id=attempt) then raise exception 'Old callback took new recovery'; end if;
 perform recruitment_recording_access(token,client,'open',jsonb_build_object('unit_id',next_unit,'recovery_id',second));
 result:=recruitment_recovery_context(token,client,second);
 if result->>'generation'<>'2' or jsonb_array_length(result->'established_facts')<>1 then raise exception 'Canonical continuation facts lost'; end if;
 if (select count(*)<>1 from recruitment_transcript_turns where attempt_id=attempt) then raise exception 'Transcript changed'; end if;
 if (select state<>'covered' from recruitment_topic_coverage where attempt_id=attempt and topic_index=0) then raise exception 'Coverage changed'; end if;
 if (select count(*)<>1 from recruitment_recording_units where attempt_id=attempt and status='capturing') then raise exception 'Competing recording ownership'; end if;
 if (select status<>'interrupted' from recruitment_recording_units where id=unit) then raise exception 'Old unit integrity was fabricated'; end if;
 if (select count(*)<1 from recruitment_events where attempt_id=attempt and action='recording_gap') then raise exception 'Gap not disclosed'; end if;
 begin perform recruitment_recovery_context(token,client,first); raise exception 'Old provider generation accepted'; exception when serialization_failure then null; end;
end $$;
rollback;
select 'PASS: consent/readiness gates, canonical continuation facts/transcript/coverage, retry idempotency, stale ownership fencing and explicit recording gap' result;
