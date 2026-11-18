-- Derived media uses the existing private asset store, retention and revision authorities.
alter table public.marketing_assets drop constraint marketing_assets_source_kind_check;
alter table public.marketing_assets add constraint marketing_assets_source_kind_check check(source_kind in ('legacy','device','drive','prepared'));
create unique index marketing_prepared_image_identity on public.marketing_assets
 (brand_id,(source_metadata->>'source_asset_id'),(source_metadata->>'source_sha256'),(source_metadata->>'recipe'))
 where source_kind='prepared' and state in ('pending','ready');

create function public.marketing_prepare_image(p_action text,p_user uuid,p_org uuid,p_brand uuid,p_source uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; s public.marketing_assets; a public.marketing_assets; metadata jsonb;
 recipe constant text := 'instagram-feed-jpeg-white-v1'; source_hash text := p_data->>'source_sha256';
begin
 select id into actor from public.employees where auth_user_id=p_user;
 if actor is null or not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.view')
  or not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.upload') then
  raise exception using errcode='42501',message='Brand media preparation permission is required.';
 end if;
 select * into s from public.marketing_assets where id=p_source for share;
 if not found or s.organization_id is distinct from p_org or s.brand_id is distinct from p_brand or s.state<>'ready' or s.mime_type<>'image/png' then
  raise exception 'Choose an available PNG from this Brand.';
 end if;
 if p_action='source' then return to_jsonb(s);end if;
 if source_hash is null or source_hash !~ '^[0-9a-f]{64}$' or (s.sha256 is not null and s.sha256<>source_hash) then raise exception 'Original image changed. Select it again.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_source::text||recipe,0));
 select * into a from public.marketing_assets where brand_id=p_brand and source_kind='prepared'
  and source_metadata->>'source_asset_id'=s.id::text and source_metadata->>'source_sha256'=source_hash
  and source_metadata->>'recipe'=recipe and state in ('pending','ready') for update;
 if p_action='lookup' then return case when a.state='ready' and a.snapshot_verified_at is not null and a.sha256=a.source_metadata->>'output_sha256' then to_jsonb(a) else 'null'::jsonb end;end if;
 if p_action='prepare' then
  if a.id is not null then return to_jsonb(a);end if;
  if coalesce(p_data->>'output_sha256','') !~ '^[0-9a-f]{64}$' or coalesce((p_data->>'size_bytes')::bigint,0) not between 1 and 8388608 then raise exception 'A JPEG up to 8 MB is required.';end if;
  a.id:=gen_random_uuid();
  insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,created_by,storage_policy,source_kind,source_metadata)
   values(a.id,p_org,p_brand,left(regexp_replace(s.filename,'\.[^.]+$',''),170)||' - Instagram.jpg','image/jpeg',(p_data->>'size_bytes')::bigint,
    p_org::text||'/'||p_brand::text||'/'||a.id::text,actor,'temporary','prepared',
    jsonb_build_object('source_asset_id',s.id,'source_sha256',source_hash,'recipe',recipe,'output_sha256',p_data->>'output_sha256')) returning * into a;
  return to_jsonb(a);
 elsif p_action='finalize' then
  if a.id is null or a.id is distinct from (p_data->>'prepared_id')::uuid or a.source_metadata->>'output_sha256' is distinct from p_data->>'output_sha256' then raise exception 'Prepared image changed. Retry selection.';end if;
  select o.metadata into metadata from storage.objects o where bucket_id='marketing-media' and name=a.object_path;
  if metadata is null or (metadata->>'size')::bigint is distinct from a.size_bytes or metadata->>'mimetype' is distinct from 'image/jpeg' then raise exception 'Prepared image upload is incomplete. Retry preparation.';end if;
  if a.state='ready' then return to_jsonb(a);end if;
  update public.marketing_assets set state='ready',sha256=p_data->>'output_sha256',snapshot_verified_at=now() where id=a.id returning * into a;
  insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details)
   values(p_org,p_brand,'instagram_image_prepared',actor,jsonb_build_object('asset_id',a.id,'source_asset_id',s.id,'recipe',recipe));
  return to_jsonb(a);
 end if;
 raise exception 'Unsupported image preparation action.';
end;$$;
revoke all on function public.marketing_prepare_image(text,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_prepare_image(text,uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Prepared JPEGs can only be finalized through byte/dimension/source-hash verification.
-- Keep ordinary Drive/device finalization unchanged.
do $guard$
declare d text; needle text;
begin
 d:=pg_get_functiondef('public.marketing_drive_asset(uuid,uuid)'::regprocedure);
 needle:='a.storage_policy<>''temporary'' or a.state not in (''pending'',''ready'')';
 if strpos(d,needle)=0 then raise exception 'Unexpected asset upload authority; review before applying.';end if;
 execute replace(d,needle,'a.storage_policy<>''temporary'' or a.source_kind=''prepared'' or a.state not in (''pending'',''ready'')');
 d:=pg_get_functiondef('public.marketing_drive_server(text,uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:='a.created_by is distinct from actor or a.storage_policy<>''temporary'' or a.state not in (''pending'',''ready'')';
 if strpos(d,needle)=0 then raise exception 'Unexpected Drive finalize authority; review before applying.';end if;
 execute replace(d,needle,'a.created_by is distinct from actor or a.storage_policy<>''temporary'' or a.source_kind=''prepared'' or a.state not in (''pending'',''ready'')');
end;$guard$;
