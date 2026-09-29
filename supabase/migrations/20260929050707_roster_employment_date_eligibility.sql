-- People owns the assignment. Roster owns the dated scheduling decision.
-- This private helper is shared by the picker, draft reads and mutations.
create function public.roster_employment_on_date(p_employee_id uuid,p_outlet_id uuid,p_on date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee public.employees%rowtype; v_outlet public.outlets%rowtype;
  v_assignment public.employee_employment_assignment_revisions%rowtype; v_state text;
begin
  if p_employee_id is null or p_outlet_id is null or p_on is null then
    return jsonb_build_object('state','unresolved');
  end if;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_outlet from public.outlets where id=p_outlet_id;
  if v_employee.id is null or v_outlet.id is null then
    return jsonb_build_object('state','unresolved');
  end if;
  v_assignment:=public.employee_employment_assignment_at(p_employee_id,p_on);
  if v_assignment.id is null or v_employee.joined_date is null then
    v_state:='unresolved';
  elsif p_on < v_employee.joined_date
    or (v_employee.resigned_date is not null and p_on > v_employee.resigned_date)
    or (v_assignment.employment_end_date is not null and p_on > v_assignment.employment_end_date) then
    v_state:='outside_employment';
  elsif v_assignment.employment_status is distinct from 'active' then
    v_state:='inactive';
  elsif lower(btrim(coalesce(v_assignment.workplace,''))) not in
    (lower(btrim(coalesce(v_outlet.name,''))),lower(btrim(coalesce(v_outlet.code,'')))) then
    v_state:='other_outlet';
  else
    v_state:='eligible';
  end if;
  return jsonb_build_object('state',v_state,'revision_id',v_assignment.id,
    'position',v_assignment.position,'workplace',v_assignment.workplace,
    'employment_status',v_assignment.employment_status,
    'employment_type',v_assignment.employment_type);
end $$;
revoke all on function public.roster_employment_on_date(uuid,uuid,date) from public,anon,authenticated;

-- The existing one-argument picker remains a today-only compatibility entry.
-- The active Roster workspace supplies its exact visible date range.
create function public.list_roster_eligible_employees(p_outlet_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or p_outlet_id is null
    or not public.current_user_can_access_outlet(p_outlet_id)
    or not (public.current_user_has_permission('crew_roster.view')
      or public.current_user_has_permission('crew_roster.manage')
      or public.current_user_has_permission('crew_roster.publish')) then
    raise exception using errcode='42501',message='Duty Roster is unavailable for this outlet.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>62 then
    raise exception using errcode='22023',message='Roster date range is invalid.';
  end if;
  select coalesce(jsonb_agg(item order by item->>'nickname',item->>'full_name',item->>'id'),'[]'::jsonb)
    into v_rows from (
    select jsonb_build_object('id',e.id,'full_name',e.full_name,'nickname',e.nickname,
      'department',e.department,'employee_code',e.employee_code,
      'position',coalesce((select x.value->>'position' from jsonb_each(d.days) x
        where x.value->>'state'='eligible' order by x.key limit 1),''),
      'roster_eligible',d.any_eligible,'eligibility_by_date',d.days) item
    from public.employees e
    cross join lateral (
      select coalesce(jsonb_object_agg(day_date::text,eligibility),'{}'::jsonb) days,
        coalesce(bool_or(eligibility->>'state'='eligible'),false) any_eligible
      from generate_series(p_start_date,p_end_date,interval '1 day') day_date
      cross join lateral (select public.roster_employment_on_date(e.id,p_outlet_id,day_date::date) eligibility) resolved
    ) d
    where exists (select 1 from public.employee_employment_assignment_revisions r
      join public.outlets o on o.id=p_outlet_id
      where r.employee_id=e.id and lower(btrim(coalesce(r.workplace,''))) in
        (lower(btrim(coalesce(o.name,''))),lower(btrim(coalesce(o.code,'')))))
      or exists (select 1 from public.duty_rosters r where r.employee_id=e.id
        and r.outlet_id=p_outlet_id and r.roster_date between p_start_date and p_end_date)
  ) selected;
  return v_rows;
end $$;
revoke all on function public.list_roster_eligible_employees(uuid,date,date) from public,anon,authenticated;
grant execute on function public.list_roster_eligible_employees(uuid,date,date) to authenticated;

create or replace function public.list_roster_eligible_employees(p_outlet_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.list_roster_eligible_employees(p_outlet_id,
    timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date,
    timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date)
$$;
revoke all on function public.list_roster_eligible_employees(uuid) from public,anon,authenticated;
grant execute on function public.list_roster_eligible_employees(uuid) to authenticated;

-- Keep the existing mutation implementation, locks, idempotency and Leave guard.
-- Replace only its two current-Employee eligibility predicates.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.save_roster_week_snapshot(uuid,uuid,date,jsonb)'::regprocedure) into v_definition;
  v_old:=$old$
      e.id is null
      or not coalesce(e.is_active, true)
      or coalesce(e.employment_status, '') <> 'active'
      or public.crew_resolve_employee_outlet(e.id) is null
      or public.crew_resolve_employee_outlet(e.id) <> p_outlet_id
    )
$old$;
  v_new:=$new$
      e.id is null
      or public.roster_employment_on_date(e.id,p_outlet_id,d.roster_date)->>'state' <> 'eligible'
    )
$new$;
  if position(v_old in v_definition)=0 then raise exception 'Roster omitted-row eligibility anchor not found.'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$old$
      e.id is null
      or not coalesce(e.is_active, true)
      or coalesce(e.employment_status, '') <> 'active'
      or public.crew_resolve_employee_outlet(e.id) is null
      or public.crew_resolve_employee_outlet(e.id) <> p_outlet_id
      or not public.current_user_can_access_outlet(public.crew_resolve_employee_outlet(e.id))
$old$;
  v_new:=$new$
      e.id is null
      or public.roster_employment_on_date(e.id,p_outlet_id,r.roster_date)->>'state' <> 'eligible'
$new$;
  if position(v_old in v_definition)=0 then raise exception 'Roster changed-row eligibility anchor not found.'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:=$old$
    elsif not coalesce(invalid_employee.is_active, true)
       or coalesce(invalid_employee.employment_status, '') <> 'active' then
      raise exception using errcode = '42501', message = format(
        'Cannot update roster for %s: the employee is inactive or no longer employed.',
        invalid_employee.employee_name
      );
    elsif invalid_employee.resolved_outlet_id is null then
      raise exception using errcode = '42501', message = format(
        'Cannot update roster for %s: the employee has no eligible outlet assignment.',
        invalid_employee.employee_name
      );
    elsif invalid_employee.resolved_outlet_id <> p_outlet_id then
      raise exception using errcode = '42501', message = format(
        'Cannot update roster for %s: the employee belongs to another outlet.',
        invalid_employee.employee_name
      );
$old$;
  v_new:=$new$
    elsif true then
      raise exception using errcode = '42501', message = format(
        'Cannot update roster for %s: verified employment assignment for the roster date is unavailable or does not permit this outlet.',
        invalid_employee.employee_name
      );
$new$;
  if position(v_old in v_definition)=0 then raise exception 'Roster eligibility message anchor not found.'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
end $migration$;

-- The older direct copy RPC must validate target dates as well as the active UI path.
do $migration$
declare v_definition text; v_anchor text; v_guard text;
begin
  select pg_get_functiondef('public.copy_roster_week(uuid,uuid,date,date,boolean)'::regprocedure) into v_definition;
  v_anchor:=$anchor$
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_target_week_start_date,v_fingerprint);
$anchor$;
  v_guard:=$guard$
  if exists (select 1 from public.duty_rosters source
    where source.outlet_id=p_outlet_id and source.roster_date between p_source_week_start_date and v_source_end
      and public.roster_employment_on_date(source.employee_id,p_outlet_id,
        p_target_week_start_date+(source.roster_date-p_source_week_start_date))->>'state' <> 'eligible') then
    raise exception using errcode='42501',message='Copy requires verified employment eligibility for every target roster date.';
  end if;
  insert into public.duty_roster_lifecycle_requests(request_id,operation,actor_id,outlet_id,week_start_date,payload_fingerprint) values(p_request_id,v_operation,v_actor,p_outlet_id,p_target_week_start_date,v_fingerprint);
