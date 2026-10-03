-- The table guard must enforce the same dated People assignment as compensation
-- commands, rather than replacing historical employer/workplace with today's master.
create or replace function public.payroll_compensation_scope_guard()
returns trigger language plpgsql set search_path=public as $$
declare v_employee public.employees%rowtype; v_resolved_outlet uuid;
 v_assignment public.employee_employment_assignment_revisions%rowtype;
begin
 select e.* into v_employee from public.payroll_profiles p
  join public.employees e on e.id=p.employee_id where p.id=new.profile_id;
 v_assignment:=public.employee_employment_assignment_at(v_employee.id,new.effective_from);
 if v_assignment.id is not null then
  v_employee.legal_entity_id:=v_assignment.legal_entity_id;
  v_employee.workplace:=v_assignment.workplace;
 end if;
 if v_employee.id is null or v_employee.legal_entity_id is distinct from new.legal_entity_id then
  raise exception using errcode='23514',message='Payroll Legal Employer must match the effective employment assignment.';
 end if;
 if v_assignment.id is not null then
  select o.id into v_resolved_outlet from public.outlets o
   where lower(btrim(o.name))=lower(btrim(v_assignment.workplace)) or lower(btrim(o.code))=lower(btrim(v_assignment.workplace))
   order by (lower(btrim(o.name))=lower(btrim(v_assignment.workplace))) desc,o.id limit 1;
 else
  v_resolved_outlet:=public.crew_resolve_employee_outlet(v_employee.id);
 end if;
 if new.default_cost_outlet_id is not null and new.default_cost_outlet_id is distinct from v_resolved_outlet then
  raise exception using errcode='23514',message='Cost outlet must match the effective employee workplace.';
 end if;
 new.default_cost_outlet_id:=v_resolved_outlet;
 new.workplace_snapshot:=v_employee.workplace;
 return new;
end $$;
revoke all on function public.payroll_compensation_scope_guard() from public,anon,authenticated;
