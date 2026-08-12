-- Resolve the PL/pgSQL variable/column ambiguity found by the rollback-only
-- Staging media fixture. No schema or access-policy behavior changes.
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
  v_employee_id uuid;
  media public.crew_learning_media%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);

  select * into media
  from public.crew_learning_media
  where id = p_media_id and status = 'ready';

  if not found or not exists (
    select 1
    from public.crew_journey_assignments assignment
    cross join lateral jsonb_array_elements(coalesce(assignment.journey_snapshot->'modules', '[]'::jsonb)) module_item
    cross join lateral jsonb_array_elements(coalesce(module_item->'lessons', '[]'::jsonb)) lesson_item
    cross join lateral jsonb_array_elements(coalesce(lesson_item->'blocks', '[]'::jsonb)) block_item
    where assignment.employee_id = v_employee_id
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
