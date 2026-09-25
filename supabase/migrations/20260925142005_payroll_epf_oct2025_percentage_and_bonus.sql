-- KWSP Third Schedule (October 2025), Part A/E. Keep the original Phase 4
-- projection as the shared SOCSO/EIS/PCB authority; replace only its EPF
-- projection with sourced, independently testable EPF evidence.
-- https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution
-- https://www.kwsp.gov.my/documents/d/guest/jadual-ketiga-bi-1-oct-2025
-- https://www.kwsp.gov.my/en/others/resource-centre/references/epf-act-1991

create table public.payroll_epf_component_classification_versions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.payroll_component_definitions(id) on delete restrict,
  effective_from date not null,
  remuneration_kind text not null check(remuneration_kind in ('ordinary','bonus')),
  source_note text not null check(char_length(btrim(source_note)) between 8 and 1000),
  reason text not null check(char_length(btrim(reason)) between 3 and 1000),
  approved_by_employee_id uuid not null references public.employees(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(component_id,effective_from)
);
create index payroll_epf_component_classification_effective_idx
  on public.payroll_epf_component_classification_versions(component_id,effective_from desc);
alter table public.payroll_epf_component_classification_versions enable row level security;
revoke all on public.payroll_epf_component_classification_versions from public,anon,authenticated;
create trigger payroll_command_guard before insert or update or delete
  on public.payroll_epf_component_classification_versions for each row
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
     'payroll_run_statutory_snapshots','payroll_epf_component_classification_versions') then
    raise exception using errcode='55000',message='Payroll historical evidence is immutable.';
  end if;
  if tg_op='UPDATE' and tg_table_name='payroll_runs' and old.status in ('finalized','paid') then
    raise exception using errcode='55000',message='Finalized payroll runs are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.payroll_epf_component_classify(
  p_component_id uuid,p_effective_from date,p_remuneration_kind text,
  p_source_note text,p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=public.payroll_admin_actor();
  v_component public.payroll_component_definitions%rowtype;
  v_prior public.payroll_epf_component_classification_versions%rowtype;
  v_id uuid;
begin
  if not public.current_user_has_permission('payroll.manage')
    or not exists(select 1 from public.employees e join public.roles r on r.id=e.role_id
      where e.id=v_actor and lower(r.name) in ('owner','admin')) then
    raise exception using errcode='42501',message='Payroll component classification authority required.';
  end if;
  select * into v_component from public.payroll_component_definitions where id=p_component_id for update;
  if v_component.id is null or v_component.component_type not in ('earning','allowance')
    or p_remuneration_kind not in ('ordinary','bonus')
    or p_effective_from is null
    or char_length(btrim(coalesce(p_source_note,'')))<8
    or char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='22023',message='A sourced EPF remuneration classification is required.';
  end if;
  select * into v_prior from public.payroll_epf_component_classification_versions
    where component_id=p_component_id order by effective_from desc limit 1;
  if v_prior.id is not null and p_effective_from<=v_prior.effective_from then
    raise exception using errcode='22023',message='A later classification effective date is required.';
  end if;
  -- Classification is global to a component. Existing finalized runs retain
  -- their snapshot, but a retrospective change requires a controlled correction.
  if exists(select 1 from public.payroll_run_statutory_snapshots snap
    join public.payroll_runs run on run.id=snap.run_id
    join public.payroll_periods period on period.id=run.period_id
    where period.period_end>=p_effective_from
      and exists(select 1 from jsonb_array_elements(snap.result->'inputs'->'wage_base_lines') line
        where line->>'scheme'='epf'
          and line->'source'->>'component_definition_id'=p_component_id::text)) then
    raise exception using errcode='55000',message='Use a controlled correction for a finalized period.';
  end if;
  perform set_config('feedx.payroll_command','yes',true);
  insert into public.payroll_epf_component_classification_versions
    (component_id,effective_from,remuneration_kind,source_note,reason,approved_by_employee_id)
  values(p_component_id,p_effective_from,p_remuneration_kind,btrim(p_source_note),btrim(p_reason),v_actor)
  returning id into v_id;
  insert into public.payroll_events(event_type,component_id,actor_employee_id,reason,details)
  values('epf_component_classified',p_component_id,v_actor,btrim(p_reason),
    jsonb_build_object('classification_version_id',v_id,'effective_from',p_effective_from,
      'remuneration_kind',p_remuneration_kind));
  return v_id;
