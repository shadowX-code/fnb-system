-- Phase B: immutable learning snapshots and Crew-safe read authorities.
create or replace function public.crew_assignment_snapshot(p_journey_id uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('journey',(select to_jsonb(j) - 'created_by' from public.crew_journeys j where j.id=p_journey_id),'modules',coalesce((select jsonb_agg(jsonb_build_object('module',to_jsonb(m),'lessons',coalesce((select jsonb_agg(jsonb_build_object('lesson',to_jsonb(l),'blocks',coalesce((select jsonb_agg(to_jsonb(b) order by b.sort_order) from public.crew_lesson_blocks b where b.lesson_id=l.id),'[]'::jsonb),'quiz',case when q.id is null then null else jsonb_build_object('id',q.id,'title',q.title,'passing_score',q.passing_score,'required',q.required) end) order by l.sort_order) from public.crew_lessons l left join public.crew_quizzes q on q.lesson_id=l.id and q.status='published' where l.module_id=m.id),'[]'::jsonb)) order by m.sort_order) from public.crew_journey_modules m where m.journey_id=p_journey_id),'[]'::jsonb));
$$;
revoke all on function public.crew_assignment_snapshot(uuid) from public,anon,authenticated;

create or replace function public.assign_crew_journey(p_employee_id uuid,p_journey_id uuid,p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public as $$
declare v_journey public.crew_journeys%rowtype; v_employee public.employees%rowtype; v_id uuid; v_snapshot jsonb;
begin
 if not public.current_user_has_permission('crew_learning.manage') then raise exception using errcode='42501',message='Missing permission to assign Crew learning.'; end if;
 select * into v_journey from public.crew_journeys where id=p_journey_id and status='published'; if not found then raise exception using errcode='22023',message='Journey must be published before assignment.'; end if;
 select * into v_employee from public.employees where id=p_employee_id; if not found then raise exception using errcode='P0002',message='Employee was not found.'; end if;
 if v_journey.outlet_id is not null and not public.current_user_can_access_outlet(v_journey.outlet_id) then raise exception using errcode='42501',message='You cannot assign learning for this outlet.'; end if;
 v_snapshot:=public.crew_assignment_snapshot(p_journey_id);
 insert into public.crew_journey_assignments(employee_id,journey_id,journey_version_assigned,assigned_by,due_at,journey_snapshot) values(p_employee_id,p_journey_id,v_journey.version,auth.uid(),p_due_at,v_snapshot) returning id into v_id;
 return v_id;
end; $$;
revoke all on function public.assign_crew_journey(uuid,uuid,timestamptz) from public,anon,authenticated; grant execute on function public.assign_crew_journey(uuid,uuid,timestamptz) to authenticated;

create or replace function public.crew_learning_assignment(p_token text,p_assignment_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_employee uuid; v_assignment public.crew_journey_assignments%rowtype; v_snapshot jsonb; v_progress jsonb;
begin
 v_employee:=public.crew_session_employee(p_token); select * into v_assignment from public.crew_journey_assignments where id=p_assignment_id and employee_id=v_employee; if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 v_snapshot:=v_assignment.journey_snapshot;
 select coalesce(jsonb_agg(jsonb_build_object('lesson_id',lesson_id,'status',status,'completed_at',completed_at)),'[]'::jsonb) into v_progress from public.crew_lesson_progress where assignment_id=v_assignment.id;
 return jsonb_build_object('id',v_assignment.id,'status',v_assignment.status,'started_at',v_assignment.started_at,'completed_at',v_assignment.completed_at,'snapshot',v_snapshot,'lesson_progress',v_progress);
end; $$;
revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated; grant execute on function public.crew_learning_assignment(text,uuid) to anon,authenticated;
