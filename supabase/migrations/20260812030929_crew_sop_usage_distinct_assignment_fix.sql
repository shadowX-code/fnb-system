-- Correct historical SOP usage so an assignment referencing the same SOP in
-- multiple lessons is counted once, while preserving the sanitized payload.
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
          count(distinct a.id) as assignment_count
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

comment on function public.crew_admin_sop_usage(uuid) is
  'Returns sanitized current references and distinct pinned assignment counts without exposing snapshots.';