$guard$;
  if position(v_anchor in v_definition)=0 then raise exception 'Roster copy validation anchor not found.'; end if;
  execute replace(v_definition,v_anchor,v_guard);
end $migration$;

-- Preserve existing publication rows. New/republished working rows pin the
-- People assignment for each roster date, never today's position.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.publish_roster_week(uuid,uuid,date)'::regprocedure) into v_definition;
  v_old:='position_snapshot=coalesce(employee.position,r.position_snapshot,'''')';
  v_new:='position_snapshot=coalesce(nullif(public.roster_employment_on_date(employee.id,p_outlet_id,r.roster_date)->>''position'',''''),r.position_snapshot,'''')';
  if position(v_old in v_definition)=0 then raise exception 'Roster publish position anchor not found.'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  v_old:='coalesce(r.position_snapshot,e.position,'''')';
  v_new:='coalesce(r.position_snapshot,'''')';
  if position(v_old in v_definition)=0 then raise exception 'Roster published-entry position anchor not found.'; end if;
  v_definition:=replace(v_definition,v_old,v_new);
  execute v_definition;
end $migration$;

-- Draft row presentation uses dated People identity; frozen snapshots continue
-- to win in the existing client read model.
do $migration$
declare v_definition text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.list_duty_roster_read_model(uuid,date,date)'::regprocedure) into v_definition;
  v_old:=$old$
        'position', e.position, 'department', e.department, 'workplace', e.workplace,
        'employee_code', e.employee_code, 'employment_status', e.employment_status,
        'is_active', e.is_active
$old$;
  v_new:=$new$
        'position', public.roster_employment_on_date(e.id,p_outlet_id,d.roster_date)->>'position',
        'department', e.department,
        'workplace', public.roster_employment_on_date(e.id,p_outlet_id,d.roster_date)->>'workplace',
        'employee_code', e.employee_code,
        'employment_status', public.roster_employment_on_date(e.id,p_outlet_id,d.roster_date)->>'employment_status',
        'is_active', public.roster_employment_on_date(e.id,p_outlet_id,d.roster_date)->>'state'='eligible'
$new$;
  if position(v_old in v_definition)=0 then raise exception 'Roster read identity anchor not found.'; end if;
  execute replace(v_definition,v_old,v_new);
end $migration$;

revoke all on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.save_roster_week_snapshot(uuid,uuid,date,jsonb) to authenticated;
revoke all on function public.copy_roster_week(uuid,uuid,date,date,boolean) from public,anon,authenticated;
grant execute on function public.copy_roster_week(uuid,uuid,date,date,boolean) to authenticated;
revoke all on function public.publish_roster_week(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.publish_roster_week(uuid,uuid,date) to authenticated;
revoke all on function public.list_duty_roster_read_model(uuid,date,date) from public,anon,authenticated;
grant execute on function public.list_duty_roster_read_model(uuid,date,date) to authenticated;
