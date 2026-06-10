-- Repair Asset Category table grants and RLS policies for production.
-- Asset categories are saved directly through Supabase table access, so authenticated table grants
-- must exist in addition to RBAC-backed RLS policies.

revoke all on table public.asset_categories from anon;
grant select, insert, update, delete on table public.asset_categories to authenticated;

alter table public.asset_categories enable row level security;

drop policy if exists "asset tracking viewers can view categories" on public.asset_categories;
drop policy if exists "asset tracking creators can create categories" on public.asset_categories;
drop policy if exists "asset tracking editors can update categories" on public.asset_categories;
drop policy if exists "asset tracking deleters can delete categories" on public.asset_categories;

drop policy if exists asset_categories_select on public.asset_categories;
create policy asset_categories_select
on public.asset_categories for select to authenticated
using (public.current_user_has_permission('asset_tracking.view'));

drop policy if exists asset_categories_insert on public.asset_categories;
create policy asset_categories_insert
on public.asset_categories for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.create'));

drop policy if exists asset_categories_update on public.asset_categories;
create policy asset_categories_update
on public.asset_categories for update to authenticated
using (
  public.current_user_has_permission('asset_tracking.edit')
  or public.current_user_has_permission('asset_tracking.delete')
)
with check (
  public.current_user_has_permission('asset_tracking.edit')
  or public.current_user_has_permission('asset_tracking.delete')
);

drop policy if exists asset_categories_delete on public.asset_categories;
create policy asset_categories_delete
on public.asset_categories for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete'));
