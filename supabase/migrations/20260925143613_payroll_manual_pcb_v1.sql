-- Payroll V1: PCB/MTD is a confirmed statutory employee deduction. Its
-- evidence is separate from generic deductions and the result-line contract
-- remains scheme='pcb' so a future automatic method can replace the source.
create table public.payroll_run_pcb_confirmations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  period_id uuid not null references public.payroll_periods(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  revision integer not null check(revision>0),
  supersedes_id uuid references public.payroll_run_pcb_confirmations(id) on delete restrict,
  amount numeric(14,2) not null check(amount>=0),
  method text not null default 'manual_confirmed' check(method='manual_confirmed'),
  source_reference text check(source_reference is null or char_length(btrim(source_reference)) between 3 and 500),
  note text check(note is null or char_length(btrim(note)) between 3 and 1000),
  reason text not null check(char_length(btrim(reason)) between 3 and 1000),
  confirmed_by_employee_id uuid not null references public.employees(id) on delete restrict,
  confirmed_at timestamptz not null default clock_timestamp(),
  unique(run_id,employee_id,revision)
);
create index payroll_run_pcb_current_idx
  on public.payroll_run_pcb_confirmations(run_id,employee_id,revision desc);
alter table public.payroll_run_pcb_confirmations enable row level security;
revoke all on public.payroll_run_pcb_confirmations from public,anon,authenticated;
create trigger payroll_command_guard before insert or update or delete
  on public.payroll_run_pcb_confirmations for each row
  execute function public.payroll_command_guard();

