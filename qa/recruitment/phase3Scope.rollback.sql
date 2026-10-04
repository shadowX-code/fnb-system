-- Existing Staging authorities only; no grants or durable business mutations.
begin;
do $$
declare manager_auth uuid; scoped_auth uuid; app uuid; report uuid; denied boolean;
begin
 select e.auth_user_id into manager_auth from employees e join roles r on r.id=e.role_id where r.name='manager' and e.enable_system_login and e.access_state='active' and e.is_active limit 1;
 select e.auth_user_id into scoped_auth from employees e join roles r on r.id=e.role_id where r.name='factory_read_only_test' and e.enable_system_login and e.access_state='active' and e.is_active limit 1;
 select a.id,r.id into app,report from recruitment_applications a join recruitment_interview_attempts t on t.application_id=a.id join recruitment_reports r on r.attempt_id=t.id where r.status='ready' limit 1;
 if manager_auth is null or scoped_auth is null or report is null then raise exception 'Existing QA authorities/report required'; end if;
 perform set_config('request.jwt.claim.sub',manager_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_auth,'role','authenticated')::text,true);
 if current_user_has_permission('recruitment.view') or current_user_has_permission('recruitment.manage') then raise exception 'Expected permission-denied QA actor'; end if;
 denied:=false; begin perform recruitment_report_prepare(app,gen_random_uuid()); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unauthorized report preparation accepted'; end if;
 denied:=false; begin perform recruitment_report_review(report); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unauthorized report review accepted'; end if;
 denied:=false; begin perform recruitment_decide(app,gen_random_uuid(),'review','shortlisted'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unauthorized manager decision accepted'; end if;
 perform set_config('request.jwt.claim.sub',scoped_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',scoped_auth,'role','authenticated')::text,true);
 denied:=false; begin perform recruitment_admin_evidence(app); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Restricted actor read report/evidence'; end if;
 raise notice 'Phase3 report preparation/review/manager decisions deny existing unauthorized actors; no grants changed';
end $$;
rollback;
