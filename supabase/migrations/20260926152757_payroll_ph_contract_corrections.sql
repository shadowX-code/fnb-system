-- Give company policy audit its canonical owner, preserving the exactly-one
-- event owner invariant instead of using an unrelated employee/rule record.
alter table public.payroll_events add column ph_policy_version_id uuid references public.payroll_ph_policy_versions(id);
alter table public.payroll_events drop constraint payroll_events_check;
alter table public.payroll_events add constraint payroll_events_check
 check(num_nonnulls(profile_id,run_id,holiday_id,component_id,rule_version_id,ph_policy_version_id)=1);
do $$ declare def text; begin
 def:=pg_get_functiondef('public.payroll_ph_policy_save(uuid,date,text,text)'::regprocedure);
 def:=replace(def,'insert into public.payroll_events(event_type,actor_employee_id,details) values(''ph_company_policy_confirmed'',a,',
 'insert into public.payroll_events(event_type,ph_policy_version_id,actor_employee_id,details) values(''ph_company_policy_confirmed'',result,a,');
 execute def;
end $$;
