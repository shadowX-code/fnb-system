-- Employee identity wins even when disabled; legacy profiles never supplement it.
-- No persisted role, permission, membership or Brand assignment is changed.
create or replace function public.current_user_role_id() returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 with identity as (select auth.uid() uid,lower(coalesce(auth.jwt()->>'email','')) email),
 employee as (
  select e.* from public.employees e cross join identity i
  where i.uid is not null and (e.auth_user_id=i.uid or e.id=i.uid
   or (e.auth_user_id is null and i.email<>'' and lower(e.email)=i.email))
  order by (e.auth_user_id=i.uid) desc nulls last,(e.id=i.uid) desc,e.id limit 1
 )
 select e.role_id from employee e where e.enable_system_login and e.access_state='active' and coalesce(e.is_active,true)
 union all
 select p.role_id from public.user_profiles p cross join identity i
 where p.id=i.uid and not exists(select 1 from employee)
  and coalesce(p.is_active,true) and coalesce(p.access_state,'active')<>'disabled'
 limit 1;
$$;
create or replace function public.current_user_has_direct_permission(permission_code text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.roles r where r.id=public.current_user_role_id() and lower(r.name) in ('owner','admin'))
 or exists(select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
  where rp.role_id=public.current_user_role_id() and p.code=permission_code);
$$;
create or replace function public.current_user_has_permission(permission_code text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select public.current_user_has_direct_permission(permission_code)
 or case
  when permission_code in ('duty_roster.view','outlet_duty_roster.view') then public.current_user_has_direct_permission('crew_roster.view')
  when permission_code in ('duty_roster.create','duty_roster.edit','duty_roster.delete') then public.current_user_has_direct_permission('crew_roster.manage')
  when permission_code='duty_roster.manage' then public.current_user_has_direct_permission('crew_roster.publish')
  else false end;
$$;
revoke all on function public.current_user_role_id(),public.current_user_has_permission(text),public.current_user_has_direct_permission(text) from public,anon;
grant execute on function public.current_user_role_id(),public.current_user_has_permission(text),public.current_user_has_direct_permission(text) to authenticated;

-- Invoker trigger: ordinary writes cannot impersonate a trusted onboarding RPC.
create function public.platform_identity_access_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare changed boolean; target_role uuid; self_target boolean;
begin
 if current_user in ('postgres','service_role','supabase_admin') then return new;end if;
 if tg_table_name='user_profiles' then
  changed:=tg_op='INSERT';
  if tg_op='UPDATE' then
   changed:=(new.id,new.role_id,new.email,new.is_active,new.enable_system_login,new.access_state,new.access_disabled_at)
    is distinct from (old.id,old.role_id,old.email,old.is_active,old.enable_system_login,old.access_state,old.access_disabled_at);
   if new.id is distinct from old.id then raise exception using errcode='42501',message='Login identity cannot be reassigned.';end if;
  end if;
  self_target:=new.id=auth.uid();
 else
  if tg_op='INSERT' and new.auth_user_id is not null then raise exception using errcode='42501',message='Use the trusted login identity workflow.';end if;
  changed:=tg_op='INSERT' and (new.role_id is not null or new.auth_user_id is not null or new.enable_system_login);
  if tg_op='UPDATE' then
   changed:=(new.id,new.role_id,new.auth_user_id,new.email,new.is_active,new.enable_system_login,new.access_state,new.access_disabled_at)
    is distinct from (old.id,old.role_id,old.auth_user_id,old.email,old.is_active,old.enable_system_login,old.access_state,old.access_disabled_at);
   if new.id is distinct from old.id or new.auth_user_id is distinct from old.auth_user_id
    or (old.auth_user_id is not null and new.email is distinct from old.email) then
    raise exception using errcode='42501',message='Use the trusted login identity workflow.';
   end if;
  end if;
  self_target:=new.auth_user_id=auth.uid() or new.id=auth.uid()
   or (new.auth_user_id is null and lower(new.email)=lower(auth.jwt()->>'email'));
 end if;
 if not changed then return new;end if;
 if coalesce(self_target,false) then raise exception using errcode='42501',message='You cannot change your own role or login access.';end if;
 if not (public.current_user_has_permission('employees.edit') or public.current_user_has_permission('employees.enable_login')
  or (tg_op='INSERT' and public.current_user_has_permission('employees.create'))) then
  raise exception using errcode='42501',message='Employee access management permission is required.';
 end if;
 target_role:=new.role_id;
 if not public.current_user_is_protected_role() then
  if target_role is not null and (exists(select 1 from public.roles where id=target_role and lower(name) in ('owner','admin'))
   or exists(select 1 from public.role_permissions rp where rp.role_id=target_role and not public.current_user_can_assign_permission(rp.permission_id))
   or exists(select 1 from public.roles where id=target_role and outlet_access_type='all') and not public.current_user_has_all_outlet_access()
   or exists(select 1 from public.role_outlets where role_id=target_role and not public.current_user_can_access_outlet(outlet_id))) then
   raise exception using errcode='42501',message='You cannot assign access outside your authority.';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.roles where id=old.role_id and lower(name) in ('owner','admin')) then
   raise exception using errcode='42501',message='Protected account access requires an administrator.';
  end if;
 end if;
 return new;
end;$$;
revoke all on function public.platform_identity_access_guard() from public,anon,authenticated;
create trigger platform_profile_access_guard before insert or update on public.user_profiles
 for each row execute function public.platform_identity_access_guard();
create trigger platform_employee_access_guard before insert or update on public.employees
 for each row execute function public.platform_identity_access_guard();
-- RLS still controls rows. Remove unused destructive grants, retaining existing admin CRUD paths.
revoke all on public.user_profiles from anon;
revoke delete,truncate,references,trigger on public.user_profiles from authenticated;
