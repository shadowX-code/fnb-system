-- Staging only. All temporary labelled QA fixture evidence rolls back.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from employees e join roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare c payroll_run_calculation_versions%rowtype; s jsonb; l jsonb; result jsonb; line jsonb; wages jsonb;
 scheme text; amount numeric; base numeric; profile uuid; entity uuid; original jsonb;
 frozen text; decisions text; rules text; summary jsonb;
begin
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by run_id,employee_id),'')) into frozen from payroll_run_calculation_snapshots x;
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) into decisions from payroll_payable_time_versions x;
 select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) into rules from payroll_pay_rule_versions x;
 assert payroll_ph_company_allowance('{"pay_basis":"monthly","basic_salary":2600}','{"approved_minutes":300}')=100,'Monthly PH formula changed';
 assert payroll_ph_company_allowance('{"pay_basis":"hourly","hourly_rate":15}','{"approved_minutes":300}')=75,'Hourly PH formula changed';
 select cv.* into strict c from payroll_run_calculation_versions cv join employees e on e.id=cv.employee_id join payroll_runs r on r.id=cv.run_id
 where e.full_name='QA ONLY Unified PH 1' and r.status='draft' order by cv.revision desc limit 1;
 select id into profile from payroll_profiles where employee_id=c.employee_id;
 select legal_entity_id into entity from payroll_periods where id=(select period_id from payroll_runs where id=c.run_id);
 summary:=payroll_company_ph_statutory_read(entity);
 assert jsonb_array_length(summary->'treatments')=5,'Summary incomplete';
 assert summary#>>'{treatments,4,method}'='manual_confirmed','PCB authority changed';
 s:=payroll_statutory_setup_read(profile,'2026-09-01');l:=payroll_lindung_setup_read(profile,'2026-09-01');
 perform payroll_statutory_setup_confirm(profile,'2026-09-01','{"epf":false,"socso":false,"eis":false,"pcb":false}',
  '{}',s->>'fingerprint',null,null,'{"status":"not_applicable"}',l->>'fingerprint',gen_random_uuid());
 result:=payroll_statutory_project(c.run_id,c.employee_id);
 for line in select value from jsonb_array_elements(result->'lines') loop
  assert line->>'applicable'='false' and (line->>'employee_amount')::numeric=0 and (line->>'employer_amount')::numeric=0,'Employee N/A overridden';
 end loop;
 s:=payroll_statutory_setup_read(profile,'2026-09-01','{"epf":true,"socso":true,"eis":true,"pcb":true}');l:=payroll_lindung_setup_read(profile,'2026-09-01');
 perform payroll_statutory_setup_confirm(profile,'2026-09-01','{"epf":true,"socso":true,"eis":true,"pcb":true}',
  '{"epf":"malaysian_under_60","socso":"first_category_base","eis":"standard"}',s->>'fingerprint',null,null,
  jsonb_build_object('status','participating','worker_category','local','act4_covered',true,'designated_legal_entity_id',entity,'source_reference','QA ONLY rollback statutory classification contract'),l->>'fingerprint',gen_random_uuid());
 original:=c.lines;
 -- Synthetic calculation inputs within the existing open labelled fixture only.
 -- No previous decisions or finalized evidence is changed; transaction rolls back.
 foreach amount in array array[100::numeric,75::numeric] loop
  c.id:=gen_random_uuid();c.revision:=c.revision+1;
  c.lines:=jsonb_build_array(
   jsonb_build_object('kind','earning','code','monthly_basic','amount',2600),
   jsonb_build_object('kind','earning','code','company_ph_benefit','amount',amount,'source',jsonb_build_object('formula_version','company_ph_v1')),
   jsonb_build_object('kind','earning','code','overtime','amount',10),
   jsonb_build_object('kind','earning','code','public_holiday_ot','amount',20,'source',jsonb_build_object('formula_version','my_ph_2023_v1','statutory_treatments',jsonb_build_object('epf','excluded','socso','included','eis','included','pcb','included'))))
  ;
  insert into payroll_run_calculation_versions select c.*;
  result:=payroll_statutory_project(c.run_id,c.employee_id);
  foreach scheme in array array['epf','socso','eis'] loop
   select (value->>'wage_base')::numeric into base from jsonb_array_elements(result->'lines') where value->>'scheme'=scheme;
   assert base=2600+amount+case when scheme='epf' then 0 else 30 end,'Incorrect base: '||scheme;
   assert exists(select 1 from jsonb_array_elements(result#>'{inputs,wage_base_lines}') x where x->>'scheme'=scheme and x->>'line_code'='company_ph_benefit' and x->>'treatment'='included'),'Missing pinned PH treatment';
  end loop;
  assert (result#>>'{inputs,lindung_wages,wage_base}')::numeric=2630+amount,'LINDUNG base mismatch';
  assert result#>>'{inputs,pcb_method}'='manual_confirmed','PCB manual confirmation lost';
  assert result->'issues' @> '["pcb_manual_confirmation_missing"]'::jsonb,'PCB silently auto-calculated';
 end loop;

 wages:=payroll_lindung_wages('[{"kind":"earning","code":"unknown","amount":100}]');
 assert wages->'issues' @> '["lindung_wage_treatment_unresolved:unknown"]'::jsonb,'Unknown component allowed';
 assert frozen=(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by run_id,employee_id),'')) from payroll_run_calculation_snapshots x),'Frozen evidence changed';
 assert decisions=(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from payroll_payable_time_versions x),'Decisions changed';
 assert rules=(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from payroll_pay_rule_versions x),'Pay rules changed';
 assert not has_function_privilege('anon','payroll_company_ph_statutory_read(uuid)','execute'),'Anonymous read exposed';
 assert not has_function_privilege('authenticated','payroll_company_ph_statutory_treatment(text)','execute'),'Internal mapping exposed';
 begin perform payroll_company_ph_statutory_read(gen_random_uuid());raise exception 'Unscoped company allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: formulas, all wage bases, OT separation, employee N/A, manual PCB, frozen evidence and scope' result;
