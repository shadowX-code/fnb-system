-- Phase B final authority hardening. Snapshot is the Crew contract; no client score/status is trusted.
create or replace function public.crew_complete_lesson(p_token text,p_assignment_id uuid,p_lesson_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e uuid; a public.crew_journey_assignments%rowtype; mod jsonb; les jsonb; prev_required int; unmet jsonb:='[]'::jsonb;
begin
 e:=public.crew_session_employee(p_token); select * into a from public.crew_journey_assignments where id=p_assignment_id and employee_id=e for update; if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 select m into mod from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m where (m->'module'->>'id')::uuid in (select module_id from public.crew_lessons where id=p_lesson_id); if mod is null then raise exception using errcode='42501',message='Lesson is unavailable.'; end if;
 select l into les from jsonb_array_elements(coalesce(mod->'lessons','[]'::jsonb)) l where (l->'lesson'->>'id')::uuid=p_lesson_id; if les is null then raise exception using errcode='42501',message='Lesson is unavailable.'; end if;
 if coalesce((a.journey_snapshot->'journey'->>'sequential_modules')::boolean,false) then select count(*) into prev_required from public.crew_lesson_progress p where p.assignment_id=a.id and p.status='completed'; if prev_required=0 and (les->'lesson'->>'sort_order')::int>1 then raise exception using errcode='42501',message='Complete earlier learning before this lesson.'; end if; end if;
 if coalesce((les->'quiz'->>'required')::boolean,false) and not exists(select 1 from public.crew_quiz_attempts x where x.employee_id=e and x.quiz_id=(les->'quiz'->>'id')::uuid and x.passed) then unmet:=unmet||jsonb_build_array('quiz'); end if;
 if unmet<>'[]'::jsonb then return jsonb_build_object('completed',false,'unmet_requirements',unmet); end if;
 insert into public.crew_lesson_progress(assignment_id,lesson_id,status,first_started_at,last_activity_at,completed_at) values(a.id,p_lesson_id,'completed',now(),now(),now()) on conflict(assignment_id,lesson_id) do update set status='completed',last_activity_at=now(),completed_at=coalesce(crew_lesson_progress.completed_at,now());
 perform public.crew_refresh_assignment_progress(a.id);
 return jsonb_build_object('completed',true,'unmet_requirements','[]'::jsonb);
end; $$;
revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated; grant execute on function public.crew_complete_lesson(text,uuid,uuid) to anon,authenticated;
