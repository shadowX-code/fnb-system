-- Reporting Admins need a scoped outlet list to select an outlet before the
-- existing Reporting RPCs can enforce the same server-side scope.
create policy "report viewers can view scoped outlets"
on public.outlets
for select
to authenticated
using (
  public.current_user_has_permission('reports.view')
  and public.current_user_can_access_outlet(id)
);

comment on policy "report viewers can view scoped outlets" on public.outlets is
  'Allows reports.view users to resolve only outlets already permitted by their server-side outlet scope.';
