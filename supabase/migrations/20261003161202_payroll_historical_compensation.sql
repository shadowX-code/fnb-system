-- Historical compensation is append-only. Same-date corrections retain the
-- original record; every effective consumer selects the latest date revision.
alter table public.payroll_compensation_versions add column revision integer not null default 1 check(revision>0);
alter table public.payroll_compensation_versions drop constraint payroll_compensation_versions_profile_id_effective_from_key;
alter table public.payroll_compensation_versions add unique(profile_id,effective_from,revision);
create function public.payroll_compensation_effective_versions()
returns setof public.payroll_compensation_versions language sql stable security definer set search_path=public as $$
 select distinct on (v.profile_id,v.effective_from) v.* from public.payroll_compensation_versions v
 order by v.profile_id,v.effective_from,v.revision desc;
$$;
revoke all on function public.payroll_compensation_effective_versions() from public,anon,authenticated;

-- Update only effective consumers. ID-based pricing and immutable snapshot reads
-- continue reading original records. Profile history retains every revision.
do $migration$
declare signature text; original text; changed text;
begin
 foreach signature in array array[
  'public.payroll_ph_work_project(uuid,uuid,date)',
  'public.payroll_employee_period_start(uuid,uuid)',
  'public.payroll_time_evidence_base(uuid,date)',
  'public.payroll_run_time_readiness(uuid)',
  'public.payroll_calculation_project(uuid,uuid)',
  'public.payroll_run_transition(uuid,text,text)'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(original,'from public.payroll_compensation_versions','from public.payroll_compensation_effective_versions()');
  if changed=original then raise exception 'Compensation consumer changed: %',signature; end if;
  execute changed;
 end loop;
end $migration$;

create or replace function public.payroll_compensation_adjust(
  p_profile_id uuid,p_effective_from date,p_pay_basis text,p_rate numeric,p_currency text,
  p_reason text,p_source_document_id uuid default null,p_default_cost_outlet_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype; v_employee public.employees%rowtype;
  v_previous public.payroll_compensation_versions%rowtype; v_document public.employee_employment_documents%rowtype; v_id uuid; v_next date; v_revision integer; v_assignment public.employee_employment_assignment_revisions%rowtype;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
  select * into v_employee from public.employees where id=v_profile.employee_id for share;
  select * into v_previous from public.payroll_compensation_versions where profile_id=p_profile_id and effective_from<=p_effective_from order by effective_from desc, revision desc limit 1;
  if p_effective_from is null or nullif(btrim(p_reason),'') is null
    or p_pay_basis not in ('monthly','hourly') or coalesce(p_rate,0)<=0
    or coalesce(p_currency,'') !~ '^[A-Z]{3}$' then
    raise exception using errcode='22023',message='An explicit effective date, reason and valid reviewed pay terms are required.';
  end if;
  v_assignment:=public.employee_employment_assignment_at(v_employee.id,p_effective_from);
  if v_assignment.id is not null then
    v_employee.legal_entity_id:=v_assignment.legal_entity_id; v_employee.workplace:=v_assignment.workplace;
  end if;
  select min(effective_from) into v_next from public.payroll_compensation_versions where profile_id=p_profile_id and effective_from>p_effective_from;
  select coalesce(max(revision),0)+1 into v_revision from public.payroll_compensation_versions where profile_id=p_profile_id and effective_from=p_effective_from;
  if v_employee.legal_entity_id is null or not exists(select 1 from public.legal_entities where id=v_employee.legal_entity_id and is_active) then
    raise exception using errcode='22023',message='An active Legal Employer is required.';
  end if;
  perform 1 from public.payroll_runs r join public.payroll_periods period on period.id=r.period_id
    where period.period_end>=p_effective_from and (v_next is null or period.period_start<v_next)
      and exists(select 1 from public.payroll_compensation_versions c where c.profile_id=p_profile_id and c.legal_entity_id=period.legal_entity_id)
    order by r.id for update of r;
  if exists(select 1 from public.payroll_run_profile_snapshots s join public.payroll_runs r on r.id=s.run_id
      join public.payroll_periods period on period.id=r.period_id
      where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from and (v_next is null or period.period_start<v_next)) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  if p_source_document_id is not null then
    select * into v_document from public.employee_employment_documents where id=p_source_document_id;
    if v_document.id is null or v_document.employee_id<>v_profile.employee_id
       or v_document.legal_entity_id_snapshot<>v_employee.legal_entity_id or v_document.status='draft' then
      raise exception using errcode='22023',message='Contract provenance does not match this employment.';
    end if;
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_compensation_versions(profile_id,effective_from,legal_entity_id,pay_basis,currency,basic_salary,hourly_rate,default_cost_outlet_id,workplace_snapshot,source_document_id,provenance,reason,approved_by_employee_id,revision)
  values(p_profile_id,p_effective_from,v_employee.legal_entity_id,p_pay_basis,p_currency,
    case when p_pay_basis='monthly' then p_rate else null end,
    case when p_pay_basis='hourly' then p_rate else null end,
    p_default_cost_outlet_id,v_employee.workplace,p_source_document_id,
    case when p_source_document_id is null then 'manual' else 'contract_reference' end,btrim(p_reason),v_actor,v_revision) returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('compensation_adjusted',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('effective_until_exclusive',v_next,'revision',v_revision,'supersedes_same_date_version_id',case when v_previous.effective_from=p_effective_from then v_previous.id end,'previous_version_id',v_previous.id,'new_version_id',v_id,
      'previous_basis',v_previous.pay_basis,'new_basis',p_pay_basis,
      'previous_rate',coalesce(v_previous.basic_salary,v_previous.hourly_rate),'new_rate',p_rate,'effective_from',p_effective_from));
  return v_id;
end; $$;

create or replace function public.payroll_profile_create(
  p_employee_id uuid,p_effective_from date,p_pay_basis text,p_rate numeric,p_currency text,
  p_reason text,p_source_document_id uuid default null,p_default_cost_outlet_id uuid default null,
  p_epf boolean default null,p_socso boolean default null,p_eis boolean default null,p_pcb boolean default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_employee public.employees%rowtype; v_profile uuid; v_document public.employee_employment_documents%rowtype; v_assignment public.employee_employment_assignment_revisions%rowtype;
begin
  if not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll profile scope denied.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for share;
  v_assignment:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);
  if v_assignment.id is not null then
    v_employee.legal_entity_id:=v_assignment.legal_entity_id; v_employee.workplace:=v_assignment.workplace;
  end if;
  if v_employee.legal_entity_id is null or not exists(select 1 from public.legal_entities where id=v_employee.legal_entity_id and is_active) then
    raise exception using errcode='22023',message='Assign an active Legal Employer before creating a Payroll Profile.';
  end if;
  if p_effective_from is null or nullif(btrim(p_reason),'') is null or p_pay_basis not in ('monthly','hourly')
     or coalesce(p_rate,0)<=0 or coalesce(p_currency,'') !~ '^[A-Z]{3}$' then
    raise exception using errcode='22023',message='Valid basis, rate, currency, effective date and reason are required.';
  end if;
  if p_default_cost_outlet_id is not null and not exists(select 1 from public.outlets where id=p_default_cost_outlet_id) then
    raise exception using errcode='22023',message='Cost outlet was not found.';
  end if;
  if p_source_document_id is not null then
    select * into v_document from public.employee_employment_documents where id=p_source_document_id;
    if v_document.id is null or v_document.employee_id<>p_employee_id or v_document.legal_entity_id_snapshot<>v_employee.legal_entity_id
      or v_document.status='draft' then
      raise exception using errcode='22023',message='Contract provenance must reference this employee and Legal Employer.';
    end if;
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_profiles(employee_id,created_by_employee_id) values(p_employee_id,v_actor) returning id into v_profile;
  insert into public.payroll_compensation_versions(profile_id,effective_from,legal_entity_id,pay_basis,currency,basic_salary,hourly_rate,default_cost_outlet_id,workplace_snapshot,source_document_id,provenance,reason,approved_by_employee_id)
  values(v_profile,p_effective_from,v_employee.legal_entity_id,p_pay_basis,p_currency,
    case when p_pay_basis='monthly' then p_rate else null end,
    case when p_pay_basis='hourly' then p_rate else null end,
    p_default_cost_outlet_id,v_employee.workplace,p_source_document_id,
    case when p_source_document_id is null then 'manual' else 'contract_reference' end,btrim(p_reason),v_actor);
  insert into public.payroll_statutory_profile_versions(profile_id,effective_from,epf_applicable,socso_applicable,eis_applicable,pcb_applicable,reason,approved_by_employee_id)
  values(v_profile,p_effective_from,p_epf,p_socso,p_eis,p_pcb,btrim(p_reason),v_actor);
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('profile_created',v_profile,v_actor,btrim(p_reason),jsonb_build_object('employee_id',p_employee_id,'pay_basis',p_pay_basis,'effective_from',p_effective_from));
  return v_profile;
end; $$;


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
    'compensation',coalesce((select jsonb_agg(to_jsonb(v) order by v.effective_from desc,v.revision desc) from public.payroll_compensation_versions v where v.profile_id=p.id),'[]'::jsonb),
    'statutory_setup',public.payroll_statutory_setup_summary(p.id,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date),
    'statutory',coalesce((select jsonb_agg(to_jsonb(s) order by s.effective_from desc) from public.payroll_statutory_profile_versions s where s.profile_id=p.id),'[]'::jsonb),
    'recurring',coalesce((select jsonb_agg(to_jsonb(c) order by c.effective_from desc) from public.payroll_recurring_component_versions c where c.profile_id=p.id),'[]'::jsonb)
  ) order by e.full_name),'[]'::jsonb) into v_profiles
  from public.payroll_profiles p join public.employees e on e.id=p.employee_id
  where (p_profile_id is null or p.id=p_profile_id)
    and public.payroll_can_access_employee(e.id,'payroll.view');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.full_name,'employee_code',e.employee_code,'joined_date',e.joined_date,
    'legal_entity_id',e.legal_entity_id,'workplace',e.workplace,
    'employment_type',e.employment_type,'employment_status',e.employment_status,
    'employment_end_date',coalesce((public.employee_employment_assignment_at(e.id,(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date)).employment_end_date,e.resigned_date),
    'legal_entity_ids',coalesce((select jsonb_agg(distinct r.legal_entity_id) from public.employee_employment_assignment_revisions r where r.employee_id=e.id and r.legal_entity_id is not null),'[]'::jsonb)||coalesce((select jsonb_agg(distinct c.legal_entity_id) from public.payroll_compensation_versions c join public.payroll_profiles p on p.id=c.profile_id where p.employee_id=e.id),'[]'::jsonb))
    order by e.full_name),'[]'::jsonb) into v_candidates
  from public.employees e where (e.legal_entity_id is not null or exists(select 1 from public.payroll_profiles p where p.employee_id=e.id) or exists(select 1 from public.employee_employment_assignment_revisions r where r.employee_id=e.id and r.legal_entity_id is not null))
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

