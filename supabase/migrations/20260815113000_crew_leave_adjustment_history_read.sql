-- Outlet-scoped, immutable Leave adjustment history for Crew Admin.
-- The calculation authority remains crew_leave_entitlement_balance; these
-- columns preserve the exact before/after evidence at adjustment time.

alter table public.crew_leave_adjustments
  add column if not exists previous_available numeric(7,2),
  add column if not exists resulting_available numeric(7,2);

create or replace function public.crew_leave_adjustment_history(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_outlet_id uuid;
  v_history jsonb;
begin
  if auth.uid() is null
     or not (public.current_user_has_permission('crew_leave_balance.view')
             or public.current_user_has_permission('crew_leave_balance.adjust')) then
    raise exception using errcode = '42501', message = 'Leave balance permission is required.';
  end if;

  v_outlet_id := public.crew_resolve_employee_outlet(p_employee_id);
  if v_outlet_id is null or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode = '42501', message = 'Leave adjustment history is outside your outlet scope.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'entitlement_id', a.entitlement_id,
    'leave_type', e.leave_type,
    'period_start', e.period_start,
    'period_end', e.period_end,
    'amount', a.amount,
    'reason', a.reason,
    'adjusted_at', a.adjusted_at,
    'adjusted_by', jsonb_build_object(
      'id', a.adjusted_by,
      'name', coalesce(up.nickname, up.full_name, up.email, 'FeedX Admin')
    ),
    'previous_available', a.previous_available,
    'resulting_available', a.resulting_available
  ) order by a.adjusted_at desc, a.id desc), '[]'::jsonb)
  into v_history
  from public.crew_leave_adjustments a
  join public.crew_leave_entitlements e on e.id = a.entitlement_id
  left join public.user_profiles up on up.id = a.adjusted_by
  where e.employee_id = p_employee_id
    and e.outlet_id = v_outlet_id;

  return v_history;
end;
$$;

revoke all on function public.crew_leave_adjustment_history(uuid) from public, anon, authenticated;
grant execute on function public.crew_leave_adjustment_history(uuid) to authenticated;

create or replace function public.crew_leave_adjust(p_entitlement_id uuid, p_amount numeric, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement public.crew_leave_entitlements%rowtype;
  v_adjustment public.crew_leave_adjustments%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave_balance.adjust') then
    raise exception using errcode = '42501', message = 'Leave adjustment permission is required.';
  end if;

  select * into v_entitlement
  from public.crew_leave_entitlements
  where id = p_entitlement_id
  for update;

  if v_entitlement.id is null or not public.current_user_can_access_outlet(v_entitlement.outlet_id) then
    raise exception using errcode = '42501', message = 'Leave entitlement is outside your outlet scope.';
  end if;
  if p_amount = 0 or abs(p_amount) > 366
     or length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception using errcode = '22023', message = 'A valid adjustment and reason are required.';
  end if;

  v_before := public.crew_leave_entitlement_balance(v_entitlement.id);

  insert into public.crew_leave_adjustments(
    entitlement_id, amount, reason, adjusted_by,
    previous_available, resulting_available
  ) values (
    v_entitlement.id, p_amount, btrim(p_reason), auth.uid(),
    nullif(v_before->>'available', '')::numeric,
    nullif(v_before->>'available', '')::numeric + p_amount
  ) returning * into v_adjustment;

  v_after := public.crew_leave_entitlement_balance(v_entitlement.id);

  return jsonb_build_object(
    'adjustment', jsonb_build_object(
      'id', v_adjustment.id,
      'amount', v_adjustment.amount,
      'reason', v_adjustment.reason,
      'adjusted_at', v_adjustment.adjusted_at,
      'previous_available', v_adjustment.previous_available,
      'resulting_available', v_adjustment.resulting_available
    ),
    'balance', v_after
  );
end;
$$;

revoke all on function public.crew_leave_adjust(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.crew_leave_adjust(uuid, numeric, text) to authenticated;
