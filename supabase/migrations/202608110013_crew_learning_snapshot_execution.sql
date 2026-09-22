-- Phase B execution authority. 013 is intentionally internal-first; no client grants here.
create or replace function public.crew_snapshot_lesson_available(p_assignment_id uuid,p_lesson_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare a public.crew_journey_assignments%rowtype; m jsonb; l jsonb; prior jsonb;
begin
 select * into a from public.crew_journey_assignments where id=p_assignment_id; if not found then return false; end if;
 select x into m from jsonb_array_elements(coalesce(a.journey_snapshot->'modules','[]'::jsonb)) x where (x->'module'->>'id')::uuid in(select module_id from public.crew_lessons where id=p_lesson_id); if m is null then return false; end if;
 select x into l from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where (x->'lesson'->>'id')::uuid=p_lesson_id; if l is null then return false; end if;
 if not coalesce((a.journey_snapshot->'journey'->>'sequential_modules')::boolean,false) then return true; end if;
 for prior in select x from jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) x where (x->'lesson'->>'sort_order')::int < (l->'lesson'->>'sort_order')::int and coalesce((x->'lesson'->>'required')::boolean,true) loop
  if not exists(select 1 from public.crew_lesson_progress p where p.assignment_id=a.id and p.lesson_id=(prior->'lesson'->>'id')::uuid and p.status='completed') then return false; end if;
 end loop;
 return true;
end; $$;
revoke all on function public.crew_snapshot_lesson_available(uuid,uuid) from public,anon,authenticated;
