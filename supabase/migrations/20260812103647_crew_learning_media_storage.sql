-- Private, outlet-scoped media for Crew Learning content.
-- Durable learning payloads store only media UUIDs and display metadata. Object
-- paths remain private and short-lived read URLs are issued by an Edge Function
-- after a Crew session/assignment check.

create table public.crew_learning_media (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  bucket_id text not null default 'crew-learning-media'
    check (bucket_id = 'crew-learning-media'),
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null
    check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'deleting')),
  uploaded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index crew_learning_media_outlet_status_idx
  on public.crew_learning_media(outlet_id, status, created_at desc);

alter table public.crew_learning_media enable row level security;
revoke all on table public.crew_learning_media from public, anon, authenticated;
grant select on table public.crew_learning_media to authenticated;

create policy crew_learning_media_admin_select
on public.crew_learning_media
for select
to authenticated
using (
  public.current_user_has_permission('crew_learning.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'crew-learning-media',
  'crew-learning-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "crew learning admins upload media" on storage.objects;
create policy "crew learning admins upload media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'crew-learning-media'
  and exists (
    select 1
    from public.crew_learning_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status = 'pending'
      and media.uploaded_by = auth.uid()
      and public.current_user_has_permission('crew_learning.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

drop policy if exists "crew learning admins read media" on storage.objects;
create policy "crew learning admins read media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'crew-learning-media'
  and exists (
    select 1
    from public.crew_learning_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status in ('pending', 'ready')
      and public.current_user_has_permission('crew_learning.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

drop policy if exists "crew learning admins delete prepared media" on storage.objects;
create policy "crew learning admins delete prepared media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'crew-learning-media'
  and exists (
    select 1
    from public.crew_learning_media media
    where media.bucket_id = storage.objects.bucket_id
      and media.object_path = storage.objects.name
      and media.status = 'deleting'
      and public.current_user_has_permission('crew_learning.manage')
      and public.current_user_can_access_outlet(media.outlet_id)
  )
);

create or replace function public.crew_prepare_learning_media_upload(
  p_outlet_id uuid,
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
  media_id uuid := gen_random_uuid();
  normalized_mime text := lower(btrim(coalesce(p_mime_type, '')));
  extension text;
  safe_name text;
  path text;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot upload learning media for this outlet.';
  end if;
  if normalized_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = '22023', message = 'Only JPG, PNG, and WebP images are supported.';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 5242880 then
    raise exception using errcode = '22023', message = 'Learning images must be 5MB or smaller.';
  end if;
  if (p_width is not null and p_width <= 0) or (p_height is not null and p_height <= 0) then
    raise exception using errcode = '22023', message = 'Image dimensions are invalid.';
  end if;

  extension := case normalized_mime
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else 'webp'
  end;
  safe_name := left(regexp_replace(coalesce(nullif(btrim(p_original_filename), ''), 'learning-image'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120);
  path := p_outlet_id::text || '/' || media_id::text || '/asset.' || extension;

  insert into public.crew_learning_media(
    id, outlet_id, object_path, original_filename, mime_type,
    file_size_bytes, width, height, uploaded_by
  ) values (
    media_id, p_outlet_id, path, safe_name, normalized_mime,
    p_file_size_bytes, p_width, p_height, auth.uid()
  );

  return jsonb_build_object(
    'id', media_id,
    'bucket', 'crew-learning-media',
    'object_path', path,
    'mime_type', normalized_mime,
    'file_size_bytes', p_file_size_bytes,
    'width', p_width,
    'height', p_height,
    'status', 'pending'
  );
end;
$$;
revoke all on function public.crew_prepare_learning_media_upload(uuid, text, text, bigint, integer, integer)
from public, anon, authenticated;
grant execute on function public.crew_prepare_learning_media_upload(uuid, text, text, bigint, integer, integer)
to authenticated;

create or replace function public.crew_finalize_learning_media_upload(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  media public.crew_learning_media%rowtype;
begin
  select * into media
  from public.crew_learning_media
  where id = p_media_id
  for update;

  if not found
     or auth.uid() is null
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(media.outlet_id) then
    raise exception using errcode = '42501', message = 'Learning media is unavailable.';
  end if;
  if media.status <> 'pending' then
    raise exception using errcode = '22023', message = 'Learning media is not awaiting upload.';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = media.bucket_id and object.name = media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The learning image upload did not complete.';
  end if;

  update public.crew_learning_media
  set status = 'ready', updated_at = now()
  where id = p_media_id;

  return jsonb_build_object(
    'id', media.id,
    'bucket', media.bucket_id,
    'object_path', media.object_path,
    'mime_type', media.mime_type,
    'file_size_bytes', media.file_size_bytes,
    'width', media.width,
    'height', media.height,
    'status', 'ready'
  );
end;
$$;
revoke all on function public.crew_finalize_learning_media_upload(uuid)
from public, anon, authenticated;
grant execute on function public.crew_finalize_learning_media_upload(uuid)
to authenticated;

create or replace function public.crew_request_learning_media_delete(p_media_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  media public.crew_learning_media%rowtype;
  protected_reference boolean := false;
begin
  select * into media
  from public.crew_learning_media
  where id = p_media_id
  for update;

  if not found
     or auth.uid() is null
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(media.outlet_id) then
    raise exception using errcode = '42501', message = 'Learning media is unavailable.';
  end if;

  select exists (
    select 1
    from public.crew_lesson_blocks block
    join public.crew_lessons lesson on lesson.id = block.lesson_id
    join public.crew_journey_modules module on module.id = lesson.module_id
    join public.crew_journeys journey on journey.id = module.journey_id
    where journey.status = 'published'
      and block.payload #>> '{media,id}' = p_media_id::text
  ) or exists (
    select 1
    from public.crew_journey_assignments assignment
    cross join lateral jsonb_array_elements(coalesce(assignment.journey_snapshot->'modules', '[]'::jsonb)) module_item
    cross join lateral jsonb_array_elements(coalesce(module_item->'lessons', '[]'::jsonb)) lesson_item
    cross join lateral jsonb_array_elements(coalesce(lesson_item->'blocks', '[]'::jsonb)) block_item
    where block_item #>> '{payload,media,id}' = p_media_id::text
  ) into protected_reference;

  if protected_reference then
    return jsonb_build_object(
      'can_delete', false,
      'reason', 'published_reference',
      'id', media.id
    );
  end if;

  update public.crew_learning_media
  set status = 'deleting', updated_at = now()
  where id = p_media_id;

  return jsonb_build_object(
    'can_delete', true,
    'id', media.id,
    'bucket', media.bucket_id,
    'object_path', media.object_path
  );
end;
$$;
revoke all on function public.crew_request_learning_media_delete(uuid)
from public, anon, authenticated;
grant execute on function public.crew_request_learning_media_delete(uuid)
to authenticated;

create or replace function public.crew_finalize_learning_media_delete(p_media_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  media public.crew_learning_media%rowtype;
begin
  select * into media
  from public.crew_learning_media
  where id = p_media_id
  for update;

  if not found then return true; end if;
  if auth.uid() is null
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(media.outlet_id) then
    raise exception using errcode = '42501', message = 'Learning media is unavailable.';
  end if;
  if media.status <> 'deleting' then
    raise exception using errcode = '22023', message = 'Learning media is not pending deletion.';
  end if;
  if exists (
    select 1 from storage.objects object
    where object.bucket_id = media.bucket_id and object.name = media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The learning image has not been removed from storage.';
  end if;

  delete from public.crew_learning_media where id = p_media_id;
  return true;
end;
$$;
revoke all on function public.crew_finalize_learning_media_delete(uuid)
from public, anon, authenticated;
grant execute on function public.crew_finalize_learning_media_delete(uuid)
to authenticated;

create or replace function public.crew_learning_media_access(
  p_token text,
  p_media_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  employee_id uuid;
  media public.crew_learning_media%rowtype;
begin
  employee_id := public.crew_session_employee(p_token);

  select * into media
  from public.crew_learning_media
  where id = p_media_id and status = 'ready';

  if not found or not exists (
    select 1
    from public.crew_journey_assignments assignment
    cross join lateral jsonb_array_elements(coalesce(assignment.journey_snapshot->'modules', '[]'::jsonb)) module_item
    cross join lateral jsonb_array_elements(coalesce(module_item->'lessons', '[]'::jsonb)) lesson_item
    cross join lateral jsonb_array_elements(coalesce(lesson_item->'blocks', '[]'::jsonb)) block_item
    where assignment.employee_id = employee_id
      and block_item #>> '{payload,media,id}' = p_media_id::text
  ) then
    raise exception using errcode = '42501', message = 'Learning media is unavailable.';
  end if;

  return jsonb_build_object(
    'id', media.id,
    'bucket', media.bucket_id,
    'object_path', media.object_path,
    'mime_type', media.mime_type,
    'width', media.width,
    'height', media.height
  );
end;
$$;
revoke all on function public.crew_learning_media_access(text, uuid)
from public, anon, authenticated;
grant execute on function public.crew_learning_media_access(text, uuid)
to anon, authenticated;

create or replace function public.crew_validate_learning_media_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if new.status = 'published' and old.status = 'draft' and exists (
    select 1
    from public.crew_lesson_blocks block
    join public.crew_lessons lesson on lesson.id = block.lesson_id
    join public.crew_journey_modules module on module.id = lesson.module_id
    where module.journey_id = new.id
      and block.payload ? 'media'
      and (
        nullif(block.payload #>> '{media,id}', '') is null
        or not exists (
          select 1
          from public.crew_learning_media media
          where media.id::text = block.payload #>> '{media,id}'
            and media.outlet_id = new.outlet_id
            and media.status = 'ready'
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'Every learning image must finish uploading before publish.';
  end if;
  return new;
end;
$$;
revoke all on function public.crew_validate_learning_media_on_publish()
from public, anon, authenticated;

create trigger crew_validate_learning_media_on_publish
before update of status on public.crew_journeys
for each row execute function public.crew_validate_learning_media_on_publish();
