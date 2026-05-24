-- Outlet management writes must also respect role outlet scope.
-- Creating a new outlet remains permission-based; editing/deleting existing
-- outlets requires access to that outlet unless the role is owner/admin.

drop policy if exists "outlet creators can insert outlets" on public.outlets;
create policy "outlet creators can insert outlets"
on public.outlets for insert to authenticated
with check (public.current_user_has_permission('outlets.create'));

drop policy if exists "outlet editors can update outlets" on public.outlets;
create policy "outlet editors can update outlets"
on public.outlets for update to authenticated
using (public.current_user_has_permission('outlets.edit') and public.current_user_can_access_outlet(id))
with check (public.current_user_has_permission('outlets.edit') and public.current_user_can_access_outlet(id));

drop policy if exists "outlet deleters can delete outlets" on public.outlets;
create policy "outlet deleters can delete outlets"
on public.outlets for delete to authenticated
using (public.current_user_has_permission('outlets.delete') and public.current_user_can_access_outlet(id));
