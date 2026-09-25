-- Read the existing effective-dated statutory category evidence through the
-- same employee visibility boundary as Payroll Profile.
create function public.payroll_statutory_input_read(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_employee_id uuid; v_versions jsonb;
begin
  perform public.payroll_admin_actor();
  select employee_id into v_employee_id from public.payroll_profiles where id=p_profile_id;
  if v_employee_id is null then
    raise exception using errcode='P0002',message='Payroll Profile not found.';
  end if;
  if not public.payroll_can_access_employee(v_employee_id,'payroll.view') then
    raise exception using errcode='42501',message='Payroll statutory input view authority denied.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(input) order by input.effective_from desc),'[]'::jsonb)
    into v_versions from public.payroll_statutory_input_versions input
    where input.profile_id=p_profile_id;
  return jsonb_build_object('versions',v_versions);
end; $$;
revoke all on function public.payroll_statutory_input_read(uuid) from public,anon;
grant execute on function public.payroll_statutory_input_read(uuid) to authenticated;
