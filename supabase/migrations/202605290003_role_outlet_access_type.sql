-- Make role outlet scope explicit so All Outlets roles can load every outlet.
-- Previously, roles with no role_outlets rows were treated as All Outlets by
-- the UI but as no outlet access by RLS.

alter table public.roles
  add column if not exists outlet_access_type text not null default 'selected';

alter table public.roles
  drop constraint if exists roles_outlet_access_type_check;

alter table public.roles
  add constraint roles_outlet_access_type_check
  check (outlet_access_type in ('all', 'selected'));

update public.roles r
set outlet_access_type = case
  when lower(r.name) in ('owner', 'admin') then 'all'
  when not exists (
    select 1
    from public.role_outlets ro
    where ro.role_id = r.id
  ) then 'all'
  else 'selected'
end
where r.outlet_access_type is null
   or r.outlet_access_type not in ('all', 'selected')
   or lower(r.name) in ('owner', 'admin')
   or (
     r.outlet_access_type = 'selected'
     and not exists (
       select 1
       from public.role_outlets ro
       where ro.role_id = r.id
     )
   );

create or replace function public.current_user_has_all_outlet_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roles r
    where r.id = public.current_user_role_id()
      and (
        lower(r.name) in ('owner', 'admin')
        or coalesce(r.outlet_access_type, 'selected') = 'all'
      )
  );
$$;

create or replace function public.current_user_can_access_outlet(target_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_outlet_id is not null
    and (
      public.current_user_has_all_outlet_access()
      or exists (
        select 1
        from public.role_outlets ro
        where ro.role_id = public.current_user_role_id()
          and ro.outlet_id = target_outlet_id
      )
    );
$$;

grant execute on function public.current_user_has_all_outlet_access() to authenticated;
grant execute on function public.current_user_can_access_outlet(uuid) to authenticated;
