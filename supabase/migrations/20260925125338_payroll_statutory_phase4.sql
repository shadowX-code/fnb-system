-- Phase 4 statutory boundary. A contribution is never inferred from a generic
-- gross amount or an unverified percentage. Official schedule rows must be
-- reconciled and installed by a later forward-only migration before use.
create table public.payroll_statutory_input_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.payroll_profiles(id) on delete restrict,
  effective_from date not null,
  epf_category text,
  socso_category text,
  eis_category text,
  pcb_inputs jsonb not null default '{}'::jsonb check(jsonb_typeof(pcb_inputs)='object'),
  source_note text not null check(char_length(btrim(source_note)) between 8 and 1000),
  reason text not null check(char_length(btrim(reason)) between 3 and 1000),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(profile_id,effective_from)
);
create index payroll_statutory_input_effective_idx on public.payroll_statutory_input_versions(profile_id,effective_from desc);

create table public.payroll_statutory_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  scheme text not null check(scheme in ('epf','socso','eis')),
  category text not null,
  effective_from date not null,
  effective_to date,
  source_url text not null check(source_url ~ '^https://'),
  source_version text not null check(nullif(btrim(source_version),'') is not null),
  reconciliation_note text not null check(nullif(btrim(reconciliation_note),'') is not null),
  created_at timestamptz not null default clock_timestamp(),
  unique(scheme,category,effective_from),
  check(effective_to is null or effective_to>=effective_from)
);
create index payroll_statutory_schedule_effective_idx on public.payroll_statutory_schedule_versions(scheme,category,effective_from desc);
create table public.payroll_statutory_schedule_bands (
  id uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null references public.payroll_statutory_schedule_versions(id) on delete restrict,
  wage_above numeric(14,2) not null check(wage_above>=0),
  wage_through numeric(14,2),
  employee_amount numeric(14,2) not null check(employee_amount>=0),
  employer_amount numeric(14,2) not null check(employer_amount>=0),
  source_row text not null,
  unique(schedule_version_id,wage_above),
  check(wage_through is null or wage_through>wage_above)
);
create index payroll_statutory_band_lookup_idx on public.payroll_statutory_schedule_bands(schedule_version_id,wage_above,wage_through);