end; $$;
revoke all on function public.payroll_epf_component_classify(uuid,date,text,text,text) from public,anon;
grant execute on function public.payroll_epf_component_classify(uuid,date,text,text,text) to authenticated;

-- Exact percentage shares and the separately published total-ringgit rule.
-- The residual is explicit remittance rounding, not a fabricated rate change.
create or replace function public.payroll_epf_percentage_contribution(
  p_wages numeric,p_employee_rate numeric,p_employer_rate numeric
) returns jsonb language plpgsql immutable set search_path=public as $$
declare v_raw_employee numeric; v_raw_employer numeric;
  v_employee numeric(14,2); v_employer numeric(14,2); v_total numeric(14,2);
begin
  if p_wages is null or p_wages<=0 or p_employee_rate is null or p_employer_rate is null
    or p_employee_rate<0 or p_employer_rate<0 then
    raise exception using errcode='22023',message='Valid EPF wages and rates are required.';
  end if;
  v_raw_employee:=p_wages*p_employee_rate/100;
  v_raw_employer:=p_wages*p_employer_rate/100;
  v_employee:=round(v_raw_employee,2);
  v_employer:=round(v_raw_employer,2);
  v_total:=ceil(v_raw_employee+v_raw_employer);
  return jsonb_build_object('employee_rate',p_employee_rate,'employer_rate',p_employer_rate,
    'employee_raw',v_raw_employee,'employer_raw',v_raw_employer,
    'employee_amount',v_employee,'employer_amount',v_employer,
    'total_contribution',v_total,
    'remittance_rounding',v_total-v_employee-v_employer);
end; $$;
revoke all on function public.payroll_epf_percentage_contribution(numeric,numeric,numeric)
  from public,anon,authenticated;

alter function public.payroll_statutory_project(uuid,uuid)
  rename to payroll_statutory_project_pre_epf_oct2025;
revoke all on function public.payroll_statutory_project_pre_epf_oct2025(uuid,uuid)
  from public,anon,authenticated;

