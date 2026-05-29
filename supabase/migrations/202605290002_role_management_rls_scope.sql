-- Role Management RLS scope repair
-- Allows configurable role editors to manage non-protected roles while
-- blocking owner/admin roles, self-role edits, and inaccessible outlet grants.

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
        public.current_user_has_permission('roles.edit')
        and target_role_id <> public.current_user_role_id()
        and exists (
          select 1
          from public.roles r
          where r.id = target_role_id
            and lower(r.name) not in ('owner', 'admin')
            and coalesce(r.is_system_role, false) = false
        )
      )
    );
$$;

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
          and public.current_user_has_permission(p.code)
      )
    );
$$;

grant execute on function public.role_is_editable_by_current_user(uuid) to authenticated;
grant execute on function public.current_user_can_assign_permission(uuid) to authenticated;

grant select, insert, update, delete on table public.roles to authenticated;
grant select, insert, update, delete on table public.permissions to authenticated;
grant select, insert, update, delete on table public.role_permissions to authenticated;

drop policy if exists "role creators can create roles" on public.roles;
create policy "role creators can create roles"
on public.roles for insert to authenticated
with check (
  public.current_user_has_permission('roles.create')
  and (
    public.current_user_is_protected_role()
    or (
      lower(name) not in ('owner', 'admin')
      and coalesce(is_system_role, false) = false
    )
  )
);

drop policy if exists "role editors can update roles" on public.roles;
create policy "role editors can update roles"
on public.roles for update to authenticated
using (public.role_is_editable_by_current_user(id))
with check (
  public.current_user_is_protected_role()
  or (
    public.current_user_has_permission('roles.edit')
    and id <> public.current_user_role_id()
    and lower(name) not in ('owner', 'admin')
    and coalesce(is_system_role, false) = false
  )
);

drop policy if exists "role deleters can delete roles" on public.roles;
create policy "role deleters can delete roles"
on public.roles for delete to authenticated
using (
  public.current_user_is_protected_role()
  or (
    public.current_user_has_permission('roles.delete')
    and id <> public.current_user_role_id()
    and lower(name) not in ('owner', 'admin')
    and coalesce(is_system_role, false) = false
  )
);

drop policy if exists "role editors can manage role permissions" on public.role_permissions;
drop policy if exists "role editors can insert role permissions" on public.role_permissions;
drop policy if exists "role editors can update role permissions" on public.role_permissions;
drop policy if exists "role editors can delete role permissions" on public.role_permissions;

create policy "role editors can insert role permissions"
on public.role_permissions for insert to authenticated
with check (
  public.role_is_editable_by_current_user(role_id)
  and public.current_user_can_assign_permission(permission_id)
);

create policy "role editors can update role permissions"
on public.role_permissions for update to authenticated
using (public.role_is_editable_by_current_user(role_id))
with check (
  public.role_is_editable_by_current_user(role_id)
  and public.current_user_can_assign_permission(permission_id)
);

create policy "role editors can delete role permissions"
on public.role_permissions for delete to authenticated
using (public.role_is_editable_by_current_user(role_id));

do $$
begin
  if to_regclass('public.role_outlets') is not null then
    execute 'drop policy if exists "role editors can manage role outlets" on public.role_outlets';
    execute 'drop policy if exists "role editors can insert role outlets" on public.role_outlets';
    execute 'drop policy if exists "role editors can update role outlets" on public.role_outlets';
    execute 'drop policy if exists "role editors can delete role outlets" on public.role_outlets';

    execute 'create policy "role editors can insert role outlets"
      on public.role_outlets for insert to authenticated
      with check (
        public.role_is_editable_by_current_user(role_id)
        and public.current_user_can_access_outlet(outlet_id)
      )';

    execute 'create policy "role editors can update role outlets"
      on public.role_outlets for update to authenticated
      using (public.role_is_editable_by_current_user(role_id))
      with check (
        public.role_is_editable_by_current_user(role_id)
        and public.current_user_can_access_outlet(outlet_id)
      )';

    execute 'create policy "role editors can delete role outlets"
      on public.role_outlets for delete to authenticated
      using (public.role_is_editable_by_current_user(role_id))';
  end if;
end $$;
