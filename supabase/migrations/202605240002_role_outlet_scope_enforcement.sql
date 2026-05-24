-- Enforce role outlet scope across outlet-owned modules.
-- Protected system roles (owner/admin) keep full outlet access automatically.

create or replace function public.current_user_role_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with current_identity as (
    select auth.uid() as user_id, lower(coalesce(auth.jwt() ->> 'email', '')) as email
  )
  select e.role_id
  from current_identity ci
  join public.employees e on (
    e.auth_user_id = ci.user_id
    or e.id = ci.user_id
    or (ci.email <> '' and lower(e.email) = ci.email)
  )
  where e.enable_system_login = true
    and e.access_state = 'active'
    and coalesce(e.is_active, true) = true
  limit 1;
$$;

create or replace function public.current_user_is_protected_role()
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
      and lower(r.name) in ('owner', 'admin')
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
      public.current_user_is_protected_role()
      or exists (
        select 1
        from public.role_outlets ro
        where ro.role_id = public.current_user_role_id()
          and ro.outlet_id = target_outlet_id
      )
    );
$$;

grant execute on function public.current_user_role_id() to authenticated;
grant execute on function public.current_user_is_protected_role() to authenticated;
grant execute on function public.current_user_can_access_outlet(uuid) to authenticated;

drop policy if exists "authenticated users can view role outlets" on public.role_outlets;
drop policy if exists "roles viewers can view role outlets" on public.role_outlets;
drop policy if exists "role users can view own role outlets" on public.role_outlets;
create policy "role users can view own role outlets"
on public.role_outlets for select to authenticated
using (
  public.current_user_is_protected_role()
  or public.current_user_has_permission('roles.view')
  or role_id = public.current_user_role_id()
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
  )
  and public.current_user_can_access_outlet(id)
);

