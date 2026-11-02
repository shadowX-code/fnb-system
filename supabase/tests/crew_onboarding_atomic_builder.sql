-- Staging only. Caller wraps BEGIN/ROLLBACK. All fixtures and enrollment evidence roll back.
do $$
declare own uuid; outlet uuid:=gen_random_uuid(); emp uuid:=gen_random_uuid(); jid uuid; nextid uuid; aid uuid; payload jsonb; saved jsonb; prior jsonb; pinned jsonb;
 req uuid:=gen_random_uuid(); first_module uuid; lesson uuid; quiz uuid; qid uuid; denied boolean; original_assignments text; original_progress text; original_attempts text;
begin
 select e.auth_user_id into own from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.is_active and e.auth_user_id is not null limit 1;
 assert own is not null,'Verified Owner needed';perform set_config('request.jwt.claim.sub',own::text,true);
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text) into original_assignments from public.crew_journey_assignments a;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]')::text) into original_progress from public.crew_lesson_progress p;
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]')::text) into original_attempts from public.crew_quiz_attempts p;
 insert into public.outlets(id,name) values(outlet,'QA Onboarding Builder '||outlet);
 jid:=public.crew_create_default_onboarding(outlet);
 payload:=public.crew_admin_onboarding_detail(jid);
 assert jsonb_array_length(payload->'modules')=8,'Default module rules retained';
 -- The old browser protocol can strand negative slots. The new transaction repairs ordering directly.
 first_module:=(payload#>>'{modules,0,id}')::uuid;
 update public.crew_journey_modules set sort_order=-1000000 where id=first_module;
 denied:=false;begin update public.crew_journey_modules set sort_order=-1000000 where id=(payload#>>'{modules,1,id}')::uuid;exception when unique_violation then denied:=true;end;assert denied,'Original fixed-negative-slot collision reproduced';
 payload:=jsonb_set(payload,'{modules}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(payload->'modules') with ordinality));
 first_module:=(payload#>>'{modules,0,id}')::uuid;lesson:=(payload#>>'{modules,0,lessons,0,id}')::uuid;
 -- Add a second block, lesson and two-question Knowledge Check, all with durable fresh IDs.
 payload:=jsonb_set(payload,'{modules,0,lessons,0,blocks}',(payload#>'{modules,0,lessons,0,blocks}')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'block_type','text','payload',jsonb_build_object('body','中文 / Bahasa Melayu preserved'))));
 quiz:=gen_random_uuid();qid:=gen_random_uuid();
 payload:=jsonb_set(payload,'{modules,0,lessons,0,quizzes}',jsonb_build_array(jsonb_build_object('id',quiz,'title','QA Knowledge Check','required',true,'passing_score',80,'questions',jsonb_build_array(
 jsonb_build_object('id',qid,'prompt','Choose A','question_type','single_choice','options',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label','A','is_correct',true),jsonb_build_object('id',gen_random_uuid(),'label','B','is_correct',false))),
 jsonb_build_object('id',gen_random_uuid(),'prompt','Choose B','question_type','single_choice','options',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label','A','is_correct',false),jsonb_build_object('id',gen_random_uuid(),'label','B','is_correct',true)))))));
 payload:=jsonb_set(payload,'{modules,0,lessons}',(payload#>'{modules,0,lessons}')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Extra Lesson','required',false,'content_type','lesson','blocks','[]'::jsonb,'quizzes','[]'::jsonb)));
 saved:=public.crew_save_onboarding_draft(jid,0,req,payload);
 assert saved->>'draft_revision'='1','Single atomic revision';
 assert saved#>>'{modules,0,id}'=first_module::text and saved#>>'{modules,0,lessons,0,id}'=lesson::text,'Module and lesson identities preserved';
 assert exists(select 1 from jsonb_array_elements(saved#>'{modules,0,lessons,0,blocks}') b where b#>>'{payload,body}'='中文 / Bahasa Melayu preserved'),'Multilingual source content retained';
 assert public.crew_save_onboarding_draft(jid,0,req,payload)->>'draft_revision'='1','Lost-response retry does not save twice';
 denied:=false;begin perform public.crew_save_onboarding_draft(jid,0,gen_random_uuid(),payload);exception when serialization_failure then denied:=true;end;assert denied,'Stale/concurrent editor cannot overwrite saved state';
 prior:=public.crew_admin_onboarding_detail(jid);
 payload:=jsonb_set(saved,'{modules,0,title}','"Partial write must roll back"');
 payload:=jsonb_set(payload,'{modules,0,lessons,0,quizzes,0,passing_score}','101');
 denied:=false;begin perform public.crew_save_onboarding_draft(jid,1,gen_random_uuid(),payload);exception when check_violation then denied:=true;end;assert denied,'Invalid data rejected';
 assert public.crew_admin_onboarding_detail(jid)=prior,'Failure rolls back all earlier row writes';
 payload:=saved;
 -- Swap blocks, lessons, questions and options within one transaction, without temporary sort slots.
 payload:=jsonb_set(payload,'{modules,0,lessons,0,blocks}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(payload#>'{modules,0,lessons,0,blocks}') with ordinality));
 payload:=jsonb_set(payload,'{modules,0,lessons,0,quizzes,0,questions}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(payload#>'{modules,0,lessons,0,quizzes,0,questions}') with ordinality));
 payload:=jsonb_set(payload,'{modules,0,lessons,0,quizzes,0,questions,0,options}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(payload#>'{modules,0,lessons,0,quizzes,0,questions,0,options}') with ordinality));
 payload:=jsonb_set(payload,'{modules,0,lessons}',(select jsonb_agg(value order by ordinality desc) from jsonb_array_elements(payload#>'{modules,0,lessons}') with ordinality));
 saved:=public.crew_save_onboarding_draft(jid,1,gen_random_uuid(),payload);
 assert saved#>>'{modules,0,lessons,1,id}'=lesson::text,'Nested permutation persisted';
 assert saved#>>'{modules,0,lessons,1,quizzes,0,questions,1,id}'=qid::text,'Question permutation persisted';
 denied:=false;begin perform public.crew_publish_onboarding_draft(jid,1);exception when serialization_failure then denied:=true;end;assert denied,'Publishing stale revision forbidden';
 insert into public.employees(id,full_name,employee_code,workplace,position) values(emp,'QA Onboarding Builder','QA-ONB-'||emp,'QA Onboarding Builder '||outlet,'Crew');
 insert into public.crew_access(employee_id,mobile_number,passcode_hash,primary_outlet_id) values(emp,'qa-'||emp,'rollback-only',outlet);
 perform public.crew_publish_onboarding_draft(jid,2);
 select id,journey_snapshot into aid,pinned from public.crew_journey_assignments where employee_id=emp;
 assert aid is not null and pinned#>>'{journey,id}'=jid::text,'Canonical enrollment snapshot created';
 nextid:=public.crew_new_journey_version(jid);
 payload:=public.crew_admin_onboarding_detail(nextid);quiz:=(payload#>>'{modules,0,lessons,1,quizzes,0,id}')::uuid;
 payload:=jsonb_set(payload,'{modules,0,lessons,1,quizzes}','[]');
 saved:=public.crew_save_onboarding_draft(nextid,0,gen_random_uuid(),payload);
 assert not exists(select 1 from public.crew_quizzes where id=quiz),'Knowledge Check deletion persisted';
 assert jsonb_array_length(public.crew_admin_onboarding_detail(nextid)#>'{modules,0,lessons,1,quizzes}')=0,'Reopen does not restore deleted Knowledge Check';
 perform public.crew_publish_onboarding_draft(nextid,1);
 assert (select journey_snapshot=pinned and journey_id=jid from public.crew_journey_assignments where id=aid),'New publication never rewrites existing Crew evidence';
 saved:=public.crew_admin_onboarding_progress(outlet);
 assert saved#>>'{0,journey_version}'='1' and saved#>>'{0,journey_id}'=jid::text,'Progress reports assigned published version';
 assert (saved#>>'{0,modules,0,id}')=(pinned#>>'{modules,0,module,id}'),'Progress outline comes from pinned evidence';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text)=original_assignments from public.crew_journey_assignments a where employee_id<>emp),'Real Crew assignments unchanged';
 denied:=false;begin perform public.crew_save_onboarding_draft(jid,2,gen_random_uuid(),payload);exception when invalid_parameter_value then denied:=true;end;assert denied,'Published version cannot be saved';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]')::text)=original_progress from public.crew_lesson_progress p),'Existing lesson progress unchanged';
 assert (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id),'[]')::text)=original_attempts from public.crew_quiz_attempts p),'Existing quiz attempts unchanged';
 perform set_config('request.jwt.claim.sub','',true);
 denied:=false;begin perform public.crew_save_onboarding_draft(nextid,1,gen_random_uuid(),payload);exception when insufficient_privilege then denied:=true;end;assert denied,'Anonymous editing denied';
 assert not has_table_privilege('authenticated','public.crew_quizzes','DELETE'),'Direct child mutations cannot bypass revision authority';
end;$$;
select 'Atomic ordering, deletion/reopen, retry/conflict, rollback, publication and pinned progress passed' as result;
