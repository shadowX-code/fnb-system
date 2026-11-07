-- Explicit machine principals; Human APIs delegate to the same canonical bodies.
-- Machine credentials never become Auth/Employee identities.
create function feedx_integrations.hr_actor_all(p_machine uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.current_user_has_all_outlet_access() else exists(select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id where m.id=p_machine and m.enabled and r.is_active and lower(r.name) not in ('owner','admin') and r.outlet_access_type='all') end;
$$;
create function feedx_integrations.hr_actor_can(p_machine uuid,p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.current_user_has_permission(p_permission) else exists(select 1 from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id join public.role_permissions rp on rp.role_id=r.id join public.permissions p on p.id=rp.permission_id join feedx_integrations.capabilities c on c.permission_code=p.code and c.workspace='HR' and c.implemented join feedx_integrations.factory_actions a on a.key=c.tool_id where m.id=p_machine and m.enabled and r.is_active and lower(r.name) not in ('owner','admin') and a.human_permission=p_permission) end;
$$;
create function feedx_integrations.hr_actor_workplace(p_machine uuid,p_workplace text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select feedx_integrations.hr_actor_all(p_machine) or exists(select 1 from public.outlets o where lower(p_workplace) in (lower(o.name),lower(coalesce(o.code,''))) and feedx_integrations.restaurant_actor_outlet(p_machine,o.id));
$$;
create function feedx_integrations.hr_actor_employee(p_machine uuid,p_employee uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.employees e where e.id=p_employee and feedx_integrations.hr_actor_workplace(p_machine,e.workplace));
$$;
create function feedx_integrations.hr_actor_entity(p_machine uuid,p_entity uuid,p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.payroll_can_manage_entity(p_entity,p_permission) else feedx_integrations.hr_actor_can(p_machine,p_permission) and feedx_integrations.hr_actor_all(p_machine) and exists(select 1 from public.legal_entities where id=p_entity) end;
$$;
create function feedx_integrations.hr_actor_run_employee(p_machine uuid,p_run uuid,p_employee uuid,p_permission text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select case when p_machine is null then public.payroll_can_access_run_employee(p_run,p_employee,p_permission) else exists(select 1 from public.payroll_runs r join public.payroll_periods p on p.id=r.period_id join public.payroll_run_employee_ids(p_run) e on e.employee_id=p_employee where r.id=p_run and feedx_integrations.hr_actor_entity(p_machine,p.legal_entity_id,p_permission)) end;
$$;


revoke all on function feedx_integrations.hr_actor_all(uuid) from public,anon,authenticated;

revoke all on function feedx_integrations.hr_actor_can(uuid,text) from public,anon,authenticated;

revoke all on function feedx_integrations.hr_actor_workplace(uuid,text) from public,anon,authenticated;

revoke all on function feedx_integrations.hr_actor_employee(uuid,uuid) from public,anon,authenticated;

revoke all on function feedx_integrations.hr_actor_entity(uuid,uuid,text) from public,anon,authenticated;

revoke all on function feedx_integrations.hr_actor_run_employee(uuid,uuid,uuid,text) from public,anon,authenticated;

alter table public.payroll_events alter column actor_employee_id drop not null;
alter table public.payroll_events add column actor_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.payroll_events add constraint payroll_events_principal_check check(num_nonnulls(actor_employee_id,actor_machine_id)=1);

alter table public.payroll_runs alter column created_by_employee_id drop not null;
alter table public.payroll_runs add column created_by_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.payroll_runs add constraint payroll_runs_principal_check check(num_nonnulls(created_by_employee_id,created_by_machine_id)=1);

alter table public.payroll_run_component_adjustments alter column actor_employee_id drop not null;
alter table public.payroll_run_component_adjustments add column actor_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.payroll_run_component_adjustments add constraint payroll_run_component_adjustments_principal_check check(num_nonnulls(actor_employee_id,actor_machine_id)=1);



alter table public.employee_employment_assignment_revisions add column recorded_by_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.employee_employment_assignment_revisions drop constraint employee_employment_assignment_revisions_source_kind_check;
alter table public.employee_employment_assignment_revisions add constraint employee_employment_assignment_revisions_source_kind_check check(source_kind in ('cutover_current','new_employee','admin_change','machine_change'));
alter table public.employee_employment_assignment_revisions add constraint employee_employment_machine_principal check((source_kind='machine_change' and recorded_by_machine_id is not null and recorded_by_employee_id is null) or (source_kind<>'machine_change' and recorded_by_machine_id is null));
alter table public.employee_employment_assignment_revisions add constraint employee_employment_machine_fields check(source_kind<>'machine_change' or (nullif(btrim(position),'') is not null and nullif(btrim(workplace),'') is not null));
alter table public.legal_entities alter column created_by_employee_id drop not null;
alter table public.legal_entities alter column updated_by_employee_id drop not null;
alter table public.legal_entities add column created_by_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.legal_entities add column updated_by_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.legal_entities add constraint legal_entities_created_principal check(num_nonnulls(created_by_employee_id,created_by_machine_id)=1);
alter table public.legal_entities add constraint legal_entities_updated_principal check(num_nonnulls(updated_by_employee_id,updated_by_machine_id)=1);


do $$ begin if md5(pg_get_functiondef('employee_employment_assignment_save(uuid,date,jsonb,text,uuid,text)'::regprocedure))<>'5e2eec1721641988d51bf51eb9f4f045' then raise exception 'HR business authority changed: employee_employment_assignment_save'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_employee_employment_assignment_save(p_machine uuid, p_employee_id uuid, p_effective_from date, p_assignment jsonb, p_reason text, p_expected_revision_id uuid, p_evidence_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_employee public.employees%rowtype; v_prior public.employee_employment_assignment_revisions%rowtype;
  v_same_date public.employee_employment_assignment_revisions%rowtype; v_next public.employee_employment_assignment_revisions%rowtype;
  v_new public.employee_employment_assignment_revisions%rowtype;
  v_actor uuid; v_type text; v_status text; v_position text; v_workplace text;
  v_entity uuid; v_end date; v_cutover date; v_verified_from date; v_historical_baseline boolean; v_jurisdiction text;
begin
  if (p_machine is null and auth.uid() is null) or not feedx_integrations.hr_actor_can(p_machine,'employees.edit') then
    raise exception using errcode='42501',message='Employment assignment permission denied.';
  end if;
  if p_effective_from is null or p_assignment is null or jsonb_typeof(p_assignment)<>'object'
    or not p_assignment ?& array['employment_type','employment_status','position','legal_entity_id','workplace']
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))<3
    or length(btrim(p_reason))>500 then
    raise exception using errcode='22023',message='Complete assignment, effective date and reason are required.';
  end if;
  select * into v_employee from public.employees where id=p_employee_id for update;
  if v_employee.id is null then raise exception using errcode='P0002',message='Employee is unavailable.'; end if;
  if not feedx_integrations.hr_actor_workplace(p_machine,v_employee.workplace) then
    raise exception using errcode='42501',message='Current Employee workplace is outside your scope.';
  end if;
  v_type:=nullif(btrim(p_assignment->>'employment_type'),'');
  v_status:=nullif(btrim(p_assignment->>'employment_status'),'');
  v_position:=nullif(btrim(p_assignment->>'position'),'');
  v_workplace:=nullif(btrim(p_assignment->>'workplace'),'');
  v_entity:=nullif(p_assignment->>'legal_entity_id','')::uuid;
  if v_type is null then raise exception using errcode='22023',message='Employment Type is required.'; end if;
  if v_status is null then raise exception using errcode='22023',message='Employment Status is required.'; end if;
  if v_position is null then raise exception using errcode='22023',message='Position is required.'; end if;
  if v_workplace is null then raise exception using errcode='22023',message='Workplace is required.'; end if;
  if v_type not in ('probation','full_time','part_time','intern','contract')
    or v_status not in ('active','resigned','terminated') then
    raise exception using errcode='22023',message='Employment assignment is invalid.';
  end if;
  if not feedx_integrations.hr_actor_workplace(p_machine,v_workplace) then
    raise exception using errcode='42501',message='New workplace is outside your scope.';
  end if;
  if v_entity is not null and not exists
    (select 1 from public.legal_entities le where le.id=v_entity and le.is_active) then
    raise exception using errcode='22023',message='Choose an active legal employer.';
  end if;
  select min(effective_from) into v_cutover from public.employee_employment_assignment_revisions
    where employee_id=p_employee_id and source_kind in ('cutover_current','new_employee');
  if v_cutover is null then
    raise exception using errcode='22023',message='No verified employment baseline exists for this employee.';
  end if;
  select min(r.effective_from) into v_verified_from
    from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id);
  v_historical_baseline:=p_effective_from<v_verified_from;
  if v_historical_baseline and v_employee.joined_date is not null
    and p_effective_from<v_employee.joined_date then
    raise exception using errcode='22023',message='Effective date cannot precede this employee''s Joined Date.';
  end if;
  v_prior:=public.employee_employment_assignment_at(p_employee_id,p_effective_from);
  v_jurisdiction:=case when p_assignment ? 'employment_jurisdiction' then nullif(p_assignment->>'employment_jurisdiction','')
    when (v_entity,v_workplace) is not distinct from (v_prior.legal_entity_id,v_prior.workplace) then v_prior.employment_jurisdiction
    else null end;
  if v_jurisdiction is not null and v_jurisdiction not in ('peninsular_labuan','sabah','sarawak','unresolved') then
    raise exception using errcode='22023',message='Choose a supported Employment Jurisdiction.';
  end if;
  if v_historical_baseline then
    select * into v_next from public.employee_employment_assignment_revisions r
      where r.employee_id=p_employee_id and r.effective_from>p_effective_from
        and not exists (select 1 from public.employee_employment_assignment_revisions newer
          where newer.supersedes_revision_id=r.id)
      order by r.effective_from,r.recorded_at desc,r.id desc limit 1;
  end if;
  if v_prior.id is distinct from p_expected_revision_id then
    raise exception using errcode='40001',message='Employment assignment changed. Review the latest timeline.';
  end if;
  if v_status='active' then v_end:=null;
  elsif v_prior.employment_status=v_status then v_end:=v_prior.employment_end_date;
  else v_end:=p_effective_from; end if;
  if (v_type,v_status,v_position,v_entity,v_workplace,v_end,v_jurisdiction) is not distinct from
     (v_prior.employment_type,v_prior.employment_status,v_prior.position,
      v_prior.legal_entity_id,v_prior.workplace,v_prior.employment_end_date,v_prior.employment_jurisdiction) then
    raise exception using errcode='22023',message='No Employment assignment change was made.';
  end if;
  select * into v_same_date from public.employee_employment_assignment_revisions r
    where r.employee_id=p_employee_id and r.effective_from=p_effective_from
      and not exists (select 1 from public.employee_employment_assignment_revisions newer
        where newer.supersedes_revision_id=r.id)
    order by r.recorded_at desc limit 1;
  select e.id into v_actor from public.employees e where e.auth_user_id=auth.uid() limit 1;
  if v_actor is null and p_machine is null then
    raise exception using errcode='42501',message='Employment change requires an Employee-linked Admin.';
  end if;
  insert into public.employee_employment_assignment_revisions
    (employee_id,effective_from,employment_type,employment_status,position,legal_entity_id,
     workplace,employment_end_date,employment_jurisdiction,source_kind,reason,evidence_reference,
     corrects_revision_id,supersedes_revision_id,recorded_by_employee_id,recorded_by_machine_id)
  values (p_employee_id,p_effective_from,v_type,v_status,v_position,v_entity,
    v_workplace,v_end,v_jurisdiction,case when p_machine is null then 'admin_change' else 'machine_change' end,btrim(p_reason),nullif(btrim(p_evidence_reference),''),
    case when v_historical_baseline then v_next.id
      when p_effective_from<timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
        or v_same_date.id is not null then v_prior.id else null end,
    v_same_date.id,v_actor,p_machine)
  returning * into v_new;
  if p_effective_from<=timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date then
    perform public.employee_employment_apply_projection(p_employee_id);
  end if;
  if v_historical_baseline then
    insert into public.audit_logs(action,module,user_id,description,metadata)
    values ('employee_employment_historical_baseline_corrected','people',auth.uid(),
      'Admin established an earlier verified employment assignment.',
      jsonb_build_object('employee_id',p_employee_id,'actor_employee_id',v_actor,'actor_machine_id',p_machine,
        'revision_id',v_new.id,'corrects_revision_id',v_new.corrects_revision_id,
        'previous_verified_from',v_verified_from,'verified_from',p_effective_from,
        'reason',v_new.reason,'evidence_reference',v_new.evidence_reference));
  end if;
  return jsonb_build_object('revision',to_jsonb(v_new),
    'projection_state',case when p_effective_from>timezone('Asia/Kuala_Lumpur',transaction_timestamp())::date
      then 'scheduled' else 'current' end);
end $function$;

revoke all on function feedx_integrations.hr_employee_employment_assignment_save(uuid,uuid,date,jsonb,text,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.employee_employment_assignment_save(p_employee_id uuid, p_effective_from date, p_assignment jsonb, p_reason text, p_expected_revision_id uuid, p_evidence_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_employee_employment_assignment_save(null,p_employee_id,p_effective_from,p_assignment,p_reason,p_expected_revision_id,p_evidence_reference); $function$;

do $$ begin if md5(pg_get_functiondef('payroll_run_create(uuid,date,date,text,uuid)'::regprocedure))<>'f3fe06289c37643b587b7b884ecdc680' then raise exception 'HR business authority changed: payroll_run_create'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_create(p_machine uuid, p_legal_entity_id uuid, p_period_start date, p_period_end date, p_reason text, p_supersedes_run_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_period public.payroll_periods%rowtype; v_parent public.payroll_runs%rowtype; v_id uuid; v_revision integer;
begin
  if not feedx_integrations.hr_actor_entity(p_machine,p_legal_entity_id,'payroll.prepare') then
    raise exception using errcode='42501',message='Legal Entity Payroll Run authority required.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start
    or date_trunc('month',p_period_start)::date<>p_period_start
    or p_period_end<>(p_period_start+interval '1 month' - interval '1 day')::date
    or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='A complete calendar month and reason are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_periods(legal_entity_id,period_start,period_end)
  values(p_legal_entity_id,p_period_start,p_period_end)
  on conflict(legal_entity_id,period_start,period_end) do nothing;
  select * into v_period from public.payroll_periods
    where legal_entity_id=p_legal_entity_id and period_start=p_period_start and period_end=p_period_end for update;
  if exists(select 1 from public.payroll_runs where period_id=v_period.id and status in ('draft','review_required','ready')) then
    raise exception using errcode='23505',message='An open run already exists for this period.';
  end if;
  if p_supersedes_run_id is null and v_period.current_finalized_run_id is not null then
    raise exception using errcode='55000',message='A correction must reference the current finalized run.';
  end if;
  if p_supersedes_run_id is not null then
    select * into v_parent from public.payroll_runs where id=p_supersedes_run_id and period_id=v_period.id and status='finalized';
    if v_parent.id is null or v_period.current_finalized_run_id is distinct from v_parent.id then
      raise exception using errcode='55000',message='Correction must supersede the current finalized run.';
    end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.payroll_runs where period_id=v_period.id;
  insert into public.payroll_runs(period_id,revision,supersedes_run_id,reason,created_by_employee_id,created_by_machine_id)
  values(v_period.id,v_revision,p_supersedes_run_id,btrim(p_reason),v_actor,p_machine) returning id into v_id;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,reason,details)
  values(case when p_supersedes_run_id is null then 'run_created' else 'correction_draft_created' end,
    v_id,v_actor,p_machine,btrim(p_reason),jsonb_build_object('period_id',v_period.id,'supersedes_run_id',p_supersedes_run_id));
  return v_id;
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_create(uuid,uuid,date,date,text,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_create(p_legal_entity_id uuid, p_period_start date, p_period_end date, p_reason text, p_supersedes_run_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_payroll_run_create(null,p_legal_entity_id,p_period_start,p_period_end,p_reason,p_supersedes_run_id); $function$;

do $$ begin if md5(pg_get_functiondef('payroll_run_component_add(uuid,uuid,uuid,uuid,numeric,text)'::regprocedure))<>'505ea792dbf53ae17133458f6906755c' then raise exception 'HR business authority changed: payroll_run_component_add'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_component_add(p_machine uuid, p_request_id uuid, p_run_id uuid, p_employee_id uuid, p_component_id uuid, p_amount numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_component public.payroll_component_definitions%rowtype;
  v_existing public.payroll_run_component_adjustments%rowtype;
begin
  if p_request_id is null then raise exception using errcode='22023',message='Request identity is required.'; end if;
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.adjust')
    or not feedx_integrations.hr_actor_run_employee(p_machine,p_run_id,p_employee_id,'payroll.adjust') then
    raise exception using errcode='42501',message='Payroll adjustment authority denied.';
  end if;
  select * into v_existing from public.payroll_run_component_adjustments where id=p_request_id;
  if v_existing.id is not null then
    if v_existing.run_id=p_run_id and v_existing.employee_id=p_employee_id
      and v_existing.component_id=p_component_id and v_existing.amount=p_amount
      and v_existing.reason=btrim(p_reason) and v_existing.reverses_id is null then
      return v_existing.id;
    end if;
    raise exception using errcode='23505',message='Request identity was already used for another adjustment.';
  end if;
  if v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Adjustments require an open Draft or Review Required Run.';
  end if;
  select * into v_component from public.payroll_component_definitions where id=p_component_id and is_active;
  if v_component.id is null or v_component.component_type not in
    ('earning','allowance','deduction','reimbursement') or coalesce(p_amount,0)<=0
    or char_length(btrim(coalesce(p_reason,'')))<3
    or not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
      where member.employee_id=p_employee_id) then
    raise exception using errcode='22023',message='Reviewed component, amount, employee and reason are required.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_component_adjustments
    (id,run_id,employee_id,component_id,amount,reason,actor_employee_id,actor_machine_id)
  values(p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,btrim(p_reason),v_actor,p_machine);
  insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,reason,details)
  values('run_component_added',p_run_id,v_actor,p_machine,btrim(p_reason),
    jsonb_build_object('adjustment_id',p_request_id,'employee_id',p_employee_id,
      'component_id',p_component_id,'amount',p_amount));
  return p_request_id;
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_component_add(uuid,uuid,uuid,uuid,uuid,numeric,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_component_add(p_request_id uuid, p_run_id uuid, p_employee_id uuid, p_component_id uuid, p_amount numeric, p_reason text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_payroll_run_component_add(null,p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,p_reason); $function$;

do $$ begin if md5(pg_get_functiondef('payroll_run_component_reverse(uuid,uuid,text)'::regprocedure))<>'93855d5832c84d9cd210a4985d87c608' then raise exception 'HR business authority changed: payroll_run_component_reverse'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_payroll_run_component_reverse(p_machine uuid, p_request_id uuid, p_adjustment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.payroll_admin_actor() else null end; v_source public.payroll_run_component_adjustments%rowtype;
  v_existing public.payroll_run_component_adjustments%rowtype;
  v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
begin
  if p_request_id is null then raise exception using errcode='22023',message='Request identity is required.'; end if;
  select * into v_source from public.payroll_run_component_adjustments
    where id=p_adjustment_id and reverses_id is null for update;
  if v_source.id is null then raise exception using errcode='P0002',message='Payroll adjustment not found.'; end if;
  select * into v_run from public.payroll_runs where id=v_source.run_id for update;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not feedx_integrations.hr_actor_entity(p_machine,v_period.legal_entity_id,'payroll.adjust')
    or not feedx_integrations.hr_actor_run_employee(p_machine,v_source.run_id,v_source.employee_id,'payroll.adjust') then
    raise exception using errcode='42501',message='Payroll adjustment authority denied.';
  end if;
  select * into v_existing from public.payroll_run_component_adjustments where id=p_request_id;
  if v_existing.id is not null then
    if v_existing.reverses_id=p_adjustment_id and v_existing.reason=btrim(p_reason) then
      return v_existing.id;
    end if;
    raise exception using errcode='23505',message='Request identity was already used.';
  end if;
  if v_run.status not in ('draft','review_required')
    or char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='55000',message='Only an open Run adjustment may be reversed with a reason.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_component_adjustments
    (id,run_id,employee_id,amount,reverses_id,reason,actor_employee_id,actor_machine_id)
  values(p_request_id,v_source.run_id,v_source.employee_id,0,p_adjustment_id,btrim(p_reason),v_actor,p_machine);
  insert into public.payroll_events(event_type,run_id,actor_employee_id,actor_machine_id,reason,details)
  values('run_component_reversed',v_source.run_id,v_actor,p_machine,btrim(p_reason),
    jsonb_build_object('adjustment_id',p_adjustment_id,'reversal_id',p_request_id));
  return p_request_id;
end; $function$;

revoke all on function feedx_integrations.hr_payroll_run_component_reverse(uuid,uuid,uuid,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.payroll_run_component_reverse(p_request_id uuid, p_adjustment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_payroll_run_component_reverse(null,p_request_id,p_adjustment_id,p_reason); $function$;

do $$ begin if md5(pg_get_functiondef('legal_entity_save(uuid,jsonb)'::regprocedure))<>'de76866c5c679a7ea0f4b80cfca403d7' then raise exception 'HR business authority changed: legal_entity_save'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_legal_entity_save(p_machine uuid, p_legal_entity_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=case when p_machine is null then public.employment_documents_current_admin_employee() else null end; v_row public.legal_entities%rowtype;
begin
  if not (feedx_integrations.hr_actor_can(p_machine,'legal_entities.manage') and (p_machine is null or feedx_integrations.hr_actor_all(p_machine))) then raise exception using errcode='42501',message='Missing permission to manage legal entities.'; end if;
  if nullif(btrim(p_payload->>'legal_company_name'),'') is null or nullif(btrim(p_payload->>'company_registration_no'),'') is null or nullif(btrim(p_payload->>'registered_address'),'') is null then
    raise exception using errcode='22023',message='Legal company name, registration number and registered address are required.';
  end if;
  if p_legal_entity_id is null then
    insert into public.legal_entities(legal_company_name,company_registration_no,registered_address,display_name,is_active,created_by_employee_id,updated_by_employee_id,created_by_machine_id,updated_by_machine_id)
    values(btrim(p_payload->>'legal_company_name'),btrim(p_payload->>'company_registration_no'),btrim(p_payload->>'registered_address'),nullif(btrim(p_payload->>'display_name'),''),coalesce((p_payload->>'is_active')::boolean,true),v_actor,v_actor,p_machine,p_machine) returning * into v_row;
  else
    update public.legal_entities set legal_company_name=btrim(p_payload->>'legal_company_name'),company_registration_no=btrim(p_payload->>'company_registration_no'),registered_address=btrim(p_payload->>'registered_address'),display_name=nullif(btrim(p_payload->>'display_name'),''),is_active=coalesce((p_payload->>'is_active')::boolean,is_active),updated_by_employee_id=v_actor,updated_by_machine_id=p_machine,updated_at=clock_timestamp() where id=p_legal_entity_id returning * into v_row;
    if v_row.id is null then raise exception using errcode='P0002',message='Legal entity was not found.'; end if;
  end if;
  return to_jsonb(v_row);
exception when unique_violation then raise exception using errcode='23505',message='Company registration number is already in use.';
end; $function$;

revoke all on function feedx_integrations.hr_legal_entity_save(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.legal_entity_save(p_legal_entity_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_legal_entity_save(null,p_legal_entity_id,p_payload); $function$;

CREATE OR REPLACE FUNCTION public.employee_employment_assignment_validate_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prior public.employee_employment_assignment_revisions%rowtype;
begin
  if new.source_kind not in ('admin_change','machine_change') then return new; end if;
  v_prior:=public.employee_employment_assignment_at(new.employee_id,new.effective_from);
  if new.position is distinct from v_prior.position
    and not exists (select 1 from public.job_positions jp
      where jp.name=new.position and jp.status='active') then
    raise exception using errcode='22023',message='Choose an active Job Position.';
  end if;
  if new.workplace is distinct from v_prior.workplace
    and lower(new.workplace) not in ('factory','management')
    and not exists (select 1 from public.outlets o where o.is_active
      and lower(new.workplace) in (lower(o.name),lower(coalesce(o.code,'')))) then
    raise exception using errcode='22023',message='Choose an active Workplace.';
  end if;
  return new;
end $function$
;

notify pgrst,'reload schema';