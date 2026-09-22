-- Crew Mobile: minimal, token-bound personal profile and bounded attendance history.
-- These are read models only; employment and attendance remain authoritative elsewhere.

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
    'employment_status', v_employee.employment_status
  );
end;
$$;

create or replace function public.crew_my_attendance_month(p_token text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_current_month date := date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date;
  v_month date := date_trunc('month', coalesce(p_month, v_current_month))::date;
  v_from timestamptz;
  v_to timestamptz;
begin
  v_employee_id := public.crew_session_employee(p_token);
  if v_month not in (v_current_month, (v_current_month - interval '1 month')::date, (v_current_month - interval '2 months')::date) then
    raise exception using errcode = '22023', message = 'Attendance history is available for the current and previous two months.';
  end if;
  v_from := (v_month::timestamp at time zone 'Asia/Kuala_Lumpur');
  v_to := ((v_month + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur');
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.clock_in_at desc)
    from public.crew_attendance_records r
    where r.employee_id = v_employee_id
      and r.clock_in_at >= v_from and r.clock_in_at < v_to
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.crew_my_profile(text) from public, anon, authenticated;
revoke all on function public.crew_my_attendance_month(text, date) from public, anon, authenticated;
grant execute on function public.crew_my_profile(text) to anon, authenticated;
grant execute on function public.crew_my_attendance_month(text, date) to anon, authenticated;
