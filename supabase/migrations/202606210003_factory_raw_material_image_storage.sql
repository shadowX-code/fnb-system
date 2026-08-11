-- Factory raw material image storage.
-- Stores uploaded raw material images; raw material records keep the public URL in image_url.

insert into storage.buckets (id, name, public)
values ('raw-material-images', 'raw-material-images', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "factory raw material image viewers can view" on storage.objects;
create policy "factory raw material image viewers can view"
on storage.objects for select to authenticated
using (
  bucket_id = 'raw-material-images'
  and (
    public.current_user_has_permission('factory_dashboard.view')
    or public.current_user_has_permission('factory_raw_inventory.view')
    or public.current_user_has_permission('factory_raw_receiving.view')
    or public.current_user_has_permission('factory_product_recipes.view')
    or public.current_user_has_permission('factory_production.complete')
  )
);

drop policy if exists "factory raw material image editors can upload" on storage.objects;
create policy "factory raw material image editors can upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'raw-material-images'
  and (
    public.current_user_has_permission('factory_raw_inventory.create')
    or public.current_user_has_permission('factory_raw_inventory.edit')
    or public.current_user_has_permission('factory_raw_inventory.manage')
  )
);

drop policy if exists "factory raw material image editors can update" on storage.objects;
create policy "factory raw material image editors can update"
on storage.objects for update to authenticated
using (
  bucket_id = 'raw-material-images'
  and (
    public.current_user_has_permission('factory_raw_inventory.create')
    or public.current_user_has_permission('factory_raw_inventory.edit')
    or public.current_user_has_permission('factory_raw_inventory.manage')
  )
)
with check (
  bucket_id = 'raw-material-images'
  and (
    public.current_user_has_permission('factory_raw_inventory.create')
    or public.current_user_has_permission('factory_raw_inventory.edit')
    or public.current_user_has_permission('factory_raw_inventory.manage')
  )
);

drop policy if exists "factory raw material image editors can delete" on storage.objects;
create policy "factory raw material image editors can delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'raw-material-images'
  and (
    public.current_user_has_permission('factory_raw_inventory.edit')
    or public.current_user_has_permission('factory_raw_inventory.manage')
  )
);
