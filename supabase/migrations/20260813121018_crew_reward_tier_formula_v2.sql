-- Crew Reward tier formula v2.
-- Replaces reward-v1 pool unlocking / >100% factors with the product-approved
-- contribution share x performance earn-rate model. Finalized/paid cycles stay
-- immutable; only draft/review cycles are recalculated.

create or replace function public.crew_reward_earn_rate(p_score numeric)
returns numeric
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when p_score is null then 0
    when p_score >= 95 then 1.00
    when p_score >= 90 then 0.90
    when p_score >= 85 then 0.80
    when p_score >= 80 then 0.65
    when p_score >= 75 then 0.45
    when p_score >= 70 then 0.20
    else 0.00
  end::numeric;
$$;

create or replace function public.crew_reward_performance_factor(
  p_score numeric,
  p_minimum numeric default 60
)
returns numeric
language sql
immutable
security definer
set search_path = public
as $$
  select public.crew_reward_earn_rate(p_score);
$$;

create or replace function public.crew_reward_pool_unlock(p_average numeric)
returns numeric
language sql
immutable
security definer
set search_path = public
as $$
  select 1::numeric;
$$;

revoke all on function public.crew_reward_earn_rate(numeric) from public, anon, authenticated;
revoke all on function public.crew_reward_performance_factor(numeric,numeric) from public, anon, authenticated;
revoke all on function public.crew_reward_pool_unlock(numeric) from public, anon, authenticated;

