-- Forward-only fix for the established roster snapshot authority.
-- PostgreSQL requires every non-aggregate HAVING reference to be grouped;
-- bool_or preserves the intended null validation while retaining duplicate
-- employee/date detection across different templates.

create or replace function public.save_roster_week_snapshot(
  p_request_id uuid,
  p_outlet_id uuid,
  p_week_start_date date,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_operation constant text := 'roster_week_snapshot';
  v_week_end_date date;
  v_rows jsonb;
  v_fingerprint text;
  v_request public.duty_roster_lifecycle_requests%rowtype;
  v_period public.roster_periods%rowtype;
  v_has_inserts boolean;
  v_has_updates boolean;
  v_has_deletes boolean;
  v_period_exists boolean;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  if p_request_id is null or p_outlet_id is null or p_week_start_date is null then raise exception 'A request ID, outlet, and week start date are required.'; end if;
  if extract(isodow from p_week_start_date) <> 1 then raise exception 'Roster week start must be Monday.'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Roster week rows must be an array.'; end if;
  if not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode = '42501', message = 'You cannot save this outlet roster.'; end if;
  v_week_end_date := p_week_start_date + 6;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employee_id', r.employee_id,
    'roster_date', r.roster_date,
    'shift_template_id', r.shift_template_id,
    'remark', coalesce(r.remark, '')
  ) order by r.roster_date, r.employee_id), '[]'::jsonb)
  into v_rows
  from jsonb_to_recordset(p_rows) as r(employee_id uuid, roster_date date, shift_template_id uuid, remark text);

  if exists (
    select 1
    from jsonb_to_recordset(v_rows) as r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    group by r.employee_id, r.roster_date
    having bool_or(r.employee_id is null or r.roster_date is null or r.shift_template_id is null)
       or count(*) > 1
  ) then raise exception 'Roster week rows must have one employee and date per row.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_rows) as r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    where r.roster_date < p_week_start_date or r.roster_date > v_week_end_date
  ) then raise exception 'Roster rows must belong to the selected week.'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_rows) as r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    left join public.employees employee on employee.id = r.employee_id
    left join public.outlets outlet on outlet.id = p_outlet_id
    where employee.id is null
       or employee.is_active is false
       or coalesce(employee.employment_status, '') <> 'active'
       or (coalesce(employee.workplace, '') <> '' and employee.workplace <> p_outlet_id::text and employee.workplace <> outlet.name)
  ) then raise exception 'Roster snapshot contains an ineligible employee.'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_rows) as r(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    left join public.shift_templates template on template.id = r.shift_template_id
    where template.id is null or template.outlet_id <> p_outlet_id
  ) then raise exception 'Roster snapshot contains an unavailable shift template.'; end if;

  v_fingerprint := md5(jsonb_build_object('operation', v_operation, 'outlet_id', p_outlet_id, 'week_start_date', p_week_start_date, 'rows', v_rows)::text);
  perform pg_advisory_xact_lock(hashtext(v_operation || ':' || p_outlet_id::text || ':' || p_week_start_date::text));
  select * into v_request from public.duty_roster_lifecycle_requests where request_id = p_request_id for update;
  if found then
    if v_request.operation = v_operation and v_request.actor_id = v_actor and v_request.outlet_id = p_outlet_id and v_request.week_start_date = p_week_start_date and v_request.payload_fingerprint = v_fingerprint and v_request.result is not null then return v_request.result; end if;
    raise exception 'Request ID was already used for a different roster save intent.';
  end if;

  select exists (
    select 1 from jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
    left join public.duty_rosters record on record.outlet_id = p_outlet_id and record.employee_id = source.employee_id and record.roster_date = source.roster_date
    where record.id is null
  ), exists (
    select 1 from public.duty_rosters record join jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
      on source.employee_id = record.employee_id and source.roster_date = record.roster_date
    where record.outlet_id = p_outlet_id and record.roster_date between p_week_start_date and v_week_end_date
  ), exists (
    select 1 from public.duty_rosters record where record.outlet_id = p_outlet_id and record.roster_date between p_week_start_date and v_week_end_date
      and not exists (select 1 from jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text) where source.employee_id = record.employee_id and source.roster_date = record.roster_date)
  ) into v_has_inserts, v_has_updates, v_has_deletes;
  if v_has_inserts and not public.current_user_has_permission('duty_roster.create') then raise exception using errcode = '42501', message = 'Missing permission to create roster shifts.'; end if;
  if v_has_updates and not (public.current_user_has_permission('duty_roster.edit') or public.current_user_has_permission('duty_roster.manage')) then raise exception using errcode = '42501', message = 'Missing permission to edit roster shifts.'; end if;
  if v_has_deletes and not public.current_user_has_permission('duty_roster.delete') then raise exception using errcode = '42501', message = 'Missing permission to delete roster shifts.'; end if;

  select * into v_period from public.roster_periods where outlet_id = p_outlet_id and week_start_date = p_week_start_date for update;
  v_period_exists := found;
  if v_period_exists and v_period.status = 'locked' then raise exception 'Unlock this roster before editing.'; end if;
  if v_period_exists and v_period.status = 'published' and not public.current_user_has_permission('duty_roster.manage') then raise exception using errcode = '42501', message = 'Missing permission to reset a published roster to draft.'; end if;
  insert into public.duty_roster_lifecycle_requests(request_id, operation, actor_id, outlet_id, week_start_date, payload_fingerprint)
  values (p_request_id, v_operation, v_actor, p_outlet_id, p_week_start_date, v_fingerprint);
  if not v_period_exists then
    insert into public.roster_periods(outlet_id, week_start_date, week_end_date, status) values (p_outlet_id, p_week_start_date, v_week_end_date, 'draft') returning * into v_period;
  elsif v_period.status = 'published' then
    update public.roster_periods set status = 'draft', locked_at = null, updated_at = now() where id = v_period.id returning * into v_period;
  end if;

  update public.duty_rosters record set shift_template_id = source.shift_template_id, start_time = template.start_time, end_time = template.end_time, break_minutes = coalesce(template.break_minutes, 0), status = 'draft', remark = source.remark, updated_by = v_actor, updated_at = now()
  from jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
  join public.shift_templates template on template.id = source.shift_template_id
  where record.outlet_id = p_outlet_id and record.employee_id = source.employee_id and record.roster_date = source.roster_date;
  insert into public.duty_rosters(outlet_id, employee_id, roster_date, shift_template_id, start_time, end_time, break_minutes, status, remark, created_by, updated_by)
  select p_outlet_id, source.employee_id, source.roster_date, source.shift_template_id, template.start_time, template.end_time, coalesce(template.break_minutes, 0), 'draft', source.remark, v_actor, v_actor
  from jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text)
  join public.shift_templates template on template.id = source.shift_template_id
  where not exists (select 1 from public.duty_rosters record where record.outlet_id = p_outlet_id and record.employee_id = source.employee_id and record.roster_date = source.roster_date);
  delete from public.duty_rosters record where record.outlet_id = p_outlet_id and record.roster_date between p_week_start_date and v_week_end_date
    and not exists (select 1 from jsonb_to_recordset(v_rows) as source(employee_id uuid, roster_date date, shift_template_id uuid, remark text) where source.employee_id = record.employee_id and source.roster_date = record.roster_date);
  if v_period.status = 'draft' then update public.duty_rosters set status = 'draft', updated_by = v_actor, updated_at = now() where outlet_id = p_outlet_id and roster_date between p_week_start_date and v_week_end_date; end if;
  select jsonb_build_object('period', to_jsonb(v_period), 'rows', coalesce(jsonb_agg(to_jsonb(record) order by record.roster_date, record.employee_id), '[]'::jsonb)) into v_result from public.duty_rosters record where record.outlet_id = p_outlet_id and record.roster_date between p_week_start_date and v_week_end_date;
  update public.duty_roster_lifecycle_requests set result = v_result, completed_at = now() where request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.save_roster_week_snapshot(uuid, uuid, date, jsonb) to authenticated;
