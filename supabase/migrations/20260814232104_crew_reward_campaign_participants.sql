-- Reward Campaign participant snapshots.
-- Campaign membership is frozen at creation and remains stable across later
-- employee transfers, departures, and outlet changes.

create table public.crew_reward_participants (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.crew_reward_cycles(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  position text,
  outlet_id uuid not null references public.outlets(id),
  selected_at timestamptz not null default now(),
  selected_by uuid references auth.users(id),
  unique (cycle_id, employee_id)
);

create index crew_reward_participants_cycle_idx
  on public.crew_reward_participants(cycle_id, employee_name);

alter table public.crew_reward_participants enable row level security;
revoke all on public.crew_reward_participants from public, anon, authenticated;
grant select, insert, update, delete on public.crew_reward_participants to service_role;

-- Preserve already-created Staging campaigns. Calculated campaigns use their
-- immutable entry membership; uncalculated drafts use the eligibility set that
-- existed when this forward migration was applied.
insert into public.crew_reward_participants(
  cycle_id, employee_id, employee_name, position, outlet_id, selected_at, selected_by
)
select e.cycle_id, e.employee_id, e.employee_name, e.position, c.outlet_id,
       coalesce(e.created_at, c.created_at), c.created_by
from public.crew_reward_entries e
join public.crew_reward_cycles c on c.id = e.cycle_id
on conflict (cycle_id, employee_id) do nothing;

insert into public.crew_reward_participants(
  cycle_id, employee_id, employee_name, position, outlet_id, selected_at, selected_by
)
select c.id, e.id, e.full_name, e.position, c.outlet_id, c.created_at, c.created_by
from public.crew_reward_cycles c
join public.crew_access ca
  on ca.primary_outlet_id = c.outlet_id
 and ca.access_state = 'active'
join public.employees e
  on e.id = ca.employee_id
 and e.is_active
 and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
where c.status = 'draft'
  and not exists (
    select 1 from public.crew_reward_participants p where p.cycle_id = c.id
  )
on conflict (cycle_id, employee_id) do nothing;

create or replace function public.crew_reward_create_campaign(
  p_outlet_id uuid,
  p_period date,
  p_configured_pool numeric,
  p_employee_ids uuid[] default null,
  p_minimum_performance numeric default 60
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_id uuid;
  period date := date_trunc('month', p_period)::date;
  requested_count integer := coalesce(cardinality(p_employee_ids), 0);
  inserted_count integer;
begin
  if not public.current_user_has_permission('crew_reward.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Reward management is unavailable for this outlet.';
  end if;
  if p_configured_pool <= 0 or p_configured_pool > 10000000 then
    raise exception using errcode = '22023', message = 'Reward Pool must be greater than RM0 and no more than RM10,000,000.';
  end if;
  if p_minimum_performance < 0 or p_minimum_performance > 100 then
    raise exception using errcode = '22023', message = 'Minimum Performance must be between 0 and 100.';
  end if;
  if p_employee_ids is not null and requested_count = 0 then
    raise exception using errcode = '22023', message = 'Select at least one eligible Crew member.';
  end if;

  insert into public.crew_reward_cycles(
    outlet_id, period_start, configured_pool, minimum_performance, created_by
  ) values (
    p_outlet_id, period, round(p_configured_pool, 2), p_minimum_performance, auth.uid()
  ) returning id into cycle_id;

  insert into public.crew_reward_participants(
    cycle_id, employee_id, employee_name, position, outlet_id, selected_by
  )
  select cycle_id, e.id, e.full_name, e.position, p_outlet_id, auth.uid()
  from public.employees e
  join public.crew_access ca
    on ca.employee_id = e.id
   and ca.primary_outlet_id = p_outlet_id
   and ca.access_state = 'active'
  where e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
    and (p_employee_ids is null or e.id = any(p_employee_ids));

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception using errcode = '22023', message = 'No eligible Crew are available for this Reward Campaign.';
  end if;
  if p_employee_ids is not null and inserted_count <> requested_count then
    raise exception using errcode = '22023', message = 'One or more selected Crew are outside this outlet or no longer eligible.';
  end if;

  return cycle_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'A Reward Campaign already exists for this outlet and month.';
end;
$$;

revoke all on function public.crew_reward_create_campaign(uuid,date,numeric,uuid[],numeric) from public, anon, authenticated;
grant execute on function public.crew_reward_create_campaign(uuid,date,numeric,uuid[],numeric) to authenticated;

create or replace function public.crew_reward_calculate(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle public.crew_reward_cycles%rowtype;
  average_score numeric;
  total_hours numeric;
  estimated numeric;
begin
  select * into cycle
  from public.crew_reward_cycles
  where id = p_cycle_id
  for update;

  if cycle.id is null then
    raise exception using errcode = 'P0002', message = 'Reward Campaign was not found.';
  end if;
  if not public.current_user_has_permission('crew_reward.manage')
     or not public.current_user_can_access_outlet(cycle.outlet_id) then
    raise exception using errcode = '42501', message = 'Reward management is unavailable for this outlet.';
  end if;
  if cycle.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only a Draft Reward Campaign can be calculated.';
  end if;
  if not exists (select 1 from public.crew_reward_participants p where p.cycle_id = cycle.id) then
    raise exception using errcode = '22023', message = 'Reward Campaign has no participating Crew.';
  end if;

  select round(avg(r.total_score), 2)
  into average_score
  from public.crew_reward_participants p
  join public.crew_performance_results r
    on r.employee_id = p.employee_id
   and r.outlet_id = cycle.outlet_id
   and r.period_start = cycle.period_start
   and r.status = 'finalized'
  where p.cycle_id = cycle.id;

  delete from public.crew_reward_entries where cycle_id = cycle.id;

  insert into public.crew_reward_entries(
    cycle_id, employee_id, employee_name, position,
    performance_result_id, performance_score, eligible_hours,
    performance_factor, status, eligibility_reason, source_snapshot
  )
  select cycle.id, p.employee_id, p.employee_name, p.position,
    r.id, r.total_score, hours.eligible_hours,
    public.crew_reward_earn_rate(r.total_score),
    case when r.id is null then 'awaiting_performance'
         when hours.eligible_hours <= 0 then 'not_eligible'
         else 'estimated' end,
    case when r.id is null then 'Finalized Performance is required.'
         when hours.eligible_hours <= 0 then 'No completed eligible working hours were recorded.'
         else 'Eligible from finalized Performance and completed attendance.' end,
    jsonb_build_object(
      'participant_snapshot_id', p.id,
      'participant_selected_at', p.selected_at,
      'performance_result_id', r.id,
      'performance_score', r.total_score,
      'performance_finalized_at', r.finalized_at,
      'eligible_hours', hours.eligible_hours,
      'calculation_version', 'reward-tier-v2'
    )
  from public.crew_reward_participants p
  left join public.crew_performance_results r
    on r.employee_id = p.employee_id
   and r.outlet_id = cycle.outlet_id
   and r.period_start = cycle.period_start
   and r.status = 'finalized'
  cross join lateral (
    select public.crew_reward_eligible_hours(p.employee_id, cycle.outlet_id, cycle.period_start) as eligible_hours
  ) hours
  where p.cycle_id = cycle.id;

  select coalesce(sum(eligible_hours), 0) into total_hours
  from public.crew_reward_entries
  where cycle_id = cycle.id and status = 'estimated';

  update public.crew_reward_entries
  set contribution_share = case when total_hours > 0 then eligible_hours / total_hours else 0 end,
      base_reward = case when total_hours > 0 then round(cycle.configured_pool * eligible_hours / total_hours, 2) else 0 end,
      calculated_reward = case when total_hours > 0 then round(cycle.configured_pool * eligible_hours / total_hours * performance_factor, 2) else 0 end,
      final_payout = case when total_hours > 0 then round(cycle.configured_pool * eligible_hours / total_hours * performance_factor, 2) else 0 end,
      status = 'qualified',
      source_snapshot = source_snapshot || jsonb_build_object(
        'outlet_total_eligible_hours', total_hours,
        'contribution_share', case when total_hours > 0 then eligible_hours / total_hours else 0 end,
        'maximum_share', case when total_hours > 0 then round(cycle.configured_pool * eligible_hours / total_hours, 2) else 0 end,
        'earn_rate', performance_factor,
        'reward_pool', cycle.configured_pool
      ),
      updated_at = now()
  where cycle_id = cycle.id and status = 'estimated';

  select coalesce(sum(final_payout), 0) into estimated
  from public.crew_reward_entries where cycle_id = cycle.id;

  if estimated > cycle.configured_pool + .01 then
    raise exception using errcode = '22003', message = 'Reward calculation exceeded the authorized pool.';
  end if;

  update public.crew_reward_cycles
  set status = 'review', calculation_version = 'reward-tier-v2',
      team_average_performance = average_score, pool_unlock_rate = 1,
      unlocked_pool = configured_pool, estimated_payout = round(estimated, 2),
      actual_payout = round(estimated, 2), unused_amount = round(configured_pool - estimated, 2),
      calculated_at = now(), updated_at = now()
  where id = cycle.id;

  return jsonb_build_object(
    'cycle_id', cycle.id, 'reward_pool', cycle.configured_pool,
    'total_eligible_hours', total_hours, 'estimated_payout', round(estimated, 2),
    'calculation_version', 'reward-tier-v2', 'status', 'review'
  );
end;
$$;

revoke all on function public.crew_reward_calculate(uuid) from public, anon, authenticated;
grant execute on function public.crew_reward_calculate(uuid) to authenticated;

create or replace function public.crew_reward_admin_data(
  p_outlet_id uuid,
  p_period date default current_date,
  p_cycle_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  period date := date_trunc('month', p_period)::date;
  selected public.crew_reward_cycles%rowtype;
  cycles jsonb;
  entries jsonb;
  adjustments jsonb;
  participants jsonb;
  eligible_crew jsonb;
begin
  if not public.current_user_has_permission('crew_reward.view')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Rewards are unavailable for this outlet.';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(c) || jsonb_build_object(
      'participant_count', (select count(*) from public.crew_reward_participants p where p.cycle_id = c.id),
      'qualified_count', (select count(*) from public.crew_reward_entries e where e.cycle_id = c.id and e.status in ('qualified','finalized','paid'))
    ) order by c.period_start desc
  ), '[]'::jsonb)
  into cycles
  from public.crew_reward_cycles c
  where c.outlet_id = p_outlet_id;

  if p_cycle_id is null then
    select * into selected from public.crew_reward_cycles
    where outlet_id = p_outlet_id and period_start = period;
  else
    select * into selected from public.crew_reward_cycles
    where id = p_cycle_id and outlet_id = p_outlet_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'name', e.full_name, 'position', e.position
  ) order by e.full_name), '[]'::jsonb)
  into eligible_crew
  from public.employees e
  join public.crew_access ca
    on ca.employee_id = e.id
   and ca.primary_outlet_id = p_outlet_id
   and ca.access_state = 'active'
  where e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated');

  if selected.id is null then
    return jsonb_build_object(
      'cycles', cycles, 'cycle', null, 'entries', '[]'::jsonb,
      'adjustments', '[]'::jsonb, 'participants', '[]'::jsonb,
      'eligible_crew', eligible_crew
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.employee_name), '[]'::jsonb)
  into entries from public.crew_reward_entries e where e.cycle_id = selected.id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.adjusted_at desc), '[]'::jsonb)
  into adjustments from public.crew_reward_adjustments a where a.cycle_id = selected.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'employee_id', p.employee_id, 'employee_name', p.employee_name,
    'position', p.position, 'selected_at', p.selected_at
  ) order by p.employee_name), '[]'::jsonb)
  into participants from public.crew_reward_participants p where p.cycle_id = selected.id;

  return jsonb_build_object(
    'cycles', cycles,
    'cycle', to_jsonb(selected) || jsonb_build_object('participant_count', jsonb_array_length(participants)),
    'entries', entries, 'adjustments', adjustments,
    'participants', participants, 'eligible_crew', eligible_crew
  );
end;
$$;

revoke all on function public.crew_reward_admin_data(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.crew_reward_admin_data(uuid,date,uuid) to authenticated;

