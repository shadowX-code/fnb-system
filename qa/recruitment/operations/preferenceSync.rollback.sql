begin;
select set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
do $$
declare app uuid; tok text; aid uuid; client uuid:=gen_random_uuid(); n integer; t bigint;
begin
 if has_function_privilege('anon','recruitment_observe_preference(text,uuid,text,integer,text)','EXECUTE') or has_function_privilege('authenticated','recruitment_observe_preference(text,uuid,text,integer,text)','EXECUTE') or not has_function_privilege('service_role','recruitment_observe_preference(text,uuid,text,integer,text)','EXECUTE') then raise exception 'Observer privilege violation';end if;
 app:=recruitment_register_application('e553e849-1644-4c91-a7d2-42c3573e26b1','{"full_name":"QA Preference Sync rollback","contact":"000000005","employment_preference":"full_time"}');
 tok:=recruitment_issue_invitation(app,clock_timestamp()+interval '1 day');
 select id into aid from recruitment_interview_attempts where application_id=app;
 update recruitment_interview_attempts set status='interviewing',lease_owner=client,lease_expires_at=clock_timestamp()+interval '45 seconds',interview_started_at=clock_timestamp(),provider_generation=1 where id=aid;
 insert into recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript) values(aid,1,1,'pref-both','candidate','I am open to both full time and part time.'),(aid,2,1,'pref-ai','ai','You want full time.'),(aid,3,1,'pref-change','candidate','Actually I choose part time.');
 perform recruitment_observe_preference(tok,client,'both',1,'I am open to both full time and part time.');
 if (select employment_preference from recruitment_applications where id=app)<>'both' then raise exception 'Both lost';end if;
 select count(*) into n from recruitment_events where application_id=app and action='employment_preference_changed';
 perform recruitment_observe_preference(tok,client,'both',1,'I am open to both full time and part time.');
 if (select count(*) from recruitment_events where application_id=app and action='employment_preference_changed')<>n then raise exception 'Duplicate history';end if;
 perform recruitment_observe_preference(tok,client,'part_time',3,'Actually I choose part time.');
 perform recruitment_observe_preference(tok,client,'both',1,'I am open to both full time and part time.');
 if (select employment_preference from recruitment_applications where id=app)<>'part_time' then raise exception 'Older observation replaced latest';end if;
 begin perform recruitment_observe_preference(tok,client,'full_time',2,'You want full time.');raise exception 'AI citation accepted';exception when sqlstate '22023' then null;end;
 begin perform recruitment_observe_preference(tok,client,'full_time',3,'I choose full time.');raise exception 'Fabricated quote accepted';exception when sqlstate '22023' then null;end;
 begin perform recruitment_observe_preference(tok,gen_random_uuid(),'part_time',3,'Actually I choose part time.');raise exception 'Wrong lease accepted';exception when insufficient_privilege then null;end;
 begin perform recruitment_observe_preference(repeat('f',64),client,'part_time',3,'Actually I choose part time.');raise exception 'Wrong token accepted';exception when others then if sqlerrm='Wrong token accepted' then raise;end if;end;
 if (select decision_state from recruitment_applications where id=app)<>'review' or exists(select 1 from recruitment_topic_coverage where attempt_id=aid and state<>'unresolved') or exists(select 1 from recruitment_reports where attempt_id=aid) then raise exception 'Preference changed evidence/fit/hiring';end if;
 update recruitment_interview_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where id=aid;
 begin perform recruitment_observe_preference(tok,client,'part_time',3,'Actually I choose part time.');raise exception 'Expired lease accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
