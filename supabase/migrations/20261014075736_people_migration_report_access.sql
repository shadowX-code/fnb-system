-- People-owned immutable migration evidence, not an anonymous reporting surface.
-- Preserve all retained rows and the established administrative SELECT grant.
alter table public.employee_employment_structure_migration_report enable row level security;
revoke all on public.employee_employment_structure_migration_report from public,anon,authenticated;
grant select on public.employee_employment_structure_migration_report to authenticated;
grant all on public.employee_employment_structure_migration_report to service_role;
create policy "People viewers can read visible employee migration evidence"
on public.employee_employment_structure_migration_report for select to authenticated
using (public.current_user_has_permission('employees.view') and exists(
 select 1 from public.employees e where e.id=employee_employment_structure_migration_report.employee_id
));
