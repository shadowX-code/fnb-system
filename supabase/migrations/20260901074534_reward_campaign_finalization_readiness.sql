-- A Reward Campaign may be finalized only after every frozen participant has a
-- complete, final Reward outcome. This check is private to trusted authorities:
-- Admin clients consume its safe projection through crew_reward_admin_data.
create or replace function public.crew_reward_finalization_readiness(p_cycle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cycle public.crew_reward_cycles%rowtype;
  participant_count integer := 0;
  entry_count integer := 0;
  missing_entry_count integer := 0;
  orphaned_entry_count integer := 0;
  awaiting_performance_count integer := 0;
  uncomputed_count integer := 0;
  invalid_outcome_count integer := 0;
  invalid_calculation_count integer := 0;
  blocker_count integer := 0;
  ready boolean := false;
  message text;
begin
  select * into cycle
  from public.crew_reward_cycles
  where id = p_cycle_id;

  if cycle.id is null then
    raise exception using errcode = 'P0002', message = 'Reward Campaign was not found.';
  end if;

  select count(*) into participant_count
  from public.crew_reward_participants p
  where p.cycle_id = cycle.id;

  select count(*) into entry_count
  from public.crew_reward_entries e
  where e.cycle_id = cycle.id;

  select count(*) into missing_entry_count
  from public.crew_reward_participants p
  where p.cycle_id = cycle.id
    and not exists (
      select 1 from public.crew_reward_entries e
      where e.cycle_id = cycle.id and e.employee_id = p.employee_id
    );

  select count(*) into orphaned_entry_count
  from public.crew_reward_entries e
  where e.cycle_id = cycle.id
    and not exists (
      select 1 from public.crew_reward_participants p
      where p.cycle_id = cycle.id and p.employee_id = e.employee_id
    );

  select
    count(*) filter (where e.status = 'awaiting_performance'),
    count(*) filter (where e.status = 'estimated'),
    count(*) filter (where e.status not in ('awaiting_performance', 'estimated', 'qualified', 'not_eligible')),
    count(*) filter (
      where (e.status = 'qualified' and (
        e.performance_result_id is null
        or e.performance_score is null
        or e.eligible_hours <= 0
      ))
      or (e.status = 'not_eligible' and (
        e.performance_result_id is null
        or e.performance_score is null
        or e.eligible_hours > 0
      ))
    )
  into awaiting_performance_count, uncomputed_count, invalid_outcome_count, invalid_calculation_count
  from public.crew_reward_entries e
  where e.cycle_id = cycle.id;

  blocker_count := missing_entry_count + orphaned_entry_count + awaiting_performance_count
    + uncomputed_count + invalid_outcome_count + invalid_calculation_count;

  ready := cycle.status = 'review'
    and cycle.calculated_at is not null
    and participant_count > 0
    and entry_count = participant_count
    and blocker_count = 0;

  message := case
    when cycle.status <> 'review' then 'Calculate and review this Reward Campaign before finalizing.'
    when cycle.calculated_at is null then 'Reward calculation is incomplete. Calculate the Campaign again before finalizing.'
    when participant_count = 0 then 'This Reward Campaign has no participating Crew.'
    when awaiting_performance_count > 0 then format('%s Crew still have incomplete Performance results.', awaiting_performance_count)
    when missing_entry_count > 0 or orphaned_entry_count > 0 then 'Reward calculation is incomplete. Review the Campaign entries before finalizing.'
    when uncomputed_count > 0 or invalid_outcome_count > 0 or invalid_calculation_count > 0 then 'Reward calculation is incomplete. Review the Campaign entries before finalizing.'
    else 'Ready to finalize.'
  end;

  return jsonb_build_object(
    'ready', ready,
    'message', message,
    'participant_count', participant_count,
    'entry_count', entry_count,
    'blocker_count', blocker_count,
    'awaiting_performance_count', awaiting_performance_count,
    'uncomputed_count', uncomputed_count,
    'missing_entry_count', missing_entry_count,
    'orphaned_entry_count', orphaned_entry_count,
    'invalid_outcome_count', invalid_outcome_count,
    'invalid_calculation_count', invalid_calculation_count
  );
end;
$$;

revoke all on function public.crew_reward_finalization_readiness(uuid) from public, anon, authenticated;

create or replace function public.crew_reward_finalize(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cycle public.crew_reward_cycles%rowtype;
  payout numeric;
  readiness jsonb;
begin
  select * into cycle
  from public.crew_reward_cycles
  where id = p_cycle_id
  for update;

  if cycle.id is null then
    raise exception using errcode = 'P0002', message = 'Reward cycle was not found.';
  end if;
  if not public.current_user_has_permission('crew_reward.finalize')
     or not public.current_user_can_access_outlet(cycle.outlet_id) then
    raise exception using errcode = '42501', message = 'Reward finalization is unavailable.';
  end if;
  if cycle.status <> 'review' then
    raise exception using errcode = '55000', message = 'Only a reviewed Reward cycle can be finalized.';
  end if;

  readiness := public.crew_reward_finalization_readiness(cycle.id);
  if not coalesce((readiness ->> 'ready')::boolean, false) then
    raise exception using
      errcode = 'P0001',
      message = 'Reward Campaign is not ready to finalize.',
      detail = readiness::text;
  end if;

  select coalesce(sum(final_payout), 0) into payout
  from public.crew_reward_entries
  where cycle_id = cycle.id;
  if payout > cycle.unlocked_pool + .01 or payout > cycle.configured_pool + .01 then
    raise exception using errcode = '22003', message = 'Reward payout exceeds the authorized pool.';
  end if;

  update public.crew_reward_entries
  set status = case when status = 'qualified' then 'finalized' else status end,
      updated_at = now()
  where cycle_id = cycle.id;

  update public.crew_reward_cycles
  set status = 'finalized',
      actual_payout = round(payout, 2),
      unused_amount = round(unlocked_pool - payout, 2),
      finalized_at = now(),
      finalized_by = auth.uid(),
      updated_at = now()
  where id = cycle.id
  returning * into cycle;

  return to_jsonb(cycle);
end;
$$;

revoke all on function public.crew_reward_finalize(uuid) from public, anon, authenticated;
grant execute on function public.crew_reward_finalize(uuid) to authenticated;

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
  readiness jsonb;
begin
  if not public.current_user_has_permission('crew_reward.view')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Rewards are unavailable for this outlet.';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(c) || jsonb_build_object(
      'participant_count', (select count(*) from public.crew_reward_participants p where p.cycle_id = c.id),
      'qualified_count', (select count(*) from public.crew_reward_entries e where e.cycle_id = c.id and e.status in ('qualified', 'finalized', 'paid'))
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
  into entries
  from public.crew_reward_entries e
  where e.cycle_id = selected.id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.adjusted_at desc), '[]'::jsonb)
  into adjustments
  from public.crew_reward_adjustments a
  where a.cycle_id = selected.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'employee_id', p.employee_id, 'employee_name', p.employee_name,
    'position', p.position, 'selected_at', p.selected_at
  ) order by p.employee_name), '[]'::jsonb)
  into participants
  from public.crew_reward_participants p
  where p.cycle_id = selected.id;

  readiness := public.crew_reward_finalization_readiness(selected.id);

  return jsonb_build_object(
    'cycles', cycles,
    'cycle', to_jsonb(selected) || jsonb_build_object(
      'participant_count', jsonb_array_length(participants),
      'finalization_readiness', readiness
    ),
    'entries', entries, 'adjustments', adjustments,
    'participants', participants, 'eligible_crew', eligible_crew
  );
end;
$$;

revoke all on function public.crew_reward_admin_data(uuid,date,uuid) from public, anon, authenticated;
grant execute on function public.crew_reward_admin_data(uuid,date,uuid) to authenticated;
