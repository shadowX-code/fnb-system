drop policy if exists "inventory waste users can view evidence photos" on storage.objects;
create policy "inventory waste users can view evidence photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_waste.view')
    or public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.view')
  )
);

drop policy if exists "inventory waste users can upload evidence photos" on storage.objects;
create policy "inventory waste users can upload evidence photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
);

drop policy if exists "inventory waste users can update evidence photos" on storage.objects;
create policy "inventory waste users can update evidence photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
)
with check (
  bucket_id = 'inventory-item-photos'
  and (
    public.current_user_has_permission('inventory_waste.create')
    or public.current_user_has_permission('inventory_waste.manage')
    or public.current_user_has_permission('inventory_control.manage')
  )
);
