-- Phase B Admin lifecycle: keep normal draft editing in RLS, but make publish/version
-- transitions atomic and prevent published learning content from being rewritten in place.

create table public.crew_learning_transition_locks (
  transaction_id bigint primary key,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.crew_learning_transition_locks enable row level security;
revoke all on table public.crew_learning_transition_locks from public, anon, authenticated;

create or replace function public.crew_learning_transition_allowed() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.crew_learning_transition_locks where transaction_id=txid_current() and actor_id=auth.uid());
$$;
revoke all on function public.crew_learning_transition_allowed() from public, anon, authenticated;

create or replace function public.crew_begin_learning_transition() returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.crew_learning_transition_locks(transaction_id,actor_id) values(txid_current(),auth.uid()) on conflict(transaction_id) do update set actor_id=excluded.actor_id,created_at=now();
end;
$$;
revoke all on function public.crew_begin_learning_transition() from public, anon, authenticated;

create or replace function public.crew_end_learning_transition() returns void
language plpgsql security definer set search_path=public as $$
begin
  delete from public.crew_learning_transition_locks where transaction_id=txid_current() and actor_id=auth.uid();
end;
$$;
revoke all on function public.crew_end_learning_transition() from public, anon, authenticated;

create or replace function public.crew_learning_admin_can_access_journey(p_journey_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission('crew_learning.manage') and exists(select 1 from public.crew_journeys j where j.id=p_journey_id and (j.outlet_id is null or public.current_user_can_access_outlet(j.outlet_id)));
$$;
revoke all on function public.crew_learning_admin_can_access_journey(uuid) from public, anon, authenticated;

create or replace function public.crew_sop_admin_can_access_sop(p_sop_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission('crew_sop.manage') and exists(select 1 from public.crew_sops s where s.id=p_sop_id and (s.outlet_id is null or public.current_user_can_access_outlet(s.outlet_id)));
$$;
revoke all on function public.crew_sop_admin_can_access_sop(uuid) from public, anon, authenticated;

alter policy crew_learning_admin_journeys on public.crew_journeys using (public.current_user_has_permission('crew_learning.manage') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))) with check (public.current_user_has_permission('crew_learning.manage') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id)));
alter policy crew_learning_admin_modules on public.crew_journey_modules using (public.crew_learning_admin_can_access_journey(journey_id)) with check (public.crew_learning_admin_can_access_journey(journey_id));
alter policy crew_learning_admin_lessons on public.crew_lessons using (public.crew_learning_admin_can_access_journey((select journey_id from public.crew_journey_modules where id=module_id))) with check (public.crew_learning_admin_can_access_journey((select journey_id from public.crew_journey_modules where id=module_id)));
alter policy crew_learning_admin_blocks on public.crew_lesson_blocks using (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=lesson_id))) with check (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=lesson_id)));
alter policy crew_quiz_admin on public.crew_quizzes using (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=lesson_id))) with check (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=lesson_id)));
alter policy crew_quiz_questions_admin on public.crew_quiz_questions using (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where q.id=quiz_id))) with check (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where q.id=quiz_id)));
alter policy crew_quiz_options_admin on public.crew_quiz_options using (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where qq.id=question_id))) with check (public.crew_learning_admin_can_access_journey((select m.journey_id from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where qq.id=question_id)));
alter policy crew_sop_admin on public.crew_sops using (public.current_user_has_permission('crew_sop.manage') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))) with check (public.current_user_has_permission('crew_sop.manage') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id)));
alter policy crew_sop_versions_admin on public.crew_sop_versions using (public.crew_sop_admin_can_access_sop(sop_id)) with check (public.crew_sop_admin_can_access_sop(sop_id));
alter policy crew_sop_sections_admin on public.crew_sop_sections using (public.crew_sop_admin_can_access_sop((select sop_id from public.crew_sop_versions where id=sop_version_id))) with check (public.crew_sop_admin_can_access_sop((select sop_id from public.crew_sop_versions where id=sop_version_id)));