create or replace function public.payroll_command_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('feedx.payroll_command',true) is distinct from 'yes' then
    raise exception using errcode='42501',message='Payroll records require the canonical command authority.';
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='Payroll history cannot be deleted.';
  end if;
  if tg_op='UPDATE' and tg_table_name in
    ('payroll_compensation_versions','payroll_recurring_component_versions',
     'payroll_statutory_profile_versions','payroll_run_profile_snapshots','payroll_events',
     'payroll_payable_time_versions','payroll_run_time_snapshots',
     'payroll_pay_rule_versions','payroll_run_component_adjustments',
     'payroll_run_calculation_versions','payroll_run_calculation_snapshots',
     'payroll_statutory_input_versions','payroll_statutory_schedule_versions',
     'payroll_statutory_schedule_bands','payroll_run_statutory_versions',
     'payroll_run_statutory_snapshots','payroll_epf_component_classification_versions',
     'payroll_run_pcb_confirmations') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
    raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_run_pcb_confirm(
  p_request_id uuid,p_run_id uuid,p_employee_id uuid,p_amount numeric,
  p_source_reference text,p_note text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_profile public.payroll_profiles%rowtype;
  v_applicability public.payroll_statutory_profile_versions%rowtype;
  v_prior public.payroll_run_pcb_confirmations%rowtype;
  v_retry public.payroll_run_pcb_confirmations%rowtype; v_id uuid;
begin
  if p_request_id is null or p_run_id is null or p_employee_id is null
    or p_amount is null or p_amount::text='NaN' or p_amount<0 or round(p_amount,2)<>p_amount
    or char_length(btrim(coalesce(p_reason,'')))<3
    or (nullif(btrim(coalesce(p_source_reference,'')),'') is not null
      and char_length(btrim(p_source_reference))<3)
    or (nullif(btrim(coalesce(p_note,'')),'') is not null
      and char_length(btrim(p_note))<3) then
    raise exception using errcode='22023',message='A confirmed PCB amount and reason are required.';
  end if;
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage')
    or not public.payroll_can_access_employee(p_employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll PCB confirmation authority denied.';
  end if;
  if not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
    where member.employee_id=p_employee_id) then
    raise exception using errcode='42501',message='Employee does not belong to this Payroll Run.';
  end if;
  select * into v_retry from public.payroll_run_pcb_confirmations where request_id=p_request_id;
  if v_retry.id is not null then
    if v_retry.run_id=p_run_id and v_retry.employee_id=p_employee_id and v_retry.amount=p_amount
      and v_retry.source_reference is not distinct from nullif(btrim(coalesce(p_source_reference,'')),'')
      and v_retry.note is not distinct from nullif(btrim(coalesce(p_note,'')),'')
      and v_retry.reason=btrim(p_reason) then return v_retry.id; end if;
    raise exception using errcode='23505',message='PCB request identity was already used with different content.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open Payroll Run can confirm PCB.';
  end if;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  select * into v_applicability from public.payroll_statutory_profile_versions
    where profile_id=v_profile.id and effective_from<=v_period.period_start
    order by effective_from desc limit 1;
  if v_applicability.pcb_applicable is distinct from true
    or exists(select 1 from public.payroll_statutory_profile_versions newer
      where newer.profile_id=v_profile.id and newer.effective_from>v_period.period_start
        and newer.effective_from<=v_period.period_end) then
    raise exception using errcode='22023',message='Reviewed, stable PCB applicability is required.';
  end if;
  select * into v_prior from public.payroll_run_pcb_confirmations
    where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_run_pcb_confirmations
    (request_id,run_id,period_id,employee_id,revision,supersedes_id,amount,
      source_reference,note,reason,confirmed_by_employee_id)
  values(p_request_id,p_run_id,v_period.id,p_employee_id,coalesce(v_prior.revision,0)+1,
    v_prior.id,p_amount,nullif(btrim(coalesce(p_source_reference,'')),''),
    nullif(btrim(coalesce(p_note,'')),''),btrim(p_reason),v_actor)
  returning id into v_id;
  insert into public.payroll_events(event_type,run_id,actor_employee_id,reason,details)
  values('pcb_manual_confirmed',p_run_id,v_actor,btrim(p_reason),
    jsonb_build_object('confirmation_id',v_id,'employee_id',p_employee_id,
      'period_id',v_period.id,'revision',coalesce(v_prior.revision,0)+1,
      'supersedes_id',v_prior.id,'amount',p_amount));
  return v_id;
end; $$;
revoke all on function public.payroll_run_pcb_confirm(uuid,uuid,uuid,numeric,text,text,text)
  from public,anon;
grant execute on function public.payroll_run_pcb_confirm(uuid,uuid,uuid,numeric,text,text,text)
  to authenticated;

create or replace function public.payroll_run_pcb_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_rows jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id',member.employee_id,
    'applicable',app.pcb_applicable,'confirmation',
      case when pcb.id is null then null else to_jsonb(pcb) end,
    'history',coalesce((select jsonb_agg(to_jsonb(history) order by history.revision desc)
      from public.payroll_run_pcb_confirmations history
      where history.run_id=p_run_id and history.employee_id=member.employee_id),'[]'::jsonb))
    order by member.employee_id),'[]'::jsonb)
    into v_rows
  from public.payroll_run_employee_ids(p_run_id) member
  left join public.payroll_profiles profile on profile.employee_id=member.employee_id
  left join lateral (select s.pcb_applicable from public.payroll_statutory_profile_versions s
    where s.profile_id=profile.id and s.effective_from<=v_period.period_start
    order by s.effective_from desc limit 1) app on true
  left join lateral (select c.* from public.payroll_run_pcb_confirmations c
    where c.run_id=p_run_id and c.employee_id=member.employee_id
    order by c.revision desc limit 1) pcb on true;
  return jsonb_build_object('results',v_rows);
end; $$;
revoke all on function public.payroll_run_pcb_read(uuid) from public,anon;
grant execute on function public.payroll_run_pcb_read(uuid) to authenticated;

alter function public.payroll_statutory_project(uuid,uuid)
  rename to payroll_statutory_project_pre_manual_pcb;
revoke all on function public.payroll_statutory_project_pre_manual_pcb(uuid,uuid)
  from public,anon,authenticated;

