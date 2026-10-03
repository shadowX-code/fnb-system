-- Canonical SOP Library RBAC. Legacy permission rows and onboarding journey
-- evidence are retained; neither is an alternative access authority.
alter table public.crew_sops add column created_by uuid;
alter table public.crew_sops alter column created_by set default auth.uid();
comment on column public.crew_sops.created_by is 'Server-attributed creator for initial unpublished SOP authoring; historical rows remain unattributed.';
create or replace function public.crew_sop_guard_creator() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.created_by:=auth.uid();
  elsif new.created_by is distinct from old.created_by then raise exception using errcode='42501',message='SOP creator attribution is immutable.';
  end if;
  return new;
end; $$;
revoke all on function public.crew_sop_guard_creator() from public,anon,authenticated;
create trigger crew_sop_guard_creator before insert or update on public.crew_sops for each row execute function public.crew_sop_guard_creator();

-- Reuse the scoped SOP authoring helper. Create only authorizes completion of
-- the caller's own initial unpublished draft; it cannot edit an existing SOP.
create or replace function public.crew_sop_admin_can_access_sop(p_sop_id uuid) returns boolean language sql stable security definer set search_path='' as $$
select public.current_user_has_permission('crew_sop_library.view') and exists (
  select 1 from public.crew_sops s where s.id=p_sop_id and s.outlet_id is not null
    and public.current_user_can_access_outlet(s.outlet_id)
    and (public.current_user_has_permission('crew_sop_library.edit')
      or public.current_user_has_permission('crew_sop_library.manage')
      or (public.current_user_has_permission('crew_sop_library.create') and s.created_by=auth.uid()
        and s.status='draft' and not exists(select 1 from public.crew_sop_versions v where v.sop_id=s.id and v.status='published')))
); $$;
revoke all on function public.crew_sop_admin_can_access_sop(uuid) from public,anon;
grant execute on function public.crew_sop_admin_can_access_sop(uuid) to authenticated;