create or replace function public.crew_guard_published_learning() returns trigger
language plpgsql security definer set search_path=public as $$
declare parent_status text; parent_id uuid;
begin
  if public.crew_learning_transition_allowed() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'crew_journeys' and old.status = 'published' then
    raise exception using errcode='42501', message='Published journeys require a new version.';
  end if;
  if tg_table_name = 'crew_sops' and old.status = 'published' then
    raise exception using errcode='42501', message='Published SOPs require a new version.';
  end if;
  if tg_table_name = 'crew_sop_versions' and old.status = 'published' then
    raise exception using errcode='42501', message='Published SOP versions are immutable.';
  end if;
  if tg_table_name = 'crew_sop_sections' then
    select status into parent_status from public.crew_sop_versions where id = case when tg_op = 'DELETE' then old.sop_version_id else new.sop_version_id end;
    if parent_status = 'published' then raise exception using errcode='42501', message='Published SOP versions are immutable.'; end if;
  end if;
  if tg_table_name = 'crew_journey_modules' then parent_id := case when tg_op = 'DELETE' then old.journey_id else new.journey_id end;
  elsif tg_table_name = 'crew_lessons' then select journey_id into parent_id from public.crew_journey_modules where id=case when tg_op = 'DELETE' then old.module_id else new.module_id end;
  elsif tg_table_name = 'crew_lesson_blocks' then select m.journey_id into parent_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=case when tg_op = 'DELETE' then old.lesson_id else new.lesson_id end;
  elsif tg_table_name = 'crew_quizzes' then select m.journey_id into parent_id from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=case when tg_op = 'DELETE' then old.lesson_id else new.lesson_id end;
  elsif tg_table_name = 'crew_quiz_questions' then select m.journey_id into parent_id from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where q.id=case when tg_op = 'DELETE' then old.quiz_id else new.quiz_id end;
  elsif tg_table_name = 'crew_quiz_options' then select m.journey_id into parent_id from public.crew_quiz_questions qq join public.crew_quizzes q on q.id=qq.quiz_id join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where qq.id=case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  end if;
  if parent_id is not null then
    select status into parent_status from public.crew_journeys where id=parent_id;
    if parent_status = 'published' then raise exception using errcode='42501', message='Published journeys require a new version.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger crew_guard_published_journeys before update or delete on public.crew_journeys for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_modules before insert or update or delete on public.crew_journey_modules for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_lessons before insert or update or delete on public.crew_lessons for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_blocks before insert or update or delete on public.crew_lesson_blocks for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_quizzes before insert or update or delete on public.crew_quizzes for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_questions before insert or update or delete on public.crew_quiz_questions for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_options before insert or update or delete on public.crew_quiz_options for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_sops before update or delete on public.crew_sops for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_sop_versions before update or delete on public.crew_sop_versions for each row execute function public.crew_guard_published_learning();
create trigger crew_guard_published_sop_sections before insert or update or delete on public.crew_sop_sections for each row execute function public.crew_guard_published_learning();

create or replace function public.crew_publish_journey(p_journey_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
begin
  if not public.current_user_has_permission('crew_learning.manage') then raise exception using errcode='42501', message='Missing permission to publish Crew learning.'; end if;
  if not exists(select 1 from public.crew_journeys where id=p_journey_id and status='draft') then raise exception using errcode='22023', message='Only a draft journey can be published.'; end if;
  if not public.crew_learning_admin_can_access_journey(p_journey_id) then raise exception using errcode='42501',message='You cannot publish learning for this outlet.'; end if;
  if not exists(select 1 from public.crew_journey_modules where journey_id=p_journey_id) or not exists(select 1 from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id) then raise exception using errcode='22023', message='A journey needs at least one module and lesson.'; end if;
  if exists(select 1 from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id and q.status <> 'draft') then raise exception using errcode='22023', message='Quiz lifecycle is inconsistent.'; end if;
  if exists(select 1 from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=p_journey_id and (not exists(select 1 from public.crew_quiz_questions qq where qq.quiz_id=q.id) or exists(select 1 from public.crew_quiz_questions qq where qq.quiz_id=q.id and not exists(select 1 from public.crew_quiz_options o where o.question_id=qq.id)) or not exists(select 1 from public.crew_quiz_options o join public.crew_quiz_questions qq on qq.id=o.question_id where qq.quiz_id=q.id and o.is_correct))) then raise exception using errcode='22023',message='Each quiz needs questions, options and a correct answer.'; end if;
  perform public.crew_begin_learning_transition();
  update public.crew_journeys set status='published', published_at=now(), updated_at=now() where id=p_journey_id;
  update public.crew_journey_modules set status='published' where journey_id=p_journey_id;
  update public.crew_quizzes q set status='published' from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where q.lesson_id=l.id and m.journey_id=p_journey_id;
  perform public.crew_end_learning_transition();
  return p_journey_id;
end;
$$;
revoke all on function public.crew_publish_journey(uuid) from public, anon, authenticated;
grant execute on function public.crew_publish_journey(uuid) to authenticated;

create or replace function public.crew_new_journey_version(p_journey_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare source_journey public.crew_journeys%rowtype; source_module record; source_lesson record; source_block record; source_quiz record; source_question record; source_option record; new_journey uuid; new_module uuid; new_lesson uuid; new_quiz uuid; new_question uuid;
begin
  if not public.current_user_has_permission('crew_learning.manage') then raise exception using errcode='42501', message='Missing permission to version Crew learning.'; end if;
  select * into source_journey from public.crew_journeys where id=p_journey_id and status='published'; if not found then raise exception using errcode='22023',message='Only a published journey can be versioned.'; end if;
  if source_journey.outlet_id is not null and not public.current_user_can_access_outlet(source_journey.outlet_id) then raise exception using errcode='42501',message='You cannot version learning for this outlet.'; end if;
  insert into public.crew_journeys(name,description,journey_type,status,version,estimated_minutes,sequential_modules,outlet_id,position,created_by) values(source_journey.name,source_journey.description,source_journey.journey_type,'draft',source_journey.version+1,source_journey.estimated_minutes,source_journey.sequential_modules,source_journey.outlet_id,source_journey.position,auth.uid()) returning id into new_journey;
  for source_module in select * from public.crew_journey_modules where journey_id=p_journey_id order by sort_order loop
    insert into public.crew_journey_modules(journey_id,title,description,sort_order,estimated_minutes,required,status) values(new_journey,source_module.title,source_module.description,source_module.sort_order,source_module.estimated_minutes,source_module.required,'draft') returning id into new_module;
    for source_lesson in select * from public.crew_lessons where module_id=source_module.id order by sort_order loop
      insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes) values(new_module,source_lesson.title,source_lesson.sort_order,source_lesson.content_type,source_lesson.required,source_lesson.estimated_minutes) returning id into new_lesson;
      insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order) select new_lesson,block_type,payload,sort_order from public.crew_lesson_blocks where lesson_id=source_lesson.id;
      for source_quiz in select * from public.crew_quizzes where lesson_id=source_lesson.id loop
        insert into public.crew_quizzes(lesson_id,title,passing_score,status,required) values(new_lesson,source_quiz.title,source_quiz.passing_score,'draft',source_quiz.required) returning id into new_quiz;
        for source_question in select * from public.crew_quiz_questions where quiz_id=source_quiz.id order by sort_order loop
          insert into public.crew_quiz_questions(quiz_id,prompt,question_type,explanation,sort_order) values(new_quiz,source_question.prompt,source_question.question_type,source_question.explanation,source_question.sort_order) returning id into new_question;
          insert into public.crew_quiz_options(question_id,label,is_correct,sort_order) select new_question,label,is_correct,sort_order from public.crew_quiz_options where question_id=source_question.id;
        end loop;
      end loop;
    end loop;
  end loop;
  return new_journey;
