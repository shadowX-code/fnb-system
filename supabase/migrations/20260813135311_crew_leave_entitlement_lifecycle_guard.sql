-- Preserve historical grants while preventing new grants for departed Crew.
create or replace function public.crew_leave_ensure_entitlement(p_employee_id uuid,p_leave_type text,p_period_start date,p_outlet_id uuid default null,p_actor uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_period_start date; v_period_end date; employee public.employees%rowtype; outlet uuid; policy public.crew_leave_policies%rowtype; eligible_start date; eligible_days integer; total_days integer; prorated numeric; prior public.crew_leave_entitlements%rowtype; prior_balance jsonb; carry numeric:=0; carry_expiry date; result_id uuid;
begin
 v_period_start:=date_trunc('year',p_period_start)::date; v_period_end:=(v_period_start+interval '1 year'-interval '1 day')::date;
 select * into employee from public.employees where id=p_employee_id;
 if employee.id is null then raise exception using errcode='22023',message='Employee is unavailable.'; end if;
 select ce.id into result_id from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=v_period_start;
 if result_id is not null then return result_id; end if;
 if not coalesce(employee.is_active,true) or coalesce(employee.employment_status,'') in ('resigned','terminated') or (employee.resigned_date is not null and v_period_start>employee.resigned_date) then raise exception using errcode='22023',message='Future leave entitlement cannot be generated for a departed employee.'; end if;
 outlet:=coalesce(p_outlet_id,public.crew_resolve_employee_outlet(employee.id));
 if outlet is null then raise exception using errcode='22023',message='Employee outlet is unavailable.'; end if;
 select * into policy from public.crew_leave_policies where outlet_id=outlet and leave_type=p_leave_type;
 if policy.id is null then raise exception using errcode='22023',message='Leave policy is unavailable.'; end if;
 eligible_start:=greatest(v_period_start,coalesce(employee.joined_date,v_period_start)); total_days:=v_period_end-v_period_start+1; eligible_days:=greatest(0,v_period_end-eligible_start+1);
 prorated:=case when policy.proration_enabled then round((policy.annual_days*eligible_days/total_days)*2)/2 else policy.annual_days end;
 if policy.carry_forward_enabled then
  select * into prior from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=(v_period_start-interval '1 year')::date;
  if prior.id is not null then prior_balance:=public.crew_leave_entitlement_balance(prior.id,prior.period_end); carry:=least(policy.max_carry_forward_days,greatest(0,coalesce((prior_balance->>'available')::numeric,0))); end if;
  carry_expiry:=make_date(extract(year from v_period_start)::int,policy.carry_forward_expiry_month,least(policy.carry_forward_expiry_day,extract(day from (make_date(extract(year from v_period_start)::int,policy.carry_forward_expiry_month,1)+interval '1 month'-interval '1 day'))::int));
 end if;
 insert into public.crew_leave_entitlements(employee_id,outlet_id,leave_type,period_start,period_end,base_entitlement,prorated_entitlement,carry_forward,carry_forward_expires_at,calculation_version,calculation_explanation,generated_by)
 values(employee.id,outlet,p_leave_type,v_period_start,v_period_end,policy.annual_days,prorated,carry,carry_expiry,policy.calculation_version,jsonb_build_object('formula',case when policy.proration_enabled then 'annual_days × eligible_calendar_days ÷ calendar_year_days, rounded to nearest half day' else 'annual entitlement without proration' end,'joined_date',employee.joined_date,'eligible_from',eligible_start,'eligible_calendar_days',eligible_days,'calendar_year_days',total_days,'weekends_and_public_holidays_excluded',false),p_actor)
 on conflict(employee_id,leave_type,period_start) do nothing returning id into result_id;
 if result_id is null then select ce.id into result_id from public.crew_leave_entitlements ce where ce.employee_id=employee.id and ce.leave_type=p_leave_type and ce.period_start=v_period_start; end if;
 return result_id;
end $$;
revoke all on function public.crew_leave_ensure_entitlement(uuid,text,date,uuid,uuid) from public,anon,authenticated;