create function public.payroll_statutory_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_project jsonb; v_inputs jsonb; v_lines jsonb:='[]'::jsonb;
  v_bases jsonb:='[]'::jsonb; v_issues text[]:='{}'; v_issue text;
  v_line jsonb; v_pcb_line jsonb; v_pcb public.payroll_run_pcb_confirmations%rowtype;
  v_calc public.payroll_run_calculation_versions%rowtype;
  v_employee_total numeric(14,2):=0; v_employer_total numeric(14,2):=0;
  v_status text;
begin
  v_project:=public.payroll_statutory_project_pre_manual_pcb(p_run_id,p_employee_id);
  v_inputs:=v_project->'inputs';
  select * into v_calc from public.payroll_run_calculation_versions
    where id=(v_project->>'calculation_version_id')::uuid;
  for v_issue in select jsonb_array_elements_text(v_project->'issues') loop
    if v_issue not like 'pcb_%'
      and v_issue<>'epf_remittance_rounding_allocation_unapproved' then
      v_issues:=array_append(v_issues,v_issue);
    end if;
  end loop;
  for v_line in select value from jsonb_array_elements(v_project->'lines') loop
    if v_line->>'scheme'='pcb' then v_pcb_line:=v_line;
    else v_lines:=v_lines||jsonb_build_array(v_line); end if;
  end loop;
  for v_line in select value from jsonb_array_elements(v_inputs->'wage_base_lines') loop
    if v_line->>'scheme'<>'pcb' then v_bases:=v_bases||jsonb_build_array(v_line); end if;
  end loop;
  if v_pcb_line->>'applicable'='true' then
    select * into v_pcb from public.payroll_run_pcb_confirmations
      where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
    if v_pcb.id is null then
      v_issues:=array_append(v_issues,'pcb_manual_confirmation_missing');
    end if;
  elsif v_pcb_line->>'applicable' is distinct from 'false' then
    v_issues:=array_append(v_issues,'pcb_applicability_unreviewed');
  end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('scheme','pcb',
    'applicable',v_pcb_line->'applicable','category',null,'wage_base',null,
    'employee_amount',case when v_pcb_line->>'applicable'='false' then 0
      when v_pcb.id is not null then v_pcb.amount else null end,
    'employer_amount',case when v_pcb_line->>'applicable'='false' then 0
      when v_pcb.id is not null then 0 else null end,
    'method',case when v_pcb.id is not null then 'manual_confirmed' else null end,
    'evidence_version_id',v_pcb.id,'source_row',case when v_pcb.id is not null
      then 'Admin-confirmed PCB/MTD amount' else null end));
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if v_line->>'applicable'='true' then
      v_employee_total:=v_employee_total+coalesce((v_line->>'employee_amount')::numeric,0);
      v_employer_total:=v_employer_total+coalesce((v_line->>'employer_amount')::numeric,0)
        +coalesce((v_line->>'remittance_rounding')::numeric,0);
    end if;
  end loop;
  v_inputs:=v_inputs||jsonb_build_object('wage_base_lines',v_bases,
    'pcb_method','manual_confirmed','pcb_confirmation',
      case when v_pcb.id is null then null else to_jsonb(v_pcb) end,
    'epf_remittance_rounding_policy','employer_funded_residual_v1');
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  return v_project||jsonb_build_object('inputs',v_inputs,'input_fingerprint',md5(v_inputs::text),
    'lines',v_lines,'issues',to_jsonb(v_issues),'status',v_status,
    'net_pay',case when v_status='ready' then v_calc.pre_statutory_pay-v_employee_total else null end,
    'employer_statutory_cost',case when v_status='ready' then v_employer_total else null end,
    'total_employer_cost',case when v_status='ready' then
      v_calc.gross_earnings+v_calc.reimbursements+v_employer_total else null end);
end; $$;
revoke all on function public.payroll_statutory_project(uuid,uuid) from public,anon,authenticated;
