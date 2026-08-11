-- Crew Journey Phase B: controlled quiz scoring and server-derived lesson progress.
create table public.crew_quizzes (id uuid primary key default gen_random_uuid(), lesson_id uuid not null unique references public.crew_lessons(id) on delete cascade, title text not null, passing_score integer not null default 80 check(passing_score between 0 and 100), status text not null default 'draft' check(status in ('draft','published','archived')), required boolean not null default true);
create table public.crew_quiz_questions (id uuid primary key default gen_random_uuid(), quiz_id uuid not null references public.crew_quizzes(id) on delete cascade, prompt text not null, question_type text not null default 'single_choice' check(question_type in ('single_choice','multiple_choice')), explanation text, sort_order integer not null, unique(quiz_id,sort_order));
create table public.crew_quiz_options (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.crew_quiz_questions(id) on delete cascade, label text not null, is_correct boolean not null default false, sort_order integer not null, unique(question_id,sort_order));
create table public.crew_quiz_attempts (id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id), quiz_id uuid not null references public.crew_quizzes(id), attempt_number integer not null, score integer not null check(score between 0 and 100), passed boolean not null, started_at timestamptz not null default now(), completed_at timestamptz not null default now(), unique(employee_id,quiz_id,attempt_number));
create table public.crew_quiz_answers (id uuid primary key default gen_random_uuid(), attempt_id uuid not null references public.crew_quiz_attempts(id) on delete cascade, question_id uuid not null references public.crew_quiz_questions(id), selected_option_ids uuid[] not null default '{}', correct boolean not null, unique(attempt_id,question_id));
alter table public.crew_quizzes enable row level security; alter table public.crew_quiz_questions enable row level security; alter table public.crew_quiz_options enable row level security; alter table public.crew_quiz_attempts enable row level security; alter table public.crew_quiz_answers enable row level security;
create policy crew_quiz_admin on public.crew_quizzes for all to authenticated using(public.current_user_has_permission('crew_learning.manage')) with check(public.current_user_has_permission('crew_learning.manage'));
create policy crew_quiz_questions_admin on public.crew_quiz_questions for all to authenticated using(public.current_user_has_permission('crew_learning.manage')) with check(public.current_user_has_permission('crew_learning.manage'));
create policy crew_quiz_options_admin on public.crew_quiz_options for all to authenticated using(public.current_user_has_permission('crew_learning.manage')) with check(public.current_user_has_permission('crew_learning.manage'));
create policy crew_quiz_attempts_admin on public.crew_quiz_attempts for select to authenticated using(public.current_user_has_permission('crew_learning.view'));
-- No Crew SELECT policy exposes questions/options/answers; RPC returns only safe prompts/options.

create or replace function public.crew_complete_lesson(p_token text, p_assignment_id uuid, p_lesson_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_assignment public.crew_journey_assignments%rowtype; v_lesson public.crew_lessons%rowtype; v_quiz public.crew_quizzes%rowtype; v_required integer; v_done integer;
begin
 v_employee:=public.crew_session_employee(p_token); select * into v_assignment from public.crew_journey_assignments where id=p_assignment_id and employee_id=v_employee for update;
 if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 select l.* into v_lesson from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where l.id=p_lesson_id and m.journey_id=v_assignment.journey_id;
 if not found then raise exception using errcode='22023',message='Lesson does not belong to this assignment.'; end if;
 select * into v_quiz from public.crew_quizzes where lesson_id=p_lesson_id and required and status='published';
 if found and not exists(select 1 from public.crew_quiz_attempts where employee_id=v_employee and quiz_id=v_quiz.id and passed) then raise exception using errcode='42501',message='Pass the required quiz before completing this lesson.'; end if;
 insert into public.crew_lesson_progress(assignment_id,lesson_id,status,first_started_at,last_activity_at,completed_at) values(p_assignment_id,p_lesson_id,'completed',now(),now(),now()) on conflict(assignment_id,lesson_id) do update set status='completed',last_activity_at=now(),completed_at=coalesce(crew_lesson_progress.completed_at,now());
 update public.crew_journey_assignments set status='in_progress',started_at=coalesce(started_at,now()) where id=p_assignment_id and status='not_started';
 select count(*) into v_required from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_assignment.journey_id and l.required;
 select count(*) into v_done from public.crew_lesson_progress where assignment_id=p_assignment_id and status='completed';
 if v_required=v_done then update public.crew_journey_assignments set status='completed',completed_at=now() where id=p_assignment_id; end if;
 return jsonb_build_object('assignment_id',p_assignment_id,'completed_lessons',v_done,'required_lessons',v_required,'status',(select status from public.crew_journey_assignments where id=p_assignment_id));
end; $$;
revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated; grant execute on function public.crew_complete_lesson(text,uuid,uuid) to anon,authenticated;
