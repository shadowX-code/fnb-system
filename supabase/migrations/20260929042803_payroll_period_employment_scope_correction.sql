-- A missing Joined Date is a run-level Setup Required condition even when no
-- employee can safely enter the canonical membership set.
create or replace function public.payroll_period_employment_scope_issue(p_period_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_period public.payroll_periods%rowtype; v_employee uuid; v_day date;
  v_revision public.employee_employment_assignment_revisions%rowtype;
begin
  select * into v_period from public.payroll_periods where id=p_period_id;
  if v_period.id is null then return 'employment_period_unresolved'; end if;
  if v_period.period_start<date '2026-09-29' then
    return 'employment_history_unresolved:'||v_period.period_start||'..'||
      least(v_period.period_end,date '2026-09-28');
  end if;
  for v_employee in select id from public.employees where joined_date is null loop
    for v_day in select generate_series(v_period.period_start,v_period.period_end,interval '1 day')::date loop
      v_revision:=public.employee_employment_assignment_at(v_employee,v_day);
      if v_revision.legal_entity_id=v_period.legal_entity_id
        and v_revision.employment_status='active' then
        return 'employment_joined_date_missing';
      end if;
    end loop;
  end loop;
  return null;
end $$;
revoke all on function public.payroll_period_employment_scope_issue(uuid) from public,anon,authenticated;

-- Keep the employee/outlet guard period-specific for open runs and pinned for
-- finalized runs. Neither branch trusts today's mutable Workplace.
create or replace function public.payroll_can_access_run_employee(p_run_id uuid,p_employee_id uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_period public.payroll_periods%rowtype; v_run public.payroll_runs%rowtype;
  v_workplace text; v_employment jsonb;
begin
  select * into v_run from public.payroll_runs where id=p_run_id;
  select * into v_period from public.payroll_periods where id=v_run.period_id;
  if v_period.id is null or not public.payroll_can_manage_entity(v_period.legal_entity_id,p_permission)
    or not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
      where member.employee_id=p_employee_id) then return false; end if;
  if public.current_user_has_all_outlet_access() then return true; end if;
  if v_run.status in ('finalized','paid') then
    select identity->>'workplace' into v_workplace from public.payroll_payslip_identity_snapshots
      where run_id=p_run_id and employee_id=p_employee_id;
  else
    v_employment:=public.payroll_period_employment_resolve(p_employee_id,v_period.id);
    v_workplace:=v_employment->'identity'->>'workplace';
  end if;
  return exists(select 1 from public.outlets outlet
    where public.current_user_can_access_outlet(outlet.id)
      and (lower(outlet.name)=lower(v_workplace) or lower(outlet.code)=lower(v_workplace)));
end $$;
revoke all on function public.payroll_can_access_run_employee(uuid,uuid,text) from public,anon,authenticated;

-- Run-scoped corrections/PCB must not use today's Employee employer/workplace
-- as their access or membership authority. Their financial commands are unchanged.
do $migration$
declare signature text; original text; changed text;
begin
  foreach signature in array array[
    'public.payroll_run_component_add(uuid,uuid,uuid,uuid,numeric,text)',
    'public.payroll_run_component_reverse(uuid,uuid,text)',
    'public.payroll_run_pcb_confirm(uuid,uuid,uuid,numeric,text,text,text)'] loop
    original:=pg_get_functiondef(signature::regprocedure);
    changed:=replace(original,
      $old$public.payroll_can_access_employee(p_employee_id,'payroll.manage')$old$,
      $new$public.payroll_can_access_run_employee(p_run_id,p_employee_id,'payroll.manage')$new$);
    changed:=replace(changed,
      $old$public.payroll_can_access_employee(v_source.employee_id,'payroll.manage')$old$,
      $new$public.payroll_can_access_run_employee(v_source.run_id,v_source.employee_id,'payroll.manage')$new$);
    if signature like '%payroll_run_component_add%' then
      changed:=replace(changed,
        E'or (not exists(select 1 from public.employees e where e.id=p_employee_id\n      and e.legal_entity_id=v_period.legal_entity_id)\n      and not exists(select 1 from public.payroll_profiles p\n        join public.payroll_compensation_versions c on c.profile_id=p.id\n        where p.employee_id=p_employee_id and c.legal_entity_id=v_period.legal_entity_id\n          and c.effective_from<=v_period.period_end)) then',
        E'or not exists(select 1 from public.payroll_run_employee_ids(p_run_id) member\n      where member.employee_id=p_employee_id) then');
      if changed like '%or (not exists(select 1 from public.employees e where e.id=p_employee_id%' then
        raise exception 'Current-employer validation anchor changed';
      end if;
    end if;
    if changed=original then raise exception 'Run-scoped authorization anchor changed: %',signature; end if;
    execute changed;
  end loop;
end $migration$;
