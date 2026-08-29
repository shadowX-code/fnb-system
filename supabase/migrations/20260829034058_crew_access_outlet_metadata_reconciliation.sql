-- Phase A still resolves an employee's canonical outlet from Employee Master
-- workplace text. Outlet name/code edits can therefore change that resolver
-- without touching employees.workplace. Reconcile only affected Crew Access
-- mirrors, revoke their active Crew sessions, and preserve an audit trail.

create or replace function public.crew_access_reconcile_outlet_metadata_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_current_outlet_id uuid;
  v_revoked_sessions integer;
begin
  if new.name is not distinct from old.name
    and new.code is not distinct from old.code then
    return new;
  end if;

  for v_access in
    select ca.employee_id,
           ca.primary_outlet_id as previous_outlet_id
    from public.crew_access ca
    join public.employees e on e.id = ca.employee_id
    where ca.primary_outlet_id = new.id
       or public.crew_resolve_employee_outlet(e.id) = new.id
    for update of ca
  loop
    v_current_outlet_id := public.crew_resolve_employee_outlet(v_access.employee_id);
    if v_access.previous_outlet_id is not distinct from v_current_outlet_id then
      continue;
    end if;

    update public.crew_access
    set primary_outlet_id = v_current_outlet_id,
        updated_at = now()
    where employee_id = v_access.employee_id;

    update public.crew_sessions
    set revoked_at = now()
    where employee_id = v_access.employee_id
      and revoked_at is null;
    get diagnostics v_revoked_sessions = row_count;

    insert into public.audit_logs(action, module, description, metadata)
    values (
      'crew_access_outlet_metadata_scope_reconciled',
      'crew',
      'Crew Access outlet scope reconciled after outlet metadata changed.',
      jsonb_build_object(
        'employee_id', v_access.employee_id,
        'actor_id', auth.uid(),
        'outlet_id', new.id,
        'previous_outlet_id', v_access.previous_outlet_id,
        'current_outlet_id', v_current_outlet_id,
        'previous_name', old.name,
        'current_name', new.name,
        'previous_code', old.code,
        'current_code', new.code,
        'revoked_session_count', v_revoked_sessions
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists crew_access_outlet_metadata_scope_reconcile on public.outlets;
create trigger crew_access_outlet_metadata_scope_reconcile
after update of name, code on public.outlets
for each row execute function public.crew_access_reconcile_outlet_metadata_scope();

revoke all on function public.crew_access_reconcile_outlet_metadata_scope() from public, anon, authenticated;
