-- Population completeness is separate from inclusion. Unknown employer/history
-- can affect any entity; today's employer, status and workplace cannot exclude it.
create function public.payroll_period_population_gaps(p_period_id uuid)
returns table(employee_id uuid, date_from date, date_to date, issue text, missing_field text)
language sql stable security definer set search_path=public as $$
  with daily as materialized (
    select e.id employee_id,e.joined_date,p.legal_entity_id,d.work_date::date work_date,
      public.employee_employment_assignment_at(e.id,d.work_date::date) assignment
    from public.payroll_periods p
    cross join public.employees e
    cross join lateral generate_series(greatest(p.period_start,coalesce(e.joined_date,p.period_start)),
      p.period_end,interval '1 day') d(work_date)
    where p.id=p_period_id
  ), unresolved as (
    select employee_id,work_date,
      case when (assignment).id is null then 'employment_history_unresolved'
        when (assignment).legal_entity_id is null then 'legal_employer_unresolved'
        else 'employment_joined_date_missing' end issue,
      case when (assignment).id is null then 'employment_assignment'
        when (assignment).legal_entity_id is null then 'legal_entity_id'
        else 'joined_date' end missing_field
    from daily
    where (assignment).id is null
      or ((assignment).employment_status='active'
        and ((assignment).employment_end_date is null or work_date<=(assignment).employment_end_date)
        and ((assignment).legal_entity_id is null
          or ((assignment).legal_entity_id=legal_entity_id and joined_date is null)))
  ), islands as (
    select *,work_date-(row_number() over(partition by employee_id,issue,missing_field order by work_date))::int island
    from unresolved
  )
  select employee_id,min(work_date),max(work_date),issue,missing_field from islands
    group by employee_id,issue,missing_field,island order by min(work_date),employee_id;
$$;
revoke all on function public.payroll_period_population_gaps(uuid) from public,anon,authenticated;

create or replace function public.payroll_period_employment_scope_issue(p_period_id uuid)
returns text language sql stable security definer set search_path=public as $$
  select case when not exists(select 1 from public.payroll_periods where id=p_period_id)
    then 'employment_period_unresolved'
    when exists(select 1 from public.payroll_period_population_gaps(p_period_id))
    then 'employment_population_requires_review' else null end;
$$;
revoke all on function public.payroll_period_employment_scope_issue(uuid) from public,anon,authenticated;

-- Reuse the authenticated run read; do not expose the unscoped internal scan.
-- Inaccessible records still block completeness but their identity is not leaked.
do $migration$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.payroll_run_preparation_read(uuid)'::regprocedure);
  changed:=replace(original,
    $anchor$'results',v_rows,'period_start'$anchor$,
    $replacement$'results',v_rows,'employment_population',case when v_run.status in ('finalized','paid') then null else
      jsonb_build_object('unresolved_count',(select count(*) from public.payroll_period_population_gaps(v_period.id)),
        'records',coalesce((select jsonb_agg(jsonb_build_object('employee_id',g.employee_id,
          'employee_name',e.full_name,'date_from',g.date_from,'date_to',g.date_to,
          'employment',jsonb_build_object('state','review_required','issue',g.issue,'missing_field',g.missing_field)))
          from public.payroll_period_population_gaps(v_period.id) g join public.employees e on e.id=g.employee_id
          where public.payroll_can_access_employee(g.employee_id,'payroll.view')), '[]'::jsonb)) end,'period_start'$replacement$);
  if changed=original then raise exception 'Payroll preparation population read anchor changed'; end if;
  execute changed;
end $migration$;
