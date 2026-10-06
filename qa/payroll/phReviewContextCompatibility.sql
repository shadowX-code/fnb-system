-- Run against migrated Staging inside a rollback transaction.
begin;
do $$
declare r public.payroll_ph_eligibility_reviews%rowtype; current_context jsonb; changed jsonb; field text; checked integer:=0; before_hash text; after_hash text;
begin
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into before_hash from payroll_ph_eligibility_reviews x;
 for r in select * from payroll_ph_eligibility_reviews where id in
 ('a926096d-724c-4681-b62f-81034d8b94ed','b0729f9e-12c9-409f-b21d-a1a7bb3a0122','9a07e52e-baad-429d-8d7e-9e336bd810dc') loop
  current_context:=payroll_ph_statutory_context(r.run_id,r.employee_id,r.work_date);
  if r.context <> current_context #- '{employment,employment_jurisdiction}' then raise exception 'Fixture no longer isolates schema-only addition';end if;
  if not payroll_ph_review_context_matches(r.context,r.context_fingerprint,current_context) then raise exception 'Schema-only compatibility failed';end if;
  if payroll_ph_review_context_matches(r.context,'invalid',current_context) then raise exception 'Corrupt binding accepted';end if;
  changed:=jsonb_set(current_context,'{employment,employment_jurisdiction}','"peninsular_malaysia_labuan"');
  if payroll_ph_review_context_matches(r.context,r.context_fingerprint,changed) then raise exception 'Non-null evidence change accepted';end if;
  foreach field in array array['source','time','paid_holiday','compensation','rules','company_policy','company_benefit','employment','date'] loop
   changed:=jsonb_set(current_context,array[field],jsonb_build_object('changed',true));
   if payroll_ph_review_context_matches(r.context,r.context_fingerprint,changed) then raise exception 'Material % change accepted',field;end if;
  end loop;
  for i in 1..2 loop
   if payroll_ph_statutory_project(r.run_id,r.employee_id,r.work_date)->'issues' ? 'ph_eligibility_evidence_changed' then raise exception 'Persisted review incorrectly invalidated';end if;
  end loop;
  checked:=checked+1;
 end loop;
 if checked<>3 then raise exception 'Expected three retained QA workflows';end if;
 select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'')) into after_hash from payroll_ph_eligibility_reviews x;
 if before_hash<>after_hash then raise exception 'Review evidence changed';end if;
 raise notice 'PASS: three review workflows; intact binding; source/time/PH/compensation/rules/policy/employment controls; repeated reads; immutable history';
end $$;
rollback;
