-- Project the existing canonical employment type through the token-bound Crew profile read.
create or replace function public.crew_my_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_employee public.employees%rowtype;
  v_outlet public.outlets%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_employee from public.employees where id = v_employee_id;
  if not found then
    raise exception using errcode = '42501', message = 'Crew Access is not available for this employee.';
  end if;

  select o.* into v_outlet
  from public.outlets o
  join public.crew_access a on a.primary_outlet_id = o.id
  where a.employee_id = v_employee_id;

  return jsonb_build_object(
    'full_name', v_employee.full_name,
    'nickname', v_employee.nickname,
    'birthday', v_employee.birthday,
    'joined_date', v_employee.joined_date,
    'contact', v_employee.contact,
    'position', v_employee.position,
    'outlet_name', v_outlet.name,
    'employment_type', v_employee.employment_type,
    'employment_status', v_employee.employment_status
  );
end;
$$;

revoke all on function public.crew_my_profile(text) from public, anon, authenticated;
grant execute on function public.crew_my_profile(text) to anon, authenticated;
