-- Preparation consumes the existing calculation authority, including its time
-- dependencies. It never promotes later setup into earlier payroll evidence.
create function public.payroll_run_preparation_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_run public.payroll_runs%rowtype; v_period public.payroll_periods%rowtype;
  v_member record; v_projection jsonb; v_setup jsonb; v_rows jsonb:='[]'::jsonb;
begin
  perform public.payroll_admin_actor();
  select * into v_run from public.payroll_runs where id=p_run_id;
  if v_run.id is null then raise exception using errcode='P0002',message='Payroll Run not found.'; end if;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if not public.payroll_can_manage_entity(v_period.legal_entity_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll Run view authority denied.';
  end if;
  for v_member in select m.employee_id,p.id profile_id from public.payroll_run_employee_ids(p_run_id) m
    left join public.payroll_profiles p on p.employee_id=m.employee_id loop
    if not public.payroll_can_access_employee(v_member.employee_id,'payroll.view') then
      raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
    end if;
    if v_run.status in ('finalized','paid') then
      select s.calculation into v_projection from public.payroll_run_calculation_snapshots s
        where s.run_id=p_run_id and s.employee_id=v_member.employee_id;
      v_setup:=null; -- final review uses pinned statutory results, not today's setup
    else
      v_projection:=public.payroll_calculation_project(p_run_id,v_member.employee_id);
      v_setup:=case when v_member.profile_id is not null then
        public.payroll_statutory_setup_resolve(v_member.profile_id,v_period.period_start,null) else null end;
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('employee_id',v_member.employee_id,
      'projection',v_projection,'statutory_setup',v_setup,
      'time_relevant',coalesce(v_projection->>'pay_basis'='hourly',false)
        or coalesce(jsonb_array_length(v_projection->'inputs'->'time'),0)>0));
  end loop;
  return jsonb_build_object('results',v_rows,'period_start',v_period.period_start,'period_end',v_period.period_end);
end; $$;
revoke all on function public.payroll_run_preparation_read(uuid) from public,anon;
grant execute on function public.payroll_run_preparation_read(uuid) to authenticated;
