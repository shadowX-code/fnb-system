-- Personal leave history is employee-owned. Management has no fixed employment
-- outlet, so its read must not create entitlements from the selected context.
create or replace function public.crew_leave_mobile(p_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare employee uuid; outlet uuid; rows jsonb; balances jsonb:='[]'::jsonb;
  leave_type text; entitlement uuid; v_management boolean;
begin
  employee:=public.crew_session_employee(p_token);
  select lower(btrim(coalesce(e.workplace,'')))='management' into v_management
    from public.employees e where e.id=employee;
  outlet:=public.crew_resolve_employee_outlet(employee);
  if v_management then
    select coalesce(jsonb_agg(public.crew_leave_entitlement_balance(e.id) order by e.leave_type),'[]'::jsonb)
      into balances from public.crew_leave_entitlements e
      where e.employee_id=employee
        and e.period_start=date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date;
  else
    foreach leave_type in array array['annual','medical','unpaid','other'] loop
      entitlement:=public.crew_leave_ensure_entitlement(employee,leave_type,
        date_trunc('year',timezone('Asia/Kuala_Lumpur',now()))::date,outlet,null);
      balances:=balances||jsonb_build_array(public.crew_leave_entitlement_balance(entitlement));
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'leave_type',r.leave_type,
    'start_date',r.start_date,'end_date',r.end_date,'duration_type',r.duration_type,
    'half_day_period',r.half_day_period,'requested_days',r.requested_days,'reason',r.reason,
    'document_status',r.document_status,'status',r.status,'submitted_at',r.submitted_at,
    'reviewed_at',r.reviewed_at,'rejection_reason',case when r.status='rejected' then r.rejection_reason else null end,
    'can_cancel',r.status='pending') order by r.start_date desc,r.submitted_at desc),'[]'::jsonb)
    into rows from public.crew_leave_requests r where r.employee_id=employee;
  return jsonb_build_object('balances',balances,'requests',rows,'can_apply',not v_management,
    'upcoming',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'leave_type',a.leave_type,
      'start_date',a.start_date,'end_date',a.end_date,'duration_type',a.duration_type,
      'half_day_period',a.half_day_period) order by a.start_date)
      from public.crew_approved_leaves a where a.employee_id=employee
        and a.end_date>=timezone('Asia/Kuala_Lumpur',now())::date),'[]'::jsonb));
end; $$;
revoke all on function public.crew_leave_mobile(text) from public,anon,authenticated;
grant execute on function public.crew_leave_mobile(text) to anon,authenticated;
