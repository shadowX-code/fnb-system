-- Keep approved Leave visible in the employee's canonical employment outlet,
-- provide one deterministic outlet-scoped Duty Roster read model, and repair
-- projections created from a cross-outlet published shift.

create or replace function public.crew_leave_review(
  p_request_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.crew_leave_requests%rowtype;
  approved public.crew_approved_leaves%rowtype;
  d date;
  projection_outlet uuid;
  current_schedule jsonb;
  template_id uuid;
  entitlement uuid;
  balance jsonb;
  year_start date;
begin
  if auth.uid() is null or not public.current_user_has_permission('crew_leave.review') then
    raise exception using errcode = '42501', message = 'Leave review permission is required.';
  end if;

  select * into row
  from public.crew_leave_requests
  where id = p_request_id
  for update;

  if row.id is null or not public.current_user_can_access_outlet(row.employment_outlet_id) then
    raise exception using errcode = '42501', message = 'Leave request is outside your outlet scope.';
  end if;

  perform pg_advisory_xact_lock(hashtext('crew_leave:' || row.employee_id::text));

  if row.status <> 'pending' then
    raise exception using errcode = '22023', message = 'Only a pending leave request can be reviewed.';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'Review decision is invalid.';
  end if;

  if p_decision = 'reject' then
    if length(btrim(coalesce(p_rejection_reason, ''))) < 2 then
      raise exception using errcode = '22023', message = 'A rejection reason is required.';
    end if;
    update public.crew_leave_requests
    set status = 'rejected',
        rejection_reason = left(btrim(p_rejection_reason), 1000),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = row.id
    returning * into row;
    insert into public.crew_leave_audit(request_id, action, actor_type, actor_user_id, detail)
    values (row.id, 'rejected', 'admin', auth.uid(), jsonb_build_object('reason', row.rejection_reason));
  else
    year_start := date_trunc('year', row.start_date)::date;
    while year_start <= date_trunc('year', row.end_date)::date loop
      entitlement := public.crew_leave_ensure_entitlement(
        row.employee_id, row.leave_type, year_start, row.employment_outlet_id, auth.uid()
      );
      balance := public.crew_leave_entitlement_balance(entitlement, row.start_date);
      if coalesce((balance ->> 'balance_enforced')::boolean, true)
         and coalesce((balance ->> 'available')::numeric, 0) < 0 then
        raise exception using errcode = '22023', message = 'Insufficient leave balance. Reject or adjust the entitlement before approval.';
      end if;
      year_start := (year_start + interval '1 year')::date;
    end loop;

    if exists (
      select 1 from public.crew_approved_leaves a
      where a.employee_id = row.employee_id
        and daterange(a.start_date, a.end_date, '[]') && daterange(row.start_date, row.end_date, '[]')
    ) then
      raise exception using errcode = '23P01', message = 'This leave overlaps another approved leave.';
    end if;

    update public.crew_leave_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = row.id
    returning * into row;

    insert into public.crew_approved_leaves(
      request_id, employee_id, employment_outlet_id, leave_type, start_date, end_date,
      duration_type, half_day_period, approved_by
    ) values (
      row.id, row.employee_id, row.employment_outlet_id, row.leave_type, row.start_date, row.end_date,
      row.duration_type, row.half_day_period, auth.uid()
    ) returning * into approved;

    -- A cross-outlet shift remains immutable evidence, but the Leave marker is
    -- rendered in the employee's canonical employment outlet.
    projection_outlet := row.employment_outlet_id;
    for d in select generate_series(row.start_date, row.end_date, interval '1 day')::date loop
      current_schedule := public.crew_roster_employee_day(row.employee_id, d);
      insert into public.crew_leave_roster_projections(
        approved_leave_id, employee_id, roster_date, outlet_id, leave_type,
        superseded_roster_entry, source_publication_id, projected_by
      ) values (
        approved.id, row.employee_id, d, projection_outlet, row.leave_type,
        nullif(current_schedule, 'null'::jsonb), nullif(current_schedule ->> 'publication_id', '')::uuid, auth.uid()
      );

      select id into template_id
      from public.shift_templates
      where outlet_id = projection_outlet
        and code = case row.leave_type when 'annual' then 'AL' when 'medical' then 'MC' when 'unpaid' then 'UL' else 'OL' end
      limit 1;

      insert into public.duty_rosters(
        outlet_id, employee_id, roster_date, shift_template_id, start_time, end_time,
        break_minutes, status, remark, created_by, updated_by, source, approved_leave_id
      ) values (
        projection_outlet, row.employee_id, d, template_id, null, null, 0, 'draft',
        public.crew_leave_label(row.leave_type), auth.uid(), auth.uid(), 'approved_leave', approved.id
      )
      on conflict(outlet_id, employee_id, roster_date) do update
      set shift_template_id = excluded.shift_template_id,
          start_time = null, end_time = null, break_minutes = 0, status = 'draft',
          remark = excluded.remark, updated_by = auth.uid(), updated_at = now(),
          source = 'approved_leave', approved_leave_id = approved.id;
    end loop;

    insert into public.crew_leave_audit(request_id, action, actor_type, actor_user_id, detail)
    values (row.id, 'approved', 'admin', auth.uid(), jsonb_build_object(
      'approved_leave_id', approved.id,
      'balance_checked', true,
      'projection_outlet_id', projection_outlet
    ));
  end if;

  return jsonb_build_object(
    'id', row.id, 'status', row.status, 'reviewed_at', row.reviewed_at,
    'rejection_reason', row.rejection_reason, 'approved_leave_id', approved.id
  );
end;
$$;

revoke all on function public.crew_leave_review(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crew_leave_review(uuid, text, text) to authenticated;

-- Repair only derived Leave projection rows. Approved requests, approvals,
-- superseded snapshots, publications, and audit history remain intact.
do $$
declare
  v_row record;
  v_template_id uuid;
begin
  for v_row in
    select p.id projection_id, p.outlet_id old_outlet_id, p.employee_id, p.roster_date,
           p.approved_leave_id, p.leave_type, a.request_id, a.employment_outlet_id
    from public.crew_leave_roster_projections p
    join public.crew_approved_leaves a on a.id = p.approved_leave_id
    where p.outlet_id is distinct from a.employment_outlet_id
  loop
    delete from public.duty_rosters
    where approved_leave_id = v_row.approved_leave_id
      and employee_id = v_row.employee_id
      and roster_date = v_row.roster_date
      and source = 'approved_leave';

    update public.crew_leave_roster_projections
    set outlet_id = v_row.employment_outlet_id
    where id = v_row.projection_id;

    select id into v_template_id
    from public.shift_templates
    where outlet_id = v_row.employment_outlet_id
      and code = case v_row.leave_type when 'annual' then 'AL' when 'medical' then 'MC' when 'unpaid' then 'UL' else 'OL' end
    limit 1;

    insert into public.duty_rosters(
      outlet_id, employee_id, roster_date, shift_template_id, start_time, end_time,
      break_minutes, status, remark, source, approved_leave_id
    ) values (
      v_row.employment_outlet_id, v_row.employee_id, v_row.roster_date, v_template_id,
      null, null, 0, 'draft', public.crew_leave_label(v_row.leave_type),
      'approved_leave', v_row.approved_leave_id
    )
    on conflict(outlet_id, employee_id, roster_date) do update
    set shift_template_id = excluded.shift_template_id,
        start_time = null, end_time = null, break_minutes = 0, status = 'draft',
        remark = excluded.remark, updated_at = now(), source = 'approved_leave',
        approved_leave_id = excluded.approved_leave_id;

    insert into public.crew_leave_audit(request_id, action, actor_type, detail)
    values (v_row.request_id, 'projected', 'system', jsonb_build_object(
      'reason', 'canonical_outlet_repair',
      'old_outlet_id', v_row.old_outlet_id,
      'new_outlet_id', v_row.employment_outlet_id,
      'roster_date', v_row.roster_date
    ));
  end loop;
end;
$$;

create or replace function public.list_duty_roster_read_model(
  p_outlet_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not (
       public.current_user_has_permission('crew_roster.view')
       or public.current_user_has_permission('crew_roster.manage')
       or public.current_user_has_permission('crew_roster.publish')
     )
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'Duty Roster is unavailable for this outlet.';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
     or p_end_date - p_start_date > 62 then
    raise exception using errcode = '22023', message = 'Roster date range is invalid.';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'roster_date', item ->> 'employee_id'), '[]'::jsonb)
  into v_result
  from (
    select to_jsonb(d) || jsonb_build_object(
      'shift_template', case when t.id is null then null else jsonb_build_object(
        'id', t.id, 'outlet_id', t.outlet_id, 'name', t.name, 'code', t.code,
        'start_time', t.start_time, 'end_time', t.end_time,
        'break_minutes', t.break_minutes, 'shift_type', t.shift_type, 'color', t.color
      ) end,
      'employee', case when e.id is null then null else jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'nickname', e.nickname,
        'position', e.position, 'department', e.department, 'workplace', e.workplace,
        'employee_code', e.employee_code, 'employment_status', e.employment_status,
        'is_active', e.is_active
      ) end
    ) item
    from public.duty_rosters d
    left join public.shift_templates t on t.id = d.shift_template_id
    left join public.employees e on e.id = d.employee_id
    where d.outlet_id = p_outlet_id
      and d.roster_date between p_start_date and p_end_date
  ) rows;

  return v_result;
end;
$$;

revoke all on function public.list_duty_roster_read_model(uuid, date, date) from public, anon, authenticated;
grant execute on function public.list_duty_roster_read_model(uuid, date, date) to authenticated;
