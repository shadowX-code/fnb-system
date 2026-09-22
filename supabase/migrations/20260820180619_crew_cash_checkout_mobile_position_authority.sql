-- Mobile Crew employees are authenticated through crew_access rather than an
-- internal Admin role_id. Cash Checkout remains token- and outlet-bound; the
-- outlet's required_positions setting is the final execution authority.
create or replace function public.crew_cash_employee_has_permission(p_employee_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.employees e
  join public.role_permissions rp on rp.role_id=e.role_id
  join public.permissions p on p.id=rp.permission_id
  where e.id=p_employee_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
    and p.code=p_permission
 ) or (
  p_permission='crew_cash_checkout.perform'
  and exists(
   select 1 from public.employees e
   join public.crew_access ca on ca.employee_id=e.id
   where e.id=p_employee_id and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
     and ca.access_state='active' and ca.primary_outlet_id is not null
  )
 );
$$;

revoke all on function public.crew_cash_employee_has_permission(uuid,text) from public,anon,authenticated;
