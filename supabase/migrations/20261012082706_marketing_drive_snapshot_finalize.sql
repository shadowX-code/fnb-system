-- Avoid collision with the private OAuth session record in actual Storage metadata verification.
create or replace function public.marketing_drive_server(p_action text,p_user uuid,p_org uuid,p_brand uuid default null,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid; c marketing_private.drive_connections; o marketing_private.drive_oauth; a public.marketing_assets; result jsonb; admin boolean; metadata jsonb;
begin
 if p_action in ('oauth_consume','oauth_finish') then
  select * into o from marketing_private.drive_oauth where state_hash=p_data->>'state_hash' for update;
  if not found or o.expires_at<now() or (p_action='oauth_consume' and o.consumed_at is not null) or (p_action='oauth_finish' and o.consumed_at is null) then raise exception 'Authorization expired. Connect again.';end if;
  p_org:=o.organization_id;actor:=o.actor;
 else select id into actor from public.employees where auth_user_id=p_user;end if;
 admin:=marketing_private.drive_admin(actor,p_org);
 if p_action in ('context','material','guard','prepare','finalize','refresh','expired') then
  if not admin and not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.view') then raise exception using errcode='42501',message='Brand media access is unavailable.';end if;
 else if not admin then raise exception using errcode='42501',message='Organization administrator access is required.';end if;end if;
 select * into c from marketing_private.drive_connections where organization_id=p_org for update;
 if p_action='context' then
  return jsonb_build_object('status',coalesce(c.status,'disconnected'),'account',c.account,'expires_at',c.expires_at,'can_manage',admin,
   'root',(select to_jsonb(r) from marketing_private.drive_roots r where r.organization_id=p_org and r.brand_id=p_brand),
   'mappings',case when admin then (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) else '[]'::jsonb end);
 elsif p_action in ('material','guard') then
  if c.status<>'connected' or c.sealed_token is null then raise exception 'Connect or reconnect Google Drive in Marketing Settings.';end if;
  if p_action='guard' and (c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from marketing_private.drive_roots r where r.brand_id=p_brand and r.revision::text=p_data->>'revision')) then raise exception 'Brand folder access changed. Refresh the library.';end if;
  return to_jsonb(c)||jsonb_build_object('root',(select to_jsonb(r) from marketing_private.drive_roots r where r.organization_id=p_org and r.brand_id=p_brand),'mappings',case when admin then (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) else '[]'::jsonb end);
 elsif p_action='begin' then
  insert into marketing_private.drive_connections(organization_id) values(p_org) on conflict do nothing;
  select * into c from marketing_private.drive_connections where organization_id=p_org;
  delete from marketing_private.drive_oauth where expires_at<now();
  insert into marketing_private.drive_oauth(state_hash,organization_id,actor,generation,sealed_verifier) values(p_data->>'state_hash',p_org,actor,c.generation,p_data->'sealed_verifier');
  return jsonb_build_object('generation',c.generation);
 elsif p_action='oauth_consume' then
  if c.generation is distinct from o.generation then raise exception 'Connection changed. Connect again.';end if;
  update marketing_private.drive_oauth set consumed_at=now() where state_hash=o.state_hash;
  return to_jsonb(o)||jsonb_build_object('connection',to_jsonb(c));
 elsif p_action='oauth_finish' then
  if c.generation is distinct from o.generation then raise exception 'Connection changed. Connect again.';end if;
  if c.account->>'permissionId' is distinct from p_data->'account'->>'permissionId' then delete from marketing_private.drive_roots where organization_id=p_org;end if;
  update marketing_private.drive_connections set generation=generation+1,status='connected',account=p_data->'account',sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,updated_at=now() where organization_id=p_org;
  update marketing_private.drive_roots set generation=c.generation+1,revision=gen_random_uuid() where organization_id=p_org;
  delete from marketing_private.drive_oauth where state_hash=o.state_hash;
 elsif p_action='refresh' then
  if c.generation is distinct from (p_data->>'generation')::integer then raise exception 'Connection changed.';end if;
  update marketing_private.drive_connections set sealed_token=p_data->'sealed_token',expires_at=(p_data->>'expires_at')::timestamptz,updated_at=now() where organization_id=p_org;
 elsif p_action='expired' then
  update marketing_private.drive_connections set status='expired',updated_at=now() where organization_id=p_org and generation=(p_data->>'generation')::integer;
 elsif p_action='disconnect' then
  update marketing_private.drive_connections set status='disconnected',generation=generation+1,sealed_token=null,expires_at=null,updated_at=now() where organization_id=p_org;
  delete from marketing_private.drive_oauth where organization_id=p_org;
 elsif p_action='map' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from public.brands where id=p_brand and organization_id=p_org) then raise exception 'Connection or brand changed.';end if;
  -- Reject stale overlap checks after a concurrent mapping update.
  if coalesce(p_data->'mappings','[]') is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.brand_id),'[]') from marketing_private.drive_roots r where r.organization_id=p_org) then raise exception 'Folder mappings changed. Review and save again.';end if;
  insert into marketing_private.drive_roots(brand_id,organization_id,root_id,root_name,favorites_id,generation) values(p_brand,p_org,p_data->>'root_id',p_data->>'root_name',nullif(p_data->>'favorites_id',''),c.generation)
  on conflict(brand_id) do update set root_id=excluded.root_id,root_name=excluded.root_name,favorites_id=excluded.favorites_id,generation=excluded.generation,revision=gen_random_uuid();
 elsif p_action='prepare' then
  if not marketing_private.actor_allowed(actor,p_org,p_brand,'marketing_content.upload') or not exists(select 1 from public.brands where id=p_brand and organization_id=p_org) then raise exception 'Brand media upload permission is required.';end if;
  if p_data->>'source_kind' not in ('device','drive') or length(trim(p_data->>'filename')) not between 1 and 200 or (p_data->>'size_bytes')::bigint not between 1 and 104857600 or p_data->>'mime_type' not in ('image/jpeg','image/png','image/webp','video/mp4') then raise exception 'Use JPG, PNG, WebP or MP4 up to 100 MB.';end if;
  if p_data->>'source_kind'='drive' and (c.generation is distinct from (p_data->>'generation')::integer or not exists(select 1 from marketing_private.drive_roots where brand_id=p_brand and revision::text=p_data->>'revision')) then raise exception 'Brand folder changed.';end if;
  -- Deduplicate exact immutable Drive source versions in one brand, never across brands.
  if p_data->>'source_kind'='drive' then
   perform pg_advisory_xact_lock(hashtextextended(p_brand::text||coalesce(p_data->'source_metadata'->>'file_id',''),0));
   select * into a from public.marketing_assets where brand_id=p_brand and source_kind='drive' and state='ready' and source_metadata=p_data->'source_metadata' and sha256=p_data->>'sha256' limit 1;
   if found then return to_jsonb(a)||jsonb_build_object('reused',true);end if;
  end if;
  a.id:=gen_random_uuid();
  insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,created_by,storage_policy,source_kind,source_metadata)
  values(a.id,p_org,p_brand,p_data->>'filename',p_data->>'mime_type',(p_data->>'size_bytes')::bigint,p_org::text||'/'||p_brand::text||'/'||a.id::text,actor,'temporary',p_data->>'source_kind',coalesce(p_data->'source_metadata','{}')) returning * into a;
  return to_jsonb(a)||jsonb_build_object('bucket','marketing-media');
 elsif p_action='finalize' then
  select * into a from public.marketing_assets where id=(p_data->>'id')::uuid for update;
  if a.organization_id is distinct from p_org or a.brand_id is distinct from p_brand or a.created_by is distinct from actor or a.storage_policy<>'temporary' or a.state not in ('pending','ready') then raise exception 'Upload is unavailable.';end if;
  if p_data->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Verified media bytes are required.';end if;
  select stored_object.metadata into metadata from storage.objects stored_object where bucket_id='marketing-media' and name=a.object_path;
  if metadata is null or (metadata->>'size')::bigint is distinct from a.size_bytes or metadata->>'mimetype' is distinct from a.mime_type then raise exception 'Uploaded file does not match its snapshot.';end if;
  update public.marketing_assets set state='ready',sha256=p_data->>'sha256',snapshot_verified_at=now() where id=a.id returning * into a;
  return to_jsonb(a);
 else raise exception 'Unsupported Drive action.';end if;
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(p_org,p_brand,'drive_'||p_action,actor,'{}');
 return jsonb_build_object('ok',true);
end;$$;
