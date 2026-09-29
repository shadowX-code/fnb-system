-- Staging-only boundary contract. Run as a privileged test transaction; the
-- final ROLLBACK removes the synthetic Employee, People revisions and Payroll
-- inputs. No Payroll Run or published/retained evidence is created.
begin;
do $test$
declare
  v_today date:=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date;
  v_reactivated date:=(date_trunc('month',timezone('Asia/Kuala_Lumpur',transaction_timestamp()))
    +interval '1 month')::date;
  v_month_end date:=(date_trunc('month',timezone('Asia/Kuala_Lumpur',transaction_timestamp()))
    +interval '2 months'-interval '1 day')::date;
  v_employee uuid; v_employee_mid uuid; v_entity uuid; v_outlet uuid; v_actor uuid; v_actor_auth uuid;
  v_period uuid; v_profile uuid; v_comp uuid;
  v_result jsonb;
begin
  select id into strict v_entity from public.legal_entities where is_active order by id limit 1;
  select id into strict v_outlet from public.outlets where name='Friends Corner' order by id limit 1;
  select id,auth_user_id into strict v_actor,v_actor_auth from public.employees
    where auth_user_id is not null order by id limit 1;
  perform set_config('request.jwt.claim.sub',v_actor_auth::text,true);
  insert into public.employees
    (full_name,employment_type,employment_status,position,legal_entity_id,
     workplace,joined_date,resigned_date,is_active)
  values ('QA ONLY ROLLBACK Employment Boundary','full_time','resigned','Service Crew',
    v_entity,'Friends Corner',v_today-30,v_today,false)
  returning id into v_employee;

  if (public.employee_employment_assignment_at(v_employee,v_today-1)).id is not null then
    raise exception 'Pre-cutover employment was inferred';
  end if;
  if public.roster_employment_on_date(v_employee,v_outlet,v_today-1)->>'state'<>'unresolved' then
    raise exception 'Pre-cutover Roster did not fail closed';
  end if;
  if public.roster_employment_on_date(v_employee,v_outlet,v_today)->>'state'='eligible' then
    raise exception 'Resigned date unexpectedly eligible';
  end if;
  if public.crew_performance_period_employment(v_employee,v_reactivated)->>'state'<>'ineligible' then
    raise exception 'Resignation without reactivation did not remain ineligible';
  end if;
  if public.crew_performance_period_employment(v_employee,v_today)->>'state'<>'unresolved' then
    raise exception 'Pre-cutover Performance was inferred';
  end if;

  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,
     legal_entity_id,workplace,employment_end_date,source_kind,reason,
     recorded_by_employee_id)
  values (v_employee,v_reactivated,'full_time','active','Service Crew',
    v_entity,'Friends Corner',null,'admin_change','Rollback-only future reactivation check',v_actor);

  if (select employment_status from public.employees where id=v_employee)<>'resigned'
    or (select resigned_date from public.employees where id=v_employee)<>v_today
    or exists(select 1 from public.crew_access where employee_id=v_employee) then
    raise exception 'Future revision activated current Employee early';
  end if;
  if public.roster_employment_on_date(v_employee,v_outlet,v_reactivated-1)->>'state'='eligible' then
    raise exception 'Roster activated before effective date';
  end if;
  if public.roster_employment_on_date(v_employee,v_outlet,v_reactivated)->>'state'<>'eligible' then
    raise exception 'Roster ignored dated reactivation';
  end if;
  v_result:=public.crew_performance_period_employment(v_employee,v_reactivated);
  if v_result->>'state'<>'eligible' then
    raise exception 'Performance ignored dated reactivation: %',v_result;
  end if;

  -- Test-only scoped inserts exercise the calculation reader, not Payroll
  -- commands. They and this session-local command flag are rolled back.
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_periods(legal_entity_id,period_start,period_end)
  values(v_entity,v_reactivated,v_month_end) returning id into v_period;
  insert into public.payroll_profiles(employee_id,created_by_employee_id)
  values(v_employee,v_actor) returning id into v_profile;
  insert into public.payroll_compensation_versions
    (profile_id,effective_from,legal_entity_id,pay_basis,basic_salary,
     default_cost_outlet_id,workplace_snapshot,reason,approved_by_employee_id)
  values(v_profile,v_reactivated,v_entity,'monthly',3000,v_outlet,
    'Friends Corner','Rollback-only monthly calculation boundary',v_actor)
  returning id into v_comp;
  v_result:=public.payroll_monthly_entitlement(v_employee,v_period,v_comp);
  if (v_result->'basis'->>'employed_days')::integer<>(v_month_end-v_reactivated+1)
    or v_result->'basis'->>'last_employment_date' is not null then
    raise exception 'Payroll days were capped by current resignation: %',v_result;
  end if;
  if public.payroll_period_employment_resolve(v_employee,v_period)->>'state'<>'resolved' then
    raise exception 'Payroll period membership ignored dated reactivation';
  end if;

  -- A reactivation inside the month contributes only dated active days. The
  -- existing one-identity Payroll/Performance models still require review.
  insert into public.employees
    (full_name,employment_type,employment_status,position,legal_entity_id,
     workplace,joined_date,resigned_date,is_active)
  values ('QA ONLY ROLLBACK Midmonth Boundary','full_time','resigned','Service Crew',
    v_entity,'Friends Corner',v_today-30,v_today,false)
  returning id into v_employee_mid;
  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,
     legal_entity_id,workplace,employment_end_date,source_kind,reason,
     recorded_by_employee_id)
  values (v_employee_mid,v_reactivated+10,'full_time','active','Service Crew',
    v_entity,'Friends Corner',null,'admin_change','Rollback-only midmonth reactivation check',v_actor);
  if public.roster_employment_on_date(v_employee_mid,v_outlet,v_reactivated+9)->>'state'='eligible'
    or public.roster_employment_on_date(v_employee_mid,v_outlet,v_reactivated+10)->>'state'<>'eligible' then
    raise exception 'Roster midmonth effective date is incorrect';
  end if;
  if public.crew_performance_period_employment(v_employee_mid,v_reactivated)->>'state'<>'mixed' then
    raise exception 'Performance midmonth change did not require review';
  end if;
  insert into public.payroll_profiles(employee_id,created_by_employee_id)
  values(v_employee_mid,v_actor) returning id into v_profile;
  insert into public.payroll_compensation_versions
    (profile_id,effective_from,legal_entity_id,pay_basis,basic_salary,
     default_cost_outlet_id,workplace_snapshot,reason,approved_by_employee_id)
  values(v_profile,v_reactivated,v_entity,'monthly',3000,v_outlet,
    'Friends Corner','Rollback-only midmonth monthly boundary',v_actor)
  returning id into v_comp;
  v_result:=public.payroll_monthly_entitlement(v_employee_mid,v_period,v_comp);
  if (v_result->'basis'->>'employed_days')::integer<>(v_month_end-v_reactivated-9) then
    raise exception 'Payroll midmonth active-day count is incorrect: %',v_result;
  end if;
  if public.payroll_period_employment_resolve(v_employee_mid,v_period)->>'state'<>'review_required' then
    raise exception 'Payroll midmonth assignment did not require review';
  end if;
end $test$;
rollback;
