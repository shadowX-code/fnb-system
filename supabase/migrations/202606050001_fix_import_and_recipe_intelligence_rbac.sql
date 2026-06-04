-- Fix module-level import RBAC and Recipe Intelligence permission coverage.

insert into public.permissions (code, module, description)
values
  ('sales_input.import', 'Sales Input', 'Import Sales Input.'),
  ('purchase_input.import', 'Purchase Input', 'Import Purchase Input.'),
  ('recipe_intelligence.view', 'Recipe Intelligence', 'View Recipe Intelligence.'),
  ('recipe_intelligence.manage', 'Recipe Intelligence', 'Manage Recipe Intelligence.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code in (
    'sales_input.import',
    'purchase_input.import',
    'recipe_intelligence.view',
    'recipe_intelligence.manage'
  )
on conflict do nothing;

drop policy if exists "sales records can be inserted by permitted users" on public.sales_records;
drop policy if exists "sales records can be updated by permitted users" on public.sales_records;
drop policy if exists "sales records can be deleted by permitted users" on public.sales_records;
drop policy if exists "sales records scoped insert" on public.sales_records;
create policy "sales records scoped insert" on public.sales_records for insert to authenticated
with check (
  (
    public.current_user_has_permission('sales_input.create')
    or public.current_user_has_permission('sales_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records scoped update" on public.sales_records;
create policy "sales records scoped update" on public.sales_records for update to authenticated
using (
  (
    public.current_user_has_permission('sales_input.edit')
    or public.current_user_has_permission('sales_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('sales_input.edit')
    or public.current_user_has_permission('sales_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records scoped delete" on public.sales_records;
create policy "sales records scoped delete" on public.sales_records for delete to authenticated
using (
  public.current_user_has_permission('sales_input.delete')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records can be inserted by permitted users" on public.purchase_records;
drop policy if exists "purchase records can be updated by permitted users" on public.purchase_records;
drop policy if exists "purchase records can be deleted by permitted users" on public.purchase_records;
drop policy if exists "purchase records scoped insert" on public.purchase_records;
create policy "purchase records scoped insert" on public.purchase_records for insert to authenticated
with check (
  (
    public.current_user_has_permission('purchase_input.create')
    or public.current_user_has_permission('purchase_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records scoped update" on public.purchase_records;
create policy "purchase records scoped update" on public.purchase_records for update to authenticated
using (
  (
    public.current_user_has_permission('purchase_input.edit')
    or public.current_user_has_permission('purchase_input.approve')
    or public.current_user_has_permission('purchase_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  (
    public.current_user_has_permission('purchase_input.edit')
    or public.current_user_has_permission('purchase_input.approve')
    or public.current_user_has_permission('purchase_input.import')
  )
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records scoped delete" on public.purchase_records;
create policy "purchase records scoped delete" on public.purchase_records for delete to authenticated
using (
  public.current_user_has_permission('purchase_input.delete')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records import select" on public.sales_records;
create policy "sales records import select" on public.sales_records for select to authenticated
using (
  public.current_user_has_permission('sales_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records import insert" on public.sales_records;
create policy "sales records import insert" on public.sales_records for insert to authenticated
with check (
  public.current_user_has_permission('sales_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "sales records import update" on public.sales_records;
create policy "sales records import update" on public.sales_records for update to authenticated
using (
  public.current_user_has_permission('sales_input.import')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('sales_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records import select" on public.purchase_records;
create policy "purchase records import select" on public.purchase_records for select to authenticated
using (
  public.current_user_has_permission('purchase_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records import insert" on public.purchase_records;
create policy "purchase records import insert" on public.purchase_records for insert to authenticated
with check (
  public.current_user_has_permission('purchase_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "purchase records import update" on public.purchase_records;
create policy "purchase records import update" on public.purchase_records for update to authenticated
using (
  public.current_user_has_permission('purchase_input.import')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('purchase_input.import')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "data import users can create import batches" on public.import_batches;
drop policy if exists "data import users can update import batches" on public.import_batches;
drop policy if exists "import batches scoped insert" on public.import_batches;
drop policy if exists "import batches scoped update" on public.import_batches;
drop policy if exists "data import users can create import batch rows" on public.import_batch_rows;
drop policy if exists "import batch rows scoped insert" on public.import_batch_rows;

drop policy if exists "import batches module import select" on public.import_batches;
create policy "import batches module import select" on public.import_batches for select to authenticated
using (
  (
    (lower(coalesce(import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and (public.current_user_has_permission('sales_input.view') or public.current_user_has_permission('sales_input.import')))
    or (lower(coalesce(import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and (public.current_user_has_permission('purchase_input.view') or public.current_user_has_permission('purchase_input.import')))
  )
  and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
);

drop policy if exists "import batches module import insert" on public.import_batches;
create policy "import batches module import insert" on public.import_batches for insert to authenticated
with check (
  (
    (lower(coalesce(import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and public.current_user_has_permission('sales_input.import'))
    or (lower(coalesce(import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and public.current_user_has_permission('purchase_input.import'))
  )
  and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
);

drop policy if exists "import batches module import update" on public.import_batches;
create policy "import batches module import update" on public.import_batches for update to authenticated
using (
  (
    (lower(coalesce(import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and public.current_user_has_permission('sales_input.import'))
    or (lower(coalesce(import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and public.current_user_has_permission('purchase_input.import'))
  )
  and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
)
with check (
  (
    (lower(coalesce(import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and public.current_user_has_permission('sales_input.import'))
    or (lower(coalesce(import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and public.current_user_has_permission('purchase_input.import'))
  )
  and (outlet_id is null or public.current_user_can_access_outlet(outlet_id))
);

drop policy if exists "import batch rows module import select" on public.import_batch_rows;
create policy "import batch rows module import select" on public.import_batch_rows for select to authenticated
using (
  exists (
    select 1
    from public.import_batches ib
    where ib.id = batch_id
      and (
        (lower(coalesce(ib.import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and (public.current_user_has_permission('sales_input.view') or public.current_user_has_permission('sales_input.import')))
        or (lower(coalesce(ib.import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and (public.current_user_has_permission('purchase_input.view') or public.current_user_has_permission('purchase_input.import')))
      )
      and (ib.outlet_id is null or public.current_user_can_access_outlet(ib.outlet_id))
  )
);

drop policy if exists "import batch rows module import insert" on public.import_batch_rows;
create policy "import batch rows module import insert" on public.import_batch_rows for insert to authenticated
with check (
  exists (
    select 1
    from public.import_batches ib
    where ib.id = batch_id
      and (
        (lower(coalesce(ib.import_type, '')) in ('sales', 'sale', 'sales input', 'sales_input') and public.current_user_has_permission('sales_input.import'))
        or (lower(coalesce(ib.import_type, '')) in ('purchases', 'purchase', 'purchase input', 'purchase_input') and public.current_user_has_permission('purchase_input.import'))
      )
      and (ib.outlet_id is null or public.current_user_can_access_outlet(ib.outlet_id))
  )
);

drop policy if exists "inventory recipes recipe intelligence select" on public.inventory_recipes;
create policy "inventory recipes recipe intelligence select" on public.inventory_recipes for select to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.view')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "inventory recipe items recipe intelligence select" on public.inventory_recipe_items;
create policy "inventory recipe items recipe intelligence select" on public.inventory_recipe_items for select to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.view')
  and exists (
    select 1
    from public.inventory_recipes recipe
    where recipe.id = recipe_id
      and public.current_user_can_access_outlet(recipe.outlet_id)
  )
);

drop policy if exists "product recipe mappings recipe intelligence select" on public.product_recipe_mappings;
create policy "product recipe mappings recipe intelligence select" on public.product_recipe_mappings for select to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.view')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings recipe intelligence insert" on public.product_recipe_mappings;
create policy "product recipe mappings recipe intelligence insert" on public.product_recipe_mappings for insert to authenticated
with check (
  public.current_user_has_permission('recipe_intelligence.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings recipe intelligence update" on public.product_recipe_mappings;
create policy "product recipe mappings recipe intelligence update" on public.product_recipe_mappings for update to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.manage')
  and public.current_user_can_access_outlet(outlet_id)
)
with check (
  public.current_user_has_permission('recipe_intelligence.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product recipe mappings recipe intelligence delete" on public.product_recipe_mappings;
create policy "product recipe mappings recipe intelligence delete" on public.product_recipe_mappings for delete to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.manage')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics recipe intelligence reports select" on public.product_sales_reports;
create policy "product analytics recipe intelligence reports select" on public.product_sales_reports for select to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.view')
  and public.current_user_can_access_outlet(outlet_id)
);

drop policy if exists "product analytics recipe intelligence items select" on public.product_sales_items;
create policy "product analytics recipe intelligence items select" on public.product_sales_items for select to authenticated
using (
  public.current_user_has_permission('recipe_intelligence.view')
  and public.current_user_can_access_outlet(outlet_id)
);
