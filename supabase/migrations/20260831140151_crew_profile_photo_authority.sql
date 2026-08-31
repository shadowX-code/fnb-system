-- Employee master data remains the canonical owner of the Crew profile photo.
-- Crew may only read or replace the photo for the employee resolved from its
-- opaque session token; Storage is private and accessed by the edge boundary.
alter table public.employees
  add column if not exists profile_photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crew-profile-photos',
  'crew-profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.crew_profile_photo_context(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_profile_photo_path text;
  v_expected_path text;
begin
  v_employee_id := public.crew_session_employee(p_token);

  select profile_photo_path
  into v_profile_photo_path
  from public.employees
  where id = v_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'Crew Access is not available for this employee.';
  end if;

  v_expected_path := v_employee_id::text || '/profile.webp';
  if v_profile_photo_path is not null and v_profile_photo_path <> v_expected_path then
    raise exception using errcode = '42501', message = 'Crew profile photo is unavailable.';
  end if;

  return jsonb_build_object(
    'employee_id', v_employee_id,
    'bucket', 'crew-profile-photos',
    'object_path', v_expected_path,
    'profile_photo_path', v_profile_photo_path
  );
end;
$$;

create or replace function public.crew_set_profile_photo(p_token text, p_profile_photo_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_expected_path text;
begin
  v_employee_id := public.crew_session_employee(p_token);
  v_expected_path := v_employee_id::text || '/profile.webp';

  if p_profile_photo_path is distinct from v_expected_path then
    raise exception using errcode = '42501', message = 'Crew may only update its own profile photo.';
  end if;

  update public.employees
  set profile_photo_path = v_expected_path,
      updated_at = now()
  where id = v_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'Crew Access is not available for this employee.';
  end if;

  insert into public.audit_logs (action, module, description, metadata)
  values (
    'crew_profile_photo_changed',
    'crew',
    'Crew profile photo changed.',
    jsonb_build_object('employee_id', v_employee_id)
  );

  return jsonb_build_object('profile_photo_path', v_expected_path);
end;
$$;

create or replace function public.crew_my_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
  v_employee public.employees%rowtype;
  v_outlet public.outlets%rowtype;
begin
  v_employee_id := public.crew_session_employee(p_token);
  select * into v_employee from public.employees where id = v_employee_id;
  if not found then
    raise exception using errcode = '42501', message = 'Crew Access is not available for this employee.';
  end if;

  select o.* into v_outlet
  from public.outlets o
  join public.crew_access a on a.primary_outlet_id = o.id
  where a.employee_id = v_employee_id;

  return jsonb_build_object(
    'full_name', v_employee.full_name,
    'nickname', v_employee.nickname,
    'birthday', v_employee.birthday,
    'joined_date', v_employee.joined_date,
    'contact', v_employee.contact,
    'position', v_employee.position,
    'outlet_name', v_outlet.name,
    'employment_type', v_employee.employment_type,
    'employment_status', v_employee.employment_status,
    'profile_photo_path', v_employee.profile_photo_path
  );
end;
$$;

revoke all on function public.crew_profile_photo_context(text) from public, anon, authenticated;
revoke all on function public.crew_set_profile_photo(text, text) from public, anon, authenticated;
revoke all on function public.crew_my_profile(text) from public, anon, authenticated;

grant execute on function public.crew_profile_photo_context(text) to anon, authenticated;
grant execute on function public.crew_set_profile_photo(text, text) to anon, authenticated;
grant execute on function public.crew_my_profile(text) to anon, authenticated;
