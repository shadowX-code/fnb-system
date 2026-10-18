-- Storage policies must not require direct grants on the protected Brand table.
-- This predicate keeps the same canonical Brand/permission checks under a controlled owner.
create function marketing_private.brand_logo_access(p_media uuid,p_upload boolean) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.actor();
begin
 return exists(select 1 from public.outlet_logo_media m join public.brands b on b.id=m.brand_id
 where m.id=p_media and marketing_private.brand_allowed(b.organization_id,b.id)
 and (not p_upload or (public.current_user_has_permission('platform_organizations.manage') and m.status='pending' and m.uploaded_by=auth.uid())));
end;$$;
revoke all on function marketing_private.brand_logo_access(uuid,boolean) from public,anon;
grant execute on function marketing_private.brand_logo_access(uuid,boolean) to authenticated;
drop policy brand_logo_media_select on public.outlet_logo_media;
create policy brand_logo_media_select on public.outlet_logo_media for select to authenticated using(marketing_private.brand_logo_access(id,false));
drop policy "brand logo upload" on storage.objects;
create policy "brand logo upload" on storage.objects for insert to authenticated with check(
 bucket_id='outlet-logos' and exists(select 1 from public.outlet_logo_media m where m.bucket_id=storage.objects.bucket_id
 and m.object_path=storage.objects.name and marketing_private.brand_logo_access(m.id,true))
);
