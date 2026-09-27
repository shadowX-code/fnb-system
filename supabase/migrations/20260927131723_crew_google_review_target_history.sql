-- Configuration history only; no Google review content or scoring authority.
create function public.crew_google_target_history(p_outlet_id uuid, p_period date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_performance.view')
     or not public.current_user_can_access_outlet(p_outlet_id)
     or not exists(select 1 from public.outlets where id = p_outlet_id and is_active = true) then
    raise exception using errcode='42501', message='Monthly target history is unavailable for this outlet.';
  end if;
  if p_period is null or p_period <> date_trunc('month', p_period)::date then
    raise exception using errcode='22023', message='A performance month is required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'old_target', a.old_target,
    'new_target', a.new_target, 'changed_at', a.changed_at) order by a.changed_at desc, a.id desc), '[]'::jsonb)
  into v_rows from public.crew_google_monthly_target_audit a
  where a.outlet_id = p_outlet_id and a.period_start = p_period;
  return jsonb_build_object('rows', v_rows);
end; $$;
revoke all on function public.crew_google_target_history(uuid,date) from public,anon,authenticated;
grant execute on function public.crew_google_target_history(uuid,date) to authenticated;
