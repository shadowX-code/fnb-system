-- Align the existing Crew Access mirror with Employee Master after introducing
-- fail-closed session scope validation. This is a one-time compatibility
-- backfill only; future workplace changes use the trigger from 20260828125052.
do $$
declare
  v_access record;
  v_revoked_sessions integer;
begin
  for v_access in
    select ca.employee_id,
           ca.primary_outlet_id as previous_outlet_id,
           public.crew_resolve_employee_outlet(ca.employee_id) as current_outlet_id
    from public.crew_access ca
    where ca.primary_outlet_id is distinct from public.crew_resolve_employee_outlet(ca.employee_id)
  loop
    update public.crew_access
    set primary_outlet_id = v_access.current_outlet_id,
        updated_at = now()
    where employee_id = v_access.employee_id;

    update public.crew_sessions
    set revoked_at = now()
    where employee_id = v_access.employee_id
      and revoked_at is null;
    get diagnostics v_revoked_sessions = row_count;

    insert into public.audit_logs(action, module, description, metadata)
    values (
      'crew_access_outlet_scope_backfilled',
      'crew',
      'Crew Access outlet scope aligned to the current Employee Master workplace.',
      jsonb_build_object(
        'employee_id', v_access.employee_id,
        'previous_outlet_id', v_access.previous_outlet_id,
        'current_outlet_id', v_access.current_outlet_id,
        'revoked_session_count', v_revoked_sessions
      )
    );
  end loop;
end;
$$;
