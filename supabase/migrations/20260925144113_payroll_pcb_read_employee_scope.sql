-- An entity-authorized reader must also be allowed to see every employee in
-- the Run. Return no partial PCB evidence when outlet-scoped visibility differs.
alter function public.payroll_run_pcb_read(uuid)
  rename to payroll_run_pcb_read_pre_employee_scope;
revoke all on function public.payroll_run_pcb_read_pre_employee_scope(uuid)
  from public,anon,authenticated;

create function public.payroll_run_pcb_read(p_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.payroll_admin_actor();
  if exists(select 1 from public.payroll_run_employee_ids(p_run_id) member
    where not public.payroll_can_access_employee(member.employee_id,'payroll.view')) then
    raise exception using errcode='42501',message='Payroll Run employee view authority denied.';
  end if;
  return public.payroll_run_pcb_read_pre_employee_scope(p_run_id);
end; $$;
revoke all on function public.payroll_run_pcb_read(uuid) from public,anon;
grant execute on function public.payroll_run_pcb_read(uuid) to authenticated;
