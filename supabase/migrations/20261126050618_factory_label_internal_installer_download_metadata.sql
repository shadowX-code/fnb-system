-- The hosted Storage CDN first checks the authenticated object's metadata.
alter policy "factory authorized internal bridge downloads"
on storage.objects
using (
  bucket_id = 'factory-print-bridge-installers'
  and name in (
    '1.3.0/FeedX-Print-Bridge-Production-Windows.exe',
    '1.3.0/FeedX-Print-Bridge-Production-macOS-arm64.pkg'
  )
  and (
    storage.allow_only_operation('object.get_authenticated')
    or storage.allow_only_operation('object.get_authenticated_info')
  )
  and (select public.factory_label_installer_access())
);
