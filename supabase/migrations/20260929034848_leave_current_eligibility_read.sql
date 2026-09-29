-- A durable balance does not prove that its holder is currently eligible.
-- This is a read projection only; request/approval guards remain the authority.
create function public.crew_leave_current_eligibility(p_employee_id uuid,p_leave_type text)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_today date:=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date;
  v_employee public.employees%rowtype;
  v_assignment public.employee_employment_assignment_revisions%rowtype;
  v_policy public.crew_leave_policy_versions%rowtype;
  v_outlet uuid; v_policy_id uuid;
begin
  select * into v_employee from public.employees where id=p_employee_id;
  v_assignment:=public.employee_employment_assignment_at(p_employee_id,v_today);
  if v_employee.id is null or v_employee.joined_date is null or v_assignment.id is null
    then return 'unresolved'; end if;
  if v_today<v_employee.joined_date or v_assignment.employment_status<>'active'
    or (v_assignment.employment_end_date is not null
      and v_today>v_assignment.employment_end_date) then return 'not_eligible'; end if;
  select o.id into v_outlet from public.outlets o
    where lower(o.name)=lower(v_assignment.workplace)
      or lower(coalesce(o.code,''))=lower(v_assignment.workplace)
    order by case when lower(o.name)=lower(v_assignment.workplace) then 0 else 1 end,o.id limit 1;
  select p.id into v_policy_id from public.crew_leave_policies p
    where p.outlet_id=v_outlet and p.leave_type=p_leave_type;
  v_policy:=public.crew_leave_policy_at(v_policy_id,v_today);
  if v_policy.id is null then return 'unresolved'; end if;
  return case when v_assignment.employment_type=any(v_policy.eligible_employment_types)
    then 'eligible' else 'not_eligible' end;
end $$;
revoke all on function public.crew_leave_current_eligibility(uuid,text)
  from public,anon,authenticated;

create or replace function public.crew_leave_safe_balance(
  p_employee_id uuid,p_leave_type text,p_year date,p_outlet_id uuid,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_entitlement uuid; v_preview jsonb; v_reason text; v_balance jsonb;
  v_current text:=public.crew_leave_current_eligibility(p_employee_id,p_leave_type);
  v_start date:=date_trunc('year',p_year)::date;
begin
  begin
    v_entitlement:=public.crew_leave_ensure_entitlement(p_employee_id,p_leave_type,
      p_year,p_outlet_id,p_actor);
    v_balance:=public.crew_leave_entitlement_balance(v_entitlement);
    return v_balance||jsonb_build_object('current_eligibility',v_current);
  exception when invalid_parameter_value then
    v_reason:=sqlerrm;
  end;
  v_preview:=public.crew_leave_entitlement_preview(p_employee_id,p_leave_type,p_year);
  return jsonb_build_object('entitlement_id',null,'employee_id',p_employee_id,
    'outlet_id',p_outlet_id,'leave_type',p_leave_type,'period_start',v_start,
    'period_end',(v_start+interval '1 year'-interval '1 day')::date,
    'balance_enforced',true,'available',null,'entitled',null,'used',null,'pending',null,
    'eligibility_state','review_required','current_eligibility',v_current,
    'explanation',v_preview,'review_reason',v_reason);
end $$;
revoke all on function public.crew_leave_safe_balance(uuid,text,date,uuid,uuid)
  from public,anon,authenticated;
