-- Phase B backend closure: snapshot-derived progress and SOP-safe authorities.
create or replace function public.crew_refresh_assignment_progress(p_assignment_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; m jsonb; lesson jsonb; module_id uuid; total int; done int; required_modules int:=0; completed_modules int:=0;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id for update; if not found then raise exception using errcode='P0002',message='Assignment not found.'; end if;
 for m in select value from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) loop
  module_id:=(m->'module'->>'id')::uuid; select count(*) into total from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where coalesce((x->'lesson'->>'required')::boolean,true);
  select count(*) into done from public.crew_lesson_progress p where p.assignment_id=a.id and p.status='completed' and p.lesson_id in (select (x->'lesson'->>'id')::uuid from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where coalesce((x->'lesson'->>'required')::boolean,true));
  if coalesce((m->'module'->>'required')::boolean,true) then required_modules:=required_modules+1; end if;
  insert into public.crew_module_progress(assignment_id,module_id,status,first_started_at,last_activity_at,completed_at) values(a.id,module_id,case when total=0 or done=total then 'completed' when done>0 then 'in_progress' else 'not_started' end,case when done>0 then now() end,now(),case when total=0 or done=total then now() end) on conflict(assignment_id,module_id) do update set status=excluded.status,last_activity_at=now(),first_started_at=coalesce(crew_module_progress.first_started_at,excluded.first_started_at),completed_at=case when excluded.status='completed' then coalesce(crew_module_progress.completed_at,now()) else crew_module_progress.completed_at end;
  if coalesce((m->'module'->>'required')::boolean,true) and (total=0 or done=total) then completed_modules:=completed_modules+1; end if;
 end loop;
 update public.crew_journey_assignments set status=case when required_modules=0 or completed_modules=required_modules then 'completed' when exists(select 1 from public.crew_lesson_progress where assignment_id=a.id) then 'in_progress' else 'not_started' end, started_at=case when exists(select 1 from public.crew_lesson_progress where assignment_id=a.id) then coalesce(started_at,now()) else started_at end, completed_at=case when required_modules=0 or completed_modules=required_modules then coalesce(completed_at,now()) else completed_at end where id=a.id;
 return jsonb_build_object('required_modules',required_modules,'completed_modules',completed_modules);
end; $$;
revoke all on function public.crew_refresh_assignment_progress(uuid) from public,anon,authenticated;

create or replace function public.crew_acknowledge_sop(p_token text,p_sop_version_id uuid,p_source text default 'journey') returns jsonb language plpgsql security definer set search_path=public as $$
declare e uuid; visible boolean;
begin
 e:=public.crew_session_employee(p_token);
 select exists(select 1 from public.crew_journey_assignments a where a.employee_id=e and a.journey_snapshot::text like '%'||p_sop_version_id::text||'%') into visible;
 if not visible or not exists(select 1 from public.crew_sop_versions where id=p_sop_version_id and status='published') then raise exception using errcode='42501',message='SOP version is unavailable.'; end if;
 insert into public.crew_sop_acknowledgements(employee_id,sop_version_id,source) values(e,p_sop_version_id,p_source) on conflict(employee_id,sop_version_id) do nothing;
 return jsonb_build_object('sop_version_id',p_sop_version_id,'acknowledged',true);
end; $$;
revoke all on function public.crew_acknowledge_sop(text,uuid,text) from public,anon,authenticated; grant execute on function public.crew_acknowledge_sop(text,uuid,text) to anon,authenticated;

create or replace function public.crew_sop_version(p_token text,p_sop_version_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare e uuid;
begin
 e:=public.crew_session_employee(p_token);
 if not exists(select 1 from public.crew_journey_assignments a where a.employee_id=e and a.journey_snapshot::text like '%'||p_sop_version_id::text||'%') then raise exception using errcode='42501',message='SOP version is unavailable.'; end if;
 return (select jsonb_build_object('id',v.id,'version',v.version,'effective_date',v.effective_date,'change_summary',v.change_summary,'title',s.title,'category',s.category,'summary',s.summary,'sections',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'body',x.body,'sort_order',x.sort_order,'key_point',x.key_point) order by x.sort_order) from public.crew_sop_sections x where x.sop_version_id=v.id),'[]'::jsonb),'acknowledged',exists(select 1 from public.crew_sop_acknowledgements a where a.employee_id=e and a.sop_version_id=v.id)) from public.crew_sop_versions v join public.crew_sops s on s.id=v.sop_id where v.id=p_sop_version_id and v.status='published');
end; $$;
revoke all on function public.crew_sop_version(text,uuid) from public,anon,authenticated; grant execute on function public.crew_sop_version(text,uuid) to anon,authenticated;
