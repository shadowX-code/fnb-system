-- Assignment-snapshot availability authorities. Array ordinality, not live order or completion counts, is authoritative.
create or replace function public.crew_snapshot_module_completed(p_assignment_id uuid,p_module_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; mod jsonb;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id; if not found then return false; end if;
 select value into mod from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) where (value->'module'->>'id')::uuid=p_module_id;
 if mod is null then return false; end if;
 return not exists(select 1 from jsonb_array_elements(coalesce(mod->'lessons','[]'::jsonb)) l where coalesce((l->'lesson'->>'required')::boolean,true) and not exists(select 1 from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=(l->'lesson'->>'id')::uuid and p.status='completed'));
end; $$;
revoke all on function public.crew_snapshot_module_completed(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_snapshot_module_available(p_assignment_id uuid,p_module_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; target_pos bigint; prior record;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id; if not found then return false; end if;
 select ordinality into target_pos from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) with ordinality x(value,ordinality) where (value->'module'->>'id')::uuid=p_module_id;
 if target_pos is null then return false; end if;
 if not coalesce((a.journey_snapshot->'journey'->>'sequential_modules')::boolean,false) then return true; end if;
 if public.crew_snapshot_module_completed(p_assignment_id,p_module_id) then return true; end if;
 for prior in select value from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) with ordinality x(value,ordinality) where ordinality<target_pos and coalesce((value->'module'->>'required')::boolean,true) loop
  if not public.crew_snapshot_module_completed(p_assignment_id,(prior.value->'module'->>'id')::uuid) then return false; end if;
 end loop;
 return true;
