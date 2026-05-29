-- Finalize canonical Roles & Permissions action keys while keeping legacy
-- roles.* permission rows working during transition.

insert into public.permissions (code, module, description)
values
  ('roles_permissions.view', 'Roles & Permissions', 'View Roles & Permissions.'),
  ('roles_permissions.create', 'Roles & Permissions', 'Create Roles & Permissions.'),
  ('roles_permissions.edit', 'Roles & Permissions', 'Edit Roles & Permissions.'),
  ('roles_permissions.delete', 'Roles & Permissions', 'Delete Roles & Permissions.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select rp.role_id, canonical.id
from public.role_permissions rp
join public.permissions legacy on legacy.id = rp.permission_id
join public.permissions canonical on canonical.code = replace(legacy.code, 'roles.', 'roles_permissions.')
where legacy.code in ('roles.view', 'roles.create', 'roles.edit', 'roles.delete')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select rp.role_id, legacy.id
from public.role_permissions rp
join public.permissions canonical on canonical.id = rp.permission_id
join public.permissions legacy on legacy.code = replace(canonical.code, 'roles_permissions.', 'roles.')
where canonical.code in ('roles_permissions.view', 'roles_permissions.create', 'roles_permissions.edit', 'roles_permissions.delete')
on conflict do nothing;

create or replace function public.current_user_has_role_management_permission(action_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_has_permission('roles_permissions.' || action_name)
      or public.current_user_has_permission('roles.' || action_name);
$$;

grant execute on function public.current_user_has_role_management_permission(text) to authenticated;

create or replace function public.current_user_can_assign_permission(target_permission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_permission_id is not null
    and (
      public.current_user_is_protected_role()
      or exists (
        select 1
        from public.permissions p
        where p.id = target_permission_id
          and (
            public.current_user_has_permission(p.code)
            or (
              p.code like 'roles_permissions.%'
              and public.current_user_has_permission(replace(p.code, 'roles_permissions.', 'roles.'))
            )
            or (
              p.code like 'roles.%'
              and public.current_user_has_permission(replace(p.code, 'roles.', 'roles_permissions.'))
            )
          )
      )
    );
$$;

grant execute on function public.current_user_can_assign_permission(uuid) to authenticated;

create or replace function public.role_is_editable_by_current_user(target_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_role_id is not null
    and (
      public.current_user_is_protected_role()
      or (
        public.current_user_has_role_management_permission('edit')
        and target_role_id <> public.current_user_role_id()
        and exists (
          select 1
          from public.roles r
          where r.id = target_role_id
            and lower(r.name) not in ('owner', 'admin')
        )
      )
    );
$$;

drop policy if exists "role creators can create roles" on public.roles;
create policy "role creators can create roles"
on public.roles for insert to authenticated
with check (
  public.current_user_has_role_management_permission('create')
  and (
    public.current_user_is_protected_role()
    or lower(name) not in ('owner', 'admin')
  )
);

drop policy if exists "role editors can update roles" on public.roles;
create policy "role editors can update roles"
on public.roles for update to authenticated
using (public.role_is_editable_by_current_user(id))
with check (
  public.current_user_is_protected_role()
  or (
    public.current_user_has_role_management_permission('edit')
    and id <> public.current_user_role_id()
    and lower(name) not in ('owner', 'admin')
  )
);

drop policy if exists "role deleters can delete roles" on public.roles;
create policy "role deleters can delete roles"
on public.roles for delete to authenticated
using (
  public.current_user_is_protected_role()
  or (
    public.current_user_has_role_management_permission('delete')
    and id <> public.current_user_role_id()
    and lower(name) not in ('owner', 'admin')
  )
);
