-- Task references share canonical private assets; Publishing MIME validation is unchanged.
alter table public.marketing_assets drop constraint marketing_assets_mime_type_check;
alter table public.marketing_assets add constraint marketing_assets_mime_type_check
 check(mime_type in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf'));
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','video/mp4','application/pdf']
 where id='marketing-media' and public=false;

do $$
declare definition text; updated text;
begin
 select pg_get_functiondef('public.marketing_drive_server(text,uuid,uuid,uuid,jsonb)'::regprocedure) into definition;
 updated:=replace(definition,$old$p_data->>'mime_type' not in ('image/jpeg','image/png','image/webp','video/mp4')$old$,
 $new$p_data->>'mime_type' not in ('image/jpeg','image/png','image/webp','video/mp4','application/pdf')$new$);
 if updated=definition then raise exception 'Unexpected media preparation contract; review before applying.';end if;
 updated:=replace(updated,'Use JPG, PNG, WebP or MP4 up to 100 MB.','Use JPG, PNG, WebP, MP4 or PDF up to 100 MB.');
 execute updated;
end;$$;
