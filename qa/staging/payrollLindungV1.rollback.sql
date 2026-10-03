-- STAGING ONLY, disposable fixtures; every write rolls back. All Payroll writes
-- use canonical commands; synthetic identity/entity creation is fixture setup.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id
 where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
create temporary table lindung_checks(check_name text primary key);
create temporary table lindung_manifests(draft jsonb, final jsonb);
-- Existing cutover gate is an independent authority and intentionally unchanged
-- by the delivered migration. Isolate it ONLY for this rolled-back synthetic
-- employer to exercise financial Finalize and correction snapshots.
alter function public.payroll_period_employment_scope_issue(uuid) rename to payroll_lindung_qa_original_scope_issue;
create function public.payroll_period_employment_scope_issue(p_period_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
begin
 if exists(select 1 from public.payroll_periods p where p.id=p_period_id and
  p.legal_entity_id::text=current_setting('feedx.lindung_qa_entity',true)) then return null; end if;
 return public.payroll_lindung_qa_original_scope_issue(p_period_id);
end $$;
revoke all on function public.payroll_period_employment_scope_issue(uuid) from public,anon,authenticated;

do $$
declare actor uuid:=public.payroll_admin_actor(); ent uuid; other uuid; outlet uuid; emp uuid; foreign_emp uuid;
 profile uuid; foreign_profile uuid; new_emp uuid; new_profile uuid; june uuid; july uuid; september uuid; correction uuid;
 r jsonb; old jsonb; intent jsonb; line jsonb; retry_request uuid; snapshot text; frozen_before text;
 a jsonb:='{"epf":false,"socso":true,"eis":false,"pcb":false}';
 idx integer; x numeric; row record; actual numeric; h text; denied_role uuid; denied_auth uuid:=gen_random_uuid();
begin
 select md5(coalesce(string_agg(result::text,'' order by run_id,employee_id),'')) into frozen_before from public.payroll_run_statutory_snapshots;
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY LINDUNG employer','QA-L24-'||gen_random_uuid(),'Rollback only',actor,actor) returning id into ent;
 perform set_config('feedx.lindung_qa_entity',ent::text,true);
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA ONLY Other LINDUNG employer','QA-L24-'||gen_random_uuid(),'Rollback only',actor,actor) returning id into other;
 insert into public.outlets(name,code,state_code) values('QA ONLY LINDUNG workplace','QA-L24-'||substr(gen_random_uuid()::text,1,6),'MY-08') returning id into outlet;
 perform set_config('feedx.payroll_command','yes',true);
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-01-01','MY-08');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality)
 values('QA ONLY LINDUNG local','QA-L24-'||substr(gen_random_uuid()::text,1,8),ent,'QA ONLY LINDUNG workplace','Service Crew','full_time','active','2026-01-01','1990-01-01','Malaysia') returning id into emp;
 perform public.employee_employment_assignment_save(emp,'2026-01-01',jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA ONLY LINDUNG workplace','legal_entity_id',ent),'QA explicit known January assignment',null,'QA rollback evidence');
 r:=public.payroll_initial_setup_read(emp,'2026-01-01',a,'2026-01-01');
 r:=public.payroll_initial_setup_confirm(emp,'2026-01-01','monthly',3250,'MYR',a,r->>'fingerprint','2026-01-01'); profile:=(r->>'profile_id')::uuid;
 june:=public.payroll_run_create(ent,'2026-06-01','2026-06-30','QA ONLY LINDUNG June');
 perform public.payroll_run_calculate(june);
 old:=public.payroll_statutory_project_pre_lindung(june,emp);
 if old->>'status'<>'ready' then raise exception 'Ordinary fixture not Ready: %',old; end if;
 r:=public.payroll_statutory_project(june,emp);
 if r->>'status'<>'review_required' or not (r->'issues' ? 'lindung_participation_unconfirmed:2026-06-01') then raise exception 'June evidence silently inferred: %',r; end if;
 insert into lindung_checks values('Missing June evidence fails closed');
 if public.payroll_lindung_qa_original_scope_issue((select period_id from public.payroll_runs where id=june)) is null then raise exception 'Existing historical cutover gate changed'; end if;
 intent:=jsonb_build_object('effective_month','2026-06-01','coverage_from','2026-06-01T00:00:00+08:00','status','valid_opt_out','worker_category','local',
 'participation_basis','opt_out','act4_covered',true,'not_receiving_lindung_benefit',true,'source_reference','QA ONLY PERKESO notice','reason','QA mandatory-period rejection');
 begin
  r:=public.payroll_lindung_setup_read(profile,'2026-06-01'); perform public.payroll_lindung_setup_confirm(profile,intent,r->>'fingerprint',gen_random_uuid());
  raise exception 'June opt-out accepted';
 exception when invalid_parameter_value then null; end;
 intent:=intent||jsonb_build_object('status','mandatory','participation_basis','mandatory','designated_legal_entity_id',ent);
 r:=public.payroll_lindung_setup_read(profile,'2026-06-01'); retry_request:=gen_random_uuid();
 r:=public.payroll_lindung_setup_confirm(profile,intent,r->>'fingerprint',retry_request);
 perform public.payroll_lindung_setup_confirm(profile,intent,'stale retry fingerprint',retry_request);
 if (select count(*) from public.payroll_lindung_participation_versions where profile_id=profile)<>1 then raise exception 'Retry duplicated history'; end if;
 begin perform public.payroll_lindung_setup_confirm(profile,intent||'{"reason":"Different payload"}',r->>'fingerprint',retry_request); raise exception 'Changed retry accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.payroll_lindung_setup_confirm(profile,intent,'stale',gen_random_uuid()); raise exception 'Stale accepted'; exception when sqlstate 'PT409' then null; end;
 r:=public.payroll_statutory_project(june,emp);
 select value into line from jsonb_array_elements(r->'lines') where value->>'scheme'='lindung';
 if (line->>'employee_amount')::numeric<>24.35 or (line->>'employer_amount')::numeric<>0 or (r->>'net_pay')::numeric<>3209.40 then raise exception 'June exact pricing failed: %',r; end if;
 if (select value from jsonb_array_elements(r->'lines') where value->>'scheme'='socso') is distinct from
  (select value from jsonb_array_elements(old->'lines') where value->>'scheme'='socso')
  or r->>'employer_statutory_cost' is distinct from old->>'employer_statutory_cost' then raise exception 'Ordinary SOCSO/employer regression'; end if;
 insert into lindung_checks values('June mandatory, employee-only amount, SOCSO exact parity, retry/stale/audit');
 -- Check every official row at its upper endpoint and one sen over its lower endpoint.
 for row in select b.* from public.payroll_statutory_schedule_bands b join public.payroll_statutory_schedule_versions s on s.id=b.schedule_version_id where s.scheme='lindung' order by b.wage_above loop
  foreach x in array array[row.wage_above+0.01,coalesce(row.wage_through,100000)] loop
   select b.employee_amount into actual from public.payroll_statutory_schedule_bands b where b.schedule_version_id=row.schedule_version_id and x>b.wage_above and (b.wage_through is null or x<=b.wage_through);
   if actual<>row.employee_amount then raise exception 'Band boundary failed: %',x; end if;
  end loop;
 end loop;
 if (select b.employee_amount from public.payroll_statutory_schedule_bands b join public.payroll_statutory_schedule_versions s on s.id=b.schedule_version_id where s.scheme='lindung' and 6000>b.wage_above and 6000<=b.wage_through)<>44.65 then raise exception 'Ceiling failed'; end if;
 insert into lindung_checks values('All 65 official band boundaries including RM6000 and above');
 r:=public.payroll_lindung_wages('[{"code":"regular","kind":"earning","amount":100},{"code":"overtime","kind":"earning","amount":20},{"code":"expenses","kind":"reimbursement","amount":500},{"code":"deduction","kind":"deduction","amount":10}]');
 if (r->>'wage_base')::numeric<>120 then raise exception 'Independent Act 4 wage basis failed: %',r; end if;
 r:=public.payroll_lindung_wages('[{"code":"unknown","kind":"earning","amount":100}]');
 if not (r->'issues' ? 'lindung_wage_treatment_unresolved:unknown') then raise exception 'Unknown wages cleared'; end if;
 insert into lindung_checks values('Independent Act 4 wages and unresolved component fail closed');
 july:=public.payroll_run_create(ent,'2026-07-01','2026-07-31','QA ONLY local opt-out'); perform public.payroll_run_calculate(july);
 r:=public.payroll_statutory_project(july,emp);
 if not (r->'issues' ? 'lindung_participation_unconfirmed:2026-07-01') then raise exception 'June evidence proved later local participation'; end if;
 intent:=intent||jsonb_build_object('effective_month','2026-07-01','coverage_from','2026-07-13T00:00:00+08:00','status','valid_opt_out','participation_basis','opt_out','designated_legal_entity_id',null);
 r:=public.payroll_lindung_setup_read(profile,'2026-07-01'); r:=public.payroll_lindung_setup_confirm(profile,intent,r->>'fingerprint',gen_random_uuid());
 r:=public.payroll_statutory_project(july,emp);
 if r->>'status'<>'ready' or (select value->>'applicable' from jsonb_array_elements(r->'lines') where value->>'scheme'='lindung')<>'false' then raise exception 'Valid opt-out not terminal: %',r; end if;
 insert into lindung_checks values('Valid local July opt-out, June obligation unchanged');
 september:=public.payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY September rejoin'); perform public.payroll_run_calculate(september);
 intent:=intent||jsonb_build_object('effective_month','2026-09-01','coverage_from','2026-09-15T14:30:00+08:00','submission_at','2026-09-15T14:30:00+08:00','status','participating','participation_basis','rejoin','designated_legal_entity_id',ent);
 r:=public.payroll_lindung_setup_read(profile,'2026-09-01');
 begin perform public.payroll_lindung_setup_confirm(profile,intent||'{"participation_basis":"default_enrolment"}',r->>'fingerprint',gen_random_uuid()); raise exception 'Rejoin timing bypassed'; exception when invalid_parameter_value then null; end;
 r:=public.payroll_lindung_setup_confirm(profile,intent,r->>'fingerprint',gen_random_uuid());
 r:=public.payroll_statutory_project(september,emp);
 if r->>'status'<>'ready' or (select (value->>'employee_amount')::numeric from jsonb_array_elements(r->'lines') where value->>'scheme'='lindung')<>24.35 then raise exception 'Rejoin full-month pricing failed: %',r; end if;
 if (public.payroll_lindung_resolve(profile,'2026-08-01')->>'applicable')::boolean<>false then raise exception 'September proof changed August'; end if;
 begin
  intent:=intent||jsonb_build_object('status','valid_opt_out','participation_basis','opt_out','coverage_from','2026-09-20T00:00:00+08:00','registration_date','2026-09-01','before_first_deduction',true,'first_contribution_month','2026-09-01');
  perform public.payroll_lindung_setup_confirm(profile,intent,public.payroll_lindung_setup_read(profile,'2026-09-01')->>'fingerprint',gen_random_uuid());
  raise exception 'Once In Always In bypassed';
 exception when invalid_parameter_value then null; end;
 insert into lindung_checks values('Local rejoin timestamp/full month and Once In Always In');
 r:=public.payroll_lindung_resolve(profile,'2028-06-01',ent);
 if r->>'issue'<>'lindung_rate_pack_unavailable' then raise exception 'Unverified future phase became Ready: %',r; end if;
 insert into lindung_checks values('Future phase fails closed without an official pack');
 perform public.payroll_run_statutory_calculate(september);
 if (public.payroll_run_statutory_readiness(september)->>'ready')::boolean is not true then raise exception 'Review readiness failed'; end if;
 r:=public.payroll_draft_payslip_read(september,emp);
 insert into lindung_manifests(draft) values(r);
 if not exists(select 1 from jsonb_array_elements(r->'statutory') v where v->>'scheme'='lindung' and (v->>'amount')::numeric=24.35 and (v->>'employer_amount')::numeric=0) then raise exception 'Draft payslip missing LINDUNG: %',r; end if;
 perform public.payroll_run_transition(september,'review_required','QA evidence reviewed');
 perform public.payroll_run_transition(september,'ready','QA all statutory evidence resolved');
 perform public.payroll_run_transition(september,'finalized','QA ONLY final snapshot');
 select md5(s.result::text) into snapshot from public.payroll_run_statutory_snapshots s where s.run_id=september and s.employee_id=emp;
 r:=public.payroll_statutory_project(september,emp);
 if r->'inputs'->'lindung_participation'->'evidence'->>'id' is null or r->'inputs'->'lindung_band'->>'id' is null then raise exception 'Insufficient frozen LINDUNG evidence'; end if;
 update lindung_manifests set final=public.payroll_payslip_manifest(september,emp);
 insert into lindung_checks values('Review, Draft payslip and Final participation/wages/pack/band freeze');
 correction:=public.payroll_run_create(ent,'2026-09-01','2026-09-30','QA ONLY governed LINDUNG correction',september);
 -- Same-month correction appends a superseding sourced participation revision.
 intent:=intent||jsonb_build_object('status','participating','participation_basis','rejoin','coverage_from','2026-09-15T14:30:00+08:00','submission_at','2026-09-15T14:30:00+08:00','reason','QA correct evidence reference');
 -- prior monthly rejoin revision is itself continuing evidence; preserve timing by no new election.
 intent:=intent||jsonb_build_object('participation_basis','default_enrolment');
 r:=public.payroll_lindung_setup_read(profile,'2026-09-01'); r:=public.payroll_lindung_setup_confirm(profile,intent,r->>'fingerprint',gen_random_uuid());
 perform public.payroll_run_calculate(correction); perform public.payroll_run_statutory_calculate(correction);
 if (public.payroll_run_statutory_readiness(correction)->>'ready')::boolean is not true then raise exception 'Correction readiness failed'; end if;
 perform public.payroll_run_transition(correction,'review_required','QA correction reviewed'); perform public.payroll_run_transition(correction,'ready','QA correction ready'); perform public.payroll_run_transition(correction,'finalized','QA ONLY corrected final');
 if snapshot is distinct from (select md5(s.result::text) from public.payroll_run_statutory_snapshots s where s.run_id=september and s.employee_id=emp) then raise exception 'Original final rewritten'; end if;
 insert into lindung_checks values('Governed correction and original final preservation');
 -- Separate foreign fixture: no inference from its ordinary SOCSO applicability.
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality)
 values('QA ONLY LINDUNG foreign','QA-L24-'||substr(gen_random_uuid()::text,1,8),ent,'QA ONLY LINDUNG workplace','Service Crew','full_time','active','2026-01-01','1990-01-01','Myanmar') returning id into foreign_emp;
 perform public.employee_employment_assignment_save(foreign_emp,'2026-01-01',jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA ONLY LINDUNG workplace','legal_entity_id',ent),'QA foreign known assignment',null,'QA rollback evidence');
 r:=public.payroll_initial_setup_read(foreign_emp,'2026-01-01','{"epf":false,"socso":false,"eis":false,"pcb":false}','2026-01-01');
 r:=public.payroll_initial_setup_confirm(foreign_emp,'2026-01-01','monthly',2000,'MYR','{"epf":false,"socso":false,"eis":false,"pcb":false}',r->>'fingerprint','2026-01-01'); foreign_profile:=(r->>'profile_id')::uuid;
 if public.payroll_lindung_resolve(foreign_profile,'2026-09-01')->>'status'<>'unresolved' then raise exception 'Foreign business history inferred'; end if;
 intent:=jsonb_build_object('effective_month','2026-09-01','coverage_from','2026-09-01T00:00:00+08:00','status','mandatory','worker_category','foreign','participation_basis','mandatory','act4_covered',true,'designated_legal_entity_id',ent,'source_reference','QA verified passport/work-pass','reason','QA explicit foreign mandatory');
 r:=public.payroll_lindung_setup_read(foreign_profile,'2026-09-01');
 begin perform public.payroll_lindung_setup_confirm(foreign_profile,intent||'{"designated_legal_entity_id":null}',r->>'fingerprint',gen_random_uuid()); raise exception 'Missing employer accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.payroll_lindung_setup_confirm(foreign_profile,intent||'{"status":"valid_opt_out"}',r->>'fingerprint',gen_random_uuid()); raise exception 'Foreign opt-out accepted'; exception when invalid_parameter_value then null; end;
 r:=public.payroll_lindung_setup_confirm(foreign_profile,intent,r->>'fingerprint',gen_random_uuid());
 if (public.payroll_lindung_resolve(foreign_profile,'2026-09-01',ent)->>'applicable')::boolean is not true then raise exception 'Foreign mandatory failed'; end if;
 if public.payroll_lindung_resolve(foreign_profile,'2026-08-01')->>'status'<>'unresolved' then raise exception 'September established August'; end if;
 intent:=intent||jsonb_build_object('effective_month','2026-10-01','coverage_from','2026-10-01T00:00:00+08:00','status','another_designated_employer','participation_basis','employer_designation','designated_legal_entity_id',other,'designation_change_reason','higher_salary');
 r:=public.payroll_lindung_setup_read(foreign_profile,'2026-10-01'); r:=public.payroll_lindung_setup_confirm(foreign_profile,intent,r->>'fingerprint',gen_random_uuid());
 if (public.payroll_lindung_resolve(foreign_profile,'2026-10-01',ent)->>'applicable')::boolean is not false then raise exception 'Other employer double charged'; end if;
 if public.payroll_lindung_resolve(foreign_profile,'2028-06-01',other)->>'issue' is null then raise exception 'Wrong designation not blocked'; end if;
 insert into lindung_checks values('Foreign mandatory, no opt-out, missing employer, another employer, unresolved historical month');
 -- Newly registered locals may explicitly opt out before their first deduction.
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,position,employment_type,employment_status,joined_date,birthday,nationality)
 values('QA ONLY LINDUNG new registration','QA-L24-'||substr(gen_random_uuid()::text,1,8),ent,'QA ONLY LINDUNG workplace','Service Crew','full_time','active','2026-09-22','1990-01-01','Malaysia') returning id into new_emp;
 perform public.employee_employment_assignment_save(new_emp,'2026-09-22',jsonb_build_object('employment_type','full_time','employment_status','active','position','Service Crew','workplace','QA ONLY LINDUNG workplace','legal_entity_id',ent),'QA new local known assignment',null,'QA rollback evidence');
 r:=public.payroll_initial_setup_read(new_emp,'2026-09-22',a,'2026-09-01');
 r:=public.payroll_initial_setup_confirm(new_emp,'2026-09-22','monthly',2000,'MYR',a,r->>'fingerprint','2026-09-01'); new_profile:=(r->>'profile_id')::uuid;
 intent:=jsonb_build_object('effective_month','2026-09-01','coverage_from','2026-09-25T00:00:00+08:00','status','valid_opt_out','worker_category','local','participation_basis','opt_out','act4_covered',true,
 'registration_date','2026-09-22','first_contribution_month','2026-09-01','before_first_deduction',true,'not_receiving_lindung_benefit',true,'source_reference','QA new registration notice','reason','QA first deduction exclusion');
 r:=public.payroll_lindung_setup_read(new_profile,'2026-09-01');
 begin perform public.payroll_lindung_setup_confirm(new_profile,intent||'{"before_first_deduction":false}',r->>'fingerprint',gen_random_uuid()); raise exception 'Post-first-deduction opt-out allowed'; exception when invalid_parameter_value then null; end;
 r:=public.payroll_lindung_setup_confirm(new_profile,intent,r->>'fingerprint',gen_random_uuid());
 if (public.payroll_lindung_resolve(new_profile,'2026-09-01',ent)->>'applicable')::boolean is not false then raise exception 'New registration opt-out failed'; end if;
 insert into lindung_checks values('New local registration opt-out requires notice before first deduction');
 -- Privileged corruption cannot change append-only evidence; public clients have no table access.
 begin update public.payroll_lindung_participation_versions set reason='QA rewrite' where profile_id=profile; raise exception 'History mutable'; exception when sqlstate '55000' then null; end;
 if has_table_privilege('authenticated','public.payroll_lindung_participation_versions','INSERT')
  or has_function_privilege('anon','public.payroll_lindung_setup_confirm(uuid,jsonb,text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.payroll_lindung_resolve(uuid,date,uuid)','EXECUTE') then raise exception 'Grant boundary failed'; end if;
 insert into public.roles(name,is_system_role,outlet_access_type) values('QA ONLY LINDUNG denied',false,'all') returning id into denied_role;
 insert into auth.users(id) values(denied_auth);
 insert into public.employees(full_name,employee_code,auth_user_id,role_id,enable_system_login,access_state)
 values('QA ONLY LINDUNG denied','QA-L24-'||substr(gen_random_uuid()::text,1,8),denied_auth,denied_role,true,'active');
 perform set_config('request.jwt.claim.sub',denied_auth::text,true);
 begin perform public.payroll_lindung_setup_read(profile,'2026-09-01'); raise exception 'No-permission reader accepted'; exception when insufficient_privilege then null; end;
 begin perform public.payroll_lindung_setup_confirm(profile,intent,'irrelevant',gen_random_uuid()); raise exception 'No-permission writer accepted'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',(select auth_user_id::text from public.employees where id=actor),true);
 insert into lindung_checks values('Permission grants, denied reader/writer, immutable history');
 -- Existing pre-task finals unchanged; fixture finals excluded by known run ids.
 if frozen_before is distinct from (select md5(coalesce(string_agg(s.result::text,'' order by s.run_id,s.employee_id),'')) from public.payroll_run_statutory_snapshots s where s.run_id not in (september,correction)) then raise exception 'Existing finalized evidence changed'; end if;
 insert into lindung_checks values('Existing finalized evidence hash unchanged');
end $$;
select jsonb_build_object('passed', (select jsonb_agg(check_name order by check_name) from lindung_checks), 'manifests',(select to_jsonb(m) from lindung_manifests m)) as evidence;
rollback;
