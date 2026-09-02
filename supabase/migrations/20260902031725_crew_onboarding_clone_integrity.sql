-- Dedicated, outlet-scoped onboarding cloning. The older generic learning
-- setup clone predates version-bound localization and learning media.

create or replace function public.crew_admin_onboarding_clone_preview(
  p_source_outlet_id uuid,
  p_target_outlet_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  source_journey public.crew_journeys%rowtype;
  language_codes jsonb;
begin
  if p_source_outlet_id is null
     or p_target_outlet_id is null
     or p_source_outlet_id = p_target_outlet_id then
    raise exception using errcode = '22023', message = 'Choose a different source outlet.';
  end if;
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_source_outlet_id)
     or not public.current_user_can_access_outlet(p_target_outlet_id) then
    raise exception using errcode = '42501', message = 'You need Onboarding access to both outlets.';
  end if;

  select * into source_journey
  from public.crew_journeys
  where id = public.crew_current_onboarding_for_outlet(p_source_outlet_id);
  if not found then
    raise exception using errcode = 'P0002', message = 'The source outlet has no published onboarding.';
  end if;

  select coalesce(jsonb_agg(language_code order by language_code), '[]'::jsonb)
  into language_codes
  from (
    select distinct unit.source_language as language_code
    from public.crew_localized_content_units unit
    where unit.domain = 'onboarding' and unit.version_id = source_journey.id
    union
    select distinct translation.language_code
    from public.crew_localized_content_translations translation
    join public.crew_localized_content_units unit on unit.id = translation.unit_id
    where unit.domain = 'onboarding' and unit.version_id = source_journey.id
  ) languages;

  return jsonb_build_object(
    'source_onboarding_id', source_journey.id,
    'source_version', source_journey.version,
    'modules', (select count(*) from public.crew_journey_modules where journey_id = source_journey.id),
    'lessons', (select count(*) from public.crew_lessons lesson join public.crew_journey_modules module on module.id = lesson.module_id where module.journey_id = source_journey.id),
    'knowledge_checks', (select count(*) from public.crew_quizzes quiz join public.crew_lessons lesson on lesson.id = quiz.lesson_id join public.crew_journey_modules module on module.id = lesson.module_id where module.journey_id = source_journey.id),
    'languages', language_codes,
    'target_has_draft', exists (select 1 from public.crew_journeys where outlet_id = p_target_outlet_id and is_mandatory_onboarding and status = 'draft'),
    'target_draft_version', (select version from public.crew_journeys where outlet_id = p_target_outlet_id and is_mandatory_onboarding and status = 'draft' order by version desc limit 1)
  );
end;
$$;
revoke all on function public.crew_admin_onboarding_clone_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crew_admin_onboarding_clone_preview(uuid, uuid) to authenticated;

