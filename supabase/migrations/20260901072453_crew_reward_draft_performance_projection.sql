-- A current draft Performance may be useful to its own Crew member as a
-- non-persistent Reward estimate. This read projection never changes Reward
-- entries, cycle state, finalized evidence, or payout history.
create or replace function public.crew_reward_draft_projection(
  p_cycle_id uuid,
  p_employee_id uuid,
  p_period date
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  cycle public.crew_reward_cycles%rowtype;
  performance public.crew_performance_results%rowtype;
  period date := date_trunc('month', p_period)::date;
  eligible_hours numeric;
  total_eligible_hours numeric;
  contribution_share numeric;
  maximum_share numeric;
  earn_rate numeric;
  reward_amount numeric;
  performance_level text;
begin
  select * into cycle
  from public.crew_reward_cycles
  where id = p_cycle_id;

  if cycle.id is null
     or not exists (
       select 1
       from public.crew_reward_participants participant
       where participant.cycle_id = cycle.id
         and participant.employee_id = p_employee_id
     ) then
    return null;
  end if;

  select * into performance
  from public.crew_performance_results result
  where result.employee_id = p_employee_id
    and result.outlet_id = cycle.outlet_id
    and result.period_start = period
    and result.status = 'draft'
    and result.total_score is not null;

  if performance.id is null then
    return null;
  end if;

  eligible_hours := public.crew_reward_eligible_hours(p_employee_id, cycle.outlet_id, period);

  -- The estimate uses the existing pool × eligible-hours share × earn-rate
  -- formula. It deliberately considers only frozen campaign participants with
  -- a usable current Performance result; this is a live display projection,
  -- never a Reward entry or payout snapshot.
  select coalesce(sum(hours.eligible_hours), 0)
  into total_eligible_hours
  from public.crew_reward_participants participant
  join public.crew_performance_results result
    on result.employee_id = participant.employee_id
   and result.outlet_id = cycle.outlet_id
   and result.period_start = period
   and result.status in ('draft', 'finalized')
   and result.total_score is not null
  cross join lateral (
    select public.crew_reward_eligible_hours(participant.employee_id, cycle.outlet_id, period) as eligible_hours
  ) hours
  where participant.cycle_id = cycle.id;

  contribution_share := case
    when total_eligible_hours > 0 then eligible_hours / total_eligible_hours
    else 0
  end;
  maximum_share := round(cycle.configured_pool * contribution_share, 2);
  earn_rate := public.crew_reward_earn_rate(performance.total_score);
  reward_amount := round(maximum_share * earn_rate, 2);
  performance_level := case
    when performance.total_score >= 95 then 'Outstanding'
    when performance.total_score >= 90 then 'Excellent'
    when performance.total_score >= 85 then 'Strong'
    when performance.total_score >= 80 then 'Good'
    when performance.total_score >= 75 then 'Meets Standard'
    when performance.total_score >= 70 then 'Developing'
    else 'Below Standard'
  end;

  return jsonb_build_object(
    'period_start', cycle.period_start,
    'status', 'estimated',
    'cycle_status', cycle.status,
    'reward_label', 'Estimated Reward',
    'reward_amount', reward_amount,
    'estimated_reward', reward_amount,
    'performance_score', performance.total_score,
    'performance_level', performance_level,
    'earn_rate', earn_rate,
    'eligible_hours', eligible_hours,
    'total_eligible_hours', round(total_eligible_hours, 2),
    'contribution_share', contribution_share,
    'maximum_share', maximum_share,
    'reward_pool', cycle.configured_pool,
    'configured_pool', cycle.configured_pool,
    'calculation_version', 'reward-tier-v2',
    'projection_applicable', true,
    'is_draft_performance_projection', true,
    'projections', jsonb_build_array(
      jsonb_build_object('key', 'current', 'label', 'Current', 'score', performance.total_score, 'earn_rate', earn_rate, 'amount', reward_amount),
      jsonb_build_object('key', 'on_track', 'label', 'On Track', 'score', 80, 'earn_rate', .65, 'amount', round(maximum_share * .65, 2)),
      jsonb_build_object('key', 'great', 'label', 'Great', 'score', 85, 'earn_rate', .80, 'amount', round(maximum_share * .80, 2)),
      jsonb_build_object('key', 'max', 'label', 'Max Potential', 'score', 95, 'earn_rate', 1, 'amount', maximum_share)
    ),
    'earn_rate_tiers', jsonb_build_array(
      jsonb_build_object('range', '95–100', 'level', 'Outstanding', 'rate', 1),
      jsonb_build_object('range', '90–94', 'level', 'Excellent', 'rate', .90),
      jsonb_build_object('range', '85–89', 'level', 'Strong', 'rate', .80),
      jsonb_build_object('range', '80–84', 'level', 'Good', 'rate', .65),
      jsonb_build_object('range', '75–79', 'level', 'Meets Standard', 'rate', .45),
      jsonb_build_object('range', '70–74', 'level', 'Developing', 'rate', .20),
      jsonb_build_object('range', '<70', 'level', 'Below Standard', 'rate', 0)
    )
  );
end;
$$;

revoke all on function public.crew_reward_draft_projection(uuid,uuid,date) from public, anon, authenticated;

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
  draft_projection jsonb;
  reward_amount numeric;
  reward_label text;
  tier_name text;
  maximum_share numeric;
  total_hours numeric;
  earn_rate numeric;
  projections jsonb;
begin
  employee := public.crew_session_employee(p_token);
  -- Keep a mutable current Performance fresh before deriving a display-only
  -- estimate. Finalized results remain immutable in crew_refresh_performance.
  perform public.crew_refresh_performance(employee, period);

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

  if current_row.entry_status in ('awaiting_performance', 'not_eligible') then
    draft_projection := public.crew_reward_draft_projection(current_row.id, employee, period);
    if draft_projection is not null then
      return draft_projection || jsonb_build_object('history', history);
    end if;
  end if;

  earn_rate := public.crew_reward_earn_rate(current_row.performance_score);
  maximum_share := round(coalesce(current_row.base_reward, current_row.configured_pool * current_row.contribution_share, 0), 2);
  total_hours := coalesce(current_row.outlet_total_eligible_hours,
    case when current_row.contribution_share > 0 then current_row.eligible_hours / current_row.contribution_share else 0 end,
    0);
  reward_amount := case
    when current_row.entry_status in ('finalized', 'paid') then current_row.final_payout
    else round(maximum_share * earn_rate, 2)
  end;
  reward_label := case current_row.entry_status when 'paid' then 'Paid Reward' when 'finalized' then 'Final Reward' else 'Estimated Reward' end;
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

  projections := case when current_row.entry_status in ('finalized', 'paid') then '[]'::jsonb else jsonb_build_array(
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
    'projection_applicable', current_row.entry_status not in ('finalized', 'paid'),
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