create function public.payroll_statutory_project(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_project jsonb; v_inputs jsonb; v_calc public.payroll_run_calculation_versions%rowtype;
  v_period public.payroll_periods%rowtype; v_employee public.employees%rowtype;
  v_epf_line jsonb; v_line jsonb; v_base_line jsonb; v_components jsonb:='[]'::jsonb;
  v_bases jsonb:='[]'::jsonb; v_schedules jsonb:='[]'::jsonb; v_lines jsonb:='[]'::jsonb;
  v_issues text[]:='{}'; v_issue text; v_category text; v_category_issue text;
  v_base numeric(14,2):=0; v_ordinary numeric(14,2):=0; v_bonus numeric(14,2):=0;
  v_component_id uuid; v_class public.payroll_epf_component_classification_versions%rowtype;
  v_missing_class boolean:=false; v_unclassified numeric(14,2):=0;
  v_treatment text; v_schedule public.payroll_statutory_schedule_versions%rowtype;
  v_band public.payroll_statutory_schedule_bands%rowtype; v_rate numeric; v_percent jsonb;
  v_employee_amount numeric(14,2); v_employer_amount numeric(14,2);
  v_remittance_rounding numeric(14,2):=0; v_employee_total numeric(14,2):=0;
  v_employer_total numeric(14,2):=0; v_status text;
begin
  v_project:=public.payroll_statutory_project_pre_epf_oct2025(p_run_id,p_employee_id);
  v_inputs:=v_project->'inputs';
  select * into v_period from public.payroll_periods period
    join public.payroll_runs run on run.period_id=period.id where run.id=p_run_id;
  select * into v_employee from public.employees where id=p_employee_id;
  select * into v_calc from public.payroll_run_calculation_versions
    where run_id=p_run_id and employee_id=p_employee_id order by revision desc limit 1;
  v_category:=v_inputs->'statutory_input'->>'epf_category';

  for v_issue in select jsonb_array_elements_text(v_project->'issues') loop
    if v_issue not like 'epf_%' then v_issues:=array_append(v_issues,v_issue); end if;
  end loop;
  for v_line in select value from jsonb_array_elements(v_project->'lines') loop
    if v_line->>'scheme'='epf' then v_epf_line:=v_line;
    else v_lines:=v_lines||jsonb_build_array(v_line); end if;
  end loop;
  for v_base_line in select value from jsonb_array_elements(v_inputs->'wage_base_lines') loop
    if v_base_line->>'scheme'='epf' then
      if v_base_line->>'line_code' in ('overtime','rest_day','public_holiday','public_holiday_ot') then
        v_base_line:=jsonb_set(v_base_line,'{treatment}','"excluded"'::jsonb);
      elsif v_base_line->>'line_code'='unpaid_time' then
        v_base_line:=jsonb_set(v_base_line,'{treatment}','"included"'::jsonb);
      end if;
      v_treatment:=v_base_line->>'treatment';
      if v_treatment='included' then
        if v_base_line->'source'->>'component_definition_id' is not null then
          v_component_id:=(v_base_line->'source'->>'component_definition_id')::uuid;
          select * into v_class from public.payroll_epf_component_classification_versions
            where component_id=v_component_id and effective_from<=v_period.period_start
            order by effective_from desc limit 1;
          v_components:=v_components||jsonb_build_array(jsonb_build_object(
            'component_id',v_component_id,'classification_version',to_jsonb(v_class)));
          if v_class.id is null then
            v_missing_class:=true;
            v_unclassified:=v_unclassified+(v_base_line->>'amount')::numeric;
          elsif v_class.remuneration_kind='bonus' then
            v_bonus:=v_bonus+(v_base_line->>'amount')::numeric;
          end if;
          if exists(select 1 from public.payroll_epf_component_classification_versions newer
            where newer.component_id=v_component_id
              and newer.effective_from>v_period.period_start
              and newer.effective_from<=v_period.period_end) then
            v_issues:=array_append(v_issues,'epf_mid_period_component_classification_change');
          end if;
        end if;
        if v_base_line->>'line_code' is distinct from 'unpaid_time' then
          v_base:=v_base+(v_base_line->>'amount')::numeric;
        else v_base:=v_base-(v_base_line->>'amount')::numeric; end if;
      elsif v_treatment is null or v_treatment='undetermined' then
        v_issues:=array_append(v_issues,'epf_wage_treatment_unresolved:'||(v_base_line->>'line_code'));
      end if;
      v_bases:=v_bases||jsonb_build_array(v_base_line);
    else v_bases:=v_bases||jsonb_build_array(v_base_line); end if;
  end loop;
  v_ordinary:=v_base-v_bonus;
  if v_epf_line->>'applicable'='true' then
    v_category_issue:=public.payroll_statutory_category_issue('epf',v_category,
      v_employee.nationality,v_employee.birthday,v_period.period_start,v_period.period_end);
    if v_category_issue is not null then v_issues:=array_append(v_issues,v_category_issue); end if;
    if v_base<0 then v_issues:=array_append(v_issues,'epf_negative_wage_base'); end if;
    if v_base>5000 and v_ordinary-v_unclassified<=5000 and v_missing_class then
      v_issues:=array_append(v_issues,'epf_bonus_threshold_component_classification_missing');
    end if;
    if v_category_issue is null and v_base>=0
      and not (v_base>5000 and v_ordinary-v_unclassified<=5000 and v_missing_class) then
      select * into v_schedule from public.payroll_statutory_schedule_versions
        where scheme='epf' and category=v_category and effective_from<=v_period.period_start
          and (effective_to is null or effective_to>=v_period.period_end)
        order by effective_from desc limit 1;
      if v_schedule.id is null then
        v_issues:=array_append(v_issues,'epf_official_schedule_unavailable');
      elsif v_base>20000 or (v_category='malaysian_under_60' and v_base>5000
          and v_ordinary<=5000 and v_bonus>0 and not v_missing_class) then
        v_rate:=case when v_category='malaysian_60_to_74' then 4
          when v_ordinary<=5000 and v_bonus>0 and not v_missing_class then 13 else 12 end;
        v_percent:=public.payroll_epf_percentage_contribution(v_base,
          case when v_category='malaysian_60_to_74' then 0 else 11 end,v_rate);
        v_employee_amount:=(v_percent->>'employee_amount')::numeric;
        v_employer_amount:=(v_percent->>'employer_amount')::numeric;
        v_remittance_rounding:=(v_percent->>'remittance_rounding')::numeric;
        v_schedules:=v_schedules||jsonb_build_array(jsonb_build_object(
          'scheme','epf','schedule',to_jsonb(v_schedule),
          'source_row',case when v_base>20000 then 'Part A/E above RM20,000 percentage'
            else 'Part A RM5,000 bonus exception' end,
          'percentage_evidence',v_percent));
      else
        select * into v_band from public.payroll_statutory_schedule_bands
          where schedule_version_id=v_schedule.id and v_base>wage_above
            and (wage_through is null or v_base<=wage_through)
          order by wage_above desc limit 1;
        if v_band.id is null then v_issues:=array_append(v_issues,'epf_official_band_unavailable');
        else
          v_employee_amount:=v_band.employee_amount; v_employer_amount:=v_band.employer_amount;
          v_schedules:=v_schedules||jsonb_build_array(jsonb_build_object(
            'scheme','epf','schedule',to_jsonb(v_schedule),'band',to_jsonb(v_band)));
        end if;
      end if;
    end if;
  elsif v_epf_line->>'applicable' is distinct from 'false' then
    v_issues:=array_append(v_issues,'epf_applicability_unreviewed');
  else v_employee_amount:=0; v_employer_amount:=0; end if;

  v_lines:=jsonb_build_array(jsonb_build_object('scheme','epf',
    'applicable',v_epf_line->'applicable','category',v_category,
    'wage_base',case when v_epf_line->>'applicable'='true' then v_base else null end,
    'employee_amount',v_employee_amount,'employer_amount',v_employer_amount,
    'remittance_rounding',v_remittance_rounding,
    'total_contribution',case when v_employee_amount is not null and v_employer_amount is not null
      then v_employee_amount+v_employer_amount+v_remittance_rounding else null end,
    'schedule_version_id',v_schedule.id,
    'source_row',case when v_percent is not null then
      case when v_base>20000 then 'Part A/E above RM20,000 percentage'
        else 'Part A RM5,000 bonus exception' end else v_band.source_row end))||v_lines;
  for v_line in select value from jsonb_array_elements(v_lines) loop
    if v_line->>'applicable'='true' then
      v_employee_total:=v_employee_total+coalesce((v_line->>'employee_amount')::numeric,0);
      v_employer_total:=v_employer_total+coalesce((v_line->>'employer_amount')::numeric,0)
        +coalesce((v_line->>'remittance_rounding')::numeric,0);
    end if;
  end loop;
  for v_line in select value from jsonb_array_elements(v_inputs->'schedules') loop
    if v_line->>'scheme'<>'epf' then v_schedules:=v_schedules||jsonb_build_array(v_line); end if;
  end loop;
  v_inputs:=v_inputs||jsonb_build_object('schedules',v_schedules,
    'wage_base_lines',v_bases,'epf_component_classifications',v_components);
  v_status:=case when cardinality(v_issues)=0 then 'ready' else 'review_required' end;
  return v_project||jsonb_build_object('inputs',v_inputs,'input_fingerprint',md5(v_inputs::text),
    'lines',v_lines,'issues',to_jsonb(v_issues),'status',v_status,
    'net_pay',case when v_status='ready' then (v_project->>'gross_earnings')::numeric
      -(v_project->>'non_statutory_deductions')::numeric-v_employee_total else null end,
    'employer_statutory_cost',case when v_status='ready' then v_employer_total else null end,
    'total_employer_cost',case when v_status='ready' then
      (v_project->>'gross_earnings')::numeric+(v_project->>'reimbursements')::numeric
      +v_employer_total else null end);
end; $$;
revoke all on function public.payroll_statutory_project(uuid,uuid) from public,anon,authenticated;
