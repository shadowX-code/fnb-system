-- One resolved setup projection. Applicability is evaluated before category.
create function public.payroll_statutory_setup_resolve(p_profile_id uuid,p_date date,p_applicability jsonb default null)
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
      'state',case when applicable=false then 'not_applicable' when issue is not null then 'setup_required' else 'confirmed' end));
  end loop;
  evidence:=jsonb_build_object('employee_id',e.id,'nationality',e.nationality,'birthday',e.birthday,
    'applicability_version_id',a.id,'category_version_id',i.id,'applicability',inputs,'effective_from',p_date);
  return jsonb_build_object('schemes',states,'complete',complete,'applicability',inputs,'effective_from',p_date,
    'fingerprint',md5(evidence::text),'evidence',evidence);
end; $$;
revoke all on function public.payroll_statutory_setup_resolve(uuid,date,jsonb) from public,anon,authenticated;

create function public.payroll_statutory_setup_read(p_profile_id uuid,p_date date default null,p_applicability jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; next_date date; history jsonb;
begin
  -- Scope is enforced by the shared resolver before history is read.
  result:=public.payroll_statutory_setup_resolve(p_profile_id,coalesce(p_date,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date),p_applicability);
  select greatest((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,
    (select max(effective_from)+1 from public.payroll_statutory_profile_versions where profile_id=p_profile_id),
    (select max(effective_from)+1 from public.payroll_statutory_input_versions where profile_id=p_profile_id)) into next_date;
  select jsonb_build_object('applicability',coalesce((select jsonb_agg(to_jsonb(v) order by effective_from desc) from public.payroll_statutory_profile_versions v where profile_id=p_profile_id),'[]'),
    'categories',coalesce((select jsonb_agg(to_jsonb(v) order by effective_from desc) from public.payroll_statutory_input_versions v where profile_id=p_profile_id),'[]')) into history;
  return result||jsonb_build_object('next_effective_from',next_date,'history',history);
end; $$;
revoke all on function public.payroll_statutory_setup_read(uuid,date,jsonb) from public,anon;
grant execute on function public.payroll_statutory_setup_read(uuid,date,jsonb) to authenticated;

create function public.payroll_statutory_setup_confirm(p_profile_id uuid,p_effective_from date,p_applicability jsonb,
  p_categories jsonb,p_fingerprint text,p_source_note text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; s text; category text; suggestion text; categories jsonb:='{}'; manual boolean:=false;
  actor uuid:=public.payroll_admin_actor(); applicability_id uuid; category_id uuid; source text; reason text;
begin
  perform 1 from public.payroll_profiles where id=p_profile_id for update;
  if not exists(select 1 from public.payroll_profiles p where p.id=p_profile_id and public.payroll_can_access_employee(p.employee_id,'payroll.manage')) then
    raise exception using errcode='42501',message='Payroll statutory setup scope denied.';
  end if;
  r:=public.payroll_statutory_setup_read(p_profile_id,p_effective_from,p_applicability);
  if p_effective_from<(r->>'next_effective_from')::date or r->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='22023',message='Setup evidence changed or effective date is not later. Refresh setup.';
  end if;
  foreach s in array array['epf','socso','eis','pcb'] loop
    if (p_applicability->>s) is null then raise exception using errcode='22023',message='Confirm applicability for every scheme.'; end if;
    if s='pcb' or (p_applicability->>s)::boolean=false then continue; end if;
    category:=nullif(p_categories->>s,''); suggestion:=r->'schemes'->s->>'recommendation';
    if category is distinct from suggestion then manual:=true; end if;
    if category is not null and public.payroll_statutory_category_issue(s,category,r->'evidence'->>'nationality',
      (r->'evidence'->>'birthday')::date,date_trunc('month',p_effective_from)::date,
      (date_trunc('month',p_effective_from)+interval '1 month - 1 day')::date) is not null then
      raise exception using errcode='22023',message='Category is unsupported by canonical employee evidence.';
    end if;
    if category is null then manual:=true; end if;
    categories:=categories||jsonb_build_object(s,category);
  end loop;
  if manual and (char_length(btrim(coalesce(p_source_note,'')))<8 or char_length(btrim(coalesce(p_reason,'')))<3) then
    raise exception using errcode='22023',message='Complete Setup or an override requires evidence and reason.';
  end if;
  source:=case when manual then btrim(p_source_note) else 'FeedX canonical Employee and Payroll evidence: '||(r->'evidence')::text end;
  reason:=case when manual then btrim(p_reason) else 'Admin confirmed unified statutory setup' end;
  -- Existing guarded append-only commands run in ONE transaction and ONE effective event.
  applicability_id:=public.payroll_statutory_adjust(p_profile_id,p_effective_from,(p_applicability->>'epf')::boolean,
    (p_applicability->>'socso')::boolean,(p_applicability->>'eis')::boolean,(p_applicability->>'pcb')::boolean,reason);
  category_id:=public.payroll_statutory_input_adjust(p_profile_id,p_effective_from,categories->>'epf',categories->>'socso',categories->>'eis','{}',source,reason);
  return public.payroll_statutory_setup_resolve(p_profile_id,p_effective_from,null)||jsonb_build_object('applicability_version_id',applicability_id,'category_version_id',category_id);
end; $$;
revoke all on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text) from public,anon;
grant execute on function public.payroll_statutory_setup_confirm(uuid,date,jsonb,jsonb,text,text,text) to authenticated;

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
    'statutory_setup',public.payroll_statutory_setup_resolve(p.id,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,null),
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

-- Keep legacy category-read compatibility on the same resolver; no second recommendation policy.
create or replace function public.payroll_statutory_recommendation(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; s text; categories jsonb:='{}'; issues jsonb:='{}';
begin
  r:=public.payroll_statutory_setup_read(p_profile_id);
  r:=public.payroll_statutory_setup_read(p_profile_id,(r->>'next_effective_from')::date,null);
  foreach s in array array['epf','socso','eis'] loop
    categories:=categories||jsonb_build_object(s,r->'schemes'->s->'recommendation');
    if r->'schemes'->s->>'state'='setup_required' and r->'schemes'->s->>'recommendation' is null then
      issues:=issues||jsonb_build_object(s,r->'schemes'->s->'issue');
    end if;
  end loop;
  return jsonb_build_object('categories',categories,'issues',issues,'effective_from',r->'effective_from',
    'evidence',r->'evidence','fingerprint',r->'fingerprint','can_confirm',issues='{}'::jsonb);
end; $$;
