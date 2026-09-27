create or replace function public.payroll_statutory_setup_resolve(p_profile_id uuid,p_date date,p_applicability jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; a public.payroll_statutory_profile_versions%rowtype;
  i public.payroll_statutory_input_versions%rowtype; s text; applicable boolean; category text;
  recommendation text; issue text; states jsonb:='{}'; inputs jsonb; evidence jsonb; complete boolean:=true;
  first_day date:=date_trunc('month',p_date)::date; last_day date:=(date_trunc('month',p_date)+interval '1 month - 1 day')::date;
  age_years integer;
begin
  perform public.payroll_admin_actor();
  select employee.* into e from public.payroll_profiles p join public.employees employee on employee.id=p.employee_id where p.id=p_profile_id;
  if e.id is null or not public.payroll_can_access_employee(e.id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll statutory view authority denied.';
  end if;
  if p_date is null then raise exception using errcode='22023',message='Effective date required.'; end if;
  select * into a from public.payroll_statutory_profile_versions where profile_id=p_profile_id and effective_from<=p_date order by effective_from desc limit 1;
  select * into i from public.payroll_statutory_input_versions where profile_id=p_profile_id and effective_from<=p_date order by effective_from desc limit 1;
  inputs:=coalesce(p_applicability,jsonb_build_object('epf',a.epf_applicable,'socso',a.socso_applicable,'eis',a.eis_applicable,'pcb',a.pcb_applicable));
  age_years:=date_part('year',age(first_day,e.birthday))::integer;
  foreach s in array array['epf','socso','eis','pcb'] loop
    applicable:=(inputs->>s)::boolean; category:=null; recommendation:=null; issue:=null;
    if applicable is null then issue:='Confirm applicability';
    elsif applicable=false then null; -- terminal resolved state, never needs category
    elsif s='pcb' then null; -- employee setup only; monthly confirmation remains separate
    else
      category:=to_jsonb(i)->>(s||'_category');
      recommendation:=case s when 'epf' then case when age_years<60 then 'malaysian_under_60' else 'malaysian_60_to_74' end
        when 'socso' then case when age_years<60 then 'first_category_base' else 'second_category_base' end else 'standard' end;
      issue:=public.payroll_statutory_category_issue(s,recommendation,e.nationality,e.birthday,first_day,last_day);
      if issue is not null then recommendation:=null; end if;
      -- A category is confirmed only when it remains supported by actual evidence.
      if category is not null and public.payroll_statutory_category_issue(s,category,e.nationality,e.birthday,first_day,last_day) is null then issue:=null;
      else category:=null; issue:=coalesce(issue,'Contribution category needs confirmation'); end if;
    end if;
    complete:=complete and issue is null;
    states:=states||jsonb_build_object(s,jsonb_build_object('applicable',applicable,'category',category,'recommendation',recommendation,'issue',issue,
      'state',case when applicable=false then 'not_applicable' when issue is not null and recommendation is not null then 'confirmation_required' when issue is not null then 'setup_required' else 'confirmed' end));
  end loop;
  evidence:=jsonb_build_object('employee_id',e.id,'nationality',e.nationality,'birthday',e.birthday,
    'applicability_version_id',a.id,'category_version_id',i.id,'applicability',inputs,'effective_from',p_date);
  return jsonb_build_object('schemes',states,'complete',complete,'applicability',inputs,'effective_from',p_date,
    'fingerprint',md5(evidence::text),'evidence',evidence);
end; $$;
revoke all on function public.payroll_statutory_setup_resolve(uuid,date,jsonb) from public,anon,authenticated;



-- Employee setup summary only: current evidence remains separate from future display.
create function public.payroll_statutory_setup_summary(p_profile_id uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare current_result jsonb; display_schemes jsonb; future_result jsonb; s text; d date; state jsonb;
  scheduled boolean:=false; needs_setup boolean:=false; needs_confirmation boolean:=false;
begin
  current_result:=public.payroll_statutory_setup_resolve(p_profile_id,p_date,null);
  display_schemes:=current_result->'schemes';
  foreach s in array array['epf','socso','eis','pcb'] loop
    state:=display_schemes->s;
    for d in select effective_from from (
      select effective_from from public.payroll_statutory_profile_versions where profile_id=p_profile_id
      union select effective_from from public.payroll_statutory_input_versions where profile_id=p_profile_id
    ) dates where effective_from>p_date order by effective_from loop
      future_result:=public.payroll_statutory_setup_resolve(p_profile_id,d,null);
      if future_result->'schemes'->s->>'state' in ('confirmed','not_applicable')
        and (future_result->'schemes'->s->>'category' is distinct from state->>'category'
          or future_result->'schemes'->s->>'applicable' is distinct from state->>'applicable'
          or state->>'state' not in ('confirmed','not_applicable')) then
        state:=(future_result->'schemes'->s)||jsonb_build_object('state','scheduled','effective_from',d,'current',current_result->'schemes'->s);
        scheduled:=true;
        exit;
      end if;
    end loop;
    needs_setup:=needs_setup or state->>'state'='setup_required';
    needs_confirmation:=needs_confirmation or state->>'state'='confirmation_required';
    display_schemes:=jsonb_set(display_schemes,array[s],state);
  end loop;
  return current_result||jsonb_build_object('display_schemes',display_schemes,'status',
    case when needs_setup then 'Setup Required' when needs_confirmation then 'Confirmation Required'
      when scheduled then 'Scheduled Change' else 'Complete' end);
end; $$;
revoke all on function public.payroll_statutory_setup_summary(uuid,date) from public,anon,authenticated;

create or replace function public.payroll_foundation_read(p_profile_id uuid default null,p_period_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_profiles jsonb; v_candidates jsonb; v_entities jsonb; v_components jsonb;
  v_holidays jsonb; v_outlets jsonb; v_periods jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'employee_id',e.id,'employee_name',e.full_name,'employee_code',e.employee_code,
    'workplace',e.workplace,'employment_type',e.employment_type,'employment_status',e.employment_status,
    'legal_entity_id',e.legal_entity_id,
    'compensation',coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_from desc) from public.payroll_compensation_versions v where v.profile_id=p.id),'[]'::jsonb),
    'statutory_setup',public.payroll_statutory_setup_summary(p.id,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,null),
    'statutory',coalesce((select jsonb_agg(to_jsonb(s) order by s.effective_from desc) from public.payroll_statutory_profile_versions s where s.profile_id=p.id),'[]'::jsonb),
    'recurring',coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_from desc) from public.payroll_recurring_component_versions c where c.profile_id=p.id),'[]'::jsonb)
  ) order by e.full_name),'[]'::jsonb) into v_profiles
  from public.payroll_profiles p join public.employees e on e.id=p.employee_id
  where (p_profile_id is null or p.id=p_profile_id)
    and public.payroll_can_access_employee(e.id,'payroll.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.full_name,'employee_code',e.employee_code,
    'legal_entity_id',e.legal_entity_id,'workplace',e.workplace,
    'employment_type',e.employment_type,'employment_status',e.employment_status)
    order by e.full_name),'[]'::jsonb) into v_candidates
  from public.employees e where e.legal_entity_id is not null
    and public.payroll_can_access_employee(e.id,'payroll.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',le.id,'name',le.legal_company_name,'display_name',le.display_name,'is_active',le.is_active)
    order by le.legal_company_name),'[]'::jsonb) into v_entities
  from public.legal_entities le
  where public.payroll_can_manage_entity(le.id,'payroll.view')
    or exists(select 1 from public.employees e where e.legal_entity_id=le.id
      and public.payroll_can_access_employee(e.id,'payroll.view'));
  select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]'::jsonb) into v_components
  from public.payroll_component_definitions c;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.holiday_date desc,h.name),'[]'::jsonb) into v_holidays
  from public.payroll_public_holidays h
  where h.legal_entity_id is null
    or public.payroll_can_manage_entity(h.legal_entity_id,'payroll.view');
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'state_code',o.state_code)
    order by o.name),'[]'::jsonb) into v_outlets
  from public.outlets o where public.current_user_can_access_outlet(o.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'legal_entity_id',p.legal_entity_id,'period_start',p.period_start,'period_end',p.period_end,
    'current_finalized_run_id',p.current_finalized_run_id,
    'runs',coalesce((select jsonb_agg(
      to_jsonb(r) || jsonb_build_object('finalized_by_name', actor.full_name)
      order by r.revision desc)
      from public.payroll_runs r left join public.employees actor on actor.id=r.finalized_by_employee_id
      where r.period_id=p.id),'[]'::jsonb)) order by p.period_start desc),'[]'::jsonb) into v_periods
  from public.payroll_periods p
  where (p_period_id is null or p.id=p_period_id)
    and public.payroll_can_manage_entity(p.legal_entity_id,'payroll.view');
  return jsonb_build_object('profiles',v_profiles,'employees',v_candidates,'legal_entities',v_entities,
    'components',v_components,'holidays',v_holidays,'outlets',v_outlets,'periods',v_periods,
    'settings_authority',jsonb_build_object(
      'components',public.current_user_has_permission('payroll.manage') and exists(
        select 1 from public.employees e join public.roles r on r.id=e.role_id
        where e.auth_user_id=auth.uid() and lower(r.name) in ('owner','admin')),
      'holidays',public.current_user_has_permission('payroll.manage')
        and public.current_user_has_all_outlet_access() and exists(
        select 1 from public.employees e join public.roles r on r.id=e.role_id
        where e.auth_user_id=auth.uid() and lower(r.name) in ('owner','admin'))));
end; $$;

revoke all on function public.payroll_foundation_read(uuid,uuid) from public,anon;
grant execute on function public.payroll_foundation_read(uuid,uuid) to authenticated;
