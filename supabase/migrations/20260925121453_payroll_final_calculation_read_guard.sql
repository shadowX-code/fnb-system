-- A finalized Run is read from its pinned calculation/profile snapshots,
-- never from a fresh projection of subsequently changed inputs.
create or replace function public.payroll_run_calculation_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_rows jsonb; v_adjustments jsonb; v_readiness jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  if v_run.status in ('finalized','paid') then
    select coalesce(jsonb_agg(s.calculation || jsonb_build_object(
      'employee_name',coalesce(p.employee_name_snapshot,e.full_name),
      'employee_code',e.employee_code,'is_stale',false)
      order by coalesce(p.employee_name_snapshot,e.full_name)),'[]'::jsonb) into v_rows
    from public.payroll_run_calculation_snapshots s
      join public.employees e on e.id=s.employee_id
      left join public.payroll_run_profile_snapshots p
        on p.run_id=s.run_id and p.employee_id=s.employee_id
    where s.run_id=p_run_id;
    v_readiness:=jsonb_build_object('ready',jsonb_array_length(v_rows)>0,
      'employees',jsonb_array_length(v_rows),'review_required',0,'uncalculated',0,
      'stale',0,'period_in_progress',false,'pinned',true);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'employee_id',e.id,'employee_name',e.full_name,'employee_code',e.employee_code,
      'revision',c.revision,'pay_basis',c.pay_basis,'basic_or_hours',c.basic_or_hours,
      'status',c.status,'issues',to_jsonb(c.issues),'lines',c.lines,'inputs',c.inputs,
      'is_stale',c.input_fingerprint is distinct from
        (public.payroll_calculation_project(p_run_id,c.employee_id)->>'input_fingerprint'),
      'gross_earnings',c.gross_earnings,'non_statutory_deductions',c.non_statutory_deductions,
      'reimbursements',c.reimbursements,'pre_statutory_pay',c.pre_statutory_pay,
      'calculated_at',c.calculated_at) order by e.full_name),'[]'::jsonb) into v_rows
    from public.payroll_run_calculation_versions c join public.employees e on e.id=c.employee_id
    where c.run_id=p_run_id and not exists(select 1 from public.payroll_run_calculation_versions newer
      where newer.run_id=c.run_id and newer.employee_id=c.employee_id and newer.revision>c.revision);
    v_readiness:=public.payroll_run_calculation_readiness(p_run_id);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,
    'component_id',a.component_id,'component_name',d.name,'component_type',d.component_type,
    'amount',a.amount,'reason',a.reason,'created_at',a.created_at) order by a.created_at),'[]'::jsonb)
    into v_adjustments
  from public.payroll_run_component_adjustments a
    join public.payroll_component_definitions d on d.id=a.component_id
  where a.run_id=p_run_id and a.reverses_id is null
    and not exists(select 1 from public.payroll_run_component_adjustments reverse where reverse.reverses_id=a.id);
  return jsonb_build_object('results',v_rows,'adjustments',v_adjustments,'readiness',v_readiness);
end; $$;
