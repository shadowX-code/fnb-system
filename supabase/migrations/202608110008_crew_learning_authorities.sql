-- Phase B authorities: immutable assignment snapshot, server-side quiz scoring and derived progress.
alter table public.crew_journey_assignments add column journey_snapshot jsonb not null default '{}'::jsonb;
create table public.crew_module_progress (id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.crew_journey_assignments(id) on delete cascade, module_id uuid not null references public.crew_journey_modules(id), status text not null default 'not_started' check(status in ('not_started','in_progress','completed')), first_started_at timestamptz, last_activity_at timestamptz, completed_at timestamptz, unique(assignment_id,module_id));
alter table public.crew_module_progress enable row level security;
create policy crew_module_progress_admin on public.crew_module_progress for select to authenticated using(public.current_user_has_permission('crew_learning.view'));

create or replace function public.crew_submit_quiz(p_token text,p_assignment_id uuid,p_quiz_id uuid,p_answers jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_assignment public.crew_journey_assignments%rowtype; v_quiz public.crew_quizzes%rowtype; v_total integer; v_correct integer:=0; v_attempt integer; v_score integer; v_passed boolean; v_question record; v_selected uuid[]; v_correct_ids uuid[]; v_attempt_id uuid;
begin
 v_employee:=public.crew_session_employee(p_token); select * into v_assignment from public.crew_journey_assignments where id=p_assignment_id and employee_id=v_employee for update; if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 select q.* into v_quiz from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where q.id=p_quiz_id and q.status='published' and m.journey_id=v_assignment.journey_id; if not found then raise exception using errcode='42501',message='Quiz is unavailable.'; end if;
 select count(*) into v_total from public.crew_quiz_questions where quiz_id=v_quiz.id; if v_total=0 then raise exception using errcode='22023',message='Quiz has no questions.'; end if;
 select coalesce(max(attempt_number),0)+1 into v_attempt from public.crew_quiz_attempts where employee_id=v_employee and quiz_id=v_quiz.id;
 insert into public.crew_quiz_attempts(employee_id,quiz_id,attempt_number,score,passed) values(v_employee,v_quiz.id,v_attempt,0,false) returning id into v_attempt_id;
 for v_question in select id from public.crew_quiz_questions where quiz_id=v_quiz.id order by sort_order loop
   select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_selected from jsonb_array_elements_text(coalesce(p_answers->v_question.id::text,'[]'::jsonb));
   select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_correct_ids from public.crew_quiz_options where question_id=v_question.id and is_correct;
   if v_selected=v_correct_ids then v_correct:=v_correct+1; end if;
   insert into public.crew_quiz_answers(attempt_id,question_id,selected_option_ids,correct) values(v_attempt_id,v_question.id,v_selected,v_selected=v_correct_ids);
 end loop;
 v_score:=round(v_correct::numeric*100/v_total); v_passed:=v_score>=v_quiz.passing_score;
 update public.crew_quiz_attempts set score=v_score,passed=v_passed,completed_at=now() where id=v_attempt_id;
 return jsonb_build_object('attempt_id',v_attempt_id,'attempt_number',v_attempt,'score',v_score,'passed',v_passed,'passing_score',v_quiz.passing_score);
end; $$;
revoke all on function public.crew_submit_quiz(text,uuid,uuid,jsonb) from public,anon,authenticated; grant execute on function public.crew_submit_quiz(text,uuid,uuid,jsonb) to anon,authenticated;

create or replace function public.assign_crew_journey(p_employee_id uuid,p_journey_id uuid,p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public as $$
declare v_journey public.crew_journeys%rowtype; v_employee public.employees%rowtype; v_id uuid;
begin
 if not public.current_user_has_permission('crew_learning.manage') then raise exception using errcode='42501',message='Missing permission to assign Crew learning.'; end if;
 select * into v_journey from public.crew_journeys where id=p_journey_id and status='published'; if not found then raise exception using errcode='22023',message='Journey must be published before assignment.'; end if;
 select * into v_employee from public.employees where id=p_employee_id; if not found then raise exception using errcode='P0002',message='Employee was not found.'; end if;
 if v_journey.outlet_id is not null and not public.current_user_can_access_outlet(v_journey.outlet_id) then raise exception using errcode='42501',message='You cannot assign learning for this outlet.'; end if;
 insert into public.crew_journey_assignments(employee_id,journey_id,journey_version_assigned,assigned_by,due_at,journey_snapshot) values(p_employee_id,p_journey_id,v_journey.version,auth.uid(),p_due_at,jsonb_build_object('journey',to_jsonb(v_journey),'modules',(select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order),'[]'::jsonb) from public.crew_journey_modules m where m.journey_id=v_journey.id))) returning id into v_id;
 return v_id;
end; $$;
revoke all on function public.assign_crew_journey(uuid,uuid,timestamptz) from public,anon,authenticated; grant execute on function public.assign_crew_journey(uuid,uuid,timestamptz) to authenticated;
