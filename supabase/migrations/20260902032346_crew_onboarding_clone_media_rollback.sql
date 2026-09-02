-- A clone can finalize one or more media copies before a later copy fails.
-- Compensation must remove ready as well as pending destination media records.
create or replace function public.crew_abort_onboarding_clone(p_journey_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_journey public.crew_journeys%rowtype;
begin
  select * into target_journey from public.crew_journeys where id = p_journey_id for update;
  if not found
     or target_journey.status <> 'draft'
     or not target_journey.is_mandatory_onboarding
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(target_journey.outlet_id) then
    raise exception using errcode = '42501', message = 'The cloned Onboarding draft is unavailable.';
  end if;
  if exists (select 1 from public.crew_journey_assignments where journey_id = p_journey_id) then
    raise exception using errcode = '22023', message = 'A cloned Onboarding draft with Crew assignments cannot be removed.';
  end if;
  delete from public.crew_localized_content_audit audit
  where audit.domain = 'onboarding' and audit.version_id = p_journey_id;
  delete from public.crew_localized_content_units unit
  where unit.domain = 'onboarding' and unit.version_id = p_journey_id;
  delete from public.crew_learning_media media
  where media.outlet_id = target_journey.outlet_id
    and media.status in ('pending', 'ready')
    and exists (
      select 1 from public.crew_lesson_blocks block
      join public.crew_lessons lesson on lesson.id = block.lesson_id
      join public.crew_journey_modules module on module.id = lesson.module_id
      where module.journey_id = p_journey_id
        and block.payload #>> '{media,id}' = media.id::text
    );
  delete from public.crew_journeys where id = p_journey_id;
  return true;
end;
$$;
revoke all on function public.crew_abort_onboarding_clone(uuid) from public, anon, authenticated;
grant execute on function public.crew_abort_onboarding_clone(uuid) to authenticated;
