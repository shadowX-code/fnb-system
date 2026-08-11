insert into public.permissions (code, module, description)
values
  ('factory_audit_logs.view', 'Factory Audit Logs', 'View Factory Audit Logs.'),
  ('factory_audit_logs.export', 'Factory Audit Logs', 'Export Factory Audit Logs.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert on table public.audit_logs to authenticated;
alter table public.audit_logs enable row level security;

drop policy if exists "audit log viewers can view audit logs" on public.audit_logs;
create policy "audit log viewers can view audit logs"
on public.audit_logs for select to authenticated
using (
  public.current_user_has_permission('audit_logs.view')
  or (
    module = 'factory'
    and public.current_user_has_permission('factory_audit_logs.view')
  )
);

drop policy if exists "authenticated users can insert audit logs" on public.audit_logs;
create policy "authenticated users can insert audit logs"
on public.audit_logs for insert to authenticated
with check (auth.uid() is not null);
