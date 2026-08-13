-- Private, version-aware media for Crew SOP documents.
-- Sections persist only media UUIDs and captions. Object paths stay private;
-- Crew receives short-lived URLs only after an opaque-session SOP access check.

alter table public.crew_sop_versions
  add constraint crew_sop_versions_id_sop_unique unique (id, sop_id);

create table public.crew_sop_media (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  sop_id uuid not null references public.crew_sops(id) on delete restrict,
  sop_version_id uuid not null references public.crew_sop_versions(id) on delete restrict,
  bucket_id text not null default 'crew-sop-media' check (bucket_id = 'crew-sop-media'),
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  status text not null default 'pending' check (status in ('pending', 'ready', 'deleting')),
  uploaded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_sop_media_version_matches_sop
    foreign key (sop_version_id, sop_id) references public.crew_sop_versions(id, sop_id) on delete restrict
);

create index crew_sop_media_scope_idx
  on public.crew_sop_media(outlet_id, sop_id, sop_version_id, status, created_at desc);

alter table public.crew_sop_media enable row level security;
revoke all on table public.crew_sop_media from public, anon, authenticated;
grant select on table public.crew_sop_media to authenticated;

create policy crew_sop_media_admin_select
on public.crew_sop_media for select to authenticated
using (
  public.current_user_has_permission('crew_sop.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

alter table public.crew_sop_sections
  add column media_id uuid references public.crew_sop_media(id) on delete restrict,
  add column media_caption text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'crew-sop-media', 'crew-sop-media', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "crew sop admins upload media" on storage.objects;
create policy "crew sop admins upload media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'crew-sop-media'
  and exists (
    select 1 from public.crew_sop_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status = 'pending'
      and media.uploaded_by = auth.uid()
      and public.current_user_has_permission('crew_sop.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

drop policy if exists "crew sop admins read media" on storage.objects;
create policy "crew sop admins read media"
on storage.objects for select to authenticated
using (
  bucket_id = 'crew-sop-media'
  and exists (
    select 1 from public.crew_sop_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status in ('pending', 'ready')
      and public.current_user_has_permission('crew_sop.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

drop policy if exists "crew sop admins delete prepared media" on storage.objects;
create policy "crew sop admins delete prepared media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'crew-sop-media'
  and exists (
    select 1 from public.crew_sop_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status = 'deleting'
      and public.current_user_has_permission('crew_sop.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

create or replace function public.crew_prepare_sop_media_upload(
  p_sop_version_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_width integer default null,
  p_height integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_media_id uuid := gen_random_uuid();
  v_sop_id uuid;
  v_outlet_id uuid;
  v_status text;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_name text;
  v_path text;
begin
  select v.sop_id, s.outlet_id, v.status
  into v_sop_id, v_outlet_id, v_status
  from public.crew_sop_versions v
  join public.crew_sops s on s.id = v.sop_id
  where v.id = p_sop_version_id;

  if auth.uid() is null or v_status <> 'draft'
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot upload media for this SOP draft.';
  end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = '22023', message = 'Only JPG, PNG, and WebP images are supported.';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 5242880 then
    raise exception using errcode = '22023', message = 'SOP images must be 5MB or smaller.';
  end if;
  if (p_width is not null and p_width <= 0) or (p_height is not null and p_height <= 0) then
    raise exception using errcode = '22023', message = 'Image dimensions are invalid.';
  end if;

  v_name := left(regexp_replace(coalesce(nullif(btrim(p_original_filename), ''), 'sop-image'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120);
  v_path := v_outlet_id::text || '/' || v_sop_id::text || '/' || p_sop_version_id::text || '/' || v_media_id::text || '.webp';

  insert into public.crew_sop_media(
    id, outlet_id, sop_id, sop_version_id, object_path, original_filename,
    mime_type, file_size_bytes, width, height, uploaded_by
  ) values (
    v_media_id, v_outlet_id, v_sop_id, p_sop_version_id, v_path, v_name,
    v_mime, p_file_size_bytes, p_width, p_height, auth.uid()
  );

  return jsonb_build_object(
    'id', v_media_id, 'bucket', 'crew-sop-media', 'object_path', v_path,
    'mime_type', v_mime, 'file_size_bytes', p_file_size_bytes,
    'width', p_width, 'height', p_height, 'status', 'pending'
  );
end;
$$;
revoke all on function public.crew_prepare_sop_media_upload(uuid, text, text, bigint, integer, integer)
from public, anon, authenticated;
grant execute on function public.crew_prepare_sop_media_upload(uuid, text, text, bigint, integer, integer)
to authenticated;

create or replace function public.crew_finalize_sop_media_upload(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found or auth.uid() is null
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if v_media.status <> 'pending' then
    raise exception using errcode = '22023', message = 'SOP media is not awaiting upload.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = v_media.bucket_id and o.name = v_media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The SOP image upload did not complete.';
  end if;
  update public.crew_sop_media set status = 'ready', updated_at = now() where id = p_media_id;
  return jsonb_build_object(
    'id', v_media.id, 'bucket', v_media.bucket_id, 'object_path', v_media.object_path,
    'mime_type', v_media.mime_type, 'file_size_bytes', v_media.file_size_bytes,
    'width', v_media.width, 'height', v_media.height, 'status', 'ready'
  );
end;
$$;
revoke all on function public.crew_finalize_sop_media_upload(uuid) from public, anon, authenticated;
grant execute on function public.crew_finalize_sop_media_upload(uuid) to authenticated;

create or replace function public.crew_request_sop_media_delete(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found or auth.uid() is null
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if exists (
    select 1 from public.crew_sop_sections section
    join public.crew_sop_versions version on version.id = section.sop_version_id
    where section.media_id = p_media_id and version.status = 'published'
  ) then
    return jsonb_build_object('can_delete', false, 'reason', 'published_reference', 'id', v_media.id);
  end if;
  if exists (select 1 from public.crew_sop_sections where media_id = p_media_id) then
    return jsonb_build_object('can_delete', false, 'reason', 'draft_reference', 'id', v_media.id);
  end if;
  update public.crew_sop_media set status = 'deleting', updated_at = now() where id = p_media_id;
  return jsonb_build_object(
    'can_delete', true, 'id', v_media.id, 'bucket', v_media.bucket_id,
    'object_path', v_media.object_path
  );
end;
$$;
revoke all on function public.crew_request_sop_media_delete(uuid) from public, anon, authenticated;
grant execute on function public.crew_request_sop_media_delete(uuid) to authenticated;

create or replace function public.crew_finalize_sop_media_delete(p_media_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found then return true; end if;
  if auth.uid() is null
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if v_media.status <> 'deleting' then
    raise exception using errcode = '22023', message = 'SOP media is not pending deletion.';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = v_media.bucket_id and o.name = v_media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The SOP image has not been removed from storage.';
  end if;
  delete from public.crew_sop_media where id = p_media_id;
  return true;
end;
$$;
revoke all on function public.crew_finalize_sop_media_delete(uuid) from public, anon, authenticated;
grant execute on function public.crew_finalize_sop_media_delete(uuid) to authenticated;

create or replace function public.crew_validate_sop_section_media()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_section_sop uuid; v_section_outlet uuid; v_media public.crew_sop_media%rowtype;
begin
  if new.media_id is null then return new; end if;
  select v.sop_id, s.outlet_id into v_section_sop, v_section_outlet
  from public.crew_sop_versions v join public.crew_sops s on s.id = v.sop_id
  where v.id = new.sop_version_id;
  select * into v_media from public.crew_sop_media where id = new.media_id and status = 'ready';
  if not found or v_media.sop_id <> v_section_sop or v_media.outlet_id <> v_section_outlet then
    raise exception using errcode = '22023', message = 'SOP media does not belong to this SOP and outlet.';
  end if;
  return new;
end;
$$;
revoke all on function public.crew_validate_sop_section_media() from public, anon, authenticated;

create trigger crew_validate_sop_section_media
before insert or update of media_id, sop_version_id on public.crew_sop_sections
for each row execute function public.crew_validate_sop_section_media();

create or replace function public.crew_sop_media_access(
  p_token text,
  p_sop_version_id uuid,
  p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_employee_id uuid; v_outlet_id uuid; v_media public.crew_sop_media%rowtype; v_visible boolean := false;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id from public.crew_access where employee_id = v_employee_id;

  select exists (
    select 1 from public.crew_sop_versions v
    join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id and v.status = 'published'
      and s.status = 'published' and s.outlet_id = v_outlet_id
  ) into v_visible;
  if not v_visible then
    select exists (
      select 1 from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks', '[]'::jsonb)) b
      where a.employee_id = v_employee_id and b->>'block_type' = 'sop_reference'
        and b->'payload'->>'sop_version_id' = p_sop_version_id::text
    ) into v_visible;
  end if;
  select media.* into v_media
  from public.crew_sop_media media
  join public.crew_sop_sections section on section.media_id = media.id
  where media.id = p_media_id and media.status = 'ready'
    and section.sop_version_id = p_sop_version_id;
  if not v_visible or not found then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  return jsonb_build_object(
    'id', v_media.id, 'bucket', v_media.bucket_id, 'object_path', v_media.object_path,
    'mime_type', v_media.mime_type, 'width', v_media.width, 'height', v_media.height
  );
end;
$$;
revoke all on function public.crew_sop_media_access(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_media_access(text, uuid, uuid) to anon, authenticated;

-- New versions may retain prior published media from the same SOP. The reference
-- stays immutable; a replacement upload receives the new draft version path.
create or replace function public.crew_new_sop_version(p_sop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare source_sop public.crew_sops%rowtype; next_version integer; new_version uuid; source_version uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501', message='Missing permission to version Crew SOPs.'; end if;
  select * into source_sop from public.crew_sops where id=p_sop_id;
  if not found then raise exception using errcode='P0002',message='SOP not found.'; end if;
  if not public.crew_sop_admin_can_access_sop(p_sop_id) then raise exception using errcode='42501',message='You cannot version SOPs for this outlet.'; end if;
  select id into source_version from public.crew_sop_versions where sop_id=p_sop_id and status='published' order by version desc limit 1;
  select coalesce(max(version),0)+1 into next_version from public.crew_sop_versions where sop_id=p_sop_id;
  insert into public.crew_sop_versions(sop_id,version,status,effective_date,change_summary,require_acknowledgement)
  select p_sop_id,next_version,'draft',effective_date,change_summary,require_acknowledgement from public.crew_sop_versions where id=source_version
  union all select p_sop_id,next_version,'draft',null,null,false where source_version is null returning id into new_version;
  if source_version is not null then
    insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point,media_url,media_id,media_caption)
    select new_version,title,body,sort_order,key_point,null,media_id,media_caption
    from public.crew_sop_sections where sop_version_id=source_version order by sort_order;
  end if;
  return new_version;
end;
$$;
revoke all on function public.crew_new_sop_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_new_sop_version(uuid) to authenticated;

create or replace function public.crew_publish_sop_version(p_sop_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_sop_id uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501',message='Missing permission to publish Crew SOPs.'; end if;
  select sop_id into v_sop_id from public.crew_sop_versions where id=p_sop_version_id and status='draft';
  if v_sop_id is null then raise exception using errcode='22023',message='Only a draft SOP version can be published.'; end if;
  if not public.crew_sop_admin_can_access_sop(v_sop_id) then raise exception using errcode='42501',message='You cannot publish SOPs for this outlet.'; end if;
  if not exists(select 1 from public.crew_sop_sections where sop_version_id=p_sop_version_id) then raise exception using errcode='22023',message='An SOP version needs at least one section.'; end if;
  if exists (
    select 1 from public.crew_sop_sections section
    left join public.crew_sop_media media on media.id = section.media_id
    where section.sop_version_id = p_sop_version_id and section.media_id is not null
      and (media.id is null or media.status <> 'ready' or media.sop_id <> v_sop_id)
  ) then raise exception using errcode='22023',message='Every SOP image must finish uploading before publish.'; end if;
  perform public.crew_begin_learning_transition();
  update public.crew_sop_versions set status='published',published_at=now(),published_by=auth.uid() where id=p_sop_version_id;
  update public.crew_sops set status='published',current_version=(select version from public.crew_sop_versions where id=p_sop_version_id),updated_at=now() where id=v_sop_id;
  perform public.crew_end_learning_transition();
  return p_sop_version_id;
end;
$$;
revoke all on function public.crew_publish_sop_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_publish_sop_version(uuid) to authenticated;

-- Crew receives a safe media identifier/caption, never a storage path.
create or replace function public.crew_sop_version(p_token text, p_sop_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_employee_id uuid; v_outlet_id uuid; v_visible boolean := false;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id from public.crew_access where employee_id = v_employee_id;
  select exists (
    select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
    where v.id=p_sop_version_id and v.status='published' and s.status='published' and s.outlet_id=v_outlet_id
  ) into v_visible;
  if not v_visible then
    select exists (
      select 1 from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks','[]'::jsonb)) b
      where a.employee_id=v_employee_id and b->>'block_type'='sop_reference'
        and b->'payload'->>'sop_version_id'=p_sop_version_id::text
    ) into v_visible;
  end if;
  if not v_visible then raise exception using errcode='42501',message='SOP version is unavailable.'; end if;
  return (
    select jsonb_build_object(
      'id',v.id,'version',v.version,'effective_date',v.effective_date,'change_summary',v.change_summary,
      'title',s.title,'category',s.category,'category_id',s.category_id,'summary',s.summary,
      'acknowledgement_required',v.require_acknowledgement,
      'sections',coalesce((select jsonb_agg(jsonb_build_object(
        'id',section.id,'title',section.title,'body',section.body,'sort_order',section.sort_order,
        'key_point',section.key_point,'media',case when media.id is null then null else jsonb_build_object(
          'id',media.id,'mime_type',media.mime_type,'width',media.width,'height',media.height,
          'caption',section.media_caption
        ) end
      ) order by section.sort_order)
      from public.crew_sop_sections section left join public.crew_sop_media media on media.id=section.media_id
      where section.sop_version_id=v.id),'[]'::jsonb),
      'acknowledged',exists(select 1 from public.crew_sop_acknowledgements a where a.employee_id=v_employee_id and a.sop_version_id=v.id)
    ) from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id
    where v.id=p_sop_version_id and v.status='published'
  );
end;
$$;
revoke all on function public.crew_sop_version(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_version(text, uuid) to anon, authenticated;

-- Clone creates independent target media metadata and returns an explicit copy
-- manifest. The authenticated client performs Storage copy, then finalizes each
-- target asset before the draft can publish.
create or replace function public.crew_clone_selected_sops(
  p_source_outlet_id uuid,
  p_target_outlet_id uuid,
  p_sop_ids uuid[],
  p_copy_categories boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  source_sop public.crew_sops%rowtype; source_version public.crew_sop_versions%rowtype;
  source_section public.crew_sop_sections%rowtype; source_media public.crew_sop_media%rowtype;
  target_sop_id uuid; target_version_id uuid; target_category_id uuid; target_media_id uuid; target_section_id uuid; target_path text;
  cloned_sops integer := 0; cloned_categories integer := 0; media_manifest jsonb := '[]'::jsonb;
begin
  if p_source_outlet_id = p_target_outlet_id then raise exception using errcode='22023',message='Choose a different source outlet.'; end if;
  if coalesce(cardinality(p_sop_ids),0)=0 then raise exception using errcode='22023',message='Select at least one SOP.'; end if;
  if auth.uid() is null or not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501',message='Missing permission to clone Crew SOPs.'; end if;
  if not public.current_user_can_access_outlet(p_source_outlet_id) or not public.current_user_can_access_outlet(p_target_outlet_id) then raise exception using errcode='42501',message='You need access to both outlets to clone SOPs.'; end if;
  if exists (select 1 from unnest(p_sop_ids) requested(id) where not exists (
    select 1 from public.crew_sops s where s.id=requested.id and s.outlet_id=p_source_outlet_id and s.status='published'
  )) then raise exception using errcode='22023',message='Every selected SOP must be published in the source outlet.'; end if;

  for source_sop in select s.* from public.crew_sops s where s.id=any(p_sop_ids) and s.outlet_id=p_source_outlet_id and s.status='published' order by s.category,s.title,s.id loop
    if exists(select 1 from public.crew_sops existing where existing.outlet_id=p_target_outlet_id and existing.status<>'archived' and lower(btrim(existing.title))=lower(btrim(source_sop.title))) then
      raise exception using errcode='23505',message=format('An SOP named "%s" already exists in the target outlet.',source_sop.title);
    end if;
    target_category_id := null;
    if p_copy_categories and source_sop.category_id is not null then
      select target.id into target_category_id from public.crew_sop_categories source
      join public.crew_sop_categories target on target.outlet_id=p_target_outlet_id and lower(btrim(target.name))=lower(btrim(source.name))
      where source.id=source_sop.category_id;
      if target_category_id is null then
        insert into public.crew_sop_categories(outlet_id,name,sort_order)
        select p_target_outlet_id,name,sort_order from public.crew_sop_categories where id=source_sop.category_id
        returning id into target_category_id;
        cloned_categories := cloned_categories+1;
      end if;
    end if;
    select v.* into source_version from public.crew_sop_versions v where v.sop_id=source_sop.id and v.status='published' order by v.version desc limit 1;
    insert into public.crew_sops(title,category,category_id,summary,status,current_version,outlet_id,position)
    values(source_sop.title,source_sop.category,target_category_id,source_sop.summary,'draft',null,p_target_outlet_id,source_sop.position)
    returning id into target_sop_id;
    insert into public.crew_sop_versions(sop_id,version,effective_date,change_summary,status,require_acknowledgement)
    values(target_sop_id,1,source_version.effective_date,'Cloned from '||source_sop.title,'draft',source_version.require_acknowledgement)
    returning id into target_version_id;

    for source_section in select * from public.crew_sop_sections where sop_version_id=source_version.id order by sort_order loop
      target_media_id := null;
      if source_section.media_id is not null then
        select * into source_media from public.crew_sop_media where id=source_section.media_id and status='ready';
        if not found then raise exception using errcode='22023',message='A source SOP image is unavailable.'; end if;
        target_media_id := gen_random_uuid();
        target_path := p_target_outlet_id::text||'/'||target_sop_id::text||'/'||target_version_id::text||'/'||target_media_id::text||'.webp';
        insert into public.crew_sop_media(id,outlet_id,sop_id,sop_version_id,object_path,original_filename,mime_type,file_size_bytes,width,height,status,uploaded_by)
        values(target_media_id,p_target_outlet_id,target_sop_id,target_version_id,target_path,source_media.original_filename,source_media.mime_type,source_media.file_size_bytes,source_media.width,source_media.height,'pending',auth.uid());
        media_manifest := media_manifest || jsonb_build_array(jsonb_build_object(
          'source_bucket',source_media.bucket_id,'source_path',source_media.object_path,
          'target_id',target_media_id,'target_bucket','crew-sop-media','target_path',target_path
        ));
      end if;
      insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point,media_url,media_caption)
      values(target_version_id,source_section.title,source_section.body,source_section.sort_order,source_section.key_point,null,source_section.media_caption)
      returning id into target_section_id;
      if target_media_id is not null then
        media_manifest := jsonb_set(
          media_manifest,
          array[(jsonb_array_length(media_manifest)-1)::text],
          media_manifest->(jsonb_array_length(media_manifest)-1) || jsonb_build_object('target_section_id',target_section_id)
        );
      end if;
    end loop;
    cloned_sops := cloned_sops+1;
  end loop;
  return jsonb_build_object(
    'source_outlet_id',p_source_outlet_id,'target_outlet_id',p_target_outlet_id,
    'sops_cloned',cloned_sops,'categories_created',cloned_categories,
    'copies_are_independent',true,'media_copies',media_manifest
  );
end;
$$;
revoke all on function public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean) to authenticated;

create or replace function public.crew_attach_sop_media(
  p_section_id uuid,
  p_media_id uuid,
  p_caption text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_version_status text; v_outlet_id uuid; v_sop_id uuid; v_media public.crew_sop_media%rowtype;
begin
  select version.status, sop.outlet_id, version.sop_id
  into v_version_status, v_outlet_id, v_sop_id
  from public.crew_sop_sections section
  join public.crew_sop_versions version on version.id=section.sop_version_id
  join public.crew_sops sop on sop.id=version.sop_id
  where section.id=p_section_id;
  select * into v_media from public.crew_sop_media where id=p_media_id and status='ready';
  if auth.uid() is null or v_version_status <> 'draft' or not found
     or v_media.outlet_id <> v_outlet_id or v_media.sop_id <> v_sop_id
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode='42501',message='SOP media cannot be attached.';
  end if;
  update public.crew_sop_sections
  set media_id=p_media_id,
      media_caption=coalesce(nullif(btrim(coalesce(p_caption,'')),''), media_caption)
  where id=p_section_id;
  return true;
end;
$$;
revoke all on function public.crew_attach_sop_media(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.crew_attach_sop_media(uuid, uuid, text) to authenticated;

create or replace function public.crew_prepare_sop_draft_media_cleanup(p_sop_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare v_outlet_id uuid; v_status text; v_assets jsonb;
begin
  select sop.outlet_id, version.status into v_outlet_id, v_status
  from public.crew_sop_versions version join public.crew_sops sop on sop.id=version.sop_id
  where version.id=p_sop_version_id;
  if auth.uid() is null or v_status <> 'draft'
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode='42501',message='SOP draft cannot be deleted.';
  end if;
  delete from public.crew_sop_sections where sop_version_id=p_sop_version_id;
  update public.crew_sop_media set status='deleting',updated_at=now()
  where sop_version_id=p_sop_version_id and status in ('pending','ready');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'object_path',object_path) order by created_at),'[]'::jsonb)
  into v_assets from public.crew_sop_media where sop_version_id=p_sop_version_id and status='deleting';
  return jsonb_build_object('sop_version_id',p_sop_version_id,'assets',v_assets);
end;
$$;
revoke all on function public.crew_prepare_sop_draft_media_cleanup(uuid) from public, anon, authenticated;
grant execute on function public.crew_prepare_sop_draft_media_cleanup(uuid) to authenticated;