drop policy if exists "authenticated users can view sales records" on public.sales_records;
drop policy if exists "sales editors can write sales records" on public.sales_records;
drop policy if exists "sales input and comparison viewers can view sales records" on public.sales_records;
drop policy if exists "sales input creators can insert sales records" on public.sales_records;
drop policy if exists "sales input editors can update sales records" on public.sales_records;
drop policy if exists "sales input deleters can delete sales records" on public.sales_records;
drop policy if exists "sales records can be selected by permitted users" on public.sales_records;
drop policy if exists "sales records can be inserted by permitted users" on public.sales_records;
drop policy if exists "sales records can be updated by permitted users" on public.sales_records;
drop policy if exists "sales records can be deleted by permitted users" on public.sales_records;
drop policy if exists "sales records scoped select" on public.sales_records;
create policy "sales records scoped select"
on public.sales_records for select to authenticated
using (
  (
    public.current_user_has_permission('sales_input.view')
    or public.current_user_has_permission('sales_comparison.view')
    or public.current_user_has_permission('dashboard.view')
    or public.current_user_has_permission('outlet_pnl.view')
    or public.current_user_has_permission('data_import.view')
    or public.current_user_has_permission('data_health.view')
    or public.current_user_has_permission('alerts.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records scoped insert" on public.sales_records;
create policy "sales records scoped insert"
on public.sales_records for insert to authenticated
with check (
  (
    public.current_user_has_permission('sales_input.create')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records scoped update" on public.sales_records;
create policy "sales records scoped update"
on public.sales_records for update to authenticated
using (
  (
    public.current_user_has_permission('sales_input.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('sales_input.edit')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records scoped delete" on public.sales_records;
create policy "sales records scoped delete"
on public.sales_records for delete to authenticated
using (
  (
    public.current_user_has_permission('sales_input.delete')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "authenticated users can view purchase records" on public.purchase_records;
drop policy if exists "purchase editors can write purchase records" on public.purchase_records;
drop policy if exists "purchase input and comparison viewers can view purchase records" on public.purchase_records;
drop policy if exists "purchase input creators can insert purchase records" on public.purchase_records;
drop policy if exists "purchase input editors can update purchase records" on public.purchase_records;
drop policy if exists "purchase input deleters can delete purchase records" on public.purchase_records;
drop policy if exists "purchase records can be selected by permitted users" on public.purchase_records;
drop policy if exists "purchase records can be inserted by permitted users" on public.purchase_records;
drop policy if exists "purchase records can be updated by permitted users" on public.purchase_records;
drop policy if exists "purchase records can be deleted by permitted users" on public.purchase_records;
drop policy if exists "purchase records scoped select" on public.purchase_records;
create policy "purchase records scoped select"
on public.purchase_records for select to authenticated
using (
  (
    public.current_user_has_permission('purchase_input.view')
    or public.current_user_has_permission('purchase_comparison.view')
    or public.current_user_has_permission('dashboard.view')
    or public.current_user_has_permission('outlet_pnl.view')
    or public.current_user_has_permission('data_import.view')
    or public.current_user_has_permission('data_health.view')
    or public.current_user_has_permission('alerts.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records scoped insert" on public.purchase_records;
create policy "purchase records scoped insert"
on public.purchase_records for insert to authenticated
with check (
  (
    public.current_user_has_permission('purchase_input.create')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records scoped update" on public.purchase_records;
create policy "purchase records scoped update"
on public.purchase_records for update to authenticated
using (
  (
    public.current_user_has_permission('purchase_input.edit')
    or public.current_user_has_permission('purchase_input.approve')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('purchase_input.edit')
    or public.current_user_has_permission('purchase_input.approve')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records scoped delete" on public.purchase_records;
create policy "purchase records scoped delete"
on public.purchase_records for delete to authenticated
using (
  (
    public.current_user_has_permission('purchase_input.delete')
    or public.current_user_has_permission('data_import.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "operating expenses can be selected by permitted users" on public.operating_expenses;
drop policy if exists "operating expenses can be inserted by permitted users" on public.operating_expenses;
drop policy if exists "operating expenses can be updated by permitted users" on public.operating_expenses;
drop policy if exists "operating expenses can be deleted by permitted users" on public.operating_expenses;
drop policy if exists "operating expenses scoped select" on public.operating_expenses;
create policy "operating expenses scoped select"
on public.operating_expenses for select to authenticated
using (
  (
    public.current_user_has_permission('operating_expenses.view')
    or public.current_user_has_permission('outlet_pnl.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "operating expenses scoped insert" on public.operating_expenses;
create policy "operating expenses scoped insert"
on public.operating_expenses for insert to authenticated
with check (public.current_user_has_permission('operating_expenses.create') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "operating expenses scoped update" on public.operating_expenses;
create policy "operating expenses scoped update"
on public.operating_expenses for update to authenticated
using (public.current_user_has_permission('operating_expenses.edit') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('operating_expenses.edit') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "operating expenses scoped delete" on public.operating_expenses;
create policy "operating expenses scoped delete"
on public.operating_expenses for delete to authenticated
using (public.current_user_has_permission('operating_expenses.delete') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "tax setting viewers can view tax settings" on public.outlet_tax_configs;
drop policy if exists "tax setting editors can insert tax settings" on public.outlet_tax_configs;
drop policy if exists "tax setting editors can update tax settings" on public.outlet_tax_configs;
drop policy if exists "tax setting editors can delete tax settings" on public.outlet_tax_configs;
drop policy if exists "tax settings scoped select" on public.outlet_tax_configs;
create policy "tax settings scoped select"
on public.outlet_tax_configs for select to authenticated
using (
  (
    public.current_user_has_permission('tax_settings.view')
    or public.current_user_has_permission('sales_input.view')
    or public.current_user_has_permission('dashboard.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "tax settings scoped insert" on public.outlet_tax_configs;
create policy "tax settings scoped insert"
on public.outlet_tax_configs for insert to authenticated
with check (public.current_user_has_permission('tax_settings.edit') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "tax settings scoped update" on public.outlet_tax_configs;
create policy "tax settings scoped update"
on public.outlet_tax_configs for update to authenticated
using (public.current_user_has_permission('tax_settings.edit') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('tax_settings.edit') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "duty roster viewers can view shift templates" on public.shift_templates;
drop policy if exists "duty roster managers can manage shift templates" on public.shift_templates;
drop policy if exists "shift templates scoped select" on public.shift_templates;
create policy "shift templates scoped select"
on public.shift_templates for select to authenticated
using (
  public.current_user_has_permission('duty_roster.view')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "shift templates scoped insert" on public.shift_templates;
create policy "shift templates scoped insert"
on public.shift_templates for insert to authenticated
with check (
  public.current_user_has_permission('duty_roster.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "shift templates scoped update" on public.shift_templates;
create policy "shift templates scoped update"
on public.shift_templates for update to authenticated
using (
  public.current_user_has_permission('duty_roster.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('duty_roster.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "shift templates scoped delete" on public.shift_templates;
create policy "shift templates scoped delete"
on public.shift_templates for delete to authenticated
using (
  public.current_user_has_permission('duty_roster.manage')
  and outlet_id is not null
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "duty roster viewers can view rosters" on public.duty_rosters;
drop policy if exists "duty roster creators can insert rosters" on public.duty_rosters;
drop policy if exists "duty roster editors can update rosters" on public.duty_rosters;
drop policy if exists "duty roster deleters can delete rosters" on public.duty_rosters;
drop policy if exists "duty rosters scoped select" on public.duty_rosters;
create policy "duty rosters scoped select"
on public.duty_rosters for select to authenticated
using (
  (
    public.current_user_has_permission('duty_roster.view')
    or public.current_user_has_permission('outlet_duty_roster.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "duty rosters scoped insert" on public.duty_rosters;
create policy "duty rosters scoped insert"
on public.duty_rosters for insert to authenticated
with check (public.current_user_has_permission('duty_roster.create') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "duty rosters scoped update" on public.duty_rosters;
create policy "duty rosters scoped update"
on public.duty_rosters for update to authenticated
using (
  (
    public.current_user_has_permission('duty_roster.edit')
    or public.current_user_has_permission('duty_roster.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('duty_roster.edit')
    or public.current_user_has_permission('duty_roster.manage')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "duty rosters scoped delete" on public.duty_rosters;
create policy "duty rosters scoped delete"
on public.duty_rosters for delete to authenticated
using (public.current_user_has_permission('duty_roster.delete') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "duty roster viewers can view periods" on public.roster_periods;
drop policy if exists "duty roster managers can create periods" on public.roster_periods;
drop policy if exists "duty roster managers can update periods" on public.roster_periods;
drop policy if exists "duty roster managers can delete periods" on public.roster_periods;
drop policy if exists "roster periods scoped select" on public.roster_periods;
create policy "roster periods scoped select"
on public.roster_periods for select to authenticated
using (
  (
    public.current_user_has_permission('duty_roster.view')
    or public.current_user_has_permission('outlet_duty_roster.view')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "roster periods scoped insert" on public.roster_periods;
create policy "roster periods scoped insert"
on public.roster_periods for insert to authenticated
with check (public.current_user_has_permission('duty_roster.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "roster periods scoped update" on public.roster_periods;
create policy "roster periods scoped update"
on public.roster_periods for update to authenticated
using (public.current_user_has_permission('duty_roster.manage') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('duty_roster.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking viewers can view assets" on public.asset_items;
drop policy if exists "asset tracking creators can create assets" on public.asset_items;
drop policy if exists "asset tracking editors can update assets" on public.asset_items;
drop policy if exists "asset tracking deleters can delete assets" on public.asset_items;
drop policy if exists "asset tracking scoped asset select" on public.asset_items;
create policy "asset tracking scoped asset select"
on public.asset_items for select to authenticated
using (public.current_user_has_permission('asset_tracking.view') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped asset insert" on public.asset_items;
create policy "asset tracking scoped asset insert"
on public.asset_items for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.create') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped asset update" on public.asset_items;
create policy "asset tracking scoped asset update"
on public.asset_items for update to authenticated
using (
  (
    public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
    or public.current_user_has_permission('asset_tracking.delete')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('asset_tracking.edit')
    or public.current_user_has_permission('asset_tracking.manage')
    or public.current_user_has_permission('asset_tracking.delete')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "asset tracking scoped asset delete" on public.asset_items;
create policy "asset tracking scoped asset delete"
on public.asset_items for delete to authenticated
using (public.current_user_has_permission('asset_tracking.delete') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking viewers can view movement logs" on public.asset_movement_logs;
drop policy if exists "asset tracking managers can create movement logs" on public.asset_movement_logs;
drop policy if exists "asset tracking scoped movement select" on public.asset_movement_logs;
create policy "asset tracking scoped movement select"
on public.asset_movement_logs for select to authenticated
using (public.current_user_has_permission('asset_tracking.view') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped movement insert" on public.asset_movement_logs;
create policy "asset tracking scoped movement insert"
on public.asset_movement_logs for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking viewers can view inspections" on public.asset_inspections;
drop policy if exists "asset tracking managers can create inspections" on public.asset_inspections;
drop policy if exists "asset tracking managers can update inspections" on public.asset_inspections;
drop policy if exists "asset tracking scoped inspection select" on public.asset_inspections;
create policy "asset tracking scoped inspection select"
on public.asset_inspections for select to authenticated
using (public.current_user_has_permission('asset_tracking.view') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped inspection insert" on public.asset_inspections;
create policy "asset tracking scoped inspection insert"
on public.asset_inspections for insert to authenticated
with check (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking scoped inspection update" on public.asset_inspections;
create policy "asset tracking scoped inspection update"
on public.asset_inspections for update to authenticated
using (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id))
with check (public.current_user_has_permission('asset_tracking.manage') and public.current_user_can_access_outlet(outlet_id));

drop policy if exists "asset tracking viewers can view inspection items" on public.asset_inspection_items;
drop policy if exists "asset tracking managers can create inspection items" on public.asset_inspection_items;
drop policy if exists "asset tracking scoped inspection item select" on public.asset_inspection_items;
create policy "asset tracking scoped inspection item select"
on public.asset_inspection_items for select to authenticated
using (
  public.current_user_has_permission('asset_tracking.view')
  and exists (
    select 1
    from public.asset_inspections ai
    where ai.id = inspection_id
      and public.current_user_can_access_outlet(ai.outlet_id)
  )
);

drop policy if exists "asset tracking scoped inspection item insert" on public.asset_inspection_items;
create policy "asset tracking scoped inspection item insert"
on public.asset_inspection_items for insert to authenticated
with check (
  public.current_user_has_permission('asset_tracking.manage')
  and exists (
    select 1
    from public.asset_items a
    where a.id = asset_id
      and public.current_user_can_access_outlet(a.outlet_id)
  )
);

drop policy if exists "data import viewers can view import batches" on public.import_batches;
drop policy if exists "data import users can create import batches" on public.import_batches;
drop policy if exists "data import users can update import batches" on public.import_batches;
drop policy if exists "import batches scoped select" on public.import_batches;
create policy "import batches scoped select"
on public.import_batches for select to authenticated
using (
  (
    public.current_user_has_permission('data_import.view')
    or public.current_user_has_permission('audit_logs.view')
  )
  and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
);

drop policy if exists "import batches scoped insert" on public.import_batches;
create policy "import batches scoped insert"
on public.import_batches for insert to authenticated
with check (public.current_user_has_permission('data_import.import') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id)));

drop policy if exists "import batches scoped update" on public.import_batches;
create policy "import batches scoped update"
on public.import_batches for update to authenticated
using (public.current_user_has_permission('data_import.import') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id)))
with check (public.current_user_has_permission('data_import.import') and (outlet_id is null or public.current_user_can_access_outlet(outlet_id)));

drop policy if exists "data import viewers can view import batch rows" on public.import_batch_rows;
drop policy if exists "data import users can create import batch rows" on public.import_batch_rows;
drop policy if exists "import batch rows scoped select" on public.import_batch_rows;
create policy "import batch rows scoped select"
on public.import_batch_rows for select to authenticated
using (
  (
    public.current_user_has_permission('data_import.view')
    or public.current_user_has_permission('audit_logs.view')
  )
  and exists (
    select 1
    from public.import_batches ib
    where ib.id = batch_id
      and (ib.outlet_id is null or public.current_user_can_access_outlet(ib.outlet_id))
  )
);

drop policy if exists "import batch rows scoped insert" on public.import_batch_rows;
create policy "import batch rows scoped insert"
on public.import_batch_rows for insert to authenticated
with check (
  public.current_user_has_permission('data_import.import')
  and exists (
    select 1
    from public.import_batches ib
    where ib.id = batch_id
      and (ib.outlet_id is null or public.current_user_can_access_outlet(ib.outlet_id))
  )
);
