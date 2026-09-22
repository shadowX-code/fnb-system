alter table public.outlets add column if not exists brand_accent_color text;
alter table public.outlets drop constraint if exists outlets_brand_accent_color_check;
alter table public.outlets add constraint outlets_brand_accent_color_check check (brand_accent_color is null or brand_accent_color ~ '^#[0-9A-Fa-f]{6}$');

create or replace function public.crew_feedback_public_entry(p_outlet_token text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('outlet',jsonb_strip_nulls(jsonb_build_object('name',o.name,'public_feedback_token',o.public_feedback_token,'logo_path',media.object_path,'logo_version',extract(epoch from media.updated_at)::bigint,'brand_accent_color',o.brand_accent_color)),'crew',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.full_name,'position',x.position,'on_shift',x.on_shift) order by x.on_shift desc,x.last_shift desc nulls last,x.full_name) from (select e.id,e.full_name,e.position,exists(select 1 from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.status='open') on_shift,(select max(a.clock_in_at) from public.crew_attendance_records a where a.employee_id=e.id and a.outlet_id=o.id and a.clock_in_at>now()-interval '14 days') last_shift from public.employees e join public.crew_access ca on ca.employee_id=e.id where ca.primary_outlet_id=o.id and ca.access_state='active' and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and exists(select 1 from public.crew_attendance_records recent where recent.employee_id=e.id and recent.outlet_id=o.id and recent.clock_in_at>now()-interval '14 days') order by on_shift desc,last_shift desc nulls last limit 12)x),'[]'::jsonb)) from public.outlets o left join public.outlet_logo_media media on media.id=o.logo_media_id and media.status='ready' where o.public_feedback_token=lower(btrim(p_outlet_token)) and o.is_active;
$$;

create or replace function public.crew_feedback_public_crew(p_outlet_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_set(public.crew_feedback_public_entry(outlet.public_feedback_token), '{outlet,id}', to_jsonb(outlet.id::text), true) from public.outlets outlet where outlet.id=p_outlet_id and outlet.is_active;
$$;
revoke all on function public.crew_feedback_public_entry(text), public.crew_feedback_public_crew(uuid) from public, anon, authenticated;
grant execute on function public.crew_feedback_public_entry(text), public.crew_feedback_public_crew(uuid) to anon, authenticated;
