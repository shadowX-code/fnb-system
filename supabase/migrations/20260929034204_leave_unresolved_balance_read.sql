-- Read-only callers must see incomplete pre-cutover evidence as Review
-- Required, not turn one employee's unresolved grant into a whole-page error.
create function public.crew_leave_safe_balance(
  p_employee_id uuid,p_leave_type text,p_year date,p_outlet_id uuid,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_entitlement uuid; v_preview jsonb; v_reason text;
  v_start date:=date_trunc('year',p_year)::date;
begin
  begin
    v_entitlement:=public.crew_leave_ensure_entitlement(p_employee_id,p_leave_type,
      p_year,p_outlet_id,p_actor);
    return public.crew_leave_entitlement_balance(v_entitlement);
  exception when invalid_parameter_value then
    v_reason:=sqlerrm;
  end;
  v_preview:=public.crew_leave_entitlement_preview(p_employee_id,p_leave_type,p_year);
  return jsonb_build_object('entitlement_id',null,'employee_id',p_employee_id,
    'outlet_id',p_outlet_id,'leave_type',p_leave_type,'period_start',v_start,
    'period_end',(v_start+interval '1 year'-interval '1 day')::date,
    'balance_enforced',true,'available',null,'entitled',null,'used',null,'pending',null,
    'eligibility_state','review_required','explanation',v_preview,'review_reason',v_reason);
end $$;
revoke all on function public.crew_leave_safe_balance(uuid,text,date,uuid,uuid)
  from public,anon,authenticated;

create or replace function public.crew_leave_balances_admin_page(
  p_outlet_id uuid,p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_query text:=btrim(coalesce(p_filters->>'query',''));
  v_page integer:=greatest(coalesce(p_page,1),1);
  v_size integer:=case when p_page_size in (20,50,100) then p_page_size else 20 end;
  v_total integer; v_rows jsonb:='[]'::jsonb; v_employee record;
  v_type text; v_balance jsonb; v_balances jsonb;
begin
  if p_outlet_id is null or auth.uid() is null
    or not (public.current_user_has_permission('crew_leave.view')
      or public.current_user_has_permission('crew_leave_balance.view'))
    or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode='42501',message='Leave balances are unavailable for this outlet.';
  end if;
  select count(*) into v_total from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated')
      and (v_query='' or concat_ws(' ',coalesce(e.nickname,e.full_name),e.full_name,e.position)
        ilike '%'||v_query||'%');
  for v_employee in select e.id,coalesce(e.nickname,e.full_name) as name,e.position
    from public.employees e
    where public.crew_resolve_employee_outlet(e.id)=p_outlet_id
      and coalesce(e.is_active,true) and coalesce(e.employment_status,'') not in ('resigned','terminated')
      and (v_query='' or concat_ws(' ',coalesce(e.nickname,e.full_name),e.full_name,e.position)
        ilike '%'||v_query||'%')
    order by coalesce(e.nickname,e.full_name),e.id
    offset (v_page-1)*v_size limit v_size loop
    v_balances:='{}'::jsonb;
    foreach v_type in array array['annual','medical','unpaid','other'] loop
      v_balance:=public.crew_leave_safe_balance(v_employee.id,v_type,
        date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,p_outlet_id,auth.uid());
      v_balances:=v_balances||jsonb_build_object(v_type,v_balance||jsonb_build_object(
        'employee',jsonb_build_object('id',v_employee.id,'name',v_employee.name,
          'position',v_employee.position)));
    end loop;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'employee',jsonb_build_object('id',v_employee.id,'name',v_employee.name,
        'position',v_employee.position),'balances',v_balances,
      'period_start',v_balances->'annual'->>'period_start',
      'period_end',v_balances->'annual'->>'period_end'));
  end loop;
  return jsonb_build_object('rows',v_rows,'total_count',v_total,
    'page',v_page,'page_size',v_size);
end $$;
revoke all on function public.crew_leave_balances_admin_page(uuid,jsonb,integer,integer)
  from public,anon,authenticated;
grant execute on function public.crew_leave_balances_admin_page(uuid,jsonb,integer,integer)
  to authenticated;

create or replace function public.crew_leave_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; outlet uuid; rows jsonb; balances jsonb:='[]'::jsonb;
  leave_type text; v_management boolean;
begin
  employee:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(e.workplace,'')))='management' into v_management
    from public.employees e where e.id=employee;
  outlet:=public.crew_resolve_employee_outlet(employee);
  if v_management then
    select coalesce(jsonb_agg(public.crew_leave_entitlement_balance(e.id)
      order by e.leave_type),'[]'::jsonb) into balances
      from public.crew_leave_entitlements e
      where e.employee_id=employee
        and e.period_start=date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date;
  else
    foreach leave_type in array array['annual','medical','unpaid','other'] loop
      balances:=balances||jsonb_build_array(public.crew_leave_safe_balance(employee,leave_type,
        date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,outlet,null));
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'leave_type',r.leave_type,
    'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,
    'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,
    'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,
    'reviewed_at',r.reviewed_at,'rejection_reason',case when r.status='rejected'
      then r.rejection_reason else null end,'can_cancel',r.status='pending')
    order by r.start_date desc,r.submitted_at desc),'[]'::jsonb) into rows
    from public.crew_leave_requests r where r.employee_id=employee;
  return jsonb_build_object('balances',balances,'requests',rows,'can_apply',not v_management,
    'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,
      'leave_type',a.leave_type,'start_date',a.start_date,'end_date',a.end_date,
      'duration_type',a.duration_type,'half_day_period',a.half_day_period)
      order by a.start_date) from public.crew_approved_leaves a where a.employee_id=employee
        and a.end_date>=timezone('Asia/Kuala_Lumpur',now())::date),'[]'::jsonb));
end $$;
revoke all on function public.crew_leave_mobile(text) from public,anon,authenticated;
grant execute on function public.crew_leave_mobile(text) to anon,authenticated;
