-- SOP Library Admin UX support.
-- Normal draft CRUD remains governed by authenticated RLS. These authorities
-- only cover the two operations that cannot be expressed safely as loose
-- browser writes: selective cross-outlet cloning and sanitized usage reads.

create or replace function public.crew_clone_selected_sops(
  p_source_outlet_id uuid,
  p_target_outlet_id uuid,
  p_sop_ids uuid[],
  p_copy_categories boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_sop public.crew_sops%rowtype;
  source_version public.crew_sop_versions%rowtype;
  target_sop_id uuid;
  target_version_id uuid;
  target_category_id uuid;
  cloned_sops integer := 0;
  cloned_categories integer := 0;
begin
  if p_source_outlet_id = p_target_outlet_id then
    raise exception using errcode = '22023', message = 'Choose a different source outlet.';
  end if;
  if coalesce(cardinality(p_sop_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'Select at least one SOP.';
  end if;
  if not public.current_user_has_permission('crew_sop.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to clone Crew SOPs.';
  end if;
  if not public.current_user_can_access_outlet(p_source_outlet_id)
     or not public.current_user_can_access_outlet(p_target_outlet_id) then
    raise exception using errcode = '42501', message = 'You need access to both outlets to clone SOPs.';
  end if;
  if exists (
    select 1 from unnest(p_sop_ids) requested(id)
    where not exists (
      select 1 from public.crew_sops s
      where s.id = requested.id
        and s.outlet_id = p_source_outlet_id
        and s.status = 'published'
    )
  ) then
    raise exception using errcode = '22023', message = 'Every selected SOP must be published in the source outlet.';
  end if;

  for source_sop in
    select s.*
    from public.crew_sops s
    where s.id = any(p_sop_ids)
      and s.outlet_id = p_source_outlet_id
      and s.status = 'published'
    order by s.category, s.title, s.id
  loop
    if exists (
      select 1 from public.crew_sops existing
      where existing.outlet_id = p_target_outlet_id
        and existing.status <> 'archived'
        and lower(btrim(existing.title)) = lower(btrim(source_sop.title))
    ) then
      raise exception using errcode = '23505',
        message = format('An SOP named "%s" already exists in the target outlet.', source_sop.title);
    end if;

    target_category_id := null;
    if p_copy_categories and source_sop.category_id is not null then
      select target.id into target_category_id
      from public.crew_sop_categories source
      join public.crew_sop_categories target
        on target.outlet_id = p_target_outlet_id
       and lower(btrim(target.name)) = lower(btrim(source.name))
      where source.id = source_sop.category_id;

      if target_category_id is null then
        insert into public.crew_sop_categories(outlet_id, name, sort_order)
        select p_target_outlet_id, name, sort_order
        from public.crew_sop_categories
        where id = source_sop.category_id
        returning id into target_category_id;
        cloned_categories := cloned_categories + 1;
      end if;
    end if;

    select v.* into source_version
    from public.crew_sop_versions v
    where v.sop_id = source_sop.id and v.status = 'published'
    order by v.version desc
    limit 1;

    insert into public.crew_sops(
      title, category, category_id, summary, status, current_version,
      outlet_id, position
    ) values (
      source_sop.title, source_sop.category, target_category_id,
      source_sop.summary, 'draft', null, p_target_outlet_id, source_sop.position
    ) returning id into target_sop_id;

    insert into public.crew_sop_versions(
      sop_id, version, effective_date, change_summary, status,
      require_acknowledgement
    ) values (
      target_sop_id, 1, source_version.effective_date,
      'Cloned from ' || source_sop.title, 'draft',
      source_version.require_acknowledgement
    ) returning id into target_version_id;

    insert into public.crew_sop_sections(
      sop_version_id, title, body, sort_order, key_point, media_url
    )
    select target_version_id, title, body, sort_order, key_point, media_url
    from public.crew_sop_sections
    where sop_version_id = source_version.id
    order by sort_order;

    cloned_sops := cloned_sops + 1;
  end loop;

  return jsonb_build_object(
    'source_outlet_id', p_source_outlet_id,
    'target_outlet_id', p_target_outlet_id,
    'sops_cloned', cloned_sops,
    'categories_created', cloned_categories,
    'copies_are_independent', true
  );
end;
$$;
revoke all on function public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean) to authenticated;

create or replace function public.crew_admin_sop_usage(p_sop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_outlet_id uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to view Crew SOP usage.';
  end if;
  select outlet_id into target_outlet_id from public.crew_sops where id = p_sop_id;
  if target_outlet_id is null or not public.current_user_can_access_outlet(target_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view SOP usage for this outlet.';
  end if;

  return jsonb_build_object(
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
        'journey_id', j.id,
        'journey_name', j.name,
        'journey_version', j.version,
        'module_title', m.title,
        'lesson_title', l.title
      ) order by j.name, m.sort_order, l.sort_order)
      from public.crew_lesson_blocks b
      join public.crew_lessons l on l.id = b.lesson_id
      join public.crew_journey_modules m on m.id = l.module_id
      join public.crew_journeys j on j.id = m.journey_id
      where b.block_type = 'sop_reference'
        and b.payload->>'sop_id' = p_sop_id::text
        and j.outlet_id = target_outlet_id
        and j.status in ('draft', 'published')
    ), '[]'::jsonb),
    'historical', coalesce((
      select jsonb_agg(jsonb_build_object(
        'journey_name', pinned.journey_name,
        'journey_version', pinned.journey_version,
        'assignment_count', pinned.assignment_count
      ) order by pinned.journey_name, pinned.journey_version desc)
      from (
        select
          a.journey_snapshot->'journey'->>'name' as journey_name,
          a.journey_version_assigned as journey_version,
          count(*) as assignment_count
        from public.crew_journey_assignments a
        cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) module
        cross join lateral jsonb_array_elements(coalesce(module->'lessons', '[]'::jsonb)) lesson
        cross join lateral jsonb_array_elements(coalesce(lesson->'blocks', '[]'::jsonb)) block
        join public.crew_journeys j on j.id = a.journey_id
        where j.outlet_id = target_outlet_id
          and block->>'block_type' = 'sop_reference'
          and block->'payload'->>'sop_id' = p_sop_id::text
        group by a.journey_snapshot->'journey'->>'name', a.journey_version_assigned
      ) pinned
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.crew_admin_sop_usage(uuid) from public, anon, authenticated;
grant execute on function public.crew_admin_sop_usage(uuid) to authenticated;

comment on function public.crew_clone_selected_sops(uuid, uuid, uuid[], boolean) is
  'Clones only explicitly selected published SOPs as independent target-outlet drafts.';
comment on function public.crew_admin_sop_usage(uuid) is
  'Returns sanitized current and historical SOP usage without exposing assignment snapshots.';
