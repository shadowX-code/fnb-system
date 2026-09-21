-- Expose only the active exception for an attendance detail. The exception and
-- its audit trail remain private; mutations continue through the guarded RPC.
create or replace function public.crew_attendance_performance_exception_current(p_attendance_record_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_record public.crew_attendance_records%rowtype;
  v_exception jsonb;
begin
  if not public.current_user_has_permission('crew_attendance.view') then
    raise exception using errcode='42501', message='Attendance view permission is required.';
  end if;

  select * into v_record
    from public.crew_attendance_records
    where id = p_attendance_record_id;

  if not found or not public.current_user_can_access_outlet(v_record.outlet_id) then
    raise exception using errcode='42501', message='Attendance is outside your outlet scope.';
  end if;

  select jsonb_build_object(
    'id', exception.id,
    'exception_type', exception.exception_type,
    'reason', exception.reason,
    'approved_at', exception.approved_at
  ) into v_exception
  from public.crew_attendance_performance_exceptions exception
  where exception.attendance_record_id = v_record.id
    and exception.revoked_at is null
  order by exception.approved_at desc
  limit 1;

  return coalesce(v_exception, 'null'::jsonb);
end;
$$;

revoke all on function public.crew_attendance_performance_exception_current(uuid) from public, anon, authenticated;
grant execute on function public.crew_attendance_performance_exception_current(uuid) to authenticated;
