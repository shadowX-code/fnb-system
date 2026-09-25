-- Cost attribution is a People workplace projection, never a client-selected outlet.
create or replace function public.payroll_compensation_scope_guard()
returns trigger language plpgsql set search_path=public as $$
declare v_employee public.employees%rowtype; v_resolved_outlet uuid;
begin
  select e.* into v_employee from public.payroll_profiles p
    join public.employees e on e.id=p.employee_id where p.id=new.profile_id;
  if v_employee.id is null or v_employee.legal_entity_id is distinct from new.legal_entity_id then
    raise exception using errcode='23514',message='Payroll Legal Employer must match the employee assignment.';
  end if;
  v_resolved_outlet:=public.crew_resolve_employee_outlet(v_employee.id);
  if new.default_cost_outlet_id is not null and new.default_cost_outlet_id is distinct from v_resolved_outlet then
    raise exception using errcode='23514',message='Cost outlet must match the canonical employee workplace.';
  end if;
  new.default_cost_outlet_id:=v_resolved_outlet;
  new.workplace_snapshot:=v_employee.workplace;
  return new;
end; $$;
create trigger payroll_compensation_scope_guard before insert on public.payroll_compensation_versions
  for each row execute function public.payroll_compensation_scope_guard();
revoke all on function public.payroll_compensation_scope_guard() from public,anon,authenticated;
