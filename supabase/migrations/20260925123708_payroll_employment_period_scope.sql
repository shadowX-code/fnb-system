-- Current Legal Entity assignment is not enough to include an employee in a
-- month before joining or after resignation. Unknown dates remain visible so
-- the calculation can require review instead of silently omitting the person.
create or replace function public.payroll_run_employee_ids(p_run_id uuid)
returns table(employee_id uuid) language sql stable security definer set search_path=public as $$
  select e.id from public.employees e join public.payroll_runs r on r.id=p_run_id
    join public.payroll_periods period on period.id=r.period_id
    where e.legal_entity_id=period.legal_entity_id
      and (e.joined_date is null or e.joined_date<=period.period_end)
      and (e.resigned_date is null or e.resigned_date>=period.period_start)
  union
  select p.employee_id from public.payroll_profiles p
    join public.employees e on e.id=p.employee_id
    join public.payroll_compensation_versions c on c.profile_id=p.id
    join public.payroll_runs r on r.id=p_run_id
    join public.payroll_periods period on period.id=r.period_id
    where c.legal_entity_id=period.legal_entity_id
      and c.effective_from<=period.period_end
      and (e.joined_date is null or e.joined_date<=period.period_end)
      and (e.resigned_date is null or e.resigned_date>=period.period_start);
$$;
