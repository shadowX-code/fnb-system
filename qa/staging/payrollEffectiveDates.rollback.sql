-- Isolated Staging rollback fixtures. No operational employee is edited.
begin;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from public.employees e
 join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login
 and e.access_state='active' limit 1),true);
do $$
declare actor uuid:=public.payroll_admin_actor(); entity uuid; outlet uuid; employee uuid; profile uuid; run uuid;
 r jsonb; a jsonb:='{"epf":true,"socso":true,"eis":true,"pcb":false}'; policy text; component uuid; result jsonb;
 old_history text; old_final text; before_events integer; ccc uuid; ccc_profile uuid; ccc_run uuid; joiner uuid;
begin
 insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,created_by_employee_id,updated_by_employee_id)
 values('QA effective-date rollback','QA-'||gen_random_uuid(),'Rollback only',actor,actor) returning id into entity;
 insert into public.outlets(name,code,state_code) values('QA effective-date rollback','QA-'||substr(gen_random_uuid()::text,1,8),'MY-08') returning id into outlet;
 insert into public.payroll_outlet_state_versions(outlet_id,effective_from,state_code) values(outlet,'2026-01-01','MY-08');
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality)
 values('QA effective-date rollback','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA effective-date rollback','2026-05-01','1990-01-01','Malaysia') returning id into employee;
 r:=public.payroll_initial_setup_read(employee,'2026-05-01',a,'2026-06-01');
 r:=public.payroll_initial_setup_confirm(employee,'2026-05-01','monthly',1700,'MYR',a,r->>'fingerprint','2026-06-01');
 profile:=(r->>'profile_id')::uuid;
 if r->>'complete'<>'true' then raise exception 'Initial recommendations unresolved: %',r; end if;
 run:=public.payroll_run_create(entity,'2026-06-01','2026-06-30','QA rollback effective dates');
 r:=public.payroll_statutory_setup_resolve(profile,'2026-06-01',null);
 if r->>'complete'<>'true' then raise exception 'Month setup not effective at start: %',r; end if;
 select count(*) into before_events from public.payroll_events where profile_id=profile;
 r:=public.payroll_statutory_setup_read(profile,'2026-06-01',a);
 perform public.payroll_statutory_setup_confirm(profile,'2026-06-01',a,
  '{"epf":"malaysian_under_60","socso":"first_category_base","eis":"standard"}',r->>'fingerprint');
 if before_events<>(select count(*) from public.payroll_events where profile_id=profile) then raise exception 'Identical confirmation duplicated audit'; end if;
 -- Each component policy prices the same exact-date assignment without UI arithmetic.
 foreach policy in array array['calendar_days','full_when_active','next_full_period'] loop
  component:=public.payroll_component_save(null,'qa_'||replace(gen_random_uuid()::text,'-',''),'QA '||policy,'allowance',
   'included','included','included','included',true,null,policy);
  perform public.payroll_recurring_adjust(profile,component,'2026-06-26',100,true,'Rollback allowance start');
  result:=public.payroll_recurring_period_project(profile,component,'2026-06-01','2026-06-30','2026-05-01',null);
  if (result->'line'->>'amount')::numeric<>(case policy when 'calendar_days' then 16.67 when 'full_when_active' then 100 else 0 end) then
   raise exception 'Policy pricing mismatch %: %',policy,result; end if;
  if policy='next_full_period' then
   result:=public.payroll_recurring_period_project(profile,component,'2026-07-01','2026-07-31','2026-05-01',null);
   if (result->'line'->>'amount')::numeric<>100 then raise exception 'Next full period did not start'; end if;
  end if;
 end loop;
 -- A definition without policy fails closed; no silent default.
 begin
  component:=public.payroll_component_save(null,'qa_'||replace(gen_random_uuid()::text,'-',''),'QA unresolved','allowance',
   'included','included','included','included',true,null,null);
  perform public.payroll_recurring_adjust(profile,component,'2026-06-26',100,true,'Rollback unresolved');
  result:=public.payroll_calculation_project(run,employee);
  if not (result->'issues' ? ('component_proration_policy_required:'||component)) then raise exception 'Missing policy did not block'; end if;
  raise exception using errcode='ZX001',message='Rollback unresolved component';
 exception when sqlstate 'ZX001' then null; end;
 perform public.payroll_employee_recalculate(run,employee);
 result:=public.payroll_statutory_project(run,employee);
 if result->>'status'<>'ready' or exists(select 1 from jsonb_array_elements(result->'lines') l
  where l->>'scheme' in ('epf','socso','eis') and (l->>'wage_base')::numeric<>1816.67) then
  raise exception 'Canonical component amount/statutory base mismatch: %',result; end if;
 -- A later monthly setup never rewrites June or its evidence.
 select md5(jsonb_agg(to_jsonb(v) order by id)::text) into old_history from public.payroll_statutory_profile_versions v where profile_id=profile;
 r:=public.payroll_statutory_setup_read(profile,'2026-07-01','{"epf":false,"socso":false,"eis":false,"pcb":false}');
 perform public.payroll_statutory_setup_confirm(profile,'2026-07-01','{"epf":false,"socso":false,"eis":false,"pcb":false}','{}',r->>'fingerprint');
 begin
  perform public.payroll_statutory_setup_confirm(profile,'2026-07-01','{"epf":false,"socso":false,"eis":false,"pcb":false}','{}',r->>'fingerprint');
  raise exception 'Stale monthly editor accepted';
 exception when sqlstate 'PT409' then null; end;
 r:=public.payroll_statutory_setup_resolve(profile,'2026-06-01',null);
 if r->'schemes'->'epf'->>'state'<>'confirmed' then raise exception 'July changed June'; end if;
 r:=public.payroll_statutory_setup_resolve(profile,'2026-07-01',null);
 if r->'schemes'->'epf'->>'state'<>'not_applicable' then raise exception 'July not resolved'; end if;
 if old_history<>(select md5(jsonb_agg(to_jsonb(v) order by id)::text) from public.payroll_statutory_profile_versions v where profile_id=profile and effective_from<'2026-07-01') then
  raise exception 'Earlier evidence changed'; end if;
 perform public.payroll_run_transition(run,'review_required','QA review');
 perform public.payroll_run_transition(run,'ready','QA readiness');
 perform public.payroll_run_transition(run,'finalized','QA Finalize');
 select md5(calculation::text) into old_final from public.payroll_run_calculation_snapshots where run_id=run and employee_id=employee;
 begin
  r:=public.payroll_statutory_setup_read(profile,'2026-06-01',a);
  perform public.payroll_statutory_setup_confirm(profile,'2026-06-01',a,'{}',r->>'fingerprint');
  raise exception 'Finalized statutory month accepted change';
 exception when sqlstate '55000' then null; end;
 if old_final<>(select md5(calculation::text) from public.payroll_run_calculation_snapshots where run_id=run and employee_id=employee) then
  raise exception 'Finalized snapshot changed'; end if;
 -- Ccc-like legacy case: gap persists until explicit monthly confirmation;
 -- missing salary history still blocks even after statutory month is resolved.
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality)
 values('QA Ccc-like rollback','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA effective-date rollback','2026-05-01','1990-01-01','Malaysia') returning id into ccc;
 ccc_profile:=public.payroll_profile_create(ccc,'2026-06-26','monthly',1700,'MYR','Legacy QA setup',null,null,false,true,false,false);
 perform public.payroll_statutory_input_adjust(ccc_profile,'2026-06-27',null,'first_category_base',null,'{}','QA legacy evidence','Legacy QA categories');
 r:=public.payroll_statutory_setup_resolve(ccc_profile,'2026-06-01',null);
 if r->>'complete'='true' then raise exception 'Legacy history silently backdated'; end if;
 r:=public.payroll_statutory_setup_read(ccc_profile,'2026-06-01','{"epf":false,"socso":true,"eis":false,"pcb":false}');
 perform public.payroll_statutory_setup_confirm(ccc_profile,'2026-06-01','{"epf":false,"socso":true,"eis":false,"pcb":false}',
  '{"socso":"first_category_base"}',r->>'fingerprint');
 r:=public.payroll_statutory_setup_resolve(ccc_profile,'2026-06-01',null);
 if r->>'complete'<>'true' then raise exception 'Monthly legacy transition unresolved: %',r; end if;
 -- Projection can inspect the same period without writing the finalized Run.
 result:=public.payroll_calculation_project(run,ccc);
 if not (result->'issues' ? 'pay_history_missing:2026-06-01..2026-06-25') then raise exception 'Missing salary history hidden: %',result; end if;
 -- New joiner still uses exact pay date and the approved calendar-day authority.
 insert into public.employees(full_name,employee_code,legal_entity_id,workplace,joined_date,birthday,nationality)
 values('QA mid-month joiner rollback','QA-'||substr(gen_random_uuid()::text,1,8),entity,'QA effective-date rollback','2026-06-11','1990-01-01','Malaysia') returning id into joiner;
 r:=public.payroll_initial_setup_read(joiner,'2026-06-11',a,'2026-06-01');
 r:=public.payroll_initial_setup_confirm(joiner,'2026-06-11','monthly',3000,'MYR',a,r->>'fingerprint','2026-06-01');
 result:=public.payroll_calculation_project(run,joiner);
 if (result->>'gross_earnings')::numeric<>2000 then raise exception 'Exact-date mid-month join/proration regression: %',result; end if;
 -- Opaque/anonymous callers cannot become a Payroll Admin by passing IDs.
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.payroll_statutory_setup_read(profile,'2026-06-01',null);
  raise exception 'Unauthenticated setup read accepted';
 exception when insufficient_privilege then null; end;
end; $$;
rollback;
