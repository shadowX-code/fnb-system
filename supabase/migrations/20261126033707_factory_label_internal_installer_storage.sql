insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'factory-print-bridge-installers', 'factory-print-bridge-installers', false, 20971520,
  array['application/octet-stream']::text[]
);

create function public.factory_label_installer_access() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_has_permission('factory_production.complete')
    and exists (
      select 1 from public.employees
      where auth_user_id = (select auth.uid()) and lower(employment_status) = 'active'
    );
$$;

revoke all on function public.factory_label_installer_access() from public, anon, authenticated;
grant execute on function public.factory_label_installer_access() to authenticated;

create policy "factory authorized internal bridge downloads"
on storage.objects for select to authenticated
using (
  bucket_id = 'factory-print-bridge-installers'
  and name in (
    '1.3.0/FeedX-Print-Bridge-Production-Windows.exe',
    '1.3.0/FeedX-Print-Bridge-Production-macOS-arm64.pkg'
  )
  and storage.allow_only_operation('object.get_authenticated')
  and (select public.factory_label_installer_access())
);
