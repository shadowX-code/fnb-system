-- Bulk week snapshots must preserve Leave-owned roster cells. They may be
-- carried through unchanged in the full-week payload, but cannot be changed
-- or removed by the Duty Roster authority.

do $migration$
declare
  v_definition text;
  v_corrected_definition text;
  v_anchor constant text := $anchor$
  fingerprint := md5(jsonb_build_object(
$anchor$;
  v_guard constant text := $guard$
  if exists (
    select 1
    from jsonb_to_recordset(rows_json) r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    join public.duty_rosters d
      on d.outlet_id = p_outlet_id
     and d.employee_id = r.employee_id
     and d.roster_date = r.roster_date
    where (d.source = 'approved_leave' or d.approved_leave_id is not null)
      and (
        d.shift_template_id is distinct from r.shift_template_id
        or coalesce(d.remark, '') is distinct from coalesce(r.remark, '')
      )
  ) then
    raise exception using errcode = '23P01', message = 'Approved leave roster cells are protected and cannot be overwritten.';
  end if;

  if exists (
    select 1
    from public.duty_rosters d
    where d.outlet_id = p_outlet_id
      and d.roster_date between p_week_start_date and week_end
      and (d.source = 'approved_leave' or d.approved_leave_id is not null)
      and not exists (
        select 1
        from jsonb_to_recordset(rows_json) r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
        where r.employee_id = d.employee_id
          and r.roster_date = d.roster_date
      )
  ) then
    raise exception using errcode = '23P01', message = 'Approved leave roster cells are protected and cannot be removed.';
  end if;

  fingerprint := md5(jsonb_build_object(
$guard$;
begin
  select pg_get_functiondef('public.save_roster_week_snapshot(uuid,uuid,date,jsonb)'::regprocedure)
  into v_definition;

  if position(v_anchor in v_definition) = 0 then
    raise exception 'Expected save_roster_week_snapshot fingerprint anchor was not found.';
  end if;

  v_corrected_definition := replace(v_definition, v_anchor, v_guard);
  execute v_corrected_definition;
end;
$migration$;

revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated;