end; $$;
revoke all on function public.crew_snapshot_module_available(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_snapshot_lesson_available(p_assignment_id uuid,p_lesson_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; mod jsonb; module_id uuid; target_pos bigint; prior record;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id; if not found then return false; end if;
 select m.value into mod from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m(value) cross join lateral jsonb_array_elements(coalesce(m.value->'lessons','[]'::jsonb)) l(value) where (l.value->'lesson'->>'id')::uuid=p_lesson_id limit 1;
 if mod is null then return false; end if; module_id:=(mod->'module'->>'id')::uuid;
 if exists(select 1 from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=p_lesson_id and p.status='completed') then return true; end if;
 if not public.crew_snapshot_module_available(p_assignment_id,module_id) then return false; end if;
 if not coalesce((a.journey_snapshot->'journey'->>'sequential_modules')::boolean,false) then return true; end if;
 select ordinality into target_pos from jsonb_array_elements(coalesce(mod->'lessons','[]'::jsonb)) with ordinality x(value,ordinality) where (value->'lesson'->>'id')::uuid=p_lesson_id;
 for prior in select value from jsonb_array_elements(coalesce(mod->'lessons','[]'::jsonb)) with ordinality x(value,ordinality) where ordinality<target_pos and coalesce((value->'lesson'->>'required')::boolean,true) loop
  if not exists(select 1 from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=(prior.value->'lesson'->>'id')::uuid and p.status='completed') then return false; end if;
 end loop;
 return true;
end; $$;
revoke all on function public.crew_snapshot_lesson_available(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_safe_snapshot_quiz(p_quiz jsonb) returns jsonb language sql security definer set search_path=public as $$
 select case when p_quiz is null or jsonb_typeof(p_quiz)='null' then null else jsonb_build_object('id',p_quiz->'id','title',p_quiz->'title','passing_score',p_quiz->'passing_score','required',p_quiz->'required','questions',coalesce((select jsonb_agg(jsonb_build_object('id',q->'id','prompt',q->'prompt','question_type',q->'question_type','sort_order',q->'sort_order','options',coalesce((select jsonb_agg(jsonb_build_object('id',o->'id','label',o->'label','sort_order',o->'sort_order') order by (o->>'sort_order')::int) from jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) o),'[]'::jsonb)) order by (q->>'sort_order')::int) from jsonb_array_elements(coalesce(p_quiz->'questions','[]'::jsonb)) q),'[]'::jsonb)) end;
$$;
revoke all on function public.crew_safe_snapshot_quiz(jsonb) from public,anon,authenticated;

create or replace function public.crew_complete_lesson(p_token text,p_assignment_id uuid,p_lesson_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e uuid; a public.crew_journey_assignments%rowtype; les jsonb; sop_ref jsonb; unmet jsonb:='[]'::jsonb;
begin
 e:=public.crew_session_employee(p_token); select * into a from public.crew_journey_assignments where id=p_assignment_id and employee_id=e for update; if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 select l.value into les from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) m(value) cross join lateral jsonb_array_elements(coalesce(m.value->'lessons','[]'::jsonb)) l(value) where (l.value->'lesson'->>'id')::uuid=p_lesson_id limit 1; if les is null then raise exception using errcode='42501',message='Lesson is unavailable.'; end if;
 if not public.crew_snapshot_lesson_available(a.id,p_lesson_id) then return jsonb_build_object('completed',false,'unmet_requirements',jsonb_build_array('sequential')); end if;
 if coalesce((les->'quiz'->>'required')::boolean,false) and not exists(select 1 from public.crew_quiz_attempts x where x.employee_id=e and x.quiz_id=(les->'quiz'->>'id')::uuid and x.passed) then unmet:=unmet||jsonb_build_array('quiz'); end if;
 for sop_ref in select value from jsonb_array_elements(coalesce(les->'blocks','[]'::jsonb)) where value->>'block_type'='sop_reference' loop if coalesce((sop_ref->'payload'->>'required_acknowledgement')::boolean,false) and not exists(select 1 from public.crew_sop_acknowledgements ack where ack.employee_id=e and ack.sop_version_id=(sop_ref->'payload'->>'sop_version_id')::uuid) then unmet:=unmet||jsonb_build_array(jsonb_build_object('type','sop_acknowledgement','sop_version_id',sop_ref->'payload'->'sop_version_id','title',sop_ref->'payload'->'title')); end if; end loop;
 if unmet<>'[]'::jsonb then return jsonb_build_object('completed',false,'unmet_requirements',unmet); end if;
 insert into public.crew_lesson_progress(assignment_id,lesson_id,status,first_started_at,last_activity_at,completed_at) values(a.id,p_lesson_id,'completed',now(),now(),now()) on conflict(assignment_id,lesson_id) do update set status='completed',last_activity_at=now(),completed_at=coalesce(crew_lesson_progress.completed_at,now()); perform public.crew_refresh_assignment_progress(a.id); return jsonb_build_object('completed',true,'unmet_requirements','[]'::jsonb);
end; $$;
revoke all on function public.crew_complete_lesson(text,uuid,uuid) from public,anon,authenticated; grant execute on function public.crew_complete_lesson(text,uuid,uuid) to anon,authenticated;

create or replace function public.crew_learning_assignment(p_token text,p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
 e uuid; a public.crew_journey_assignments%rowtype; m record; l record;
 safe_modules jsonb:='[]'::jsonb; safe_lessons jsonb; safe_blocks jsonb;
 required_total int; required_completed int; module_done boolean; module_available boolean;
 lesson_done boolean; lesson_available boolean; lesson_status text;
begin
 e:=public.crew_session_employee(p_token);
 select * into a from public.crew_journey_assignments where id=p_assignment_id and employee_id=e;
 if not found then raise exception using errcode='42501',message='Learning assignment is unavailable.'; end if;
 for m in select value,ordinality from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) with ordinality x(value,ordinality) order by ordinality loop
  safe_lessons:='[]'::jsonb; required_total:=0; required_completed:=0;
  for l in select value,ordinality from jsonb_array_elements(coalesce(m.value->'lessons','[]'::jsonb)) with ordinality x(value,ordinality) order by ordinality loop
   lesson_done:=exists(select 1 from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=(l.value->'lesson'->>'id')::uuid and p.status='completed');
   lesson_available:=public.crew_snapshot_lesson_available(a.id,(l.value->'lesson'->>'id')::uuid);
   select coalesce(p.status,'not_started') into lesson_status from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=(l.value->'lesson'->>'id')::uuid;
   lesson_status:=coalesce(lesson_status,'not_started');
   if coalesce((l.value->'lesson'->>'required')::boolean,true) then required_total:=required_total+1; if lesson_done then required_completed:=required_completed+1; end if; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',b->'id','block_type',b->'block_type','payload',b->'payload','sort_order',b->'sort_order') order by (b->>'sort_order')::int),'[]'::jsonb) into safe_blocks from jsonb_array_elements(coalesce(l.value->'blocks','[]'::jsonb)) b;
   safe_lessons:=safe_lessons||jsonb_build_array(jsonb_build_object('lesson',l.value->'lesson','status',lesson_status,'required',coalesce((l.value->'lesson'->>'required')::boolean,true),'available',lesson_available,'locked',not lesson_available,'completed',lesson_done,'blocks',safe_blocks,'quiz',public.crew_safe_snapshot_quiz(l.value->'quiz')));
  end loop;
  module_done:=public.crew_snapshot_module_completed(a.id,(m.value->'module'->>'id')::uuid);
  module_available:=public.crew_snapshot_module_available(a.id,(m.value->'module'->>'id')::uuid);
  safe_modules:=safe_modules||jsonb_build_array(jsonb_build_object('module',(m.value->'module')-('created_by'::text),'status',case when module_done then 'completed' when required_completed>0 then 'in_progress' else 'not_started' end,'required',coalesce((m.value->'module'->>'required')::boolean,true),'progress_percentage',case when required_total=0 then 100 else round(100.0*required_completed/required_total) end,'available',module_available,'locked',not module_available,'completed',module_done,'lessons',safe_lessons));
 end loop;
 return jsonb_build_object('id',a.id,'status',a.status,'started_at',a.started_at,'completed_at',a.completed_at,'journey',(a.journey_snapshot->'journey')-('created_by'::text),'modules',safe_modules);
end;
$$;
revoke all on function public.crew_learning_assignment(text,uuid) from public,anon,authenticated; grant execute on function public.crew_learning_assignment(text,uuid) to anon,authenticated;
