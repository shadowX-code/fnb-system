-- SOP document metadata is versioned evidence, just like its sections. The
-- parent row remains the current live-library projection only.
alter table public.crew_sop_versions
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists category_id uuid references public.crew_sop_categories(id),
  add column if not exists summary text;

-- Preserve the current historical wording before drafts begin owning edits.
-- Migration execution has no request JWT, so establish the same transaction-
-- scoped transition lock using an existing authenticated actor when present.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', actor.id, 'role', 'authenticated')::text,
  true
)
from auth.users actor
order by actor.created_at, actor.id
limit 1;

insert into public.crew_learning_transition_locks(transaction_id, actor_id)
select txid_current(), auth.uid()
where auth.uid() is not null
on conflict (transaction_id) do update
set actor_id = excluded.actor_id,
    created_at = now();

update public.crew_sop_versions version_row
set title = coalesce(version_row.title, sop.title),
    category = coalesce(version_row.category, sop.category),
    category_id = coalesce(version_row.category_id, sop.category_id),
    summary = coalesce(version_row.summary, sop.summary)
from public.crew_sops sop
where sop.id = version_row.sop_id
  and (version_row.title is null or version_row.category is null or version_row.category_id is null);

delete from public.crew_learning_transition_locks
where transaction_id = txid_current()
  and actor_id = auth.uid();

create or replace function public.crew_sop_version_metadata_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare parent_row public.crew_sops%rowtype;
begin
  select * into parent_row from public.crew_sops where id = new.sop_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SOP not found.';
  end if;
  new.title := coalesce(nullif(btrim(new.title), ''), parent_row.title);
  new.category := coalesce(nullif(btrim(new.category), ''), parent_row.category);
  new.category_id := coalesce(new.category_id, parent_row.category_id);
  new.summary := coalesce(new.summary, parent_row.summary);
  return new;
end;
$$;
revoke all on function public.crew_sop_version_metadata_defaults() from public, anon, authenticated;

drop trigger if exists crew_sop_version_metadata_defaults on public.crew_sop_versions;
create trigger crew_sop_version_metadata_defaults
before insert on public.crew_sop_versions
for each row execute function public.crew_sop_version_metadata_defaults();

create or replace function public.crew_new_sop_version(p_sop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare source_sop public.crew_sops%rowtype; source_version public.crew_sop_versions%rowtype; next_version integer; new_version uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501', message='Missing permission to version Crew SOPs.'; end if;
  select * into source_sop from public.crew_sops where id=p_sop_id;
  if not found then raise exception using errcode='P0002',message='SOP not found.'; end if;
  if not public.crew_sop_admin_can_access_sop(p_sop_id) then raise exception using errcode='42501',message='You cannot version SOPs for this outlet.'; end if;
  select * into source_version from public.crew_sop_versions where sop_id=p_sop_id and status='published' order by version desc limit 1;
  select coalesce(max(version),0)+1 into next_version from public.crew_sop_versions where sop_id=p_sop_id;

  insert into public.crew_sop_versions(sop_id,version,status,effective_date,change_summary,require_acknowledgement,title,category,category_id,summary)
  values (
    p_sop_id, next_version, 'draft', source_version.effective_date, source_version.change_summary,
    coalesce(source_version.require_acknowledgement, false), coalesce(source_version.title, source_sop.title),
    coalesce(source_version.category, source_sop.category), coalesce(source_version.category_id, source_sop.category_id),
    coalesce(source_version.summary, source_sop.summary)
  ) returning id into new_version;

  if source_version.id is not null then
    insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point,media_url,media_id,media_caption)
    select new_version,title,body,sort_order,key_point,null,media_id,media_caption
    from public.crew_sop_sections where sop_version_id=source_version.id order by sort_order;
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
declare v_sop_id uuid; v_version public.crew_sop_versions%rowtype; v_category_name text;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501',message='Missing permission to publish Crew SOPs.'; end if;
  select * into v_version from public.crew_sop_versions where id=p_sop_version_id and status='draft';
  v_sop_id := v_version.sop_id;
  if v_sop_id is null then raise exception using errcode='22023',message='Only a draft SOP version can be published.'; end if;
  if not public.crew_sop_admin_can_access_sop(v_sop_id) then raise exception using errcode='42501',message='You cannot publish SOPs for this outlet.'; end if;
  if nullif(btrim(v_version.title), '') is null or v_version.category_id is null then raise exception using errcode='22023',message='An SOP title and category are required.'; end if;
  select category.name into v_category_name from public.crew_sop_categories category join public.crew_sops sop on sop.outlet_id=category.outlet_id where category.id=v_version.category_id and sop.id=v_sop_id;
  if v_category_name is null then raise exception using errcode='22023',message='Choose an SOP category from this outlet.'; end if;
  if not exists(select 1 from public.crew_sop_sections where sop_version_id=p_sop_version_id) then raise exception using errcode='22023',message='An SOP version needs at least one section.'; end if;
  if exists (
    select 1 from public.crew_sop_sections section left join public.crew_sop_media media on media.id = section.media_id
    where section.sop_version_id = p_sop_version_id and section.media_id is not null
      and (media.id is null or media.status <> 'ready' or media.sop_id <> v_sop_id)
  ) then raise exception using errcode='22023',message='Every SOP image must finish uploading before publish.'; end if;
  perform public.crew_begin_learning_transition();
  update public.crew_sop_versions set category=v_category_name,status='published',published_at=now(),published_by=auth.uid() where id=p_sop_version_id;
  update public.crew_sops set title=v_version.title,category=v_category_name,category_id=v_version.category_id,summary=v_version.summary,status='published',current_version=v_version.version,updated_at=now() where id=v_sop_id;
  perform public.crew_end_learning_transition();
  return p_sop_version_id;
end;
$$;
revoke all on function public.crew_publish_sop_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_publish_sop_version(uuid) to authenticated;

-- Crew always receives the selected immutable version snapshot, not mutable
-- parent-library metadata.
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
      'title',v.title,'category',v.category,'category_id',v.category_id,'summary',v.summary,
      'acknowledgement_required',v.require_acknowledgement,
      'sections',coalesce((select jsonb_agg(jsonb_build_object(
        'id',section.id,'title',section.title,'body',section.body,'sort_order',section.sort_order,
        'key_point',section.key_point,'media',case when media.id is null then null else jsonb_build_object(
          'id',media.id,'mime_type',media.mime_type,'width',media.width,'height',media.height,'caption',section.media_caption
        ) end
      ) order by section.sort_order) from public.crew_sop_sections section left join public.crew_sop_media media on media.id=section.media_id where section.sop_version_id=v.id),'[]'::jsonb),
      'acknowledged',exists(select 1 from public.crew_sop_acknowledgements a where a.employee_id=v_employee_id and a.sop_version_id=v.id),
      'acknowledged_at',(select a.acknowledged_at from public.crew_sop_acknowledgements a where a.employee_id=v_employee_id and a.sop_version_id=v.id)
    ) from public.crew_sop_versions v where v.id=p_sop_version_id and v.status='published'
  );
end;
$$;
revoke all on function public.crew_sop_version(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_version(text, uuid) to anon, authenticated;

comment on column public.crew_sop_versions.title is 'Immutable SOP title snapshot for this version.';
comment on column public.crew_sop_versions.category is 'Immutable SOP category label snapshot for this version.';
comment on column public.crew_sop_versions.summary is 'Immutable SOP summary snapshot for this version.';
