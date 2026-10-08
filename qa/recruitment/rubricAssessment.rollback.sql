-- Staging-only transaction fixtures; publication, configuration and reports all roll back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where r.name='owner' and e.auth_user_id is not null limit 1),true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
declare d jsonb; p uuid; opening uuid; app uuid; invite text; attempt uuid; rid uuid; claim jsonb; body jsonb; criterion text; original jsonb; x jsonb;
begin
 select definition into d from recruitment_interview_profiles where profile_key='service_crew' order by version desc limit 1;
 original:=d;
 d:=jsonb_set(d,'{evidence_areas,0,rubric}',jsonb_build_object('levels',jsonb_build_array(
 jsonb_build_object('level',1,'criteria','States they would dismiss a customer complaint without checking the order or seeking help.'),
 jsonb_build_object('level',2,'criteria','Describes acknowledging the complaint and checking the order, without explaining the next update.'),
 jsonb_build_object('level',3,'criteria','Describes checking with the kitchen, explaining a realistic update and coordinating help.'),
 jsonb_build_object('level',4,'criteria','Describes coordinated checking, clear updates, proportionate escalation and checking resolution.'))));
 perform recruitment_validate_profile(d);
 begin perform recruitment_validate_profile(jsonb_set(d,'{evidence_areas,0,rubric,levels,3,level}','1')); raise exception 'Duplicate rubric levels accepted'; exception when sqlstate '22023' then null; end;
 begin perform recruitment_validate_profile(jsonb_set(d,'{evidence_areas,0,rubric,levels,0,criteria}','"good"')); raise exception 'Generic empty criterion accepted'; exception when sqlstate '22023' then null; end;
 perform recruitment_validate_offerings('{"additional_information":[{"topic":"Training location","information":"Orientation at the hiring workplace."}]}','[]');
 begin perform recruitment_validate_offerings('{"additional_information":[{"topic":"Salary","information":"Duplicate authority"}]}','[]'); raise exception 'Dedicated term duplication accepted'; exception when sqlstate '22023' then null; end;
 begin perform recruitment_validate_offerings('{"additional_information":[{"topic":"Training","information":"Confirmed"},{"topic":"training","information":"Other"}]}','[]'); raise exception 'Duplicate topics accepted'; exception when sqlstate '22023' then null; end;
 p:=recruitment_publish_profile(d,(select max(version) from recruitment_interview_profiles where profile_key='service_crew'));
 begin perform recruitment_publish_profile(d,(select max(version)-1 from recruitment_interview_profiles where profile_key='service_crew')); raise exception 'Stale publication accepted'; exception when sqlstate '40001' then null; end;
 begin update recruitment_interview_profiles set definition=original where id=p; raise exception 'Published profile changed'; exception when sqlstate '55000' then null; end;
 select to_jsonb(o)||jsonb_build_object('id',null,'title','QA Rubric Authority Rollback','config',to_jsonb(c)||jsonb_build_object('interview_profile_id',p,'job_context',jsonb_build_object('additional_information',jsonb_build_array(jsonb_build_object('topic','Training location','information','Orientation at the hiring workplace.'))))) into x
 from recruitment_openings o join recruitment_interview_configs c on c.opening_id=o.id and c.version=o.config_version where o.status='open' order by o.created_at desc limit 1;
 opening:=recruitment_save_opening(x);
 app:=recruitment_register_application(opening,'{"full_name":"QA Rubric Rollback","contact":"0000000889"}');
 invite:=recruitment_issue_invitation(app,clock_timestamp()+interval '1 day');
 select id into attempt from recruitment_interview_attempts where application_id=app;
 update recruitment_interview_attempts set status='completed',recording_state='partial' where id=attempt;
 insert into recruitment_transcript_turns(attempt_id,turn_number,provider_generation,provider_item_id,speaker,transcript,elapsed_start_ms,elapsed_end_ms) values(attempt,1,1,'rubric-rollback-candidate','candidate','I check the order and tell the kitchen about the complaint.',0,1000);
 rid:=recruitment_report_enqueue(attempt,gen_random_uuid(),true);
 claim:=recruitment_report_claim(rid);
 if claim->>'prompt_version'<>'recruitment-report-v4' or claim->'source'->'assessment_plan'->>'profile_id'<>p::text then raise exception 'New report not pinned to rubric profile'; end if;
 criterion:=d->'evidence_areas'->0->'rubric'->'levels'->1->>'criteria';
 x:=jsonb_build_object('text','Describes checking the order and contacting the kitchen.','kind','interpretation','evidence',jsonb_build_array(jsonb_build_object('turn_id',(select id from recruitment_transcript_turns where attempt_id=attempt limit 1))));
 body:=jsonb_build_object('assessment_profile',jsonb_build_object('id',p,'version',(select version from recruitment_interview_profiles where id=p)), 'assessments',jsonb_build_array(jsonb_build_object('index',0,'area',d->'evidence_areas'->0->>'name','status','assessed','level',2,'criterion',criterion,'finding',x)));
 begin perform recruitment_report_finish(rid,(claim->>'generation_id')::uuid,jsonb_set(body,'{assessments,0,criterion}','"invented criterion"'),'qa',null); raise exception 'Foreign criterion accepted'; exception when sqlstate '22023' then null; end;
 begin perform recruitment_report_finish(rid,(claim->>'generation_id')::uuid,jsonb_set(body,'{assessments,0,finding,evidence,0,turn_id}','-1'),'qa',null); raise exception 'Foreign citation accepted'; exception when sqlstate '22023' then null; end;
 begin perform recruitment_report_finish(rid,gen_random_uuid(),body,'qa',null); raise exception 'Stale generation accepted'; exception when sqlstate '40001' then null; end;
 begin perform recruitment_report_finish(rid,(claim->>'generation_id')::uuid,jsonb_set(body,'{assessments,0,status}','"insufficient_evidence"'),'qa',null); raise exception 'Scored missing evidence accepted'; exception when sqlstate '22023' then null; end;
 perform recruitment_report_finish(rid,(claim->>'generation_id')::uuid,body,'qa',null);
 if not exists(select 1 from recruitment_reports where id=rid and status='ready' and recruitment_reports.body->'assessments'->0->>'level'='2') then raise exception 'Validated assessment did not persist'; end if;
 begin update recruitment_reports set body='{}' where id=rid; raise exception 'Ready report mutable'; exception when sqlstate '55000' then null; end;
 if recruitment_report_source('70456ad7-42ae-4429-a2a1-f7cf15144a60') ? 'assessment_plan' then raise exception 'Historical profile acquired rubric'; end if;
 if has_function_privilege('anon','recruitment_report_finish(uuid,uuid,jsonb,text,text)','EXECUTE') or has_function_privilege('authenticated','recruitment_report_finish(uuid,uuid,jsonb,text,text)','EXECUTE') or has_table_privilege('authenticated','recruitment_reports','UPDATE') then raise exception 'Report write authority exposed'; end if;
end $$;
set local role anon;
do $$ begin
 begin perform recruitment_publish_profile('{}',2); raise exception 'Anonymous publication allowed'; exception when insufficient_privilege then null; end;
 begin perform recruitment_save_opening('{}'); raise exception 'Anonymous opening write allowed'; exception when insufficient_privilege then null; end;
end $$;
rollback;
