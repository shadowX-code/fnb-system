-- Forward runtime fix: avoid PL/pgSQL variable/column ambiguity in the controlled progress refresh authority.
create or replace function public.crew_refresh_assignment_progress(p_assignment_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; m jsonb; v_module_id uuid; total int; done int; required_modules int:=0; completed_modules int:=0;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id for update;
 if not found then raise exception using errcode='P0002',message='Assignment not found.'; end if;
 for m in select value from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) loop
  v_module_id:=(m->'module'->>'id')::uuid;
  select count(*) into total from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where coalesce((x->'lesson'->>'required')::boolean,true);
  select count(*) into done from public.crew_lesson_progress p where p.assignment_id=a.id and p.status='completed' and p.lesson_id in (select (x->'lesson'->>'id')::uuid from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where coalesce((x->'lesson'->>'required')::boolean,true));
  if coalesce((m->'module'->>'required')::boolean,true) then required_modules:=required_modules+1; end if;
  insert into public.crew_module_progress(assignment_id,module_id,status,first_started_at,last_activity_at,completed_at)
  values(a.id,v_module_id,case when total=0 or done=total then 'completed' when done>0 then 'in_progress' else 'not_started' end,case when done>0 then now() end,now(),case when total=0 or done=total then now() end)
  on conflict(assignment_id,module_id) do update set status=excluded.status,last_activity_at=now(),first_started_at=coalesce(crew_module_progress.first_started_at,excluded.first_started_at),completed_at=case when excluded.status='completed' then coalesce(crew_module_progress.completed_at,now()) else crew_module_progress.completed_at end;
  if coalesce((m->'module'->>'required')::boolean,true) and (total=0 or done=total) then completed_modules:=completed_modules+1; end if;
 end loop;
 update public.crew_journey_assignments set status=case when required_modules=0 or completed_modules=required_modules then 'completed' when exists(select 1 from public.crew_lesson_progress where assignment_id=a.id) then 'in_progress' else 'not_started' end,started_at=case when exists(select 1 from public.crew_lesson_progress where assignment_id=a.id) then coalesce(started_at,now()) else started_at end,completed_at=case when required_modules=0 or completed_modules=required_modules then coalesce(completed_at,now()) else completed_at end where id=a.id;
 return jsonb_build_object('required_modules',required_modules,'completed_modules',completed_modules);
end;
$$;
revoke all on function public.crew_refresh_assignment_progress(uuid) from public,anon,authenticated;
