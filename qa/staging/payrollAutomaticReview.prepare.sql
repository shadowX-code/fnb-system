-- Staging only: labelled existing QA employees, no finalized/real evidence changes.
-- The browser, not this setup script, must perform automatic recalculation.
begin;
select set_config('request.jwt.claim.sub',(select e.auth_user_id::text from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.enable_system_login and e.access_state='active' limit 1),true);
do $$
declare p uuid; ent uuid; emp uuid; run uuid;
begin
 select id into emp from public.employees where employee_code='QA-SEQ-1003';
 select id into p from public.payroll_profiles where employee_id=emp;
 if p is null then raise exception 'Sequential review fixture missing'; end if;
 perform public.payroll_compensation_adjust(p,'2026-09-02','hourly',16,'MYR','QA ONLY canonical input change verifies automatic stale recalculation');
 select id,legal_entity_id into emp,ent from public.employees where employee_code='QA-P4-V1-0927';
 if emp is null then raise exception 'Supported statutory fixture missing'; end if;
 if exists(select 1 from public.payroll_periods where legal_entity_id=ent and period_start='2026-10-01') then raise exception 'October QA run already exists: inspect instead of repeating'; end if;
 run:=public.payroll_run_create(ent,'2026-10-01','2026-10-31','QA ONLY automatic calculation/table verification; no finalization or payment');
 perform public.payroll_run_pcb_confirm(gen_random_uuid(),run,emp,50,null,'QA synthetic monthly PCB confirmation','QA ONLY table verification');
end $$;
commit;
