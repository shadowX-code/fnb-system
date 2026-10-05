-- Staging only; synthetic wage inputs and labelled QA fixture participation roll back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare code text; wages jsonb; component payroll_component_definitions%rowtype;
 c payroll_run_calculation_versions%rowtype; s jsonb; l jsonb; prior jsonb; current_project jsonb;
 frozen_before text; decision_before text; expected numeric; band payroll_statutory_schedule_bands%rowtype;
begin
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by run_id,employee_id),'')) into frozen_before from payroll_run_calculation_snapshots x;
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) into decision_before from payroll_payable_time_versions x;
 foreach code in array array['monthly_basic','regular','overtime','rest_day','public_holiday','public_holiday_ot','company_ph_benefit'] loop
  wages:=payroll_lindung_wages(jsonb_build_array(jsonb_build_object('kind','earning','code',code,'amount',100)));
  assert (wages->>'wage_base')::numeric=100 and wages->'issues'='[]'::jsonb,'System earning not classified: '||code;
 end loop;
 -- Real arithmetic pattern; no real Production employee/data copied.
 wages:=payroll_lindung_wages('[{"kind":"earning","code":"monthly_basic","amount":2000},{"kind":"earning","code":"company_ph_benefit","amount":76.92,"source":{"formula_version":"company_ph_v1","treatment_model":"unified_v1"}}]');
 assert (wages->>'wage_base')::numeric=2076.92 and wages->'issues'='[]'::jsonb,'Company PH base mismatch';
 assert wages#>>'{wage_base_lines,1,treatment}'='included','Missing pinned Act 4 evidence';
 select b.* into band from payroll_statutory_schedule_bands b join payroll_statutory_schedule_versions p on p.id=b.schedule_version_id
 where p.scheme='lindung' and p.category='phase1' and p.effective_from<='2026-09-01' and p.effective_to>='2026-09-30' and 2076.92>b.wage_above and (b.wage_through is null or 2076.92<=b.wage_through);
 assert band.id is not null and band.employee_amount=15.35,'Official Phase 1 band mismatch';
 wages:=payroll_lindung_wages('[{"kind":"earning","code":"monthly_basic","amount":2000},{"kind":"deduction","code":"unpaid_time","amount":100},{"kind":"reimbursement","code":"travel","amount":40},{"kind":"deduction","code":"loan","amount":20}]');
 assert (wages->>'wage_base')::numeric=1900 and wages->'issues'='[]'::jsonb,'Exclusion/reduction regression';
 wages:=payroll_lindung_wages('[{"kind":"earning","code":"unknown_custom","amount":100,"source":{"statutory_treatments":{"socso":"included"}}}]');
 assert wages->'issues' @> '["lindung_wage_treatment_unresolved:unknown_custom"]'::jsonb,'Client treatment bypass';
 for component in select * from payroll_component_definitions loop
  wages:=payroll_lindung_wages(jsonb_build_array(jsonb_build_object('kind','earning','code','qa_custom','amount',100,'source',jsonb_build_object('component_definition_id',component.id))));
  if component.socso_treatment='included' then
   assert (wages->>'wage_base')::numeric=100 and wages->'issues'='[]'::jsonb,'Configured inclusion regression';
  elsif component.socso_treatment='excluded' then
   assert (wages->>'wage_base')::numeric=0 and wages->'issues'='[]'::jsonb,'Configured exclusion regression';
  else assert wages->'issues' @> '["lindung_wage_treatment_unresolved:qa_custom"]'::jsonb,'Undetermined component allowed';end if;
 end loop;
 -- Existing labelled synthetic Monthly and Hourly PH fixtures, no decision/pricing writes.
 for c in select cv.* from payroll_run_calculation_versions cv join employees e on e.id=cv.employee_id
 where e.full_name in ('QA ONLY Unified PH 1','QA ONLY PH d2342702 2')
 and cv.revision=(select max(x.revision) from payroll_run_calculation_versions x where x.employee_id=cv.employee_id and x.run_id=cv.run_id) loop
  wages:=payroll_lindung_wages(c.lines);
  assert wages->'issues'='[]'::jsonb,'Live fixture wage mapping unresolved';
  if (select status from payroll_runs where id=c.run_id) in ('finalized','paid') then
   assert payroll_statutory_project(c.run_id,c.employee_id)=(select result from payroll_run_statutory_snapshots where run_id=c.run_id and employee_id=c.employee_id),'Finalized result not frozen';
   continue;
  end if;
  prior:=payroll_statutory_project_pre_lindung(c.run_id,c.employee_id);
  s:=payroll_statutory_setup_read((select id from payroll_profiles where employee_id=c.employee_id),'2026-09-01');
  l:=payroll_lindung_setup_read((select id from payroll_profiles where employee_id=c.employee_id),'2026-09-01');
  perform payroll_statutory_setup_confirm((select id from payroll_profiles where employee_id=c.employee_id),'2026-09-01',
   s->'applicability',s->'categories',s->>'fingerprint',null,null,jsonb_build_object('status','participating','worker_category','local','act4_covered',true,'source_reference','QA ONLY temporary wage mapping contract','designated_legal_entity_id',(select legal_entity_id from payroll_periods where id=(select period_id from payroll_runs where id=c.run_id))),l->>'fingerprint',gen_random_uuid());
  current_project:=payroll_statutory_project(c.run_id,c.employee_id);
  assert not exists(select 1 from jsonb_array_elements_text(current_project->'issues') x where x like 'lindung_wage_treatment_unresolved:%'),'System PH still blocked';
  select coalesce(sum((line->>'amount')::numeric),0) into expected from jsonb_array_elements(c.lines) line where line->>'kind'='earning';
  assert (current_project#>>'{inputs,lindung_wages,wage_base}')::numeric=expected,'Integrated wage base mismatch';
  assert (select jsonb_agg(x) from jsonb_array_elements(current_project->'lines') x where x->>'scheme'<>'lindung')=prior->'lines','Ordinary statutory changed';
 end loop;
 assert frozen_before=(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by run_id,employee_id),'')) from payroll_run_calculation_snapshots x),'Frozen snapshots changed';
 assert decision_before=(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from payroll_payable_time_versions x),'PH/time decisions changed';
 assert not has_function_privilege('authenticated','payroll_lindung_wages(jsonb)','execute'),'Internal authority exposed';
end $$;
rollback;
select 'PASS: system wages, official band, custom fail-closed, integrated Monthly/Hourly PH, ordinary statutory and immutable evidence' result;
