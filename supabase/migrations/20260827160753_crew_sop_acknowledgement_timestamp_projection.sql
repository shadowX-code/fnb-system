-- Expose the existing acknowledgement timestamp through the current
-- session-bound SOP read authority. Visibility and all security settings
-- deliberately match the currently applied function.
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
    select 1 from public.crew_sop_versions v join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id and v.status = 'published' and s.status = 'published' and s.outlet_id = v_outlet_id
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
  if not v_visible then raise exception using errcode = '42501', message = 'SOP version is unavailable.'; end if;
  return (
    select jsonb_build_object(
      'id', v.id, 'version', v.version, 'effective_date', v.effective_date, 'change_summary', v.change_summary,
      'title', s.title, 'category', s.category, 'category_id', s.category_id, 'summary', s.summary,
      'acknowledgement_required', v.require_acknowledgement,
      'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', section.id, 'title', section.title, 'body', section.body, 'sort_order', section.sort_order,
        'key_point', section.key_point, 'media', case when media.id is null then null else jsonb_build_object(
          'id', media.id, 'mime_type', media.mime_type, 'width', media.width, 'height', media.height,
          'caption', section.media_caption
        ) end
      ) order by section.sort_order)
      from public.crew_sop_sections section left join public.crew_sop_media media on media.id = section.media_id
      where section.sop_version_id = v.id), '[]'::jsonb),
      'acknowledged', exists(select 1 from public.crew_sop_acknowledgements a where a.employee_id = v_employee_id and a.sop_version_id = v.id),
      'acknowledged_at', (select a.acknowledged_at from public.crew_sop_acknowledgements a where a.employee_id = v_employee_id and a.sop_version_id = v.id)
    ) from public.crew_sop_versions v join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id and v.status = 'published'
  );
end;
$$;
revoke all on function public.crew_sop_version(text, uuid) from public, anon, authenticated;
grant execute on function public.crew_sop_version(text, uuid) to anon, authenticated;

-- Return the same immutable acknowledgement evidence on a new or idempotent
-- acknowledgement. The existing write, session binding, and grants are intact.
create or replace function public.crew_acknowledge_sop(
  p_token text,
  p_sop_version_id uuid,
  p_source text default 'journey'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_outlet_id uuid;
  visible boolean := false;
  v_acknowledged_at timestamptz;
begin
  if p_source not in ('direct_library', 'journey', 'required_update') then
    raise exception using errcode = '22023', message = 'Unsupported SOP acknowledgement source.';
  end if;
  v_employee_id := public.crew_session_employee(p_token);
  select primary_outlet_id into v_outlet_id
  from public.crew_access
  where employee_id = v_employee_id;
  select exists (
    select 1
    from public.crew_sop_versions v
    join public.crew_sops s on s.id = v.sop_id
    where v.id = p_sop_version_id
      and v.status = 'published'
      and s.status = 'published'
      and s.outlet_id = v_outlet_id
  ) into visible;
  if not visible then
    select exists (
      select 1
      from public.crew_journey_assignments a
      cross join lateral jsonb_array_elements(coalesce(a.journey_snapshot->'modules', '[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'lessons', '[]'::jsonb)) l
      cross join lateral jsonb_array_elements(coalesce(l->'blocks', '[]'::jsonb)) b
      where a.employee_id = v_employee_id
        and b->>'block_type' = 'sop_reference'
        and b->'payload'->>'sop_version_id' = p_sop_version_id::text
    ) into visible;
  end if;
  if not visible then raise exception using errcode = '42501', message = 'SOP version is unavailable.'; end if;
  insert into public.crew_sop_acknowledgements(employee_id, sop_version_id, source)
  values (v_employee_id, p_sop_version_id, p_source)
  on conflict (employee_id, sop_version_id) do nothing;
  select acknowledged_at into v_acknowledged_at
  from public.crew_sop_acknowledgements
  where employee_id = v_employee_id and sop_version_id = p_sop_version_id;
  return jsonb_build_object(
    'sop_version_id', p_sop_version_id,
    'acknowledged', true,
    'acknowledged_at', v_acknowledged_at
  );
end;
$$;
revoke all on function public.crew_acknowledge_sop(text, uuid, text) from public, anon, authenticated;
grant execute on function public.crew_acknowledge_sop(text, uuid, text) to anon, authenticated;
