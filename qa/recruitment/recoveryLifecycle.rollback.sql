-- Disposable/local or rollback-only Staging contract verification. No durable fixtures.
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;
do $$
declare opening uuid:=gen_random_uuid(); config uuid:=gen_random_uuid(); applicant uuid:=gen_random_uuid(); application uuid:=gen_random_uuid(); invitation uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); unit uuid:=gen_random_uuid(); lost uuid:=gen_random_uuid(); token text:=repeat('a',64); result jsonb;
begin
  -- Canonical master references are placeholders ONLY inside this rolled-back fixture.
  set local session_replication_role=replica;
  insert into employees(id,full_name) values(actor,'Synthetic rollback QA');
  insert into recruitment_openings(id,title,position_id,workplace,legal_entity_id,status,created_by,updated_by) values(opening,'QA Phase 2 rollback',gen_random_uuid(),'Management',gen_random_uuid(),'open',actor,actor);
  insert into recruitment_interview_configs(id,opening_id,version,required_topics,scenario_briefs,target_minutes,max_minutes,created_by) values(config,opening,1,'["Customer service evidence"]','["Handle a missing order"]',5,5,actor);
  insert into recruitment_applicants(id,full_name,contact,created_by) values(applicant,'Synthetic QA','00000',actor);
  insert into recruitment_applications(id,applicant_id,opening_id,opening_title_snapshot,opening_description_snapshot,position_snapshot,workplace_snapshot,legal_entity_snapshot,created_by) values(application,applicant,opening,'QA','','QA','Management','QA',actor);
  insert into recruitment_invitations(id,application_id,token_hash,expires_at,issued_by) values(invitation,application,encode(extensions.digest(token,'sha256'),'hex'),clock_timestamp()+interval '1 hour',actor);
  insert into recruitment_interview_attempts(id,invitation_id,application_id,opening_id,config_version_id,status) values(attempt,invitation,application,opening,config,'ready');
  insert into recruitment_consents(attempt_id,application_id,copy_version,copy_snapshot,accepted_purposes) values(attempt,application,'qa','{}','{}');
  set local session_replication_role=origin;
  result:=recruitment_public_begin(token,client);
  perform recruitment_recording_access(token,client,'open',jsonb_build_object('unit_id',unit));
  result:=recruitment_realtime_context(token,client);
  perform recruitment_public_provider_connected(token,client,1);
  perform recruitment_public_transcript_turn(token,client,1,1,'candidate-item','candidate','I handled café orders and checked missing meals.',0,1000);
  perform recruitment_apply_coverage(token,client,'{"topics":[{"index":0,"turn_number":1}],"scenarios":[]}');
  perform recruitment_public_interruption(token,client,'page_backgrounded');
  -- Server clock represents a prolonged background interruption; no candidate time authority.
  update recruitment_interview_attempts set paused_at=clock_timestamp()-interval '20 minutes', max_ends_at=clock_timestamp()-interval '15 minutes' where id=attempt;
  result:=recruitment_public_begin(token,client);
  perform pg_temp.assert(result->>'status'='starting','Background recovery finalized a paused attempt');
  perform pg_temp.assert((result->>'max_ends_at')::timestamptz>clock_timestamp()+interval '4 minutes 55 seconds','Remaining active duration was not restored');
  perform pg_temp.assert((select paused_at is null from recruitment_interview_attempts where id=attempt),'Resume left time budget paused');
  perform pg_temp.assert((select count(*)=1 from recruitment_interview_attempts where invitation_id=invitation),'Resume duplicated attempt');
  perform pg_temp.assert((select count(*)=1 from recruitment_transcript_turns where attempt_id=attempt),'Resume lost durable transcript');
  perform pg_temp.assert((select state='covered' from recruitment_topic_coverage where attempt_id=attempt and topic_index=0),'Resume lost coverage');
  begin perform recruitment_public_begin(token,gen_random_uuid()); raise exception 'Concurrent client accepted'; exception when lock_not_available then null; end;
  result:=recruitment_realtime_context(token,client);
  perform pg_temp.assert(result->>'generation'='2','Replacement session generation not fenced');
  perform pg_temp.assert(jsonb_array_length(result->'established_facts')=1,'Established facts missing');
  perform pg_temp.assert((result->>'remaining_seconds')::integer>290,'Remaining time missing');
  begin perform recruitment_public_provider_connected(token,client,1); raise exception 'Stale provider accepted'; exception when insufficient_privilege then null; end;
  perform recruitment_public_provider_connected(token,client,2);
  perform recruitment_public_traces(token,client,'[{"generation":2,"key":"trace-1","record":{"type":"response.created","response_id":"response-1","owner":"candidate-item","elapsed_ms":1000}}]');
  perform recruitment_public_traces(token,client,'[{"generation":2,"key":"trace-1","record":{"type":"response.created","response_id":"response-1","owner":"candidate-item","elapsed_ms":1000}}]');
  perform pg_temp.assert((select count(*)=1 from recruitment_realtime_traces where attempt_id=attempt),'Trace retry duplicated event');
  begin perform recruitment_public_traces(token,client,'[{"generation":2,"key":"bad","record":{"type":"response.created","token":"secret"}}]'); raise exception 'Unbounded credential diagnostics accepted'; exception when invalid_parameter_value then null; end;
  perform pg_temp.assert(not has_table_privilege('anon','recruitment_realtime_traces','select'),'Anonymous trace data exposed');
  perform pg_temp.assert(not has_function_privilege('anon','recruitment_public_trace(text,uuid,integer,text,jsonb)','execute'),'Private trace helper exposed');
  perform recruitment_public_annotation(token,client,1,'candidate-item','truncated',1000);
  -- Annotation filtering applies only to context; retained evidence remains append-only.
  update recruitment_interview_attempts set provider_requested_at=null where id=attempt;
  result:=recruitment_realtime_context(token,client);
  perform pg_temp.assert(jsonb_array_length(result->'turns')=0,'Unheard/truncated text replayed in resume context');
  perform pg_temp.assert((select count(*)>0 from recruitment_events where attempt_id=attempt and action='recording_gap'),'Recovery gap omitted');
  update recruitment_invitations set revoked_at=clock_timestamp() where id=invitation;
  begin perform recruitment_public_begin(token,client); raise exception 'Revoked resume accepted'; exception when insufficient_privilege then null; end;
  raise notice 'Recovery, remaining time, duplicate client, generation fence, bounded diagnostics and durable context contracts passed';
end $$;
rollback;
