-- Software release assets only; preserve the PDF-only payslip artifact bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payroll-renderer-assets','payroll-renderer-assets',false,16777216,array['application/gzip'])
on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='payroll-renderer-assets' and public)
  then raise exception 'Renderer release assets must be private'; end if;
end $$;
-- No client storage policies or grants. Deployment/service access only.
