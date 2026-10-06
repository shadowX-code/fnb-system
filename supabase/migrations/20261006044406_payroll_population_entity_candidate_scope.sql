-- Scope historical completeness to entity-linked People evidence, not global legacy gaps.
create or replace function public.payroll_period_population_gaps(p_period_id uuid)
returns table(employee_id uuid, date_from date, date_to date, issue text, missing_field text)
language sql stable security definer set search_path=public as $$
  with known_employers as materialized (
    -- Use the canonical resolver to exclude superseded and audit-only revisions.
    select r.employee_id,r.effective_from,r.legal_entity_id
    from public.employee_employment_assignment_revisions r
    where r.legal_entity_id is not null
      and (public.employee_employment_assignment_at(r.employee_id,r.effective_from)).id=r.id
  ), daily as materialized (
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
    where (
      -- Candidate evidence is not proof of membership. Bound an unknown segment
      -- by the closest known employers; never spread it to unrelated entities.
      legal_entity_id=(select k.legal_entity_id from known_employers k
        where k.employee_id=daily.employee_id and k.effective_from<=work_date
        order by k.effective_from desc limit 1)
      or legal_entity_id=(select k.legal_entity_id from known_employers k
        where k.employee_id=daily.employee_id and k.effective_from>work_date
        order by k.effective_from limit 1)
    ) and ((assignment).id is null
      or ((assignment).employment_status='active'
        and ((assignment).employment_end_date is null or work_date<=(assignment).employment_end_date)
        and ((assignment).legal_entity_id is null
          or ((assignment).legal_entity_id=legal_entity_id and joined_date is null))))
  ), islands as (
    select *,work_date-(row_number() over(partition by employee_id,issue,missing_field order by work_date))::int island
    from unresolved
  )
  select employee_id,min(work_date),max(work_date),issue,missing_field from islands
    group by employee_id,issue,missing_field,island order by min(work_date),employee_id;
$$;
revoke all on function public.payroll_period_population_gaps(uuid) from public,anon,authenticated;
