-- Resolve PL/pgSQL variable/column ambiguity in the token-bound Crew context.
create or replace function public.crew_operations_employee_context(p_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_employee_id uuid; v_employee public.employees%rowtype; v_access public.crew_access%rowtype;
begin
 v_employee_id:=public.crew_session_employee(p_token);
 select e.* into v_employee from public.employees e
 where e.id=v_employee_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated');
 select ca.* into v_access from public.crew_access ca
 where ca.employee_id=v_employee.id and ca.access_state='active';
 if v_employee.id is null or v_access.employee_id is null then
   raise exception using errcode='42501',message='Crew Operations access is unavailable.';
 end if;
 return jsonb_build_object('employee_id',v_employee.id,'employee_name',v_employee.full_name,'position',v_employee.position,'role_id',v_employee.role_id,'outlet_id',v_access.primary_outlet_id);
end; $$;
revoke all on function public.crew_operations_employee_context(text) from public,anon,authenticated;
