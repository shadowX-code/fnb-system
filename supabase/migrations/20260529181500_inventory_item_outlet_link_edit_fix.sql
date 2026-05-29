-- Allow Master Inventory linked outlet edits without requiring par level entry.
-- Par Level is configured later in Par Levels, so new outlet links may start unset.

alter table public.inventory_item_outlets
  alter column par_level drop not null,
  alter column par_level drop default;

drop policy if exists "inventory outlet config managers can delete configs" on public.inventory_item_outlets;
create policy "inventory outlet config managers can delete configs"
on public.inventory_item_outlets for delete to authenticated
using (
  (
    public.current_user_has_permission('inventory_master.edit')
    or public.current_user_has_permission('inventory_master.delete')
    or public.current_user_has_permission('inventory_par_levels.edit')
    or public.current_user_has_permission('inventory_control.manage_master')
  )
  and public.current_user_can_access_outlet(outlet_id)
);
