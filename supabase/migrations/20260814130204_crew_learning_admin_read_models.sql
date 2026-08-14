-- Crew Learning Admin read models.
--
-- The regular authenticated table policies remain the CRUD source of truth.
-- These read-only authorities avoid repeatedly evaluating the same permission
-- and outlet checks at every level of deeply nested PostgREST relationships.

create or replace function public.crew_admin_onboarding_list(p_outlet_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_outlet_id is null
     or not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(p_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view Crew Onboarding for this outlet.';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', journey.id,
        'name', journey.name,
        'description', journey.description,
        'journey_type', journey.journey_type,
        'status', journey.status,
        'version', journey.version,
        'estimated_minutes', journey.estimated_minutes,
        'sequential_modules', journey.sequential_modules,
        'outlet_id', journey.outlet_id,
        'position', journey.position,
        'created_at', journey.created_at,
        'updated_at', journey.updated_at,
        'published_at', journey.published_at,
        'lineage_id', journey.lineage_id,
        'is_mandatory_onboarding', journey.is_mandatory_onboarding,
        'modules', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', module.id,
              'title', module.title,
              'description', module.description,
              'sort_order', module.sort_order,
              'estimated_minutes', module.estimated_minutes,
              'required', module.required,
              'status', module.status,
              'lessons', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', lesson.id,
                    'title', lesson.title,
                    'sort_order', lesson.sort_order,
                    'content_type', lesson.content_type,
                    'required', lesson.required,
                    'estimated_minutes', lesson.estimated_minutes,
                    'quizzes', coalesce((
                      select jsonb_agg(
                        jsonb_build_object(
                          'id', quiz.id,
                          'title', quiz.title,
                          'passing_score', quiz.passing_score,
                          'required', quiz.required,
                          'status', quiz.status
                        ) order by quiz.id
                      )
                      from public.crew_quizzes quiz
                      where quiz.lesson_id = lesson.id
                    ), '[]'::jsonb)
                  ) order by lesson.sort_order
                )
                from public.crew_lessons lesson
                where lesson.module_id = module.id
              ), '[]'::jsonb)
            ) order by module.sort_order
          )
          from public.crew_journey_modules module
          where module.journey_id = journey.id
        ), '[]'::jsonb)
      ) order by journey.version desc
    )
    from public.crew_journeys journey
    where journey.outlet_id = p_outlet_id
      and journey.is_mandatory_onboarding = true
  ), '[]'::jsonb);
end;
$$;

create or replace function public.crew_admin_onboarding_detail(p_journey_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_outlet_id uuid;
  result jsonb;
begin
  select journey.outlet_id
  into target_outlet_id
  from public.crew_journeys journey
  where journey.id = p_journey_id
    and journey.is_mandatory_onboarding = true;

  if target_outlet_id is null then
    raise exception using errcode = 'P0002', message = 'Crew Onboarding version not found.';
  end if;
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_can_access_outlet(target_outlet_id) then
    raise exception using errcode = '42501', message = 'You cannot view this Crew Onboarding version.';
  end if;

  select to_jsonb(journey) - ('created_by'::text) || jsonb_build_object(
    'modules', coalesce((
      select jsonb_agg(
        to_jsonb(module) || jsonb_build_object(
          'lessons', coalesce((
            select jsonb_agg(
              to_jsonb(lesson) || jsonb_build_object(
                'blocks', coalesce((
                  select jsonb_agg(to_jsonb(block) order by block.sort_order)
                  from public.crew_lesson_blocks block
                  where block.lesson_id = lesson.id
                ), '[]'::jsonb),
                'quizzes', coalesce((
                  select jsonb_agg(
                    to_jsonb(quiz) || jsonb_build_object(
                      'questions', coalesce((
                        select jsonb_agg(
                          to_jsonb(question) || jsonb_build_object(
                            'options', coalesce((
                              select jsonb_agg(to_jsonb(option_row) order by option_row.sort_order)
                              from public.crew_quiz_options option_row
                              where option_row.question_id = question.id
                            ), '[]'::jsonb)
                          ) order by question.sort_order
                        )
                        from public.crew_quiz_questions question
                        where question.quiz_id = quiz.id
                      ), '[]'::jsonb)
                    ) order by quiz.id
                  )
                  from public.crew_quizzes quiz
                  where quiz.lesson_id = lesson.id
                ), '[]'::jsonb)
              ) order by lesson.sort_order
            )
            from public.crew_lessons lesson
            where lesson.module_id = module.id
          ), '[]'::jsonb)
        ) order by module.sort_order
      )
      from public.crew_journey_modules module
      where module.journey_id = journey.id
    ), '[]'::jsonb)
  )
  into result
  from public.crew_journeys journey
  where journey.id = p_journey_id;

  return result;
end;
$$;

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
      where sop.outlet_id = p_outlet_id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(category_row) order by category_row.sort_order, category_row.name)
      from public.crew_sop_categories category_row
      where category_row.outlet_id = p_outlet_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.crew_sop_admin_detail(p_sop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  if not public.current_user_has_permission('crew_sop.manage')
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
$$;

revoke all on function public.crew_admin_onboarding_list(uuid) from public, anon, authenticated;
revoke all on function public.crew_admin_onboarding_detail(uuid) from public, anon, authenticated;
revoke all on function public.crew_sop_admin_library(uuid) from public, anon, authenticated;
revoke all on function public.crew_sop_admin_detail(uuid) from public, anon, authenticated;

grant execute on function public.crew_admin_onboarding_list(uuid) to authenticated;
grant execute on function public.crew_admin_onboarding_detail(uuid) to authenticated;
grant execute on function public.crew_sop_admin_library(uuid) to authenticated;
grant execute on function public.crew_sop_admin_detail(uuid) to authenticated;

comment on function public.crew_admin_onboarding_list(uuid) is
  'Outlet-scoped lightweight Onboarding list for authenticated Crew Learning admins; editor content is deferred.';
comment on function public.crew_admin_onboarding_detail(uuid) is
  'Outlet-scoped full Onboarding editor read for authenticated Crew Learning admins.';
comment on function public.crew_sop_admin_library(uuid) is
  'Outlet-scoped lightweight SOP Library list for authenticated SOP admins; section content is deferred.';
comment on function public.crew_sop_admin_detail(uuid) is
  'Outlet-scoped full SOP version and section read for authenticated SOP admins.';
