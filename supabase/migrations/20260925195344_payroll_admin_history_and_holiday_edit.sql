-- Payroll Admin history projection and controlled shared-holiday correction.
-- Existing finalized snapshots and payable-time evidence remain immutable.

create or replace function public.payroll_run_history_read(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view')
    or not public.payroll_can_manage_entity(p_legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll history is outside access scope.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id',r.id,'period_id',p.id,'period_start',p.period_start,
    'revision',r.revision,'status',r.status,'finalized_at',r.finalized_at,
    'current',p.current_finalized_run_id=r.id,
    'employee_count',members.employee_count,
    'gross',case when totals.ready_count=members.employee_count and members.employee_count>0 then totals.gross end,
    'net_pay',case when totals.ready_count=members.employee_count and members.employee_count>0 then totals.net_pay end,
    'employer_statutory_cost',case when totals.ready_count=members.employee_count and members.employee_count>0 then totals.employer_statutory_cost end,
    'total_employer_cost',case when totals.ready_count=members.employee_count and members.employee_count>0 then totals.total_employer_cost end
  ) order by p.period_start desc,r.revision desc),'[]'::jsonb) into v_rows
  from public.payroll_periods p join public.payroll_runs r on r.period_id=p.id
  cross join lateral (
    select case when r.status in ('finalized','paid')
      then (select count(*)::int from public.payroll_run_profile_snapshots s where s.run_id=r.id)
      else (select count(*)::int from public.payroll_run_employee_ids(r.id)) end employee_count
  ) members
  left join lateral (
    select count(*) filter(where s.status='ready' and s.net_pay is not null)::int ready_count,
      sum(s.gross_earnings) gross,sum(s.net_pay) net_pay,
      sum(s.employer_statutory_cost) employer_statutory_cost,
      sum(s.total_employer_cost) total_employer_cost
    from (
      select distinct on (v.employee_id) v.employee_id,v.status,v.gross_earnings,v.net_pay,
        v.employer_statutory_cost,v.total_employer_cost
      from public.payroll_run_statutory_versions v where v.run_id=r.id
      order by v.employee_id,v.revision desc
    ) s
  ) totals on true
  where p.legal_entity_id=p_legal_entity_id;
  return v_rows;
end; $$;
revoke all on function public.payroll_run_history_read(uuid) from public,anon;
grant execute on function public.payroll_run_history_read(uuid) to authenticated;

create or replace function public.payroll_holiday_history_read(p_holiday_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_holiday public.payroll_public_holidays%rowtype; v_rows jsonb; v_editable boolean;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select * into v_holiday from public.payroll_public_holidays where id=p_holiday_id;
  if v_holiday.id is null or (v_holiday.legal_entity_id is not null
    and not public.payroll_can_manage_entity(v_holiday.legal_entity_id,'payroll.view')) then
    raise exception using errcode='42501',message='Holiday is outside Payroll scope.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',ev.id,'event_type',ev.event_type,
    'occurred_at',ev.occurred_at,'reason',ev.reason,'details',ev.details,
    'actor_name',actor.full_name) order by ev.occurred_at desc),'[]'::jsonb) into v_rows
  from public.payroll_events ev join public.employees actor on actor.id=ev.actor_employee_id
  where ev.holiday_id=p_holiday_id;
  v_editable:=v_holiday.legal_entity_id is null
    and v_holiday.holiday_date>(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date
    and not exists(select 1 from public.payroll_payable_time_versions t
      where t.evidence->>'holiday_id'=p_holiday_id::text);
  return jsonb_build_object('events',v_rows,'editable',v_editable);
end; $$;
revoke all on function public.payroll_holiday_history_read(uuid) from public,anon;
grant execute on function public.payroll_holiday_history_read(uuid) to authenticated;

create or replace function public.payroll_holiday_update(
  p_holiday_id uuid,p_holiday_date date,p_name text,p_scope text,p_source_note text,
  p_state_code text,p_outlet_id uuid,p_is_active boolean,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_old public.payroll_public_holidays%rowtype;
  v_today date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not public.current_user_has_all_outlet_access()
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Shared Payroll holiday authority required.';
  end if;
  select * into v_old from public.payroll_public_holidays where id=p_holiday_id for update;
  if v_old.id is null or v_old.legal_entity_id is not null then
    raise exception using errcode='22023',message='Only shared holiday definitions can be edited.';
  end if;
  if v_old.holiday_date<=v_today or p_holiday_date<=v_today
    or exists(select 1 from public.payroll_payable_time_versions t
      where t.evidence->>'holiday_id'=p_holiday_id::text) then
    raise exception using errcode='22023',message='Historical or consumed holiday evidence cannot be edited.';
  end if;
  if p_holiday_date is null or nullif(btrim(p_name),'') is null
    or nullif(btrim(p_source_note),'') is null or nullif(btrim(p_reason),'') is null
    or p_is_active is null
    or not ((p_scope='national' and p_state_code is null and p_outlet_id is null)
      or (p_scope='state' and p_state_code ~ '^MY-(0[1-9]|1[0-6])$' and p_outlet_id is null)
      or (p_scope='outlet' and p_state_code is null and p_outlet_id is not null)) then
    raise exception using errcode='22023',message='Valid holiday, geography, status and reason are required.';
  end if;
  if p_scope='outlet' and not exists(select 1 from public.outlets where id=p_outlet_id) then
    raise exception using errcode='22023',message='Outlet override requires an existing outlet.';
  end if;
  if exists(select 1 from public.payroll_public_holidays h where h.id<>p_holiday_id
    and h.holiday_date=p_holiday_date and lower(h.name)=lower(btrim(p_name)) and h.scope=p_scope
    and h.state_code is not distinct from p_state_code and h.outlet_id is not distinct from p_outlet_id) then
    raise exception using errcode='23505',message='This holiday already exists.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  update public.payroll_public_holidays set holiday_date=p_holiday_date,name=btrim(p_name),
    scope=p_scope,state_code=p_state_code,outlet_id=p_outlet_id,is_active=p_is_active,
    source_note=btrim(p_source_note) where id=p_holiday_id;
  insert into public.payroll_events(event_type,holiday_id,actor_employee_id,reason,details)
  values('holiday_updated',p_holiday_id,v_actor,btrim(p_reason),jsonb_build_object(
    'before',jsonb_build_object('date',v_old.holiday_date,'name',v_old.name,'scope',v_old.scope,
      'state_code',v_old.state_code,'outlet_id',v_old.outlet_id,'is_active',v_old.is_active,
      'source_note',v_old.source_note),
    'after',jsonb_build_object('date',p_holiday_date,'name',btrim(p_name),'scope',p_scope,
      'state_code',p_state_code,'outlet_id',p_outlet_id,'is_active',p_is_active,
      'source_note',btrim(p_source_note))));
  return p_holiday_id;
end; $$;
revoke all on function public.payroll_holiday_update(uuid,date,text,text,text,text,uuid,boolean,text) from public,anon;
grant execute on function public.payroll_holiday_update(uuid,date,text,text,text,text,uuid,boolean,text) to authenticated;
