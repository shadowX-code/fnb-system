-- Permit Leave admins to load only outlets already allowed by FeedX scope.
drop policy if exists "crew leave admins can view scoped outlets" on public.outlets;
create policy "crew leave admins can view scoped outlets" on public.outlets for select to authenticated
using (public.current_user_has_permission('crew_leave.view') and public.current_user_can_access_outlet(id));
