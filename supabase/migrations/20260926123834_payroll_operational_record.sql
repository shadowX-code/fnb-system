-- Operational draft commands delegate to the existing append-only authorities.
-- Finalized presentation reads only the immutable revision snapshots.
create or replace function public.payroll_draft_adjustment_save(
  p_request_id uuid,p_run_id uuid,p_employee_id uuid,p_action text,
  p_adjustment_id uuid,p_component_id uuid,p_amount numeric,p_remark text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_source public.payroll_run_component_adjustments%rowtype;
  v_reason text:=case when nullif(btrim(p_remark),'') is null then 'Draft adjustment '||p_action else 'Admin remark: '||btrim(p_remark) end;
  v_reverse_id uuid;
begin
  perform public.payroll_admin_actor();
  if p_request_id is null or p_action not in ('add','edit','remove') or p_action is null then
    raise exception using errcode='22023',message='Valid draft action and request identity are required.';
  end if;
  if p_action='add' then
    if p_adjustment_id is not null then raise exception using errcode='22023',message='New adjustment cannot replace an existing identity.'; end if;
    return public.payroll_run_component_add(p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,v_reason);
  end if;
  -- Match the legacy command lock order: source, then Run. Serialize edits of
  -- the same source and reject a stale replacement without losing any evidence.
  select * into v_source from public.payroll_run_component_adjustments
    where id=p_adjustment_id and reverses_id is null for update;
  if v_source.id is null or v_source.run_id is distinct from p_run_id
    or v_source.employee_id is distinct from p_employee_id then
    raise exception using errcode='22023',message='Adjustment does not belong to this employee and Run.';
  end if;
  v_reverse_id:=case when p_action='edit' then md5(p_request_id::text||':remove')::uuid else p_request_id end;
  if exists(select 1 from public.payroll_run_component_adjustments
    where reverses_id=v_source.id and id<>v_reverse_id) then
    raise exception using errcode='40001',message='This adjustment was already changed. Refresh employee payroll.';
  end if;
  perform public.payroll_run_component_reverse(v_reverse_id,v_source.id,v_reason);
  if p_action='edit' then
    return public.payroll_run_component_add(p_request_id,p_run_id,p_employee_id,p_component_id,p_amount,v_reason);
  end if;
  return v_reverse_id;
end; $$;

create or replace function public.payroll_component_save(
  p_component_id uuid,p_code text,p_name text,p_component_type text,
  p_epf_treatment text,p_socso_treatment text,p_eis_treatment text,p_pcb_treatment text,
  p_is_active boolean,p_remark text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_reason text:=coalesce(nullif(btrim(p_remark),''),'Pay Component configuration');
begin
  perform public.payroll_admin_actor();
  if p_is_active is null or p_epf_treatment not in ('included','excluded') or p_epf_treatment is null
    or p_socso_treatment not in ('included','excluded') or p_socso_treatment is null
    or p_eis_treatment not in ('included','excluded') or p_eis_treatment is null
    or p_pcb_treatment not in ('included','excluded') or p_pcb_treatment is null then
    raise exception using errcode='22023',message='Resolve all statutory wage treatments before saving.';
  end if;
  if p_component_id is null then
    v_id:=public.payroll_component_create(p_code,p_name,p_component_type,
      p_epf_treatment,p_socso_treatment,p_eis_treatment,p_pcb_treatment,v_reason);
    if p_is_active then return v_id; end if;
  else v_id:=p_component_id;
  end if;
  -- The existing update authority preserves fixed Type and finalized-use guards.
  return public.payroll_component_update(v_id,p_name,p_epf_treatment,p_socso_treatment,
    p_eis_treatment,p_pcb_treatment,p_is_active,'Admin Pay Components configuration',v_reason);
end; $$;

create or replace function public.payroll_finalized_record_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if v_run.id is null or not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll record access denied.';
  end if;
  if v_run.status not in ('finalized','paid') then
    raise exception using errcode='55000',message='Payroll record requires a finalized revision.';
  end if;
  return jsonb_build_object('run',to_jsonb(v_run),'period',to_jsonb(v_period),
    'finalized_by_name',(select full_name from public.employees where id=v_run.finalized_by_employee_id),
    'results',coalesce((select jsonb_agg(jsonb_build_object(
      'employee_id',p.employee_id,'employee_name',p.employee_name_snapshot,
      'calculation',c.calculation,'statutory',s.result) order by p.employee_name_snapshot,p.employee_id)
      from public.payroll_run_profile_snapshots p
      left join public.payroll_run_calculation_snapshots c on c.run_id=p.run_id and c.employee_id=p.employee_id
      left join public.payroll_run_statutory_snapshots s on s.run_id=p.run_id and s.employee_id=p.employee_id
      where p.run_id=v_run.id),'[]'::jsonb));
end; $$;

revoke all on function public.payroll_draft_adjustment_save(uuid,uuid,uuid,text,uuid,uuid,numeric,text) from public,anon;
revoke all on function public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text) from public,anon;
revoke all on function public.payroll_finalized_record_read(uuid) from public,anon;
grant execute on function public.payroll_draft_adjustment_save(uuid,uuid,uuid,text,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.payroll_component_save(uuid,text,text,text,text,text,text,text,boolean,text) to authenticated;
grant execute on function public.payroll_finalized_record_read(uuid) to authenticated;
