-- Preserve immutable historical roster rows when a current week is moved back
-- to draft. Only employees who are currently schedulable for the selected
-- outlet should participate in that status transition.

do $migration$
declare
  v_definition text;
  v_corrected_definition text;
  v_old_fragment constant text := $old$
  update public.duty_rosters
  set status = 'draft', updated_by = actor, updated_at = now()
  where period_row.status = 'draft'
    and outlet_id = p_outlet_id
    and roster_date between p_week_start_date and week_end
    and status is distinct from 'draft';
$old$;
  v_new_fragment constant text := $new$
  update public.duty_rosters d
  set status = 'draft', updated_by = actor, updated_at = now()
  where period_row.status = 'draft'
    and d.outlet_id = p_outlet_id
    and d.roster_date between p_week_start_date and week_end
    and d.status is distinct from 'draft'
    and exists (
      select 1
      from public.employees e
      where e.id = d.employee_id
        and coalesce(e.is_active, true)
        and coalesce(e.employment_status, '') = 'active'
        and public.crew_resolve_employee_outlet(e.id) = p_outlet_id
    );
$new$;
begin
  select pg_get_functiondef('public.save_roster_week_snapshot(uuid,uuid,date,jsonb)'::regprocedure)
  into v_definition;

  if position(v_old_fragment in v_definition) = 0 then
    raise exception 'Expected save_roster_week_snapshot status transition was not found.';
  end if;

  v_corrected_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  execute v_corrected_definition;
end;
$migration$;

revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated;
