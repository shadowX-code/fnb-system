-- Allow outlet-scoped Crew Learning administrators to resolve their visible
-- outlet context without broadening any mutation authority.
drop policy if exists "crew learning admins can view scoped outlets" on public.outlets;
create policy "crew learning admins can view scoped outlets"
on public.outlets
for select
to authenticated
using (
  (
    public.current_user_has_permission('crew_learning.view')
    or public.current_user_has_permission('crew_learning.manage')
    or public.current_user_has_permission('crew_sop.view')
    or public.current_user_has_permission('crew_sop.manage')
  )
  and public.current_user_can_access_outlet(id)
);

comment on policy "crew learning admins can view scoped outlets" on public.outlets is
  'Read-only outlet context for Crew Learning/SOP administrators; role_outlets remains authoritative.';
