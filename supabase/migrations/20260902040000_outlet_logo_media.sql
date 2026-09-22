-- Canonical outlet-owned branding assets. Public feedback receives only the
-- active logo path; all upload, replace, and remove operations remain scoped.
create table if not exists public.outlet_logo_media (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  bucket_id text not null default 'outlet-logos' check (bucket_id = 'outlet-logos'),
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 2097152),
  status text not null default 'pending' check (status in ('pending', 'ready', 'deleting')),
  uploaded_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.outlets add column if not exists logo_media_id uuid references public.outlet_logo_media(id) on delete set null;
create index if not exists outlet_logo_media_outlet_idx on public.outlet_logo_media(outlet_id, status, created_at desc);
alter table public.outlet_logo_media enable row level security;
revoke all on public.outlet_logo_media from public, anon, authenticated;
grant select on public.outlet_logo_media to authenticated;
create policy outlet_logo_media_admin_select on public.outlet_logo_media for select to authenticated using (
  public.current_user_has_permission('outlets.view') and public.current_user_can_access_outlet(outlet_id)
);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('outlet-logos', 'outlet-logos', true, 2097152, array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "outlet logo upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'outlet-logos' and exists (
    select 1 from public.outlet_logo_media media where media.bucket_id = storage.objects.bucket_id and media.object_path = storage.objects.name
      and media.status = 'pending' and media.uploaded_by = auth.uid() and public.current_user_has_permission('outlets.edit') and public.current_user_can_access_outlet(media.outlet_id)
  )
);
create policy "outlet logo remove" on storage.objects for delete to authenticated using (
  bucket_id = 'outlet-logos' and exists (
    select 1 from public.outlet_logo_media media where media.bucket_id = storage.objects.bucket_id and media.object_path = storage.objects.name
      and media.status = 'deleting' and public.current_user_has_permission('outlets.edit') and public.current_user_can_access_outlet(media.outlet_id)
  )
);

create or replace function public.outlet_prepare_logo_upload(p_outlet_id uuid, p_filename text, p_mime_type text, p_size bigint)
returns jsonb language plpgsql security definer set search_path=public, storage as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_ext text;
begin
  if auth.uid() is null or not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501', message='You cannot update this outlet logo.'; end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp') or p_size is null or p_size < 1 or p_size > 2097152 then raise exception using errcode='22023', message='Use a PNG, JPG, or WebP logo up to 2 MB.'; end if;
  if not exists(select 1 from public.outlets where id=p_outlet_id) then raise exception using errcode='P0002', message='Outlet not found.'; end if;
  v_ext := case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  v_path := p_outlet_id::text || '/' || v_id::text || '/logo.' || v_ext;
  insert into public.outlet_logo_media(id,outlet_id,object_path,original_filename,mime_type,file_size_bytes,uploaded_by) values(v_id,p_outlet_id,v_path,coalesce(nullif(btrim(p_filename),''),'logo.'||v_ext),p_mime_type,p_size,auth.uid());
  return jsonb_build_object('id',v_id,'bucket','outlet-logos','object_path',v_path);
end; $$;

create or replace function public.outlet_finalize_logo_upload(p_media_id uuid)
returns jsonb language plpgsql security definer set search_path=public, storage as $$
declare media public.outlet_logo_media%rowtype;
begin
  select * into media from public.outlet_logo_media where id=p_media_id for update;
  if not found or auth.uid() is null or media.status <> 'pending' or not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(media.outlet_id) then raise exception using errcode='42501', message='Outlet logo is unavailable.'; end if;
  if not exists(select 1 from storage.objects where bucket_id=media.bucket_id and name=media.object_path) then raise exception using errcode='22023', message='The outlet logo upload did not complete.'; end if;
  update public.outlet_logo_media set status='ready',updated_at=now() where id=media.id;
  update public.outlets set logo_media_id=media.id,updated_at=now() where id=media.outlet_id;
  return jsonb_build_object('id',media.id,'object_path',media.object_path,'version',extract(epoch from now())::bigint);
end; $$;

create or replace function public.outlet_prepare_logo_remove(p_outlet_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare media public.outlet_logo_media%rowtype;
begin
  select media.* into media from public.outlets outlet join public.outlet_logo_media media on media.id=outlet.logo_media_id where outlet.id=p_outlet_id for update;
  if auth.uid() is null or not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(p_outlet_id) then raise exception using errcode='42501', message='You cannot update this outlet logo.'; end if;
  if not found then return jsonb_build_object('removed',false); end if;
  update public.outlets set logo_media_id=null,updated_at=now() where id=p_outlet_id;
  update public.outlet_logo_media set status='deleting',updated_at=now() where id=media.id;
  return jsonb_build_object('removed',true,'id',media.id,'bucket',media.bucket_id,'object_path',media.object_path);
end; $$;

create or replace function public.outlet_finalize_logo_remove(p_media_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare media public.outlet_logo_media%rowtype;
begin
  select * into media from public.outlet_logo_media where id=p_media_id for update;
  if not found then return true; end if;
  if auth.uid() is null or media.status <> 'deleting' or not public.current_user_has_permission('outlets.edit') or not public.current_user_can_access_outlet(media.outlet_id) then raise exception using errcode='42501', message='Outlet logo is unavailable.'; end if;
  delete from public.outlet_logo_media where id=media.id;
  return true;
end; $$;

revoke all on function public.outlet_prepare_logo_upload(uuid,text,text,bigint), public.outlet_finalize_logo_upload(uuid), public.outlet_prepare_logo_remove(uuid), public.outlet_finalize_logo_remove(uuid) from public, anon, authenticated;
grant execute on function public.outlet_prepare_logo_upload(uuid,text,text,bigint), public.outlet_finalize_logo_upload(uuid), public.outlet_prepare_logo_remove(uuid), public.outlet_finalize_logo_remove(uuid) to authenticated;

create or replace function public.crew_feedback_public_entry(p_outlet_token text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('outlet',jsonb_strip_nulls(jsonb_build_object('name',o.name,'public_feedback_token',o.public_feedback_token,'logo_path',media.object_path,'logo_version',extract(epoch from media.updated_at)::bigint)),'crew',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'on_shift',x.on_shift) order by x.on_shift desc,x.last_shift desc nulls last,x.full_name) from (select e.id,e.full_name,e.position,exists(select 1 from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.status='open') on_shift,(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.clock_in_at>now()-interval '14 days') last_shift from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=o.id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and exists(select 1 from public.crew_attendance_records recent where recent.employee_id=e.id and recent.outlet_id=o.id and recent.clock_in_at>now()-interval '14 days') order by on_shift desc,last_shift desc nulls last limit 12)x),'[]'::jsonb)) from public.outlets o left join public.outlet_logo_media media on media.id=o.logo_media_id and media.status='ready' where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
$$;

create or replace function public.crew_feedback_public_crew(p_outlet_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_set(public.crew_feedback_public_entry(outlet.public_feedback_token), '{outlet,id}', to_jsonb(outlet.id::text), true)
  from public.outlets outlet where outlet.id = p_outlet_id and outlet.is_active;
$$;
revoke all on function public.crew_feedback_public_entry(text), public.crew_feedback_public_crew(uuid) from public, anon, authenticated;
grant execute on function public.crew_feedback_public_entry(text), public.crew_feedback_public_crew(uuid) to anon, authenticated;
