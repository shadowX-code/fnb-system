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

alter table public.recruitment_decisions alter column actor_employee_id drop not null;
alter table public.recruitment_decisions add column actor_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.recruitment_decisions add constraint recruitment_decisions_principal_check check(num_nonnulls(actor_employee_id,actor_machine_id)=1);

alter table public.recruitment_events add column actor_machine_id uuid references feedx_integrations.machine_identities(id);

alter table public.employee_compliance_reviews alter column reviewed_by drop not null;
alter table public.employee_compliance_reviews add column reviewed_by_machine_id uuid references feedx_integrations.machine_identities(id);
alter table public.employee_compliance_reviews add constraint employee_compliance_review_principal check(num_nonnulls(reviewed_by,reviewed_by_machine_id)=1);
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

do $$ begin if md5(pg_get_functiondef('employee_compliance_review(uuid,text,text)'::regprocedure))<>'18b9104cb4130f56c18dba9e0dfc88b9' then raise exception 'HR business authority changed: employee_compliance_review'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_employee_compliance_review(p_machine uuid, p_submission_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_submission public.employee_compliance_submissions%rowtype; v_review public.employee_compliance_reviews%rowtype;
begin
  if not feedx_integrations.hr_actor_can(p_machine,'employee_compliance.review') then raise exception using errcode='42501',message='Missing permission to review compliance.'; end if;
  if p_decision not in ('verified','rejected') then raise exception using errcode='22023',message='Choose Verify or Reject.'; end if;
  if p_decision='rejected' and nullif(btrim(p_rejection_reason),'') is null then raise exception using errcode='22023',message='Rejection reason is required.'; end if;
  select * into v_submission from public.employee_compliance_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception using errcode='22023',message='Submission was not found.'; end if;
  if not (case when p_machine is null then public.employee_compliance_admin_can_access_employee(v_submission.employee_id) else feedx_integrations.hr_actor_employee(p_machine,v_submission.employee_id) end) then raise exception using errcode='42501',message='Submission is outside your outlet scope.'; end if;
  if exists(select 1 from public.employee_compliance_reviews where submission_id=p_submission_id) then raise exception using errcode='23505',message='Submission was already reviewed.'; end if;
  insert into public.employee_compliance_reviews(submission_id,decision,rejection_reason,reviewed_by,reviewed_by_machine_id)
  values(p_submission_id,p_decision,case when p_decision='rejected' then btrim(p_rejection_reason) end,auth.uid(),p_machine) returning * into v_review;
  return jsonb_build_object('review_id',v_review.id,'submission_id',p_submission_id,'decision',p_decision,'reviewed_at',v_review.reviewed_at);
end; $function$;

revoke all on function feedx_integrations.hr_employee_compliance_review(uuid,uuid,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.employee_compliance_review(p_submission_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_employee_compliance_review(null,p_submission_id,p_decision,p_rejection_reason); $function$;

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

do $$ begin if md5(pg_get_functiondef('recruitment_decide(uuid,uuid,text,text,text,jsonb,uuid)'::regprocedure))<>'b1e5fe341acc621c7f1c55485a2e1dbb' then raise exception 'HR business authority changed: recruitment_decide'; end if;end $$;

CREATE OR REPLACE FUNCTION feedx_integrations.hr_recruitment_decide(p_machine uuid, p_application_id uuid, p_request_id uuid, p_expected_state text, p_decision text, p_reason text DEFAULT ''::text, p_hire jsonb DEFAULT NULL::jsonb, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=case when p_machine is null then recruitment_actor('recruitment.manage') else null end; a recruitment_applications%rowtype; o recruitment_openings%rowtype; prior recruitment_decisions%rowtype; eid uuid; jp job_positions%rowtype; workplace_name text; fp text; name text; contact_value text; identity_no text; start_date date; named_duplicate boolean;
begin
 if p_machine is not null and (not feedx_integrations.hr_actor_can(p_machine,'recruitment.manage') or p_decision='hired' or p_report_id is not null) then raise exception using errcode='42501',message='Hiring and report-review authority remains Human-owned';end if;
 if p_request_id is null or p_decision not in ('shortlisted','final_interview','rejected','hired') or length(coalesce(p_reason,''))>1000 then raise exception using errcode='22023',message='Invalid decision request.'; end if;
 fp:=encode(extensions.digest(jsonb_build_object('app',p_application_id,'expected',p_expected_state,'decision',p_decision,'reason',coalesce(p_reason,''),'hire',p_hire,'report',p_report_id)::text,'sha256'),'hex');
 select * into a from recruitment_applications where id=p_application_id for update;
 select * into o from recruitment_openings where id=a.opening_id;
 if a.id is null or not (case when p_machine is null then recruitment_opening_in_scope(o.outlet_id) else feedx_integrations.hr_actor_all(p_machine) or (o.outlet_id is not null and feedx_integrations.restaurant_actor_outlet(p_machine,o.outlet_id)) end) then raise exception using errcode='42501',message='Application unavailable.'; end if;
 select * into prior from recruitment_decisions where request_id=p_request_id;
 if found then if prior.fingerprint<>fp or prior.actor_employee_id is distinct from actor or prior.actor_machine_id is distinct from p_machine then raise exception using errcode='22023',message='Conflicting decision retry.'; end if; return jsonb_build_object('state',prior.to_state,'employee_id',prior.employee_id); end if;
 if a.decision_state is distinct from p_expected_state or a.decision_state in ('hired','rejected') or
 (p_decision='shortlisted' and a.decision_state<>'review') or (p_decision='final_interview' and a.decision_state<>'shortlisted') or (p_decision='hired' and a.decision_state not in ('shortlisted','final_interview')) then raise exception using errcode='55000',message='Application changed or transition is unavailable. Refresh the review.'; end if;
 if exists(select 1 from recruitment_interview_attempts where application_id=a.id and status in ('starting','interviewing','finalizing','interrupted')) then raise exception using errcode='55000',message='End the active interview before deciding.'; end if;
 if p_report_id is not null then
   if not exists(select 1 from recruitment_reports r join recruitment_interview_attempts t on t.id=r.attempt_id where r.id=p_report_id and t.application_id=a.id and r.status in ('ready','unusable')) then raise exception 'Report does not belong to this application.'; end if;
   perform recruitment_report_review(p_report_id);
 end if;
 if p_decision='hired' then
   if not current_user_has_permission('employees.create') or not current_user_has_permission('employees.view') or (o.outlet_id is null and not current_user_has_all_outlet_access()) then raise exception using errcode='42501',message='Employee creation and workplace access required.'; end if;
   -- Serialize applicant conversions and person matching across concurrent applications.
   perform 1 from recruitment_applicants where id=a.applicant_id for update;
   perform pg_advisory_xact_lock(hashtextextended('people-recruitment-hire',0));
   if exists(select 1 from recruitment_hire_conversions where applicant_id=a.applicant_id) then raise exception using errcode='23505',message='Applicant already converted to an Employee. Continue in People.'; end if;
   name:=btrim(p_hire->>'full_name'); contact_value:=btrim(p_hire->>'contact'); identity_no:=nullif(btrim(p_hire->>'ic_no'),''); start_date:=(p_hire->>'joined_date')::date;
   if coalesce(length(name),0) not between 2 and 160 or coalesce(length(contact_value),0) not between 5 and 40 or coalesce(length(btrim(p_hire->>'nationality')),0) not between 2 and 80 or start_date is null or start_date>timezone('Asia/Kuala_Lumpur',clock_timestamp())::date or coalesce(p_hire->>'employment_type','') not in ('probation','full_time','part_time','intern','contract') then raise exception using errcode='22023',message='Confirm name, contact, nationality, employment type and a start date on or before today. Future starters are converted when employment begins.'; end if;
   if exists(select 1 from employees e where (identity_no is not null and regexp_replace(lower(coalesce(e.ic_no,'')),'[^a-z0-9]','','g')=regexp_replace(lower(identity_no),'[^a-z0-9]','','g')) or (length(regexp_replace(contact_value,'[^0-9]','','g'))>=5 and recruitment_person_contact_key(e.contact)=recruitment_person_contact_key(contact_value))) then raise exception using errcode='23505',message='Matching Employee identity or contact found. Resolve the person in People before Hire; no duplicate Employee was created.'; end if;
   select exists(select 1 from employees where lower(btrim(full_name))=lower(name)) into named_duplicate;
   if named_duplicate and coalesce(length(btrim(p_hire->>'duplicate_name_reason')),0)<10 then raise exception using errcode='23505',message='An Employee has this name. Confirm they are different people and record a concise explanation.'; end if;
   select * into jp from job_positions where id=o.position_id and status='active';
   if jp.id is null or not exists(select 1 from legal_entities where id=o.legal_entity_id and is_active) then raise exception 'Opening Position or Legal Employer is inactive. Resolve in People.'; end if;
   workplace_name:=o.workplace;
   if o.outlet_id is not null then select outlets.name into workplace_name from outlets where id=o.outlet_id and is_active; end if;
   if workplace_name is null then raise exception 'Opening Workplace is inactive.'; end if;
   -- Same canonical table/after-insert baseline and workforce mirror triggers as ordinary People creation.
   insert into employees(full_name,contact,ic_no,nationality,joined_date,employment_type,employment_status,position,department,workplace,legal_entity_id,enable_system_login,access_state,created_by)
   values(name,contact_value,identity_no,btrim(p_hire->>'nationality'),start_date,p_hire->>'employment_type','active',jp.name,jp.department,workplace_name,o.legal_entity_id,false,'no_access',auth.uid()) returning id into eid;
   insert into audit_logs(action,module,user_id,user_name,description,metadata) values('employee_created','people',auth.uid(),(select full_name from employees where id=actor),'Employee created through manager Recruitment Hire.',jsonb_build_object('employee_id',eid,'application_id',a.id,'request_id',p_request_id,'same_name_clarification',case when named_duplicate then p_hire->>'duplicate_name_reason' end));
 end if;
 insert into recruitment_decisions(request_id,application_id,actor_employee_id,actor_machine_id,from_state,to_state,reason,fingerprint,report_id,employee_id) values(p_request_id,a.id,actor,p_machine,a.decision_state,p_decision,coalesce(p_reason,''),fp,p_report_id,eid);
 if eid is not null then insert into recruitment_hire_conversions(applicant_id,application_id,employee_id,request_id) values(a.applicant_id,a.id,eid,p_request_id); end if;
 update recruitment_applications set decision_state=p_decision,employee_id=eid where id=a.id;
 insert into recruitment_events(opening_id,application_id,action,actor_employee_id,actor_machine_id,details) values(a.opening_id,a.id,'manager_decision',actor,p_machine,jsonb_build_object('from',a.decision_state,'to',p_decision,'request_id',p_request_id,'report_id',p_report_id,'employee_id',eid,'reason',coalesce(p_reason,'')));
 if p_decision in ('hired','rejected') then update recruitment_invitations set revoked_at=clock_timestamp() where application_id=a.id and revoked_at is null; end if;
 return jsonb_build_object('state',p_decision,'employee_id',eid);
end $function$;

revoke all on function feedx_integrations.hr_recruitment_decide(uuid,uuid,uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.recruitment_decide(p_application_id uuid, p_request_id uuid, p_expected_state text, p_decision text, p_reason text DEFAULT ''::text, p_hire jsonb DEFAULT NULL::jsonb, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select feedx_integrations.hr_recruitment_decide(null,p_application_id,p_request_id,p_expected_state,p_decision,p_reason,p_hire,p_report_id); $function$;

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