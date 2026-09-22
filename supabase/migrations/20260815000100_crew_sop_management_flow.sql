-- Crew SOP management flow: lightweight usage counts for the Library and a
-- controlled category lifecycle that keeps the denormalized SOP category label
-- in sync without weakening published-version immutability.

create or replace function public.crew_sop_admin_library(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_outlet_id is null
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view the SOP Library for this outlet.';
  end if;

  return jsonb_build_object(
    'sops', coalesce((
      with current_usage as (
        select
          block.payload->>'sop_id' as sop_id,
          count(*) as reference_count,
          count(distinct journey.id) as onboarding_count
        from public.crew_lesson_blocks block
        join public.crew_lessons lesson on lesson.id = block.lesson_id
        join public.crew_journey_modules module on module.id = lesson.module_id
        join public.crew_journeys journey on journey.id = module.journey_id
        where block.block_type = 'sop_reference'
          and journey.outlet_id = p_outlet_id
          and journey.status in ('draft', 'published')
        group by block.payload->>'sop_id'
      ), pinned_usage as (
        select pinned.sop_id, count(distinct pinned.assignment_id) as assignment_count
        from (
          select assignment.id as assignment_id,
                 block->'payload'->>'sop_id' as sop_id
          from public.crew_journey_assignments assignment
          join public.crew_journeys journey on journey.id = assignment.journey_id
          cross join lateral jsonb_array_elements(coalesce(assignment.journey_snapshot->'modules', '[]'::jsonb)) module
          cross join lateral jsonb_array_elements(coalesce(module->'lessons', '[]'::jsonb)) lesson
          cross join lateral jsonb_array_elements(coalesce(lesson->'blocks', '[]'::jsonb)) block
          where journey.outlet_id = p_outlet_id
            and block->>'block_type' = 'sop_reference'
        ) pinned
        group by pinned.sop_id
      )
      select jsonb_agg(
        jsonb_build_object(
          'id', sop.id,
          'title', sop.title,
          'category', sop.category,
          'category_id', sop.category_id,
          'summary', sop.summary,
          'status', sop.status,
          'current_version', sop.current_version,
          'outlet_id', sop.outlet_id,
          'position', sop.position,
          'created_at', sop.created_at,
          'updated_at', sop.updated_at,
          'current_reference_count', coalesce(current_usage.reference_count, 0),
          'current_onboarding_count', coalesce(current_usage.onboarding_count, 0),
          'pinned_assignment_count', coalesce(pinned_usage.assignment_count, 0),
          'versions', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', version_row.id,
                'version', version_row.version,
                'status', version_row.status,
                'effective_date', version_row.effective_date,
                'change_summary', version_row.change_summary,
                'require_acknowledgement', version_row.require_acknowledgement,
                'published_at', version_row.published_at
              ) order by version_row.version desc
            )
            from public.crew_sop_versions version_row
            where version_row.sop_id = sop.id
          ), '[]'::jsonb)
        ) order by sop.updated_at desc, sop.id
      )
      from public.crew_sops sop
      left join current_usage on current_usage.sop_id = sop.id::text
      left join pinned_usage on pinned_usage.sop_id = sop.id::text
      where sop.outlet_id = p_outlet_id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(
        to_jsonb(category_row) || jsonb_build_object(
          'sop_count', (select count(*) from public.crew_sops sop where sop.category_id = category_row.id)
        ) order by category_row.sort_order, category_row.name
      )
      from public.crew_sop_categories category_row
      where category_row.outlet_id = p_outlet_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.crew_manage_sop_category(
  p_outlet_id uuid,
  p_action text,
  p_category_id uuid default null,
  p_name text default null,
  p_sort_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.crew_sop_categories%rowtype;
  normalized_name text := nullif(btrim(p_name), '');
  used_by integer := 0;
begin
  if auth.uid() is null
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot manage SOP categories for this outlet.';
  end if;

  if p_action not in ('create', 'rename', 'reorder', 'delete') then
    raise exception using errcode = '22023', message = 'Unsupported SOP category action.';
  end if;

  if p_action = 'create' then
    if normalized_name is null or length(normalized_name) > 80 then
      raise exception using errcode = '22023', message = 'Category name must contain 1 to 80 characters.';
    end if;
    insert into public.crew_sop_categories(outlet_id, name, sort_order)
    values (p_outlet_id, normalized_name, coalesce(p_sort_order, 10))
    returning * into target;
  else
    select * into target
    from public.crew_sop_categories
    where id = p_category_id and outlet_id = p_outlet_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'SOP category not found.';
    end if;

    if p_action = 'rename' then
      if normalized_name is null or length(normalized_name) > 80 then
        raise exception using errcode = '22023', message = 'Category name must contain 1 to 80 characters.';
      end if;
      update public.crew_sop_categories
      set name = normalized_name, updated_at = now()
      where id = target.id
      returning * into target;
      -- Category is library metadata, not version content. Keep the canonical
      -- label in sync while snapshots and published SOP sections stay frozen.
      perform public.crew_begin_learning_transition();
      update public.crew_sops
      set category = normalized_name, updated_at = now()
      where category_id = target.id;
    elsif p_action = 'reorder' then
      if p_sort_order is null then
        raise exception using errcode = '22023', message = 'Category order is required.';
      end if;
      update public.crew_sop_categories
      set sort_order = p_sort_order, updated_at = now()
      where id = target.id
      returning * into target;
    else
      select count(*) into used_by from public.crew_sops where category_id = target.id;
      if used_by > 0 then
        raise exception using errcode = '23503', message = format('Category is used by %s SOP%s. Reassign them before deleting it.', used_by, case when used_by = 1 then '' else 's' end);
      end if;
      delete from public.crew_sop_categories where id = target.id;
      return jsonb_build_object('deleted', true, 'id', target.id, 'sop_count', 0);
    end if;
  end if;

  select count(*) into used_by from public.crew_sops where category_id = target.id;
  return to_jsonb(target) || jsonb_build_object('sop_count', used_by);
end;
$$;

revoke all on function public.crew_sop_admin_library(uuid) from public, anon, authenticated;
revoke all on function public.crew_manage_sop_category(uuid, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.crew_sop_admin_library(uuid) to authenticated;
grant execute on function public.crew_manage_sop_category(uuid, text, uuid, text, integer) to authenticated;

comment on function public.crew_sop_admin_library(uuid) is
  'Outlet-scoped lightweight SOP Library with sanitized dependency counts; section content and snapshots remain deferred.';
comment on function public.crew_manage_sop_category(uuid, text, uuid, text, integer) is
  'Outlet-scoped SOP category lifecycle with safe in-use deletion and synchronized library labels.';
