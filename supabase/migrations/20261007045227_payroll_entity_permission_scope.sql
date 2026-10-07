-- Full Legal Entity Payroll authority follows explicit permissions and all-outlet
-- scope, not a role's display name. Partial-outlet aggregate reads stay denied.
create or replace function public.payroll_can_manage_entity(p_legal_entity_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.current_user_has_permission(p_permission)
    and public.current_user_has_all_outlet_access()
    and exists(select 1 from public.employees e
      where e.auth_user_id=auth.uid() and e.is_active and e.enable_system_login
        and e.access_state='active')
    and exists(select 1 from public.legal_entities le where le.id=p_legal_entity_id);
$$;

-- Private scope helper: clients enter through existing permission-checked RPCs.
revoke all on function public.payroll_can_manage_entity(uuid,text) from public,anon,authenticated;