create or replace function public.crew_clone_onboarding(
  p_source_outlet_id uuid,
  p_target_outlet_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  source_journey public.crew_journeys%rowtype;
  source_module record;
  source_lesson record;
  source_block record;
  source_quiz record;
  source_question record;
  source_media public.crew_learning_media%rowtype;
  target_journey_id uuid;
  target_module_id uuid;
  target_lesson_id uuid;
  target_quiz_id uuid;
  target_question_id uuid;
  target_media_id uuid;
  mapped_sop_id uuid;
  next_version integer;
  target_path text;
  media_manifest jsonb := '[]'::jsonb;
begin
  if p_source_outlet_id is null
     or p_target_outlet_id is null
     or p_source_outlet_id = p_target_outlet_id then
    raise exception using errcode = '22023', message = 'Choose a different source outlet.';
  end if;
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_source_outlet_id)
     or not public.current_user_can_access_outlet(p_target_outlet_id) then
    raise exception using errcode = '42501', message = 'You need Onboarding access to both outlets.';
  end if;
  if exists (
    select 1 from public.crew_journeys
    where outlet_id = p_target_outlet_id
      and is_mandatory_onboarding
      and status = 'draft'
  ) then
    raise exception using errcode = '23505', message = 'The destination already has an Onboarding draft. Finish or discard that draft before cloning.';
  end if;

  select * into source_journey
  from public.crew_journeys
  where id = public.crew_current_onboarding_for_outlet(p_source_outlet_id)
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'The source outlet has no published onboarding.';
  end if;

  create temporary table if not exists pg_temp.crew_onboarding_clone_sop_map (
    source_sop_id uuid primary key,
    target_sop_id uuid not null
  ) on commit drop;
  truncate table pg_temp.crew_onboarding_clone_sop_map;
  insert into pg_temp.crew_onboarding_clone_sop_map(source_sop_id, target_sop_id)
  select source_sop.id, target_sop.id
  from public.crew_sops source_sop
  join public.crew_sops target_sop
    on target_sop.outlet_id = p_target_outlet_id
   and target_sop.status = 'published'
   and lower(btrim(target_sop.title)) = lower(btrim(source_sop.title))
   and lower(btrim(target_sop.category)) = lower(btrim(source_sop.category))
  where source_sop.outlet_id = p_source_outlet_id;

  if exists (
    select 1
    from public.crew_lesson_blocks block
    join public.crew_lessons lesson on lesson.id = block.lesson_id
    join public.crew_journey_modules module on module.id = lesson.module_id
    where module.journey_id = source_journey.id
      and block.block_type = 'sop_reference'
      and not exists (
        select 1 from pg_temp.crew_onboarding_clone_sop_map map
        where map.source_sop_id = (block.payload->>'sop_id')::uuid
      )
  ) then
    raise exception using errcode = '22023', message = 'The destination needs matching published SOPs for every referenced onboarding SOP.';
  end if;

  create temporary table if not exists pg_temp.crew_onboarding_clone_media_map (
    source_media_id uuid primary key,
    target_media_id uuid not null
  ) on commit drop;
  truncate table pg_temp.crew_onboarding_clone_media_map;

  select coalesce(max(version), 0) + 1 into next_version
  from public.crew_journeys
  where outlet_id = p_target_outlet_id and is_mandatory_onboarding;

  insert into public.crew_journeys(
    name, description, journey_type, status, version, estimated_minutes,
    sequential_modules, outlet_id, position, created_by, lineage_id,
    is_mandatory_onboarding
  ) values (
    source_journey.name, source_journey.description, source_journey.journey_type,
    'draft', next_version, source_journey.estimated_minutes,
    source_journey.sequential_modules, p_target_outlet_id, source_journey.position,
    auth.uid(), gen_random_uuid(), true
  ) returning id into target_journey_id;

  for source_module in
    select * from public.crew_journey_modules where journey_id = source_journey.id order by sort_order
  loop
    insert into public.crew_journey_modules(journey_id, title, description, sort_order, estimated_minutes, required, status)
    values (target_journey_id, source_module.title, source_module.description, source_module.sort_order, source_module.estimated_minutes, source_module.required, 'draft')
    returning id into target_module_id;

    for source_lesson in
      select * from public.crew_lessons where module_id = source_module.id order by sort_order
    loop
      insert into public.crew_lessons(module_id, title, sort_order, content_type, required, estimated_minutes)
      values (target_module_id, source_lesson.title, source_lesson.sort_order, source_lesson.content_type, source_lesson.required, source_lesson.estimated_minutes)
      returning id into target_lesson_id;

      for source_block in
        select * from public.crew_lesson_blocks where lesson_id = source_lesson.id order by sort_order
      loop
        if source_block.block_type = 'sop_reference' then
          select target_sop_id into mapped_sop_id
          from pg_temp.crew_onboarding_clone_sop_map
          where source_sop_id = (source_block.payload->>'sop_id')::uuid;
          insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
          values (target_lesson_id, source_block.block_type, jsonb_set(source_block.payload, '{sop_id}', to_jsonb(mapped_sop_id::text), true), source_block.sort_order);
        elsif nullif(source_block.payload #>> '{media,id}', '') is not null then
          select * into source_media
          from public.crew_learning_media
          where id = (source_block.payload #>> '{media,id}')::uuid
            and outlet_id = p_source_outlet_id
            and status = 'ready';
          if not found then
            raise exception using errcode = '22023', message = 'A source learning image is unavailable for cloning.';
          end if;
          select media_map.target_media_id into target_media_id
          from pg_temp.crew_onboarding_clone_media_map media_map
          where media_map.source_media_id = source_media.id;
          if target_media_id is null then
            target_media_id := gen_random_uuid();
            target_path := p_target_outlet_id::text || '/' || target_media_id::text || '/asset.' || case source_media.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
            insert into public.crew_learning_media(id, outlet_id, bucket_id, object_path, original_filename, mime_type, file_size_bytes, width, height, status, uploaded_by)
            values (target_media_id, p_target_outlet_id, source_media.bucket_id, target_path, source_media.original_filename, source_media.mime_type, source_media.file_size_bytes, source_media.width, source_media.height, 'pending', auth.uid());
            insert into pg_temp.crew_onboarding_clone_media_map(source_media_id, target_media_id)
            values (source_media.id, target_media_id);
            media_manifest := media_manifest || jsonb_build_array(jsonb_build_object(
              'source_bucket', source_media.bucket_id,
              'source_path', source_media.object_path,
              'target_id', target_media_id,
              'target_bucket', source_media.bucket_id,
              'target_path', target_path
            ));
          end if;
          insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
          values (target_lesson_id, source_block.block_type, jsonb_set(source_block.payload, '{media,id}', to_jsonb(target_media_id::text), true), source_block.sort_order);
        else
          insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
          values (target_lesson_id, source_block.block_type, source_block.payload, source_block.sort_order);
        end if;
      end loop;

      for source_quiz in select * from public.crew_quizzes where lesson_id = source_lesson.id loop
        insert into public.crew_quizzes(lesson_id, title, passing_score, status, required)
        values (target_lesson_id, source_quiz.title, source_quiz.passing_score, 'draft', source_quiz.required)
        returning id into target_quiz_id;
        for source_question in select * from public.crew_quiz_questions where quiz_id = source_quiz.id order by sort_order loop
          insert into public.crew_quiz_questions(quiz_id, prompt, question_type, explanation, sort_order)
          values (target_quiz_id, source_question.prompt, source_question.question_type, source_question.explanation, source_question.sort_order)
          returning id into target_question_id;
          insert into public.crew_quiz_options(question_id, label, is_correct, sort_order)
          select target_question_id, label, is_correct, sort_order
          from public.crew_quiz_options where question_id = source_question.id order by sort_order;
        end loop;
      end loop;
    end loop;
  end loop;

  insert into public.crew_localized_content_units(domain, outlet_id, version_id, unit_key, field_kind, source_language, source_value, source_revision, source_hash, created_by, updated_by)
  select unit.domain, p_target_outlet_id, target_journey_id, unit.unit_key, unit.field_kind, unit.source_language, unit.source_value, unit.source_revision, unit.source_hash, auth.uid(), auth.uid()
  from public.crew_localized_content_units unit
  where unit.domain = 'onboarding' and unit.version_id = source_journey.id;

  insert into public.crew_localized_content_translations(unit_id, language_code, translated_value, status, provider, model, generated_by, generated_at, source_revision, source_hash, manually_edited_at, manually_edited_by, reviewed_by, reviewed_at)
  select target_unit.id, translation.language_code, translation.translated_value, translation.status, translation.provider, translation.model, translation.generated_by, translation.generated_at, translation.source_revision, translation.source_hash, translation.manually_edited_at, translation.manually_edited_by, translation.reviewed_by, translation.reviewed_at
  from public.crew_localized_content_units source_unit
  join public.crew_localized_content_translations translation on translation.unit_id = source_unit.id
  join public.crew_localized_content_units target_unit on target_unit.domain = 'onboarding' and target_unit.version_id = target_journey_id and target_unit.unit_key = source_unit.unit_key
  where source_unit.domain = 'onboarding' and source_unit.version_id = source_journey.id;

  insert into public.crew_localized_content_audit(unit_id, domain, version_id, action, source_language, source_revision, source_hash, actor_id, metadata)
  select target_unit.id, 'onboarding', target_journey_id, 'version_cloned', target_unit.source_language, target_unit.source_revision, target_unit.source_hash, auth.uid(), jsonb_build_object('source_outlet_id', p_source_outlet_id, 'source_version_id', source_journey.id)
  from public.crew_localized_content_units target_unit
  where target_unit.domain = 'onboarding' and target_unit.version_id = target_journey_id;

  return jsonb_build_object(
    'onboarding_id', target_journey_id,
    'source_onboarding_id', source_journey.id,
    'source_version', source_journey.version,
    'target_version', next_version,
    'media_copies', media_manifest
  );
end;
$$;
revoke all on function public.crew_clone_onboarding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crew_clone_onboarding(uuid, uuid) to authenticated;

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
    and media.status = 'pending'
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

comment on function public.crew_clone_onboarding(uuid, uuid) is
  'Atomically creates an independent destination onboarding draft from the source outlet latest published onboarding. Crew history and assignments are never copied.';
