-- Shared append-only calculation cores; existing bulk RPCs delegate unchanged.
CREATE OR REPLACE FUNCTION public.payroll_run_calculate_core(p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.payroll_admin_actor(); v_run public.payroll_runs%rowtype;
  v_period public.payroll_periods%rowtype; v_employee_id uuid; v_projection jsonb;
  v_latest public.payroll_run_calculation_versions%rowtype;
  v_created integer:=0; v_unchanged integer:=0;
begin
  select * into v_run from public.payroll_runs where id=p_run_id for update;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.manage') then
    raise exception using errcode='42501',message='Payroll calculation authority denied.';
  end if;
  if v_run.foundation_only or v_run.status not in ('draft','review_required') then
    raise exception using errcode='55000',message='Only an open calculation Run can be recalculated.';
  end if;
  if p_only_employee_id is not null and not exists (
    select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_only_employee_id
  ) then raise exception using errcode='42501',message='Employee is not included in this Payroll Run.'; end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) where p_only_employee_id is null or employee_id=p_only_employee_id order by employee_id loop
    v_projection:=public.payroll_calculation_project(p_run_id,v_employee_id);
    select * into v_latest from public.payroll_run_calculation_versions
      where run_id=p_run_id and employee_id=v_employee_id order by revision desc limit 1 for update;
    if v_latest.id is not null and v_latest.input_fingerprint=v_projection->>'input_fingerprint' then
      v_unchanged:=v_unchanged+1; continue;
    end if;
    perform set_config('feedx.payroll_command','yes',true);
    insert into public.payroll_run_calculation_versions
      (run_id,employee_id,revision,supersedes_id,input_fingerprint,status,pay_basis,
       basic_or_hours,lines,issues,inputs,gross_earnings,non_statutory_deductions,
       reimbursements,pre_statutory_pay,calculated_by_employee_id)
    values(p_run_id,v_employee_id,coalesce(v_latest.revision,0)+1,v_latest.id,
      v_projection->>'input_fingerprint',v_projection->>'status',v_projection->>'pay_basis',
      v_projection->>'basic_or_hours',v_projection->'lines',
      array(select jsonb_array_elements_text(v_projection->'issues')),
      v_projection->'inputs',(v_projection->>'gross_earnings')::numeric,
      (v_projection->>'non_statutory_deductions')::numeric,
      (v_projection->>'reimbursements')::numeric,
      (v_projection->>'pre_statutory_pay')::numeric,v_actor);
    v_created:=v_created+1;
  end loop;
  if v_created>0 then
    insert into public.payroll_events(event_type,run_id,actor_employee_id,details)
    values('run_calculated',p_run_id,v_actor,
      jsonb_build_object('new_versions',v_created,'unchanged',v_unchanged));
  end if;
  return jsonb_build_object('created',v_created,'unchanged',v_unchanged);
end; $function$
;
revoke all on function public.payroll_run_calculate_core(uuid,uuid) from public,anon,authenticated;

create or replace function public.payroll_run_calculate(p_run_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select public.payroll_run_calculate_core(p_run_id,null);
$$;
CREATE OR REPLACE FUNCTION public.payroll_run_statutory_calculate_core(p_run_id uuid, p_only_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if p_only_employee_id is not null and not exists (
    select 1 from public.payroll_run_employee_ids(p_run_id) where employee_id=p_only_employee_id
  ) then raise exception using errcode='42501',message='Employee is not included in this Payroll Run.'; end if;
  for v_employee_id in select employee_id from public.payroll_run_employee_ids(p_run_id) where p_only_employee_id is null or employee_id=p_only_employee_id order by employee_id loop
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
end; $function$
;
revoke all on function public.payroll_run_statutory_calculate_core(uuid,uuid) from public,anon,authenticated;

create or replace function public.payroll_run_statutory_calculate(p_run_id uuid)
returns jsonb language sql security definer set search_path=public as $$
  select public.payroll_run_statutory_calculate_core(p_run_id,null);
$$;

-- One transaction refreshes the selected employee's earnings and statutory bases.
create or replace function public.payroll_employee_recalculate(p_run_id uuid,p_employee_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_calculation jsonb; v_statutory jsonb;
begin
  if p_employee_id is null then raise exception using errcode='22023',message='Employee is required.'; end if;
  v_calculation:=public.payroll_run_calculate_core(p_run_id,p_employee_id);
  v_statutory:=public.payroll_run_statutory_calculate_core(p_run_id,p_employee_id);
  return jsonb_build_object('calculation',v_calculation,'statutory',v_statutory);
end; $$;
revoke all on function public.payroll_employee_recalculate(uuid,uuid) from public,anon;
grant execute on function public.payroll_employee_recalculate(uuid,uuid) to authenticated;