end;
$$;
revoke all on function public.crew_new_journey_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_new_journey_version(uuid) to authenticated;

create or replace function public.crew_new_sop_version(p_sop_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare source_sop public.crew_sops%rowtype; next_version integer; new_version uuid; source_version uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501', message='Missing permission to version Crew SOPs.'; end if;
  select * into source_sop from public.crew_sops where id=p_sop_id; if not found then raise exception using errcode='P0002',message='SOP not found.'; end if;
  if not public.crew_sop_admin_can_access_sop(p_sop_id) then raise exception using errcode='42501',message='You cannot version SOPs for this outlet.'; end if;
  select id into source_version from public.crew_sop_versions where sop_id=p_sop_id and status='published' order by version desc limit 1;
  select coalesce(max(version),0)+1 into next_version from public.crew_sop_versions where sop_id=p_sop_id;
  insert into public.crew_sop_versions(sop_id,version,status,effective_date,change_summary,require_acknowledgement) select p_sop_id,next_version,'draft',effective_date,change_summary,require_acknowledgement from public.crew_sop_versions where id=source_version union all select p_sop_id,next_version,'draft',null,null,false where source_version is null returning id into new_version;
  if source_version is not null then insert into public.crew_sop_sections(sop_version_id,title,body,sort_order,key_point,media_url) select new_version,title,body,sort_order,key_point,media_url from public.crew_sop_sections where sop_version_id=source_version order by sort_order; end if;
  return new_version;
end;
$$;
revoke all on function public.crew_new_sop_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_new_sop_version(uuid) to authenticated;

create or replace function public.crew_publish_sop_version(p_sop_version_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare sop uuid;
begin
  if not public.current_user_has_permission('crew_sop.manage') then raise exception using errcode='42501',message='Missing permission to publish Crew SOPs.'; end if;
  select sop_id into sop from public.crew_sop_versions where id=p_sop_version_id and status='draft'; if sop is null then raise exception using errcode='22023',message='Only a draft SOP version can be published.'; end if;
  if not public.crew_sop_admin_can_access_sop(sop) then raise exception using errcode='42501',message='You cannot publish SOPs for this outlet.'; end if;
  if not exists(select 1 from public.crew_sop_sections where sop_version_id=p_sop_version_id) then raise exception using errcode='22023',message='An SOP version needs at least one section.'; end if;
  perform public.crew_begin_learning_transition();
  update public.crew_sop_versions set status='published',published_at=now(),published_by=auth.uid() where id=p_sop_version_id;
  update public.crew_sops set status='published',current_version=(select version from public.crew_sop_versions where id=p_sop_version_id),updated_at=now() where id=sop;
  perform public.crew_end_learning_transition();
  return p_sop_version_id;
end;
$$;
revoke all on function public.crew_publish_sop_version(uuid) from public, anon, authenticated;
grant execute on function public.crew_publish_sop_version(uuid) to authenticated;
