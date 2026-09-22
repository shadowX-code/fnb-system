-- Storage's remove endpoint resolves an object before deleting it. Keep the
-- object selectable while the controlled delete workflow has marked its
-- metadata row as deleting; otherwise DELETE matches no object and the
-- finalizer correctly refuses to remove the metadata record.
drop policy if exists "crew sop admins read media" on storage.objects;

create policy "crew sop admins read media"
on storage.objects for select to authenticated
using (
  bucket_id = 'crew-sop-media'
  and exists (
    select 1
    from public.crew_sop_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status in ('pending', 'ready', 'deleting')
      and public.current_user_has_permission('crew_sop.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);
