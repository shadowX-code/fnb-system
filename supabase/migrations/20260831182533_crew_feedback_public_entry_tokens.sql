-- Stable, opaque entry points for public Crew feedback. These tokens are
-- intentionally separate from mutable outlet names/codes and internal UUIDs.
alter table public.outlets
  add column if not exists public_feedback_token text;

update public.outlets
set public_feedback_token = encode(extensions.gen_random_bytes(18), 'hex')
where public_feedback_token is null;

alter table public.outlets
  alter column public_feedback_token set default encode(extensions.gen_random_bytes(18), 'hex'),
  alter column public_feedback_token set not null;

alter table public.outlets
  drop constraint if exists outlets_public_feedback_token_format_check;

alter table public.outlets
  add constraint outlets_public_feedback_token_format_check
  check (public_feedback_token ~ '^[a-f0-9]{36}$');

create unique index if not exists outlets_public_feedback_token_unique_idx
  on public.outlets (public_feedback_token);

-- Legacy UUID links remain supported. The token is returned solely so the
-- browser can replace the old hash URL with the canonical public URL.
create or replace function public.crew_feedback_public_crew(p_outlet_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'outlet', jsonb_build_object('id', o.id, 'name', o.name, 'public_feedback_token', o.public_feedback_token),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'position', x.position, 'on_shift', x.on_shift) order by x.on_shift desc, x.last_shift desc nulls last, x.full_name)
      from (
        select e.id, e.full_name, e.position,
          exists(select 1 from public.crew_attendance_records a where a.employee_id = e.id and a.outlet_id = o.id and a.status = 'open') on_shift,
          (select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id = e.id and a.outlet_id = o.id and a.clock_in_at > now() - interval '14 days') last_shift
        from public.employees e
        join public.crew_access ca on ca.employee_id = e.id
        where ca.primary_outlet_id = o.id
          and ca.access_state = 'active'
          and e.is_active
          and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
          and exists(select 1 from public.crew_attendance_records recent where recent.employee_id = e.id and recent.outlet_id = o.id and recent.clock_in_at > now() - interval '14 days')
        order by on_shift desc, last_shift desc nulls last
        limit 12
      ) x
    ), '[]'::jsonb)
  )
  from public.outlets o
  where o.id = p_outlet_id and o.is_active;
$$;
revoke all on function public.crew_feedback_public_crew(uuid) from public, anon, authenticated;
grant execute on function public.crew_feedback_public_crew(uuid) to anon, authenticated;

create or replace function public.crew_feedback_public_entry(p_outlet_token text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'outlet', jsonb_build_object('name', o.name, 'public_feedback_token', o.public_feedback_token),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'position', x.position, 'on_shift', x.on_shift) order by x.on_shift desc, x.last_shift desc nulls last, x.full_name)
      from (
        select e.id, e.full_name, e.position,
          exists(select 1 from public.crew_attendance_records a where a.employee_id = e.id and a.outlet_id = o.id and a.status = 'open') on_shift,
          (select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id = e.id and a.outlet_id = o.id and a.clock_in_at > now() - interval '14 days') last_shift
        from public.employees e
        join public.crew_access ca on ca.employee_id = e.id
        where ca.primary_outlet_id = o.id
          and ca.access_state = 'active'
          and e.is_active
          and coalesce(e.employment_status, 'active') not in ('resigned', 'terminated')
          and exists(select 1 from public.crew_attendance_records recent where recent.employee_id = e.id and recent.outlet_id = o.id and recent.clock_in_at > now() - interval '14 days')
        order by on_shift desc, last_shift desc nulls last
        limit 12
      ) x
    ), '[]'::jsonb)
  )
  from public.outlets o
  where o.public_feedback_token = lower(btrim(p_outlet_token)) and o.is_active;
$$;
revoke all on function public.crew_feedback_public_entry(text) from public, anon, authenticated;
grant execute on function public.crew_feedback_public_entry(text) to anon, authenticated;

create or replace function public.crew_feedback_submit_public(p_outlet_token text, p_employee_id uuid, p_experience text, p_positive_tags text[], p_improvement_tags text[], p_comment text, p_client_token text)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare v_outlet_id uuid;
begin
  select o.id into v_outlet_id
  from public.outlets o
  where o.public_feedback_token = lower(btrim(p_outlet_token)) and o.is_active;

  if v_outlet_id is null then
    raise exception using errcode = '22023', message = 'Feedback link is unavailable.';
  end if;

  return public.crew_feedback_submit(v_outlet_id, p_employee_id, p_experience, p_positive_tags, p_improvement_tags, p_comment, p_client_token);
end;
$$;
revoke all on function public.crew_feedback_submit_public(text, uuid, text, text[], text[], text, text) from public, anon, authenticated;
grant execute on function public.crew_feedback_submit_public(text, uuid, text, text[], text[], text, text) to anon, authenticated;
