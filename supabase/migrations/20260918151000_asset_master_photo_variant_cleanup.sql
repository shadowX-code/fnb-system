-- Only normalized Asset master variants are eligible for ordinary Admin
-- cleanup. Inspection evidence paths stay immutable and outside this policy.

drop policy if exists "asset tracking editors can delete master photo variants" on storage.objects;
create policy "asset tracking editors can delete master photo variants"
on storage.objects for delete to authenticated
using (
  bucket_id = 'asset-photos'
  and name like 'asset_master/%'
  and (
    public.current_user_has_permission('asset_tracking.create')
    or public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
  )
);
