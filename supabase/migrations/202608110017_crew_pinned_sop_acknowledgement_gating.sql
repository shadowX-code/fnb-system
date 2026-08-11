-- Freeze published SOP references into each assignment and gate lesson completion on that exact version.
create or replace function public.crew_assignment_snapshot(p_journey_id uuid) returns jsonb
language sql security definer set search_path=public as $$
 select jsonb_build_object(
  'journey',(select to_jsonb(j) - ('created_by'::text) from public.crew_journeys j where j.id=p_journey_id),
  'modules',coalesce((
   select jsonb_agg(jsonb_build_object(
    'module',to_jsonb(m),
    'lessons',coalesce((
     select jsonb_agg(jsonb_build_object(
      'lesson',to_jsonb(l),
      'blocks',coalesce((
       select jsonb_agg(case when b.block_type='sop_reference' then
        jsonb_build_object('id',b.id,'block_type',b.block_type,'sort_order',b.sort_order,
         'payload',jsonb_build_object(
          'sop_id',sv.sop_id,'sop_version_id',sv.sop_version_id,'title',sv.title,
          'version',sv.version,'required_acknowledgement',sv.require_acknowledgement
         ))
        else to_jsonb(b) end order by b.sort_order)
       from public.crew_lesson_blocks b
       left join lateral (
        select s.id as sop_id,v.id as sop_version_id,s.title,v.version,v.require_acknowledgement
        from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id
        where s.id=(b.payload->>'sop_id')::uuid and s.status='published' and v.status='published'
        order by v.version desc limit 1
       ) sv on true
       where b.lesson_id=l.id
      ),'[]'::jsonb),
      'quiz',case when q.id is null then null else jsonb_build_object(
       'id',q.id,'title',q.title,'passing_score',q.passing_score,'required',q.required,
       'questions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',qq.id,'prompt',qq.prompt,'question_type',qq.question_type,'explanation',qq.explanation,'sort_order',qq.sort_order,
        'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'sort_order',o.sort_order,'is_correct',o.is_correct) order by o.sort_order) from public.crew_quiz_options o where o.question_id=qq.id),'[]'::jsonb)
       ) order by qq.sort_order) from public.crew_quiz_questions qq where qq.quiz_id=q.id),'[]'::jsonb)
      ) end
     ) order by l.sort_order)
     from public.crew_lessons l left join public.crew_quizzes q on q.lesson_id=l.id and q.status='published'
     where l.module_id=m.id
    ),'[]'::jsonb)
   ) order by m.sort_order)
   from public.crew_journey_modules m where m.journey_id=p_journey_id
  ),'[]'::jsonb)
 );
$$;
revoke all on function public.crew_assignment_snapshot(uuid) from public,anon,authenticated;

create or replace function public.assign_crew_journey(p_employee_id uuid,p_journey_id uuid,p_due_at timestamptz default null) returns uuid language plpgsql security definer set search_path=public as $$
declare v_journey public.crew_journeys%rowtype; v_employee public.employees%rowtype; v_id uuid; v_snapshot jsonb;
begin
 if not public.current_user_has_permission('crew_learning.manage') then raise exception using errcode='42501',message='Missing permission to assign Crew learning.'; end if;
 select * into v_journey from public.crew_journeys where id=p_journey_id and status='published'; if not found then raise exception using errcode='22023',message='Journey must be published before assignment.'; end if;
 select * into v_employee from public.employees where id=p_employee_id; if not found then raise exception using errcode='P0002',message='Employee was not found.'; end if;
 if v_journey.outlet_id is not null and not public.current_user_can_access_outlet(v_journey.outlet_id) then raise exception using errcode='42501',message='You cannot assign learning for this outlet.'; end if;
 if exists(
  select 1 from public.crew_lesson_blocks b join public.crew_lessons l on l.id=b.lesson_id join public.crew_journey_modules m on m.id=l.module_id
  where m.journey_id=p_journey_id and b.block_type='sop_reference' and not exists(
   select 1 from public.crew_sops s join public.crew_sop_versions v on v.sop_id=s.id
   where s.id=(b.payload->>'sop_id')::uuid and s.status='published' and v.status='published'
  )
 ) then raise exception using errcode='22023',message='Every SOP reference must resolve to a published SOP version before assignment.'; end if;
 v_snapshot:=public.crew_assignment_snapshot(p_journey_id);
 insert into public.crew_journey_assignments(employee_id,journey_id,journey_version_assigned,assigned_by,due_at,journey_snapshot)
 values(p_employee_id,p_journey_id,v_journey.version,auth.uid(),p_due_at,v_snapshot) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.assign_crew_journey(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.assign_crew_journey(uuid,uuid,timestamptz) to authenticated;

create or replace function public.crew_complete_lesson(p_token text,p_assignment_id uuid,p_lesson_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e uuid; a public.crew_journey_assignments%rowtype; mod jsonb; les jsonb; sop_ref jsonb; prev_required int; unmet jsonb:='[]'::jsonb;
begin
 e:=public.crew_session_employee(p_token);
 select * into a from public.crew_journey_assignments where id=p_assignment_id and employee_id=e for update;
 if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 select m into mod from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m where (m->'module'->>'id')::uuid in (select module_id from public.crew_lessons where id=p_lesson_id);
 if mod is null then raise exception using errcode='42501',message='Lesson is unavailable.'; end if;
 select l into les from jsonb_array_elements(coalesce(mod->'lessons','[]'::jsonb)) l where (l->'lesson'->>'id')::uuid=p_lesson_id;
 if les is null then raise exception using errcode='42501',message='Lesson is unavailable.'; end if;
 if coalesce((a.journey_snapshot->'journey'->>'sequential_modules')::boolean,false) then
  select count(*) into prev_required from public.crew_lesson_progress p where p.assignment_id=a.id and p.status='completed';
  if prev_required=0 and (les->'lesson'->>'sort_order')::int>1 then raise exception using errcode='42501',message='Complete earlier learning before this lesson.'; end if;
 end if;
 if coalesce((les->'quiz'->>'required')::boolean,false) and not exists(select 1 from public.crew_quiz_attempts x where x.employee_id=e and x.quiz_id=(les->'quiz'->>'id')::uuid and x.passed) then unmet:=unmet||jsonb_build_array('quiz'); end if;
 for sop_ref in select value from jsonb_array_elements(coalesce(les->'blocks','[]'::jsonb)) where value->>'block_type'='sop_reference' loop
  if coalesce((sop_ref->'payload'->>'required_acknowledgement')::boolean,false) and not exists(
   select 1 from public.crew_sop_acknowledgements ack
   where ack.employee_id=e and ack.sop_version_id=(sop_ref->'payload'->>'sop_version_id')::uuid
  ) then unmet:=unmet||jsonb_build_array(jsonb_build_object('type','sop_acknowledgement','sop_version_id',sop_ref->'payload'->'sop_version_id','title',sop_ref->'payload'->'title')); end if;
 end loop;
 if unmet<>'[]'::jsonb then return jsonb_build_object('completed',false,'unmet_requirements',unmet); end if;
 insert into public.crew_lesson_progress(assignment_id,lesson_id,status,first_started_at,last_activity_at,completed_at) values(a.id,p_lesson_id,'completed',now(),now(),now()) on conflict(assignment_id,lesson_id) do update set status='completed',last_activity_at=now(),completed_at=coalesce(crew_lesson_progress.completed_at,now());
 perform public.crew_refresh_assignment_progress(a.id);
 return jsonb_build_object('completed',true,'unmet_requirements','[]'::jsonb);
end;
$$;
revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_complete_lesson(text,uuid,uuid) to anon,authenticated;
