
-- A generic trigger receives table-specific OLD/NEW records. Use JSONB for
-- status checks so an SOP-section trigger never attempts to resolve OLD.status.
create or replace function public.crew_guard_published_learning() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent_status text; parent_id uuid;
begin
  if public.crew_learning_transition_allowed() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'crew_journeys' and (to_jsonb(old)->>'status') = 'published' then raise exception using errcode='42501',message='Published journeys require a new version.'; end if;
  if tg_table_name = 'crew_sops' and (to_jsonb(old)->>'status') = 'published' then raise exception using errcode='42501',message='Published SOPs require a new version.'; end if;
  if tg_table_name = 'crew_sop_versions' and (to_jsonb(old)->>'status') = 'published' then raise exception using errcode='42501',message='Published SOP versions are immutable.'; end if;
  if tg_table_name = 'crew_sop_sections' then
    select status into parent_status from public.crew_sop_versions where id=case when tg_op='DELETE' then old.sop_version_id else new.sop_version_id end;
    if parent_status='published' then raise exception using errcode='42501',message='Published SOP versions are immutable.'; end if;
  end if;
  if tg_table_name='crew_journey_modules' then parent_id:=case when tg_op='DELETE' then old.journey_id else new.journey_id end;
  elsif tg_table_name='crew_lessons' then select journey_id into parent_id from public.crew_journey_modules where id=case when tg_op='DELETE' then old.module_id else new.module_id end;
  elsif tg_table_name='crew_lesson_blocks' then select m.journey_id into parent_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=case when tg_op='DELETE' then old.lesson_id else new.lesson_id end;
  elsif tg_table_name='crew_quizzes' then select m.journey_id into parent_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=case when tg_op='DELETE' then old.lesson_id else new.lesson_id end;
  elsif tg_table_name='crew_quiz_questions' then select m.journey_id into parent_id from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where q.id=case when tg_op='DELETE' then old.quiz_id else new.quiz_id end;
  elsif tg_table_name='crew_quiz_options' then select m.journey_id into parent_id from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where qq.id=case when tg_op='DELETE' then old.question_id else new.question_id end;
  end if;
  if parent_id is not null then select status into parent_status from public.crew_journeys where id=parent_id; if parent_status='published' then raise exception using errcode='42501',message='Published journeys require a new version.'; end if; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.crew_guard_published_learning() from public, anon, authenticated;
