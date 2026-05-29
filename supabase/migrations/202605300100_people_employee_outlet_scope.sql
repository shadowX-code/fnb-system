-- Stabilize People module outlet scope for employee records.
-- Employees currently store their work outlet in the text `workplace` field.
-- Until a dedicated employee outlet_id migration is introduced, RLS maps
-- workplace to outlets.name/code and applies the canonical role outlet scope.

drop policy if exists "employees can view own profile or employee viewers can view all" on public.employees;
drop policy if exists "employees can view own profile or permitted users can view employees" on public.employees;
drop policy if exists "employee viewers can view employees" on public.employees;
create policy "employees scoped select"
on public.employees for select to authenticated
using (
  auth_user_id = auth.uid()
  or id = auth.uid()
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or (
    public.current_user_has_permission('employees.view')
    and (
      public.current_user_has_all_outlet_access()
      or exists (
        select 1
        from public.outlets o
        where public.current_user_can_access_outlet(o.id)
          and (
            lower(o.name) = lower(coalesce(employees.workplace, ''))
            or lower(coalesce(o.code, '')) = lower(coalesce(employees.workplace, ''))
          )
      )
    )
  )
);

drop policy if exists "employee creators can insert employees" on public.employees;
create policy "employee creators can insert employees"
on public.employees for insert to authenticated
with check (
  public.current_user_has_permission('employees.create')
  and (
    public.current_user_has_all_outlet_access()
    or exists (
      select 1
      from public.outlets o
      where public.current_user_can_access_outlet(o.id)
        and (
          lower(o.name) = lower(coalesce(employees.workplace, ''))
          or lower(coalesce(o.code, '')) = lower(coalesce(employees.workplace, ''))
        )
    )
  )
);

drop policy if exists "employee editors can update employees" on public.employees;
create policy "employee editors can update employees"
on public.employees for update to authenticated
using (
  (
    public.current_user_has_permission('employees.edit')
    or public.current_user_has_permission('employees.enable_login')
    or public.current_user_has_permission('employees.deactivate')
    or public.current_user_has_permission('employees.reset_password')
  )
  and (
    public.current_user_has_all_outlet_access()
    or exists (
      select 1
      from public.outlets o
      where public.current_user_can_access_outlet(o.id)
        and (
          lower(o.name) = lower(coalesce(employees.workplace, ''))
          or lower(coalesce(o.code, '')) = lower(coalesce(employees.workplace, ''))
        )
    )
  )
)
with check (
  (
    public.current_user_has_permission('employees.edit')
    or public.current_user_has_permission('employees.enable_login')
    or public.current_user_has_permission('employees.deactivate')
    or public.current_user_has_permission('employees.reset_password')
  )
  and (
    public.current_user_has_all_outlet_access()
    or exists (
      select 1
      from public.outlets o
      where public.current_user_can_access_outlet(o.id)
        and (
          lower(o.name) = lower(coalesce(employees.workplace, ''))
          or lower(coalesce(o.code, '')) = lower(coalesce(employees.workplace, ''))
        )
    )
  )
);

drop policy if exists "outlet viewers can view outlets" on public.outlets;
create policy "outlet viewers can view outlets"
on public.outlets for select to authenticated
using (
  (
    public.current_user_has_permission('outlets.view')
    or public.current_user_has_permission('dashboard.view')
    or public.current_user_has_permission('sales_input.view')
    or public.current_user_has_permission('sales_comparison.view')
    or public.current_user_has_permission('purchase_input.view')
    or public.current_user_has_permission('purchase_comparison.view')
    or public.current_user_has_permission('data_import.view')
    or public.current_user_has_permission('data_health.view')
    or public.current_user_has_permission('alerts.view')
    or public.current_user_has_permission('outlet_pnl.view')
    or public.current_user_has_permission('operating_expenses.view')
    or public.current_user_has_permission('duty_roster.view')
    or public.current_user_has_permission('outlet_duty_roster.view')
    or public.current_user_has_permission('asset_tracking.view')
    or public.current_user_has_permission('employees.view')
    or public.current_user_has_permission('employees.create')
    or public.current_user_has_permission('employees.edit')
    or public.current_user_has_permission('inventory_dashboard.view')
    or public.current_user_has_permission('inventory_master.view')
    or public.current_user_has_permission('inventory_par_levels.view')
    or public.current_user_has_permission('inventory_groups.view')
    or public.current_user_has_permission('inventory_stock_check.view')
    or public.current_user_has_permission('inventory_orders.view')
    or public.current_user_has_permission('inventory_movements.view')
    or public.current_user_has_permission('inventory_waste.view')
    or public.current_user_has_permission('inventory_recipes.view')
  )
  and public.current_user_can_access_outlet(id)
);