CREATE OR REPLACE FUNCTION public.crew_admin_sop_usage(p_sop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_outlet_id uuid;
begin
  if not public.current_user_has_permission('crew_sop_library.view') then
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
$function$
;


CREATE OR REPLACE FUNCTION public.crew_attach_sop_media(p_section_id uuid, p_media_id uuid, p_caption text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_version_status text; v_outlet_id uuid; v_sop_id uuid; v_media public.crew_sop_media%rowtype;
begin
  select version.status, sop.outlet_id, version.sop_id
  into v_version_status, v_outlet_id, v_sop_id
  from public.crew_sop_sections section
  join public.crew_sop_versions version on version.id=section.sop_version_id
  join public.crew_sops sop on sop.id=version.sop_id
  where section.id=p_section_id;
  select * into v_media from public.crew_sop_media where id=p_media_id and status='ready';
  if auth.uid() is null or v_version_status <> 'draft' or not found
     or v_media.outlet_id <> v_outlet_id or v_media.sop_id <> v_sop_id
     or not public.crew_sop_admin_can_access_sop(v_sop_id)
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode='42501',message='SOP media cannot be attached.';
  end if;
  update public.crew_sop_sections
  set media_id=p_media_id,
      media_caption=coalesce(nullif(btrim(coalesce(p_caption,'')),''), media_caption)
  where id=p_section_id;
  return true;
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_clone_learning_setup(p_source_outlet_id uuid, p_target_outlet_id uuid, p_copy_onboarding boolean DEFAULT true, p_copy_sop_categories boolean DEFAULT true, p_copy_sops boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  source_journey public.crew_journeys%rowtype;
  source_module record;
  source_lesson record;
  source_block record;
  source_quiz record;
  source_question record;
  source_sop record;
  source_version record;
  source_category record;
  target_sop_id uuid;
  target_version_id uuid;
  target_category_id uuid;
  target_journey_id uuid;
  target_module_id uuid;
  target_lesson_id uuid;
  target_quiz_id uuid;
  target_question_id uuid;
  mapped_sop_id uuid;
  next_journey_version integer;
  cloned_sops integer := 0;
  cloned_categories integer := 0;
begin
  if p_source_outlet_id = p_target_outlet_id then
    raise exception using errcode = '22023', message = 'Choose a different source outlet.';
  end if;

  if not public.current_user_can_access_outlet(p_source_outlet_id)
     or not public.current_user_can_access_outlet(p_target_outlet_id) then
    raise exception using errcode = '42501', message = 'You need access to both outlets to clone learning.';
  end if;

  if p_copy_onboarding and not public.current_user_has_permission('crew_learning.manage') then
    raise exception using errcode = '42501', message = 'Missing permission to clone onboarding.';
  end if;

  if (p_copy_sop_categories or p_copy_sops)
     and not (public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) then
    raise exception using errcode = '42501', message = 'Missing permission to clone SOPs.';
  end if;

  if not p_copy_onboarding and not p_copy_sop_categories and not p_copy_sops then
    raise exception using errcode = '22023', message = 'Select at least one part of the learning setup.';
  end if;

  if p_copy_onboarding and exists (
    select 1 from public.crew_journeys
    where outlet_id = p_target_outlet_id
      and is_mandatory_onboarding
      and status in ('draft', 'published')
  ) then
    raise exception using errcode = '23505', message = 'The target outlet already has an onboarding setup.';
  end if;

  if p_copy_sops and exists (
    select 1 from public.crew_sops
    where outlet_id = p_target_outlet_id
      and status <> 'archived'
  ) then
    raise exception using errcode = '23505', message = 'The target outlet already has an SOP library.';
  end if;

  create temporary table if not exists pg_temp.crew_clone_sop_map (
    source_sop_id uuid primary key,
    target_sop_id uuid not null
  ) on commit drop;
  truncate table pg_temp.crew_clone_sop_map;

  if p_copy_sop_categories or p_copy_sops then
    for source_category in
      select * from public.crew_sop_categories
      where outlet_id = p_source_outlet_id
      order by sort_order, name
    loop
      select id into target_category_id
      from public.crew_sop_categories
      where outlet_id = p_target_outlet_id
        and lower(btrim(name)) = lower(btrim(source_category.name));

      if target_category_id is null then
        insert into public.crew_sop_categories(outlet_id, name, sort_order)
        values (p_target_outlet_id, source_category.name, source_category.sort_order)
        returning id into target_category_id;
      else
        update public.crew_sop_categories
        set sort_order = source_category.sort_order,
            updated_at = now()
        where id = target_category_id;
      end if;
      cloned_categories := cloned_categories + 1;
    end loop;
  end if;

  if p_copy_sops then
    for source_sop in
      select s.*
      from public.crew_sops s
      where s.outlet_id = p_source_outlet_id
        and s.status = 'published'
      order by s.category, s.title
    loop
      select c.id into target_category_id
      from public.crew_sop_categories source_c
      join public.crew_sop_categories c
        on c.outlet_id = p_target_outlet_id
       and lower(btrim(c.name)) = lower(btrim(source_c.name))
      where source_c.id = source_sop.category_id;

      insert into public.crew_sops(
        title, category, category_id, summary, status, current_version,
        outlet_id, position
      ) values (
        source_sop.title, source_sop.category, target_category_id,
        source_sop.summary, 'draft', null, p_target_outlet_id, source_sop.position
      ) returning id into target_sop_id;

      select v.* into source_version
      from public.crew_sop_versions v
      where v.sop_id = source_sop.id
        and v.status = 'published'
      order by v.version desc
      limit 1;

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

      insert into pg_temp.crew_clone_sop_map(source_sop_id, target_sop_id)
      values (source_sop.id, target_sop_id);
      cloned_sops := cloned_sops + 1;
    end loop;
  end if;

  if p_copy_onboarding then
    select * into source_journey
    from public.crew_journeys
    where id = public.crew_current_onboarding_for_outlet(p_source_outlet_id);

    if source_journey.id is null then
      raise exception using errcode = 'P0002', message = 'The source outlet has no published onboarding setup.';
    end if;

    -- When SOPs are not cloned, every source reference must resolve to an
    -- independently published target SOP with the same title and category.
    if not p_copy_sops then
      insert into pg_temp.crew_clone_sop_map(source_sop_id, target_sop_id)
      select source_s.id, target_s.id
      from public.crew_sops source_s
      join public.crew_sops target_s
        on target_s.outlet_id = p_target_outlet_id
       and target_s.status = 'published'
       and lower(btrim(target_s.title)) = lower(btrim(source_s.title))
       and lower(btrim(target_s.category)) = lower(btrim(source_s.category))
      where source_s.outlet_id = p_source_outlet_id
      on conflict (source_sop_id) do update set target_sop_id = excluded.target_sop_id;

      if exists (
        select 1
        from public.crew_lesson_blocks b
        join public.crew_lessons l on l.id = b.lesson_id
        join public.crew_journey_modules m on m.id = l.module_id
        where m.journey_id = source_journey.id
          and b.block_type = 'sop_reference'
          and not exists (
            select 1 from pg_temp.crew_clone_sop_map map
            where map.source_sop_id = (b.payload->>'sop_id')::uuid
          )
      ) then
        raise exception using errcode = '22023', message = 'Clone the SOP Library or provide matching published SOPs in the target outlet.';
      end if;
    end if;

    select coalesce(max(version), 0) + 1 into next_journey_version
    from public.crew_journeys
    where outlet_id = p_target_outlet_id
      and is_mandatory_onboarding;

    insert into public.crew_journeys(
      name, description, journey_type, status, version, estimated_minutes,
      sequential_modules, outlet_id, position, created_by, lineage_id,
      is_mandatory_onboarding
    ) values (
      'New Crew Onboarding', source_journey.description, 'onboarding', 'draft',
      next_journey_version, source_journey.estimated_minutes, true,
      p_target_outlet_id, 'Mandatory for all Crew', auth.uid(), gen_random_uuid(), true
    ) returning id into target_journey_id;

    for source_module in
      select * from public.crew_journey_modules
      where journey_id = source_journey.id
      order by sort_order
    loop
      insert into public.crew_journey_modules(
        journey_id, title, description, sort_order, estimated_minutes, required, status
      ) values (
        target_journey_id, source_module.title, source_module.description,
        source_module.sort_order, source_module.estimated_minutes,
        source_module.required, 'draft'
      ) returning id into target_module_id;

      for source_lesson in
        select * from public.crew_lessons
        where module_id = source_module.id
        order by sort_order
      loop
        insert into public.crew_lessons(
          module_id, title, sort_order, content_type, required, estimated_minutes
        ) values (
          target_module_id, source_lesson.title, source_lesson.sort_order,
          source_lesson.content_type, source_lesson.required,
          source_lesson.estimated_minutes
        ) returning id into target_lesson_id;

        for source_block in
          select * from public.crew_lesson_blocks
          where lesson_id = source_lesson.id
          order by sort_order
        loop
          if source_block.block_type = 'sop_reference' then
            select map.target_sop_id into mapped_sop_id
            from pg_temp.crew_clone_sop_map map
            where map.source_sop_id = (source_block.payload->>'sop_id')::uuid;

            if mapped_sop_id is null then
              raise exception using errcode = '22023', message = 'A cloned onboarding SOP reference could not be mapped safely.';
            end if;

            insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
            values (
              target_lesson_id,
              source_block.block_type,
              jsonb_set(source_block.payload, '{sop_id}', to_jsonb(mapped_sop_id::text), true),
              source_block.sort_order
            );
          else
            insert into public.crew_lesson_blocks(lesson_id, block_type, payload, sort_order)
            values (target_lesson_id, source_block.block_type, source_block.payload, source_block.sort_order);
          end if;
        end loop;

        for source_quiz in
          select * from public.crew_quizzes
          where lesson_id = source_lesson.id
        loop
          insert into public.crew_quizzes(lesson_id, title, passing_score, status, required)
          values (target_lesson_id, source_quiz.title, source_quiz.passing_score, 'draft', source_quiz.required)
          returning id into target_quiz_id;

          for source_question in
            select * from public.crew_quiz_questions
            where quiz_id = source_quiz.id
            order by sort_order
          loop
            insert into public.crew_quiz_questions(
              quiz_id, prompt, question_type, explanation, sort_order
            ) values (
              target_quiz_id, source_question.prompt, source_question.question_type,
              source_question.explanation, source_question.sort_order
            ) returning id into target_question_id;

            insert into public.crew_quiz_options(question_id, label, is_correct, sort_order)
            select target_question_id, label, is_correct, sort_order
            from public.crew_quiz_options
            where question_id = source_question.id
            order by sort_order;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'target_outlet_id', p_target_outlet_id,
    'onboarding_id', target_journey_id,
    'sop_categories_cloned', cloned_categories,
    'sops_cloned', cloned_sops,
    'status', 'draft'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_clone_selected_sops(p_source_outlet_id uuid, p_target_outlet_id uuid, p_sop_ids uuid[], p_copy_categories boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  source_sop public.crew_sops%rowtype; source_version public.crew_sop_versions%rowtype;
  source_section public.crew_sop_sections%rowtype; source_media public.crew_sop_media%rowtype;
  target_sop_id uuid; target_version_id uuid; target_category_id uuid; target_media_id uuid; target_section_id uuid; target_path text;
  cloned_sops integer := 0; cloned_categories integer := 0; media_manifest jsonb := '[]'::jsonb;
begin
  if p_source_outlet_id = p_target_outlet_id then raise exception using errcode='22023',message='Choose a different source outlet.'; end if;
  if coalesce(cardinality(p_sop_ids),0)=0 then raise exception using errcode='22023',message='Select at least one SOP.'; end if;
  if auth.uid() is null or not (public.current_user_has_permission('crew_sop_library.view') and (public.current_user_has_permission('crew_sop_library.create') or public.current_user_has_permission('crew_sop_library.manage'))) then raise exception using errcode='42501',message='Missing permission to clone Crew SOPs.'; end if;
  if not public.current_user_can_access_outlet(p_source_outlet_id) or not public.current_user_can_access_outlet(p_target_outlet_id) then raise exception using errcode='42501',message='You need access to both outlets to clone SOPs.'; end if;
  if exists (select 1 from unnest(p_sop_ids) requested(id) where not exists (
    select 1 from public.crew_sops s where s.id=requested.id and s.outlet_id=p_source_outlet_id and s.status='published'
  )) then raise exception using errcode='22023',message='Every selected SOP must be published in the source outlet.'; end if;

  for source_sop in select s.* from public.crew_sops s where s.id=any(p_sop_ids) and s.outlet_id=p_source_outlet_id and s.status='published' order by s.category,s.title,s.id loop
    if exists(select 1 from public.crew_sops existing where existing.outlet_id=p_target_outlet_id and existing.status<>'archived' and lower(btrim(existing.title))=lower(btrim(source_sop.title))) then
      raise exception using errcode='23505',message=format('An SOP named "%s" already exists in the target outlet.',source_sop.title);
    end if;
    target_category_id := null;
    if p_copy_categories and source_sop.category_id is not null then
      select target.id into target_category_id from public.crew_sop_categories source
      join public.crew_sop_categories target on target.outlet_id=p_target_outlet_id and lower(btrim(target.name))=lower(btrim(source.name))
      where source.id=source_sop.category_id;
      if target_category_id is null then
        insert into public.crew_sop_categories(outlet_id,name,sort_order)
        select p_target_outlet_id,name,sort_order from public.crew_sop_categories where id=source_sop.category_id
        returning id into target_category_id;
        cloned_categories := cloned_categories+1;
      end if;
    end if;
    select v.* into source_version from public.crew_sop_versions v where v.sop_id=source_sop.id and v.status='published' order by v.version desc limit 1;
    insert into public.crew_sops(title,category,category_id,summary,status,current_version,outlet_id,position)
    values(source_sop.title,source_sop.category,target_category_id,source_sop.summary,'draft',null,p_target_outlet_id,source_sop.position)
    returning id into target_sop_id;
    insert into public.crew_sop_versions(sop_id,version,effective_date,change_summary,status,require_acknowledgement)
    values(target_sop_id,1,source_version.effective_date,'Cloned from '||source_sop.title,'draft',source_version.require_acknowledgement)
    returning id into target_version_id;

    for source_section in select * from public.crew_sop_sections where sop_version_id=source_version.id order by sort_order loop
      target_media_id := null;
      if source_section.media_id is not null then
        select * into source_media from public.crew_sop_media where id=source_section.media_id and status='ready';
        if not found then raise exception using errcode='22023',message='A source SOP image is unavailable.'; end if;
        target_media_id := gen_random_uuid();
        target_path := p_target_outlet_id::text||'/'||target_sop_id::text||'/'||target_version_id::text||'/'||target_media_id::text||'.webp';
        insert into public.crew_sop_media(id,outlet_id,sop_id,sop_version_id,object_path,original_filename,mime_type,file_size_bytes,width,height,status,uploaded_by)
        values(target_media_id,p_target_outlet_id,target_sop_id,target_version_id,target_path,source_media.original_filename,source_media.mime_type,source_media.file_size_bytes,source_media.width,source_media.height,'pending',auth.uid());
        media_manifest := media_manifest || jsonb_build_array(jsonb_build_object(
          'source_bucket',source_media.bucket_id,'source_path',source_media.object_path,
          'target_id',target_media_id,'target_bucket','crew-sop-media','target_path',target_path
        ));
      end if;
      insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point,media_url,media_caption)
      values(target_version_id,source_section.title,source_section.body,source_section.sort_order,source_section.key_point,null,source_section.media_caption)
      returning id into target_section_id;
      if target_media_id is not null then
        media_manifest := jsonb_set(
          media_manifest,
          array[(jsonb_array_length(media_manifest)-1)::text],
          media_manifest->(jsonb_array_length(media_manifest)-1) || jsonb_build_object('target_section_id',target_section_id)
        );
      end if;
    end loop;
    cloned_sops := cloned_sops+1;
  end loop;
  return jsonb_build_object(
    'source_outlet_id',p_source_outlet_id,'target_outlet_id',p_target_outlet_id,
    'sops_cloned',cloned_sops,'categories_created',cloned_categories,
    'copies_are_independent',true,'media_copies',media_manifest
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_finalize_sop_media_delete(p_media_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found then return true; end if;
  if auth.uid() is null
     or not public.crew_sop_admin_can_access_sop(v_media.sop_id)
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if v_media.status <> 'deleting' then
    raise exception using errcode = '22023', message = 'SOP media is not pending deletion.';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = v_media.bucket_id and o.name = v_media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The SOP image has not been removed from storage.';
  end if;
  delete from public.crew_sop_media where id = p_media_id;
  return true;
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_finalize_sop_media_upload(p_media_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found or auth.uid() is null
     or not public.crew_sop_admin_can_access_sop(v_media.sop_id)
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if v_media.status <> 'pending' then
    raise exception using errcode = '22023', message = 'SOP media is not awaiting upload.';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = v_media.bucket_id and o.name = v_media.object_path
  ) then
    raise exception using errcode = '22023', message = 'The SOP image upload did not complete.';
  end if;
  update public.crew_sop_media set status = 'ready', updated_at = now() where id = p_media_id;
  return jsonb_build_object(
    'id', v_media.id, 'bucket', v_media.bucket_id, 'object_path', v_media.object_path,
    'mime_type', v_media.mime_type, 'file_size_bytes', v_media.file_size_bytes,
    'width', v_media.width, 'height', v_media.height, 'status', 'ready'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_localization_version_context(p_domain text, p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare result jsonb;
begin
  if p_domain='sop' then
    select jsonb_build_object('outlet_id',s.outlet_id,'status',v.status,'permission','crew_sop_library.view','sop_id',s.id) into result
    from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=p_version_id;
  elsif p_domain='onboarding' then
    select jsonb_build_object('outlet_id',j.outlet_id,'status',j.status,'permission','crew_learning.manage') into result
    from public.crew_journeys j where j.id=p_version_id;
  elsif p_domain='task' then
    select jsonb_build_object('outlet_id',t.outlet_id,'status',t.status,'permission','crew_operations.manage') into result
    from public.crew_operation_templates t where t.id=p_version_id;
  else
    raise exception using errcode='22023',message='Unsupported localized content domain.';
  end if;
  if result is null then raise exception using errcode='22023',message='Localized content version was not found.'; end if;
  return result;
end; $function$
;


CREATE OR REPLACE FUNCTION public.crew_manage_sop_category(p_outlet_id uuid, p_action text, p_category_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text, p_sort_order integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.crew_sop_categories%rowtype;
  normalized_name text := nullif(btrim(p_name), '');
  used_by integer := 0;
begin
  if auth.uid() is null
     or not (public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage'))
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
$function$
;


CREATE OR REPLACE FUNCTION public.crew_new_sop_version(p_sop_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare source_sop public.crew_sops%rowtype; source_version public.crew_sop_versions%rowtype; next_version integer; new_version uuid;
begin
  if not public.crew_sop_admin_can_access_sop(p_sop_id) then raise exception using errcode='42501', message='Missing permission to version Crew SOPs.'; end if;
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
$function$
;


CREATE OR REPLACE FUNCTION public.crew_prepare_sop_draft_media_cleanup(p_sop_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_outlet_id uuid; v_status text; v_assets jsonb;
begin
  select sop.outlet_id, version.status into v_outlet_id, v_status
  from public.crew_sop_versions version join public.crew_sops sop on sop.id=version.sop_id
  where version.id=p_sop_version_id;
  if auth.uid() is null or v_status <> 'draft'
     or not (public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage'))
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode='42501',message='SOP draft cannot be deleted.';
  end if;
  delete from public.crew_sop_sections where sop_version_id=p_sop_version_id;
  update public.crew_sop_media set status='deleting',updated_at=now()
  where sop_version_id=p_sop_version_id and status in ('pending','ready');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'object_path',object_path) order by created_at),'[]'::jsonb)
  into v_assets from public.crew_sop_media where sop_version_id=p_sop_version_id and status='deleting';
  return jsonb_build_object('sop_version_id',p_sop_version_id,'assets',v_assets);
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_prepare_sop_media_upload(p_sop_version_id uuid, p_original_filename text, p_mime_type text, p_file_size_bytes bigint, p_width integer DEFAULT NULL::integer, p_height integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_media_id uuid := gen_random_uuid();
  v_sop_id uuid;
  v_outlet_id uuid;
  v_status text;
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_name text;
  v_path text;
begin
  select v.sop_id, s.outlet_id, v.status
  into v_sop_id, v_outlet_id, v_status
  from public.crew_sop_versions v
  join public.crew_sops s on s.id = v.sop_id
  where v.id = p_sop_version_id;

  if auth.uid() is null or v_status <> 'draft'
     or not public.crew_sop_admin_can_access_sop(v_sop_id)
     or not public.current_user_can_access_outlet(v_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot upload media for this SOP draft.';
  end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception using errcode = '22023', message = 'Only JPG, PNG, and WebP images are supported.';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 5242880 then
    raise exception using errcode = '22023', message = 'SOP images must be 5MB or smaller.';
  end if;
  if (p_width is not null and p_width <= 0) or (p_height is not null and p_height <= 0) then
    raise exception using errcode = '22023', message = 'Image dimensions are invalid.';
  end if;

  v_name := left(regexp_replace(coalesce(nullif(btrim(p_original_filename), ''), 'sop-image'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120);
  v_path := v_outlet_id::text || '/' || v_sop_id::text || '/' || p_sop_version_id::text || '/' || v_media_id::text || '.webp';

  insert into public.crew_sop_media(
    id, outlet_id, sop_id, sop_version_id, object_path, original_filename,
    mime_type, file_size_bytes, width, height, uploaded_by
  ) values (
    v_media_id, v_outlet_id, v_sop_id, p_sop_version_id, v_path, v_name,
    v_mime, p_file_size_bytes, p_width, p_height, auth.uid()
  );

  return jsonb_build_object(
    'id', v_media_id, 'bucket', 'crew-sop-media', 'object_path', v_path,
    'mime_type', v_mime, 'file_size_bytes', p_file_size_bytes,
    'width', p_width, 'height', p_height, 'status', 'pending'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_publish_sop_version(p_sop_version_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_sop_id uuid; v_version public.crew_sop_versions%rowtype; v_category_name text;
begin
  if not (public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) then raise exception using errcode='42501',message='Missing permission to publish Crew SOPs.'; end if;
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
$function$
;


CREATE OR REPLACE FUNCTION public.crew_request_sop_media_delete(p_media_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare v_media public.crew_sop_media%rowtype;
begin
  select * into v_media from public.crew_sop_media where id = p_media_id for update;
  if not found or auth.uid() is null
     or not public.crew_sop_admin_can_access_sop(v_media.sop_id)
     or not public.current_user_can_access_outlet(v_media.outlet_id) then
    raise exception using errcode = '42501', message = 'SOP media is unavailable.';
  end if;
  if exists (
    select 1 from public.crew_sop_sections section
    join public.crew_sop_versions version on version.id = section.sop_version_id
    where section.media_id = p_media_id and version.status = 'published'
  ) then
    return jsonb_build_object('can_delete', false, 'reason', 'published_reference', 'id', v_media.id);
  end if;
  if exists (select 1 from public.crew_sop_sections where media_id = p_media_id) then
    return jsonb_build_object('can_delete', false, 'reason', 'draft_reference', 'id', v_media.id);
  end if;
  update public.crew_sop_media set status = 'deleting', updated_at = now() where id = p_media_id;
  return jsonb_build_object(
    'can_delete', true, 'id', v_media.id, 'bucket', v_media.bucket_id,
    'object_path', v_media.object_path
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_sop_admin_detail(p_sop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_outlet_id uuid;
  result jsonb;
begin
  select sop.outlet_id
  into target_outlet_id
  from public.crew_sops sop
  where sop.id = p_sop_id;

  if target_outlet_id is null then
    raise exception using errcode = 'P0002', message = 'SOP not found.';
  end if;
  if not public.current_user_has_permission('crew_sop_library.view')
     or not public.current_user_can_access_outlet(target_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view this SOP.';
  end if;

  select to_jsonb(sop) || jsonb_build_object(
    'versions', coalesce((
      select jsonb_agg(
        to_jsonb(version_row) || jsonb_build_object(
          'sections', coalesce((
            select jsonb_agg(to_jsonb(section_row) order by section_row.sort_order)
            from public.crew_sop_sections section_row
            where section_row.sop_version_id = version_row.id
          ), '[]'::jsonb)
        ) order by version_row.version desc
      )
      from public.crew_sop_versions version_row
      where version_row.sop_id = sop.id
    ), '[]'::jsonb)
  )
  into result
  from public.crew_sops sop
  where sop.id = p_sop_id;

  return result;
end;
$function$
;


CREATE OR REPLACE FUNCTION public.crew_sop_admin_library(p_outlet_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_outlet_id is null
     or not public.current_user_has_permission('crew_sop_library.view')
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
$function$
;


create or replace function public.crew_localization_assert_admin(p_domain text,p_version_id uuid,p_require_draft boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare context jsonb;
begin
  context:=public.crew_localization_version_context(p_domain,p_version_id);
  if not public.current_user_has_permission(context->>'permission') or not public.current_user_can_access_outlet((context->>'outlet_id')::uuid)
    or (p_domain='sop' and p_require_draft and not public.crew_sop_admin_can_access_sop((context->>'sop_id')::uuid)) then
    raise exception using errcode='42501',message='Localized content is unavailable for this outlet.';
  end if;
  if p_require_draft and context->>'status'<>'draft' then raise exception using errcode='55000',message='Published content is immutable. Create or continue a Draft version.'; end if;
  return context;
end; $$;


drop policy "crew_sop_media_admin_select" on public."crew_sop_media";

create policy "crew_sop_media_admin_select" on public."crew_sop_media" for select to authenticated using ((public.current_user_has_permission('crew_sop_library.view') AND current_user_can_access_outlet(outlet_id)));

drop policy "crew sop admins upload media" on storage."objects";

create policy "crew sop admins upload media" on storage."objects" for insert to authenticated with check (((bucket_id = 'crew-sop-media'::text) AND (EXISTS ( SELECT 1
   FROM crew_sop_media media
  WHERE ((media.bucket_id = objects.bucket_id) AND (media.object_path = objects.name) AND (media.status = 'pending'::text) AND (media.uploaded_by = auth.uid()) AND public.crew_sop_admin_can_access_sop(media.sop_id) AND current_user_can_access_outlet(media.outlet_id))))));

drop policy "crew learning admins can view scoped outlets" on public."outlets";

create policy "crew learning admins can view scoped outlets" on public."outlets" for select to authenticated using (((current_user_has_permission('crew_learning.view'::text) OR current_user_has_permission('crew_learning.manage'::text) OR public.current_user_has_permission('crew_sop_library.view') OR public.current_user_has_permission('crew_sop_library.view') OR current_user_has_permission('crew_growth.view'::text) OR current_user_has_permission('crew_growth.manage'::text) OR current_user_has_permission('crew_growth.assess'::text) OR current_user_has_permission('crew_growth.certify'::text)) AND current_user_can_access_outlet(id)));

drop policy "crew_sop_ack_admin" on public."crew_sop_acknowledgements";

create policy "crew_sop_ack_admin" on public."crew_sop_acknowledgements" for select to authenticated using (public.current_user_has_permission('crew_sop_library.view') and exists(select 1 from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=sop_version_id and public.current_user_can_access_outlet(s.outlet_id)));

drop policy "crew_sop_versions_admin" on public."crew_sop_versions";

create policy "crew_sop_versions_admin_read" on public."crew_sop_versions" for select to authenticated using (public.current_user_has_permission('crew_sop_library.view') and exists(select 1 from public.crew_sops s where s.id=sop_id and public.current_user_can_access_outlet(s.outlet_id)));

create policy "crew_sop_versions_admin_create" on public."crew_sop_versions" for insert to authenticated with check (public.crew_sop_admin_can_access_sop(sop_id));

create policy "crew_sop_versions_admin_edit" on public."crew_sop_versions" for update to authenticated using (public.crew_sop_admin_can_access_sop(sop_id)) with check (public.crew_sop_admin_can_access_sop(sop_id));

create policy "crew_sop_versions_admin_delete" on public."crew_sop_versions" for delete to authenticated using ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.crew_sop_admin_can_access_sop(sop_id));

drop policy "crew_sop_sections_admin" on public."crew_sop_sections";

create policy "crew_sop_sections_admin_read" on public."crew_sop_sections" for select to authenticated using (public.current_user_has_permission('crew_sop_library.view') and exists(select 1 from public.crew_sops s where s.id=(select v.sop_id from public.crew_sop_versions v where v.id=sop_version_id) and public.current_user_can_access_outlet(s.outlet_id)));

create policy "crew_sop_sections_admin_create" on public."crew_sop_sections" for insert to authenticated with check (public.crew_sop_admin_can_access_sop((select v.sop_id from public.crew_sop_versions v where v.id=sop_version_id)));

create policy "crew_sop_sections_admin_edit" on public."crew_sop_sections" for update to authenticated using (public.crew_sop_admin_can_access_sop((select v.sop_id from public.crew_sop_versions v where v.id=sop_version_id))) with check (public.crew_sop_admin_can_access_sop((select v.sop_id from public.crew_sop_versions v where v.id=sop_version_id)));

create policy "crew_sop_sections_admin_delete" on public."crew_sop_sections" for delete to authenticated using ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.crew_sop_admin_can_access_sop((select v.sop_id from public.crew_sop_versions v where v.id=sop_version_id)));

drop policy "crew_sop_categories_admin" on public."crew_sop_categories";

create policy "crew_sop_categories_admin_read" on public."crew_sop_categories" for select to authenticated using (public.current_user_has_permission('crew_sop_library.view') and public.current_user_can_access_outlet(outlet_id));

create policy "crew_sop_categories_admin_create" on public."crew_sop_categories" for insert to authenticated with check ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.current_user_can_access_outlet(outlet_id));

create policy "crew_sop_categories_admin_edit" on public."crew_sop_categories" for update to authenticated using ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.current_user_can_access_outlet(outlet_id)) with check ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.current_user_can_access_outlet(outlet_id));

create policy "crew_sop_categories_admin_delete" on public."crew_sop_categories" for delete to authenticated using ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.current_user_can_access_outlet(outlet_id));

drop policy "crew_sop_admin" on public."crew_sops";

create policy "crew_sop_admin_read" on public."crew_sops" for select to authenticated using (public.current_user_has_permission('crew_sop_library.view') and public.current_user_can_access_outlet(outlet_id));

create policy "crew_sop_admin_create" on public."crew_sops" for insert to authenticated with check ((public.current_user_has_permission('crew_sop_library.view') and (public.current_user_has_permission('crew_sop_library.create') or public.current_user_has_permission('crew_sop_library.manage'))) and public.current_user_can_access_outlet(outlet_id) and created_by=auth.uid() and status='draft' and current_version is null);

create policy "crew_sop_admin_edit" on public."crew_sops" for update to authenticated using (public.crew_sop_admin_can_access_sop(id)) with check (public.crew_sop_admin_can_access_sop(id) and public.current_user_can_access_outlet(outlet_id));

create policy "crew_sop_admin_delete" on public."crew_sops" for delete to authenticated using ((public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage')) and public.current_user_can_access_outlet(outlet_id));

drop policy "crew sop admins delete prepared media" on storage."objects";

create policy "crew sop admins delete prepared media" on storage."objects" for delete to authenticated using (((bucket_id = 'crew-sop-media'::text) AND (EXISTS ( SELECT 1
   FROM crew_sop_media media
  WHERE ((media.bucket_id = objects.bucket_id) AND (media.object_path = objects.name) AND (media.status = 'deleting'::text) AND public.crew_sop_admin_can_access_sop(media.sop_id) AND current_user_can_access_outlet(media.outlet_id))))));

drop policy "crew sop admins read media" on storage."objects";

create policy "crew sop admins read media" on storage."objects" for select to authenticated using (((bucket_id = 'crew-sop-media'::text) AND (EXISTS ( SELECT 1
   FROM crew_sop_media media
  WHERE ((media.bucket_id = objects.bucket_id) AND (media.object_path = objects.name) AND (media.status = ANY (ARRAY['pending'::text, 'ready'::text, 'deleting'::text])) AND public.current_user_has_permission('crew_sop_library.view') AND current_user_can_access_outlet(media.outlet_id))))));

-- Draft authoring cannot bypass Manage by writing publication fields directly.
create or replace function public.crew_sop_guard_publication_permission() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='published' and (tg_op='INSERT' or old.status is distinct from new.status) then
    if not (public.current_user_has_permission('crew_sop_library.view') and public.current_user_has_permission('crew_sop_library.manage') and public.crew_learning_transition_allowed()) then
      raise exception using errcode='42501',message='SOP publication requires Manage and the publish workflow.';
    end if;
  end if;
  if tg_table_name='crew_sops' and tg_op='UPDATE' and (to_jsonb(new)->>'current_version') is distinct from (to_jsonb(old)->>'current_version') and not public.crew_learning_transition_allowed() then
    raise exception using errcode='42501',message='SOP current version is owned by the publish workflow.';
  end if;
  return new;
end; $$;
revoke all on function public.crew_sop_guard_publication_permission() from public,anon,authenticated;
create trigger crew_sop_guard_publication_permission before insert or update on public.crew_sops for each row execute function public.crew_sop_guard_publication_permission();
create trigger crew_sop_guard_publication_permission before insert or update on public.crew_sop_versions for each row execute function public.crew_sop_guard_publication_permission();

-- Version/section identity cannot be moved to bypass published-parent guards.
create or replace function public.crew_sop_guard_content_parent() returns trigger language plpgsql set search_path='' as $$
begin
  if (tg_table_name='crew_sop_versions' and (to_jsonb(new)->>'sop_id') is distinct from (to_jsonb(old)->>'sop_id'))
    or (tg_table_name='crew_sop_sections' and (to_jsonb(new)->>'sop_version_id') is distinct from (to_jsonb(old)->>'sop_version_id')) then
    raise exception using errcode='42501',message='SOP content parent identity is immutable.';
  end if;
  return new;
end; $$;
revoke all on function public.crew_sop_guard_content_parent() from public,anon,authenticated;
create trigger crew_sop_guard_content_parent before update on public.crew_sop_versions for each row execute function public.crew_sop_guard_content_parent();
create trigger crew_sop_guard_content_parent before update on public.crew_sop_sections for each row execute function public.crew_sop_guard_content_parent();
