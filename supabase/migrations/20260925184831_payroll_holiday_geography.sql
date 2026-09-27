-- Payroll holiday definitions are shared by geography, not replicated by Legal
-- Entity. Existing entity-scoped rows remain untouched as historical overrides.
alter table public.outlets add column if not exists state_code text;
alter table public.outlets add constraint outlets_state_code_my_check
  check (state_code is null or state_code ~ '^MY-[0-9]{2}$');

-- A later outlet move must not retroactively classify a historical shift.
create table public.payroll_outlet_state_versions (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  state_code text check (state_code is null or state_code ~ '^MY-[0-9]{2}$'),
  effective_from date not null default (timezone('Asia/Kuala_Lumpur',now())::date),
  actor_employee_id uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
create index payroll_outlet_state_effective_idx on public.payroll_outlet_state_versions(outlet_id,effective_from desc,created_at desc);
alter table public.payroll_outlet_state_versions enable row level security;
revoke all on public.payroll_outlet_state_versions from public,anon,authenticated;

create or replace function public.payroll_outlet_state_capture()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_actor uuid;
begin
  if tg_op='INSERT' then
    if new.state_code is null then return new; end if;
  elsif old.state_code is not distinct from new.state_code then
    return new;
  end if;
  select e.id into v_actor from public.employees e where e.auth_user_id=auth.uid() limit 1;
  insert into public.payroll_outlet_state_versions(outlet_id,state_code,actor_employee_id)
  values(new.id,new.state_code,v_actor);
  return new;
end; $$;
create trigger payroll_outlet_state_capture after insert or update of state_code on public.outlets
  for each row execute function public.payroll_outlet_state_capture();

create or replace function public.payroll_outlet_state_immutable()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='55000',message='Outlet state history cannot be changed or deleted.';
end; $$;
create trigger payroll_outlet_state_immutable before update or delete on public.payroll_outlet_state_versions
  for each row execute function public.payroll_outlet_state_immutable();
revoke all on function public.payroll_outlet_state_capture() from public,anon,authenticated;
revoke all on function public.payroll_outlet_state_immutable() from public,anon,authenticated;

create or replace function public.payroll_holiday_save(
  p_holiday_date date,p_name text,p_scope text,p_source_note text,
  p_legal_entity_id uuid default null,p_state_code text default null,p_outlet_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_id uuid;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not public.current_user_has_all_outlet_access()
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Shared Payroll holiday authority required.';
  end if;
  if p_legal_entity_id is not null then
    raise exception using errcode='22023',message='New public holidays are shared; Legal Entity ownership is historical only.';
  end if;
  if p_holiday_date is null or nullif(btrim(p_name),'') is null or nullif(btrim(p_source_note),'') is null
    or not ((p_scope='national' and p_state_code is null and p_outlet_id is null)
      or (p_scope='state' and p_state_code ~ '^MY-[0-9]{2}$' and p_outlet_id is null)
      or (p_scope='outlet' and p_state_code is null and p_outlet_id is not null)) then
    raise exception using errcode='22023',message='Holiday date, source and valid geographic scope are required.';
  end if;
  if p_scope='outlet' and not exists(select 1 from public.outlets where id=p_outlet_id) then
    raise exception using errcode='22023',message='Outlet override requires an existing outlet.';
  end if;
  -- Do not silently stack a new shared definition on existing entity-specific
  -- evidence for the same named day and geography.
  if exists(select 1 from public.payroll_public_holidays h where h.holiday_date=p_holiday_date
      and lower(h.name)=lower(btrim(p_name)) and h.scope=p_scope
      and h.state_code is not distinct from p_state_code
      and h.outlet_id is not distinct from p_outlet_id) then
    raise exception using errcode='23505',message='This holiday already exists, including any legacy company-specific definition.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_public_holidays(holiday_date,name,scope,state_code,outlet_id,legal_entity_id,source_note,created_by_employee_id)
  values(p_holiday_date,btrim(p_name),p_scope,p_state_code,p_outlet_id,null,btrim(p_source_note),v_actor) returning id into v_id;
  insert into public.payroll_events(event_type,holiday_id,actor_employee_id,details)
  values('holiday_added',v_id,v_actor,jsonb_build_object('scope',p_scope,'state_code',p_state_code,'outlet_id',p_outlet_id,'holiday_date',p_holiday_date));
  return v_id;
end; $$;

-- Resolve state holidays only from canonical outlet state. Unknown geography
-- remains a review exception, never an inferred paid holiday.
create or replace function public.payroll_time_evidence_geo(p_employee_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_payload jsonb; v_outlet_id uuid; v_state text; v_state_version_id uuid;
  v_holiday public.payroll_public_holidays%rowtype;
  v_issues jsonb;
begin
  v_payload:=public.payroll_time_evidence_base(p_employee_id,p_work_date);
  if v_payload is null or v_payload->>'holiday_id' is not null then return v_payload; end if;
  v_outlet_id:=nullif(v_payload->>'outlet_id','')::uuid;
  select id,state_code into v_state_version_id,v_state from public.payroll_outlet_state_versions
    where outlet_id=v_outlet_id and effective_from<=p_work_date
    order by effective_from desc,created_at desc limit 1;
  if v_state is not null then
    select * into v_holiday from public.payroll_public_holidays h
      where h.is_active and h.holiday_date=p_work_date and h.scope='state'
        and h.state_code=v_state
        and (h.legal_entity_id is null or h.legal_entity_id=nullif(v_payload->>'legal_entity_id','')::uuid)
      order by case when h.legal_entity_id is not null then 0 else 1 end limit 1;
    v_issues:=coalesce(v_payload->'issue_codes','[]'::jsonb);
    select coalesce(jsonb_agg(issue.code),'[]'::jsonb) into v_issues
      from jsonb_array_elements_text(v_issues) as issue(code) where issue.code<>'state_holiday_scope_review';
    if v_holiday.id is not null then
      v_payload:=v_payload || jsonb_build_object('holiday_id',v_holiday.id,'classification','public_holiday');
      v_issues:=v_issues || '"public_holiday_review"'::jsonb;
    end if;
    v_payload:=v_payload || jsonb_build_object('issue_codes',v_issues,
      'outlet_state_version_id',v_state_version_id,'outlet_state_code',v_state);
    v_payload:=v_payload - 'source_fingerprint';
    return v_payload || jsonb_build_object('source_fingerprint',md5(v_payload::text));
  end if;
  return v_payload;
end; $$;

create or replace function public.payroll_time_evidence(p_employee_id uuid,p_work_date date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_evidence jsonb; v_latest public.payroll_payable_time_versions%rowtype; v_payload jsonb;
begin
  v_evidence:=public.payroll_time_evidence_geo(p_employee_id,p_work_date);
  if v_evidence is not null then return v_evidence; end if;
  select * into v_latest from public.payroll_payable_time_versions
    where employee_id=p_employee_id and work_date=p_work_date order by revision desc limit 1;
  if v_latest.id is null then return null; end if;
  v_payload:=jsonb_build_object(
    'employee_id',p_employee_id,'profile_id',v_latest.profile_id,'work_date',p_work_date,
    'compensation_version_id',v_latest.evidence->>'compensation_version_id',
    'pay_basis',v_latest.evidence->>'pay_basis','legal_entity_id',v_latest.evidence->>'legal_entity_id',
    'outlet_id',v_latest.evidence->>'outlet_id','roster_entry_id',null,'roster_publication_id',null,
    'roster_entry_type',null,'scheduled_start_at',null,'scheduled_end_at',null,'roster_break_minutes',null,
    'attendance_id',null,'attendance_count',0,'clock_in_at',null,'clock_out_at',null,
    'leave_id',null,'leave_type',null,'holiday_id',null,'scheduled_minutes',null,'actual_minutes',null,
    'proposed_minutes',null,'extra_candidate_minutes',0,'classification','non_payable',
    'issue_codes',jsonb_build_array('source_removed'),'calculation_version','payable-time-v1-source-removed');
  return v_payload || jsonb_build_object('source_fingerprint',md5(v_payload::text));
end; $$;

revoke all on function public.payroll_time_evidence_geo(uuid,date) from public,anon,authenticated;
revoke all on function public.payroll_time_evidence(uuid,date) from public,anon,authenticated;

-- Shared holiday definitions are visible to any authorized Payroll viewer;
-- outlet applicability is still constrained to that viewer's outlet scope.
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

-- Component identity and type never change. Treatment changes are prohibited
-- after any finalized use, because corrections must not silently recalculate
-- historical entitlement from a mutable definition. The audit event snapshots
-- both versions, so draft-only changes remain explainable.
create or replace function public.payroll_component_update(
  p_component_id uuid,p_name text,p_epf_treatment text,p_socso_treatment text,
  p_eis_treatment text,p_pcb_treatment text,p_is_active boolean,
  p_source_note text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_old public.payroll_component_definitions%rowtype;
  v_finalized_use boolean; v_new jsonb;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Payroll component settings authority required.';
  end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_reason),'') is null
    or nullif(btrim(p_source_note),'') is null or p_is_active is null
    or p_epf_treatment not in ('included','excluded','undetermined')
    or p_socso_treatment not in ('included','excluded','undetermined')
    or p_eis_treatment not in ('included','excluded','undetermined')
    or p_pcb_treatment not in ('included','excluded','undetermined') then
    raise exception using errcode='22023',message='Name, treatments, status, source and reason are required.';
  end if;
  select * into v_old from public.payroll_component_definitions where id=p_component_id for update;
  if v_old.id is null then raise exception using errcode='22023',message='Component not found.'; end if;
  select exists(select 1 from public.payroll_run_calculation_versions c
    join public.payroll_runs r on r.id=c.run_id
    where r.status in ('finalized','paid')
      and c.inputs->'components' @> jsonb_build_array(jsonb_build_object('definition',jsonb_build_object('id',p_component_id)))
  ) into v_finalized_use;
  if v_finalized_use and (v_old.name is distinct from btrim(p_name)
      or v_old.epf_treatment is distinct from p_epf_treatment
      or v_old.socso_treatment is distinct from p_socso_treatment
      or v_old.eis_treatment is distinct from p_eis_treatment
      or v_old.pcb_treatment is distinct from p_pcb_treatment) then
    raise exception using errcode='55000',message='This component is used by finalized payroll. Create a new component for changed name or statutory treatment.';
  end if;
  if v_old.name=btrim(p_name) and v_old.epf_treatment=p_epf_treatment
    and v_old.socso_treatment=p_socso_treatment and v_old.eis_treatment=p_eis_treatment
    and v_old.pcb_treatment=p_pcb_treatment and v_old.is_active=p_is_active then
    return p_component_id;
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  update public.payroll_component_definitions set name=btrim(p_name),
    epf_treatment=p_epf_treatment,socso_treatment=p_socso_treatment,
    eis_treatment=p_eis_treatment,pcb_treatment=p_pcb_treatment,is_active=p_is_active
    where id=p_component_id;
  select to_jsonb(c) into v_new from public.payroll_component_definitions c where id=p_component_id;
  insert into public.payroll_events(event_type,component_id,actor_employee_id,reason,details)
  values('component_updated',p_component_id,v_actor,btrim(p_reason),
    jsonb_build_object('before',to_jsonb(v_old),'after',v_new,'source',btrim(p_source_note)));
  return p_component_id;
end; $$;

create or replace function public.payroll_component_history_read(p_component_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_result jsonb;
begin
  perform public.payroll_admin_actor();
  if not public.current_user_has_permission('payroll.view') then
    raise exception using errcode='42501',message='Payroll view permission required.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_type',e.event_type,
    'occurred_at',e.occurred_at,'reason',e.reason,'details',e.details,
    'actor_name',actor.full_name) order by e.occurred_at desc),'[]'::jsonb) into v_result
  from public.payroll_events e join public.employees actor on actor.id=e.actor_employee_id
  where e.component_id=p_component_id;
  return v_result;
end; $$;

revoke all on function public.payroll_component_update(uuid,text,text,text,text,text,boolean,text,text) from public,anon;
grant execute on function public.payroll_component_update(uuid,text,text,text,text,text,boolean,text,text) to authenticated;
revoke all on function public.payroll_component_history_read(uuid) from public,anon;
grant execute on function public.payroll_component_history_read(uuid) to authenticated;
