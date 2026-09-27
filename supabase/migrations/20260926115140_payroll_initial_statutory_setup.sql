-- Share one recommendation policy before and after a Payroll Profile exists.
create function public.payroll_statutory_setup_core(p_employee_id uuid,p_profile_id uuid,p_date date,p_applicability jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare e public.employees%rowtype; a public.payroll_statutory_profile_versions%rowtype;
  i public.payroll_statutory_input_versions%rowtype; s text; applicable boolean; category text;
  recommendation text; issue text; states jsonb:='{}'; inputs jsonb; evidence jsonb; complete boolean:=true;
  first_day date:=date_trunc('month',p_date)::date; last_day date:=(date_trunc('month',p_date)+interval '1 month - 1 day')::date;
  age_years integer;
begin
  perform public.payroll_admin_actor();
  select * into e from public.employees where id=p_employee_id;
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

revoke all on function public.payroll_statutory_setup_core(uuid,uuid,date,jsonb) from public,anon,authenticated;

create or replace function public.payroll_statutory_setup_resolve(p_profile_id uuid,p_date date,p_applicability jsonb default null)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.payroll_statutory_setup_core(
    (select employee_id from public.payroll_profiles where id=p_profile_id),p_profile_id,p_date,p_applicability);
$$;
revoke all on function public.payroll_statutory_setup_resolve(uuid,date,jsonb) from public,anon,authenticated;

create function public.payroll_initial_setup_read(p_employee_id uuid,p_date date,p_applicability jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r jsonb; context jsonb;
begin
  r:=public.payroll_statutory_setup_core(p_employee_id,null,p_date,p_applicability);
  if exists(select 1 from public.payroll_profiles where employee_id=p_employee_id) then
    raise exception using errcode='PT409',message='Employee Payroll setup already exists. Refresh Employees.';
  end if;
  select jsonb_build_object('legal_entity_id',legal_entity_id,'workplace',workplace) into context
    from public.employees where id=p_employee_id;
  return r||jsonb_build_object('fingerprint',md5((r->>'fingerprint')||context::text));
end; $$;
revoke all on function public.payroll_initial_setup_read(uuid,date,jsonb) from public,anon;
grant execute on function public.payroll_initial_setup_read(uuid,date,jsonb) to authenticated;

-- One transaction: compensation + applicability + supported category evidence.
-- No client category is trusted; unsupported schemes remain truthfully unresolved.
create function public.payroll_initial_setup_confirm(p_employee_id uuid,p_effective_from date,
  p_pay_basis text,p_rate numeric,p_currency text,p_applicability jsonb,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; profile_id uuid; s text; category_id uuid;
  reason text:='Admin confirmed initial Payroll and statutory setup';
begin
  perform public.payroll_admin_actor();
  if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll initial setup scope denied.';
  end if;
  perform 1 from public.employees where id=p_employee_id for update;
  r:=public.payroll_initial_setup_read(p_employee_id,p_effective_from,p_applicability);
  if r->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='PT409',message='Statutory information was updated. Refresh setup.',
      detail='payroll_statutory_setup_stale';
  end if;
  foreach s in array array['epf','socso','eis','pcb'] loop
    if p_applicability->>s is null then
      raise exception using errcode='22023',message='Confirm applicability for every scheme.';
    end if;
  end loop;
  profile_id:=public.payroll_profile_create(p_employee_id,p_effective_from,p_pay_basis,p_rate,p_currency,
    reason,null,null,(p_applicability->>'epf')::boolean,(p_applicability->>'socso')::boolean,
    (p_applicability->>'eis')::boolean,(p_applicability->>'pcb')::boolean);
  category_id:=public.payroll_statutory_input_adjust(profile_id,p_effective_from,
    r->'schemes'->'epf'->>'recommendation',r->'schemes'->'socso'->>'recommendation',
    r->'schemes'->'eis'->>'recommendation','{}',
    'FeedX canonical Employee evidence: '||(r->'evidence')::text,reason);
  return public.payroll_statutory_setup_resolve(profile_id,p_effective_from,null)
    ||jsonb_build_object('profile_id',profile_id,'category_version_id',category_id);
end; $$;
revoke all on function public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text) from public,anon;
grant execute on function public.payroll_initial_setup_confirm(uuid,date,text,numeric,text,jsonb,text) to authenticated;