create or replace function public.crew_reward_calculate(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    raise exception using errcode = 'P0002', message = 'Reward cycle was not found.';
  end if;
  if not public.current_user_has_permission('crew_reward.manage')
     or not public.current_user_can_access_outlet(cycle.outlet_id) then
    raise exception using errcode = '42501', message = 'Reward management is unavailable for this outlet.';
  end if;
  if cycle.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only a Draft Reward cycle can be calculated.';
  end if;

  select round(avg(r.total_score), 2)
  into average_score
  from public.crew_performance_results r
  join public.employees e on e.id = r.employee_id
  join public.crew_access ca
    on ca.employee_id = e.id
   and ca.primary_outlet_id = cycle.outlet_id
   and ca.access_state = 'active'
  where r.outlet_id = cycle.outlet_id
    and r.period_start = cycle.period_start
    and r.status = 'finalized'
    and e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated');

  delete from public.crew_reward_entries where cycle_id = cycle.id;

  insert into public.crew_reward_entries(
    cycle_id, employee_id, employee_name, position,
    performance_result_id, performance_score, eligible_hours,
    performance_factor, status, eligibility_reason, source_snapshot
  )
  select
    cycle.id,
    e.id,
    e.full_name,
    e.position,
    r.id,
    r.total_score,
    hours.eligible_hours,
    public.crew_reward_earn_rate(r.total_score),
    case
      when r.id is null then 'awaiting_performance'
      when hours.eligible_hours <= 0 then 'not_eligible'
      else 'estimated'
    end,
    case
      when r.id is null then 'Finalized Performance is required.'
      when hours.eligible_hours <= 0 then 'No completed eligible working hours were recorded.'
      else 'Eligible from finalized Performance and completed attendance.'
    end,
    jsonb_build_object(
      'performance_result_id', r.id,
      'performance_score', r.total_score,
      'performance_finalized_at', r.finalized_at,
      'eligible_hours', hours.eligible_hours,
      'calculation_version', 'reward-tier-v2'
    )
  from public.employees e
  join public.crew_access ca
    on ca.employee_id = e.id
   and ca.primary_outlet_id = cycle.outlet_id
   and ca.access_state = 'active'
  left join public.crew_performance_results r
    on r.employee_id = e.id
   and r.outlet_id = cycle.outlet_id
   and r.period_start = cycle.period_start
   and r.status = 'finalized'
  cross join lateral (
    select public.crew_reward_eligible_hours(e.id, cycle.outlet_id, cycle.period_start) as eligible_hours
  ) hours
  where e.is_active
    and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated');

  select coalesce(sum(eligible_hours), 0)
  into total_hours
  from public.crew_reward_entries
  where cycle_id = cycle.id
    and status = 'estimated';

  update public.crew_reward_entries
  set contribution_share = case when total_hours > 0 then eligible_hours / total_hours else 0 end,
      base_reward = case when total_hours > 0 then round(cycle.configured_pool * (eligible_hours / total_hours), 2) else 0 end,
      calculated_reward = case when total_hours > 0 then round(cycle.configured_pool * (eligible_hours / total_hours) * performance_factor, 2) else 0 end,
      final_payout = case when total_hours > 0 then round(cycle.configured_pool * (eligible_hours / total_hours) * performance_factor, 2) else 0 end,
      status = 'qualified',
      source_snapshot = source_snapshot || jsonb_build_object(
        'outlet_total_eligible_hours', total_hours,
        'contribution_share', case when total_hours > 0 then eligible_hours / total_hours else 0 end,
        'maximum_share', case when total_hours > 0 then round(cycle.configured_pool * (eligible_hours / total_hours), 2) else 0 end,
        'earn_rate', performance_factor,
        'reward_pool', cycle.configured_pool
      ),
      updated_at = now()
  where cycle_id = cycle.id
    and status = 'estimated';

  select coalesce(sum(final_payout), 0)
  into estimated
  from public.crew_reward_entries
  where cycle_id = cycle.id;

  if estimated > cycle.configured_pool + .01 then
    raise exception using errcode = '22003', message = 'Reward calculation exceeded the authorized pool.';
  end if;

  update public.crew_reward_cycles
  set status = 'review',
      calculation_version = 'reward-tier-v2',
      team_average_performance = average_score,
      pool_unlock_rate = 1,
      unlocked_pool = configured_pool,
      estimated_payout = round(estimated, 2),
      actual_payout = round(estimated, 2),
      unused_amount = round(configured_pool - estimated, 2),
      calculated_at = now(),
      updated_at = now()
  where id = cycle.id;

  return jsonb_build_object(
    'cycle_id', cycle.id,
    'reward_pool', cycle.configured_pool,
    'total_eligible_hours', total_hours,
    'estimated_payout', round(estimated, 2),
    'calculation_version', 'reward-tier-v2',
    'status', 'review'
  );
end;
$$;

revoke all on function public.crew_reward_calculate(uuid) from public, anon, authenticated;
grant execute on function public.crew_reward_calculate(uuid) to authenticated;

-- Convert only mutable cycles. Historical finalized/paid results are deliberately
-- left on their original calculation version.
do $$
declare
  cycle_row record;
  total_hours numeric;
  estimated numeric;
begin
  for cycle_row in
    select * from public.crew_reward_cycles where status in ('draft', 'review')
  loop
    if cycle_row.status = 'review' then
      select coalesce(sum(e.eligible_hours), 0)
      into total_hours
      from public.crew_reward_entries e
      where e.cycle_id = cycle_row.id
        and e.performance_result_id is not null
        and e.eligible_hours > 0;

      update public.crew_reward_entries e
      set performance_factor = public.crew_reward_earn_rate(e.performance_score),
          contribution_share = case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then e.eligible_hours / total_hours else 0 end,
          base_reward = case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then round(cycle_row.configured_pool * e.eligible_hours / total_hours, 2) else 0 end,
          calculated_reward = case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then round(cycle_row.configured_pool * e.eligible_hours / total_hours * public.crew_reward_earn_rate(e.performance_score), 2) else 0 end,
          final_payout = case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then round(cycle_row.configured_pool * e.eligible_hours / total_hours * public.crew_reward_earn_rate(e.performance_score), 2) else 0 end,
          adjustment_amount = 0,
          status = case when e.performance_result_id is null then 'awaiting_performance' when e.eligible_hours <= 0 then 'not_eligible' else 'qualified' end,
          eligibility_reason = case when e.performance_result_id is null then 'Finalized Performance is required.' when e.eligible_hours <= 0 then 'No completed eligible working hours were recorded.' else 'Eligible from finalized Performance and completed attendance.' end,
          source_snapshot = e.source_snapshot || jsonb_build_object(
            'calculation_version', 'reward-tier-v2',
            'outlet_total_eligible_hours', total_hours,
            'contribution_share', case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then e.eligible_hours / total_hours else 0 end,
            'maximum_share', case when total_hours > 0 and e.performance_result_id is not null and e.eligible_hours > 0 then round(cycle_row.configured_pool * e.eligible_hours / total_hours, 2) else 0 end,
            'earn_rate', public.crew_reward_earn_rate(e.performance_score),
            'reward_pool', cycle_row.configured_pool
          ),
          updated_at = now()
      where e.cycle_id = cycle_row.id;

      select coalesce(sum(final_payout), 0)
      into estimated
      from public.crew_reward_entries
      where cycle_id = cycle_row.id;

      update public.crew_reward_cycles
      set calculation_version = 'reward-tier-v2',
          pool_unlock_rate = 1,
          unlocked_pool = configured_pool,
          estimated_payout = round(estimated, 2),
          actual_payout = round(estimated, 2),
          unused_amount = round(configured_pool - estimated, 2),
          updated_at = now()
      where id = cycle_row.id;
    else
      update public.crew_reward_cycles
      set calculation_version = 'reward-tier-v2', updated_at = now()
      where id = cycle_row.id;
    end if;
  end loop;
end;
$$;

create or replace function public.crew_reward_mobile(p_token text, p_period date default current_date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  employee uuid;
  period date := date_trunc('month', p_period)::date;
  current_row record;
  history jsonb;
  reward_amount numeric;
  reward_label text;
  tier_name text;
  maximum_share numeric;
  total_hours numeric;
  earn_rate numeric;
  projections jsonb;
begin
  employee := public.crew_session_employee(p_token);

  select
    c.*,
    e.performance_score,
    e.eligible_hours,
    e.contribution_share,
    e.performance_factor,
    e.base_reward,
    e.calculated_reward,
    e.final_payout,
    e.status as entry_status,
    e.eligibility_reason,
    coalesce((e.source_snapshot ->> 'outlet_total_eligible_hours')::numeric, 0) as outlet_total_eligible_hours
  into current_row
  from public.crew_reward_entries e
  join public.crew_reward_cycles c on c.id = e.cycle_id
  where e.employee_id = employee
    and c.period_start = period
  order by c.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'period_start', x.period_start,
    'amount', x.final_payout,
    'status', x.entry_status,
    'paid_at', x.paid_at
  ) order by x.period_start desc), '[]'::jsonb)
  into history
  from (
    select c.period_start, e.final_payout, e.status as entry_status, c.paid_at
    from public.crew_reward_entries e
    join public.crew_reward_cycles c on c.id = e.cycle_id
    where e.employee_id = employee
      and c.period_start < period
      and c.status in ('finalized', 'paid')
    order by c.period_start desc
    limit 12
  ) x;

  if current_row.id is null then
    return jsonb_build_object(
      'period_start', period,
      'status', 'not_available',
      'explanation', 'No Reward cycle is available for this month.',
      'calculation_version', 'reward-tier-v2',
      'history', history
    );
  end if;

  earn_rate := public.crew_reward_earn_rate(current_row.performance_score);
  maximum_share := round(coalesce(current_row.base_reward, current_row.configured_pool * current_row.contribution_share, 0), 2);
  total_hours := coalesce(current_row.outlet_total_eligible_hours,
    case when current_row.contribution_share > 0 then current_row.eligible_hours / current_row.contribution_share else 0 end,
    0);
  reward_amount := case
    when current_row.status in ('finalized', 'paid') then current_row.final_payout
    else round(maximum_share * earn_rate, 2)
  end;
  reward_label := case current_row.status when 'paid' then 'Paid Reward' when 'finalized' then 'Final Reward' else 'Estimated Reward' end;
  tier_name := case
    when current_row.performance_score is null then 'Awaiting Review'
    when current_row.performance_score >= 95 then 'Outstanding'
    when current_row.performance_score >= 90 then 'Excellent'
    when current_row.performance_score >= 85 then 'Strong'
    when current_row.performance_score >= 80 then 'Good'
    when current_row.performance_score >= 75 then 'Meets Standard'
    when current_row.performance_score >= 70 then 'Developing'
    else 'Below Standard'
  end;

  projections := case when current_row.status in ('finalized', 'paid') then '[]'::jsonb else jsonb_build_array(
    jsonb_build_object('key', 'current', 'label', 'Current', 'score', current_row.performance_score, 'earn_rate', earn_rate, 'amount', round(maximum_share * earn_rate, 2)),
    jsonb_build_object('key', 'on_track', 'label', 'On Track', 'score', 80, 'earn_rate', .65, 'amount', round(maximum_share * .65, 2)),
    jsonb_build_object('key', 'great', 'label', 'Great', 'score', 85, 'earn_rate', .80, 'amount', round(maximum_share * .80, 2)),
    jsonb_build_object('key', 'max', 'label', 'Max Potential', 'score', 95, 'earn_rate', 1, 'amount', maximum_share)
  ) end;

  return jsonb_build_object(
    'period_start', current_row.period_start,
    'status', current_row.entry_status,
    'cycle_status', current_row.status,
    'reward_label', reward_label,
    'reward_amount', reward_amount,
    'estimated_reward', reward_amount,
    'performance_score', current_row.performance_score,
    'performance_level', tier_name,
    'earn_rate', earn_rate,
    'eligible_hours', current_row.eligible_hours,
    'total_eligible_hours', round(total_hours, 2),
    'contribution_share', current_row.contribution_share,
    'maximum_share', maximum_share,
    'reward_pool', current_row.configured_pool,
    'configured_pool', current_row.configured_pool,
    'calculation_version', 'reward-tier-v2',
    'eligibility_reason', current_row.eligibility_reason,
    'projection_applicable', current_row.status not in ('finalized', 'paid'),
    'projections', projections,
    'earn_rate_tiers', jsonb_build_array(
      jsonb_build_object('range', '95–100', 'level', 'Outstanding', 'rate', 1),
      jsonb_build_object('range', '90–94', 'level', 'Excellent', 'rate', .90),
      jsonb_build_object('range', '85–89', 'level', 'Strong', 'rate', .80),
      jsonb_build_object('range', '80–84', 'level', 'Good', 'rate', .65),
      jsonb_build_object('range', '75–79', 'level', 'Meets Standard', 'rate', .45),
      jsonb_build_object('range', '70–74', 'level', 'Developing', 'rate', .20),
      jsonb_build_object('range', '<70', 'level', 'Below Standard', 'rate', 0)
    ),
    'history', history
  );
end;
$$;

revoke all on function public.crew_reward_mobile(text,date) from public, anon, authenticated;
grant execute on function public.crew_reward_mobile(text,date) to anon, authenticated;