create table public.payroll_run_statutory_versions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  revision integer not null check(revision>0),
  supersedes_id uuid references public.payroll_run_statutory_versions(id) on delete restrict,
  calculation_version_id uuid references public.payroll_run_calculation_versions(id) on delete restrict,
  input_fingerprint text not null,
  status text not null check(status in ('ready','review_required')),
  lines jsonb not null check(jsonb_typeof(lines)='array'),
  issues text[] not null default '{}',
  inputs jsonb not null,
  gross_earnings numeric(14,2) not null,
  non_statutory_deductions numeric(14,2) not null,
  reimbursements numeric(14,2) not null,
  net_pay numeric(14,2),
  employer_statutory_cost numeric(14,2),
  total_employer_cost numeric(14,2),
  calculated_by_employee_id uuid not null references public.employees(id) on delete restrict,
  calculated_at timestamptz not null default clock_timestamp(),
  unique(run_id,employee_id,revision),
  check((status='ready')=(cardinality(issues)=0)),
  check((status='ready')=(net_pay is not null and employer_statutory_cost is not null and total_employer_cost is not null))
);
create index payroll_statutory_result_latest_idx on public.payroll_run_statutory_versions(run_id,employee_id,revision desc);
create table public.payroll_run_statutory_snapshots (
  run_id uuid not null references public.payroll_runs(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  statutory_version_id uuid not null unique references public.payroll_run_statutory_versions(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(run_id,employee_id)
);

do $$ declare t text; begin
  foreach t in array array['payroll_statutory_input_versions','payroll_statutory_schedule_versions',
    'payroll_statutory_schedule_bands','payroll_run_statutory_versions','payroll_run_statutory_snapshots'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('create trigger payroll_command_guard before insert or update or delete on public.%I for each row execute function public.payroll_command_guard()',t);
  end loop;
end $$;

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
     'payroll_run_statutory_snapshots') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
    raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_statutory_input_adjust(
  p_profile_id uuid,p_effective_from date,p_epf_category text,p_socso_category text,
  p_eis_category text,p_pcb_inputs jsonb,p_source_note text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_profile public.payroll_profiles%rowtype;
  v_prior public.payroll_statutory_input_versions%rowtype; v_id uuid;
begin
  select * into v_profile from public.payroll_profiles where id=p_profile_id for update;
  if v_profile.id is null or not public.payroll_can_access_employee(v_profile.employee_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll statutory input authority denied.';
  end if;
  select * into v_prior from public.payroll_statutory_input_versions where profile_id=p_profile_id order by effective_from desc limit 1;
  if p_effective_from is null or p_effective_from<=v_prior.effective_from
    or char_length(btrim(coalesce(p_source_note,'')))<8 or char_length(btrim(coalesce(p_reason,'')))<3
    or jsonb_typeof(coalesce(p_pcb_inputs,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='A later effective date, sourced input and reason are required.';
  end if;
  if exists(select 1 from public.payroll_run_profile_snapshots s
    join public.payroll_runs r on r.id=s.run_id join public.payroll_periods period on period.id=r.period_id
    where s.profile_id=p_profile_id and r.status in ('finalized','paid') and period.period_end>=p_effective_from) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_statutory_input_versions(profile_id,effective_from,epf_category,socso_category,
    eis_category,pcb_inputs,source_note,reason,approved_by_employee_id)
  values(p_profile_id,p_effective_from,nullif(btrim(p_epf_category),''),nullif(btrim(p_socso_category),''),
    nullif(btrim(p_eis_category),''),coalesce(p_pcb_inputs,'{}'::jsonb),btrim(p_source_note),btrim(p_reason),v_actor)
  returning id into v_id;
  insert into public.payroll_events(event_type,profile_id,actor_employee_id,reason,details)
  values('statutory_inputs_reviewed',p_profile_id,v_actor,btrim(p_reason),
    jsonb_build_object('input_version_id',v_id,'effective_from',p_effective_from));
  return v_id;
end; $$;

-- Project is read-only: all money comes from the pinned Phase 3 calculation
-- lines, distinct wage treatments, and an exact official schedule band.
create or replace function public.payroll_statutory_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee public.employees%rowtype; v_profile public.payroll_profiles%rowtype;
  v_applicability public.payroll_statutory_profile_versions%rowtype;
  v_input public.payroll_statutory_input_versions%rowtype;
  v_calc public.payroll_run_calculation_versions%rowtype;
  v_schedule public.payroll_statutory_schedule_versions%rowtype;
  v_band public.payroll_statutory_schedule_bands%rowtype;
  v_component public.payroll_component_definitions%rowtype;
  v_scheme text; v_category text; v_applicable boolean; v_treatment text;
  v_line jsonb; v_bases jsonb:='[]'::jsonb; v_lines jsonb:='[]'::jsonb;
  v_issues text[]:='{}'; v_base numeric(14,2); v_employee_amount numeric(14,2):=0;
  v_employer_amount numeric(14,2):=0; v_employee_total numeric(14,2):=0;
  v_employer_total numeric(14,2):=0; v_inputs jsonb; v_status text;
begin
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_profile from public.payroll_profiles where employee_id=p_employee_id;
  if v_run.id is null or v_employee.id is null then
    raise exception using errcode='P0002',message='Payroll Run or employee not found.';
  end if;
  select * into v_calc from public.payroll_run_calculation_versions
    where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
  select * into v_applicability from public.payroll_statutory_profile_versions
    where profile_id=v_profile.id and effective_from<=v_period.period_start order by effective_from desc limit 1;
  select * into v_input from public.payroll_statutory_input_versions
    where profile_id=v_profile.id and effective_from<=v_period.period_start order by effective_from desc limit 1;
  v_inputs:=jsonb_build_object('calculation_version_id',v_calc.id,
    'calculation_fingerprint',v_calc.input_fingerprint,
    'applicability',to_jsonb(v_applicability),'statutory_input',to_jsonb(v_input),
    'employee_attributes',jsonb_build_object('nationality',v_employee.nationality,'birthday',v_employee.birthday),
    'period_start',v_period.period_start,'period_end',v_period.period_end,
    'schedules',jsonb_build_array());
  if v_calc.id is null or v_calc.status<>'ready'
    or v_calc.input_fingerprint is distinct from
      (public.payroll_calculation_project(p_run_id,p_employee_id)->>'input_fingerprint') then
    v_issues:=array_append(v_issues,'phase3_calculation_missing_or_stale');
  end if;
  if v_applicability.id is null then v_issues:=array_append(v_issues,'statutory_applicability_missing'); end if;
  if v_applicability.id is not null and exists(select 1 from public.payroll_statutory_profile_versions newer
    where newer.profile_id=v_profile.id and newer.effective_from>v_period.period_start
      and newer.effective_from<=v_period.period_end) then
    v_issues:=array_append(v_issues,'mid_period_statutory_applicability_change');
  end if;
  if v_input.id is not null and exists(select 1 from public.payroll_statutory_input_versions newer
    where newer.profile_id=v_profile.id and newer.effective_from>v_period.period_start
      and newer.effective_from<=v_period.period_end) then
    v_issues:=array_append(v_issues,'mid_period_statutory_input_change');
  end if;
  foreach v_scheme in array array['epf','socso','eis','pcb'] loop
    v_applicable:=case v_scheme when 'epf' then v_applicability.epf_applicable
      when 'socso' then v_applicability.socso_applicable when 'eis' then v_applicability.eis_applicable
      else v_applicability.pcb_applicable end;
    v_category:=case v_scheme when 'epf' then v_input.epf_category
      when 'socso' then v_input.socso_category when 'eis' then v_input.eis_category else null end;
    v_base:=0; v_employee_amount:=0; v_employer_amount:=0;
    if v_applicable is null then
      v_issues:=array_append(v_issues,v_scheme||'_applicability_unreviewed');
    elsif v_applicable then
      for v_line in select value from jsonb_array_elements(coalesce(v_calc.lines,'[]'::jsonb)) loop
        v_treatment:=null;
        if v_line->>'kind'='reimbursement' then v_treatment:='excluded';
        elsif v_line->>'kind'='deduction' and v_line->>'code'<>'unpaid_time' then v_treatment:='excluded';
        elsif v_line->>'code' in ('monthly_basic','regular') then v_treatment:='included';
        elsif v_line->'source'->>'component_definition_id' is not null then
          select * into v_component from public.payroll_component_definitions
            where id=(v_line->'source'->>'component_definition_id')::uuid;
          v_treatment:=case v_scheme when 'epf' then v_component.epf_treatment
            when 'socso' then v_component.socso_treatment when 'eis' then v_component.eis_treatment
            else v_component.pcb_treatment end;
        end if;
        if v_treatment is null or v_treatment='undetermined' then
          v_issues:=array_append(v_issues,v_scheme||'_wage_treatment_unresolved:'||(v_line->>'code'));
        elsif v_treatment='included' then
          if v_line->>'kind'='deduction' then v_base:=v_base-(v_line->>'amount')::numeric;
          else v_base:=v_base+(v_line->>'amount')::numeric; end if;
        end if;
        v_bases:=v_bases||jsonb_build_array(jsonb_build_object('scheme',v_scheme,
          'line_code',v_line->>'code','amount',v_line->'amount','treatment',coalesce(v_treatment,'undetermined'),
          'source',v_line->'source'));
      end loop;
      if v_base<0 then v_issues:=array_append(v_issues,v_scheme||'_negative_wage_base'); end if;
      if v_scheme='pcb' then
        -- The 2026 HASiL specification needs YTD and prior-employer inputs and
        -- official-case reconciliation. Never turn an unresolved PCB into zero.
        v_issues:=array_append(v_issues,'pcb_2026_official_spec_unvalidated');
      elsif nullif(v_category,'') is null then
        v_issues:=array_append(v_issues,v_scheme||'_category_unreviewed');
      else
        select * into v_schedule from public.payroll_statutory_schedule_versions
          where scheme=v_scheme and category=v_category and effective_from<=v_period.period_start
            and (effective_to is null or effective_to>=v_period.period_end)
          order by effective_from desc limit 1;
        if v_schedule.id is null then v_issues:=array_append(v_issues,v_scheme||'_official_schedule_unavailable');
        else
          select * into v_band from public.payroll_statutory_schedule_bands
            where schedule_version_id=v_schedule.id and v_base>wage_above
              and (wage_through is null or v_base<=wage_through)
            order by wage_above desc limit 1;
          if v_band.id is null then v_issues:=array_append(v_issues,v_scheme||'_official_band_unavailable');
          else
            v_employee_amount:=v_band.employee_amount; v_employer_amount:=v_band.employer_amount;
            v_employee_total:=v_employee_total+v_employee_amount;
            v_employer_total:=v_employer_total+v_employer_amount;
            v_inputs:=jsonb_set(v_inputs,'{schedules}',v_inputs->'schedules'||jsonb_build_array(
              jsonb_build_object('scheme',v_scheme,'schedule',to_jsonb(v_schedule),'band',to_jsonb(v_band))));
          end if;
        end if;
      end if;
    end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('scheme',v_scheme,
      'applicable',v_applicable,'category',v_category,'wage_base',case when v_applicable then v_base else null end,
      'employee_amount',case when v_applicable is false then 0 when v_scheme='pcb' then null
        when v_band.id is not null then v_employee_amount else null end,
      'employer_amount',case when v_applicable is false then 0 when v_scheme='pcb' then 0
        when v_band.id is not null then v_employer_amount else null end,
      'schedule_version_id',v_schedule.id,'source_row',v_band.source_row));
    v_band:=null; v_schedule:=null;
  end loop;
  v_inputs:=v_inputs||jsonb_build_object('wage_base_lines',v_bases);
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  return jsonb_build_object('employee_id',p_employee_id,'calculation_version_id',v_calc.id,
    'input_fingerprint',md5(v_inputs::text),'status',v_status,'issues',to_jsonb(v_issues),
    'lines',v_lines,'inputs',v_inputs,'gross_earnings',coalesce(v_calc.gross_earnings,0),
    'non_statutory_deductions',coalesce(v_calc.non_statutory_deductions,0),
    'reimbursements',coalesce(v_calc.reimbursements,0),
    'net_pay',case when v_status='ready' then v_calc.pre_statutory_pay-v_employee_total else null end,
    'employer_statutory_cost',case when v_status='ready' then v_employer_total else null end,
    'total_employer_cost',case when v_status='ready' then v_calc.gross_earnings+v_calc.reimbursements+v_employer_total else null end);
end; $$;

create or replace function public.payroll_run_statutory_calculate(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_project jsonb;
  v_latest public.payroll_run_statutory_versions%rowtype; v_created integer:=0; v_unchanged integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll statutory calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open Payroll Run can calculate statutory results.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) order by employee_id loop
    v_project:=public.payroll_statutory_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_statutory_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    if v_latest.id is not null and v_latest.input_fingerprint=v_project->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_statutory_versions(run_id,employee_id,revision,supersedes_id,
      calculation_version_id,input_fingerprint,status,lines,issues,inputs,gross_earnings,
      non_statutory_deductions,reimbursements,net_pay,employer_statutory_cost,
      total_employer_cost,calculated_by_employee_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      (v_project->>'calculation_version_id')::uuid,v_project->>'input_fingerprint',v_project->>'status',
      v_project->'lines',array(select jsonb_array_elements_text(v_project->'issues')),
      v_project->'inputs',(v_project->>'gross_earnings')::numeric,
      (v_project->>'non_statutory_deductions')::numeric,(v_project->>'reimbursements')::numeric,
      (v_project->>'net_pay')::numeric,(v_project->>'employer_statutory_cost')::numeric,
      (v_project->>'total_employer_cost')::numeric,v_actor);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
    values('run_statutory_calculated',p_run_id,v_actor,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
end; $$;

create or replace function public.payroll_run_statutory_readiness(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_employee_id uuid; v_project jsonb; v_latest public.payroll_run_statutory_versions%rowtype;
  v_count integer:=0; v_missing integer:=0; v_review integer:=0; v_stale integer:=0;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) loop
    v_count:=v_count+1; v_project:=public.payroll_statutory_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_statutory_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1;
    if v_latest.id is null then v_missing:=v_missing+1;
    elsif v_latest.input_fingerprint is distinct from v_project->>'input_fingerprint' then v_stale:=v_stale+1;
    elsif v_latest.status='review_required' then v_review:=v_review+1; end if;
  end loop;
  return jsonb_build_object('ready',v_count>0 and v_missing=0 and v_review=0 and v_stale=0
      and (v_period.period_end<timezone('Asia/Kuala_Lumpur',now())::date),
    'employees',v_count,'uncalculated',v_missing,'review_required',v_review,'stale',v_stale);
end; $$;

create or replace function public.payroll_run_statutory_read(p_run_id uuid)
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
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'employee_id',s.employee_id,
    'employee_name',e.full_name,'employee_code',e.employee_code,'revision',s.revision,
    'status',s.status,'issues',to_jsonb(s.issues),'lines',s.lines,'inputs',s.inputs,
    'is_stale',s.input_fingerprint is distinct from
      (public.payroll_statutory_project(p_run_id,s.employee_id)->>'input_fingerprint'),
    'gross_earnings',s.gross_earnings,'non_statutory_deductions',s.non_statutory_deductions,
    'reimbursements',s.reimbursements,'net_pay',s.net_pay,
    'employer_statutory_cost',s.employer_statutory_cost,
    'total_employer_cost',s.total_employer_cost) order by e.full_name),'[]'::jsonb) into v_rows
  from public.payroll_run_statutory_versions s join public.employees e on e.id=s.employee_id
  where s.run_id=p_run_id and not exists(select 1 from public.payroll_run_statutory_versions newer
    where newer.run_id=s.run_id and newer.employee_id=s.employee_id and newer.revision>s.revision);
  return jsonb_build_object('results',v_rows,'readiness',public.payroll_run_statutory_readiness(p_run_id));
end; $$;

create or replace function public.payroll_statutory_run_gate()
returns trigger language plpgsql set search_path=public as $$
declare v_readiness jsonb;
begin
  if new.status in ('ready','finalized') and old.status is distinct from new.status
    and not new.foundation_only then
    v_readiness:=public.payroll_run_statutory_readiness(new.id);
    if not (v_readiness->>'ready')::boolean then
      raise exception using errcode='55000',message='Statutory calculation requires review or recalculation.',
        detail=v_readiness::text;
    end if;
  end if;
  return new;
end; $$;
create trigger payroll_statutory_run_gate before update on public.payroll_runs
  for each row execute function public.payroll_statutory_run_gate();

create or replace function public.payroll_statutory_snapshot_finalized_run()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='finalized' and old.status is distinct from new.status and not new.foundation_only then
    insert into public.payroll_run_statutory_snapshots(run_id,employee_id,statutory_version_id,result)
    select new.id,s.employee_id,s.id,to_jsonb(s) from public.payroll_run_statutory_versions s
    join public.payroll_run_employee_ids(new.id) member on member.employee_id=s.employee_id
    where s.run_id=new.id and s.status='ready'
      and not exists(select 1 from public.payroll_run_statutory_versions later
        where later.run_id=s.run_id and later.employee_id=s.employee_id and later.revision>s.revision);
  end if;
  return new;
end; $$;
create trigger payroll_statutory_snapshot_finalized_run after update on public.payroll_runs
  for each row execute function public.payroll_statutory_snapshot_finalized_run();

revoke all on function public.payroll_statutory_input_adjust(uuid,date,text,text,text,jsonb,text,text) from public,anon;
revoke all on function public.payroll_run_statutory_calculate(uuid) from public,anon;
revoke all on function public.payroll_run_statutory_readiness(uuid) from public,anon;
revoke all on function public.payroll_run_statutory_read(uuid) from public,anon;
grant execute on function public.payroll_statutory_input_adjust(uuid,date,text,text,text,jsonb,text,text) to authenticated;
grant execute on function public.payroll_run_statutory_calculate(uuid) to authenticated;
grant execute on function public.payroll_run_statutory_readiness(uuid) to authenticated;
grant execute on function public.payroll_run_statutory_read(uuid) to authenticated;
revoke all on function public.payroll_statutory_project(uuid,uuid) from public,anon,authenticated;
revoke all on function public.payroll_statutory_run_gate() from public,anon,authenticated;
revoke all on function public.payroll_statutory_snapshot_finalized_run() from public,anon,authenticated;
