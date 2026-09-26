-- Guided category confirmation delegates to the existing append-only authority.
create function public.payroll_statutory_recommendation(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; v_date date; v_latest date; v_start date; v_end date;
  a public.payroll_statutory_profile_versions%rowtype; v_age integer; v_categories jsonb:='{}';
  v_issues jsonb:='{}'; v_category text; v_issue text; v_scheme text; v_evidence jsonb;
begin
  perform public.payroll_admin_actor();
  select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
  if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll statutory view authority denied.';
  end if;
  select max(effective_from) into v_latest from public.payroll_statutory_input_versions where profile_id=p_profile_id;
  v_date:=greatest((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,v_latest+1);
  select * into a from public.payroll_statutory_profile_versions where profile_id=p_profile_id and effective_from<=v_date order by effective_from desc limit 1;
  v_start:=date_trunc('month',v_date)::date; v_end:=(v_start+interval '1 month - 1 day')::date;
  v_age:=date_part('year',age(v_start,e.birthday))::integer;
  foreach v_scheme in array array['epf','socso','eis'] loop
    v_category:=case v_scheme when 'epf' then case when v_age<60 then 'malaysian_under_60' else 'malaysian_60_to_74' end
      when 'socso' then case when v_age<60 then 'first_category_base' else 'second_category_base' end else 'standard' end;
    if (to_jsonb(a)->>(v_scheme||'_applicable')) is null then v_issue:='Applicability must be reviewed first';
    elsif (to_jsonb(a)->>(v_scheme||'_applicable'))::boolean=false then v_issue:=null; v_category:=null;
    else v_issue:=public.payroll_statutory_category_issue(v_scheme,v_category,e.nationality,e.birthday,v_start,v_end); end if;
    if v_issue is not null then v_categories:=v_categories||jsonb_build_object(v_scheme,null); v_issues:=v_issues||jsonb_build_object(v_scheme,v_issue);
    else v_categories:=v_categories||jsonb_build_object(v_scheme,v_category); end if;
  end loop;
  v_evidence:=jsonb_build_object('employee_id',e.id,'nationality',e.nationality,'birthday',e.birthday,
    'applicability_version_id',a.id,'latest_input_date',v_latest,'effective_from',v_date,'policy','existing-supported-category-guard');
  return jsonb_build_object('categories',v_categories,'issues',v_issues,'effective_from',v_date,
    'evidence',v_evidence,'fingerprint',md5(v_evidence::text),'can_confirm',v_issues='{}'::jsonb);
end; $$;
revoke all on function public.payroll_statutory_recommendation(uuid) from public,anon;
grant execute on function public.payroll_statutory_recommendation(uuid) to authenticated;

create function public.payroll_statutory_confirm_recommendation(p_profile_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_recommendation jsonb; v_id uuid;
begin
  perform public.payroll_admin_actor();
  perform 1 from public.payroll_profiles where id=p_profile_id for update;
  v_recommendation:=public.payroll_statutory_recommendation(p_profile_id);
  if not (v_recommendation->>'can_confirm')::boolean or v_recommendation->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='22023',message='Employee evidence changed or needs review. Refresh the recommendation.';
  end if;
  v_id:=public.payroll_statutory_input_adjust(p_profile_id,(v_recommendation->>'effective_from')::date,
    v_recommendation->'categories'->>'epf',v_recommendation->'categories'->>'socso',v_recommendation->'categories'->>'eis','{}',
    'FeedX canonical Employee and Payroll applicability evidence: '||(v_recommendation->'evidence')::text,
    'Admin confirmed system recommendation');
  return v_id;
end; $$;
revoke all on function public.payroll_statutory_confirm_recommendation(uuid,text) from public,anon;
grant execute on function public.payroll_statutory_confirm_recommendation(uuid,text) to authenticated;

create function public.payroll_statutory_schedule_read()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then raise exception using errcode='42501',message='Payroll view required.'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.scheme,s.category,s.effective_from desc),'[]') into v_rows
    from public.payroll_statutory_schedule_versions s;
  return v_rows;
end; $$;
revoke all on function public.payroll_statutory_schedule_read() from public,anon;
grant execute on function public.payroll_statutory_schedule_read() to authenticated;

-- Retired definitions may still have assignments to stop; no historical rows change.
create or replace function public.payroll_recurring_adjust(
  p_profile_id uuid,p_component_id uuid,p_effective_from date,p_amount numeric,p_is_active boolean,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype; v_component public.payroll_component_definitions%rowtype; v_previous public.payroll_recurring_component_versions%rowtype; v_id uuid;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll component scope denied.';
  end if;
  select * into v_component from public.payroll_component_definitions where id=p_component_id;
  if v_component.id is null or v_component.component_type not in ('allowance','deduction') or (p_is_active and not v_component.is_active) then
    raise exception using errcode='22023',message='Choose an active recurring allowance or deduction; existing inactive definitions may only be stopped.';
  end if;
  select * into v_previous from public.payroll_recurring_component_versions where profile_id=p_profile_id and component_id=p_component_id order by effective_from desc limit 1;
  if (v_previous.id is not null and p_effective_from<=v_previous.effective_from)
    or p_effective_from is null or nullif(btrim(p_reason),'') is null
    or (p_is_active and coalesce(p_amount,0)<=0) or (not p_is_active and p_amount<>0) then
    raise exception using errcode='22023',message='A valid later effective date, amount and reason are required.';
  end if;
  if exists(select 1 from public.payroll_run_profile_snapshots s join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_recurring_component_versions(profile_id,component_id,effective_from,amount,is_active,reason,approved_by_employee_id)
  values(p_profile_id,p_component_id,p_effective_from,p_amount,p_is_active,btrim(p_reason),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('recurring_component_adjusted',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('component_id',p_component_id,'previous_version_id',v_previous.id,'new_version_id',v_id,'effective_from',p_effective_from));
  return v_id;
end; $$;
