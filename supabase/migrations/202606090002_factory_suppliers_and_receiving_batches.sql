-- Factory Suppliers and multi-row raw material receiving batches.
-- Preserves factory_raw_material_receivings as item rows for inventory, costing, lots and traceability.

create table if not exists public.factory_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  supplier_code text,
  contact_person text,
  phone text,
  email text,
  status text not null default 'active',
  remarks text,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists factory_suppliers_lower_name_key
on public.factory_suppliers (lower(supplier_name));

create unique index if not exists factory_suppliers_lower_code_key
on public.factory_suppliers (lower(supplier_code))
where supplier_code is not null and supplier_code <> '';

create table if not exists public.factory_raw_material_receiving_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text unique not null,
  reference_no text,
  supplier_id uuid references public.factory_suppliers(id) on delete set null,
  supplier_name text,
  received_date date not null default current_date,
  remarks text,
  status text not null default 'active',
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.factory_raw_material_receivings
  add column if not exists batch_id uuid references public.factory_raw_material_receiving_batches(id) on delete set null,
  add column if not exists supplier_id uuid references public.factory_suppliers(id) on delete set null;

insert into public.factory_suppliers (supplier_name, status, created_at, updated_at)
select distinct trim(supplier_name), 'active', now(), now()
from public.factory_raw_material_receivings
where nullif(trim(coalesce(supplier_name, '')), '') is not null
on conflict ((lower(supplier_name))) do nothing;

update public.factory_raw_material_receivings receiving
set supplier_id = supplier.id,
    updated_at = now()
from public.factory_suppliers supplier
where receiving.supplier_id is null
  and lower(trim(receiving.supplier_name)) = lower(supplier.supplier_name);

insert into public.factory_raw_material_receiving_batches (
  batch_no,
  reference_no,
  supplier_id,
  supplier_name,
  received_date,
  remarks,
  status,
  created_by,
  created_at,
  updated_at
)
select
  receiving.receipt_no,
  receiving.invoice_no,
  receiving.supplier_id,
  receiving.supplier_name,
  receiving.received_date,
  receiving.remarks,
  'active',
  receiving.received_by,
  receiving.created_at,
  receiving.updated_at
from public.factory_raw_material_receivings receiving
where receiving.batch_id is null
on conflict (batch_no) do nothing;

update public.factory_raw_material_receivings receiving
set batch_id = batch.id,
    updated_at = now()
from public.factory_raw_material_receiving_batches batch
where receiving.batch_id is null
  and batch.batch_no = receiving.receipt_no;

create index if not exists factory_raw_material_receivings_batch_id_idx
on public.factory_raw_material_receivings(batch_id);

create index if not exists factory_raw_material_receivings_supplier_id_idx
on public.factory_raw_material_receivings(supplier_id);

create index if not exists factory_raw_material_receiving_batches_received_date_idx
on public.factory_raw_material_receiving_batches(received_date);

insert into public.permissions (code, module, description)
values
  ('factory_suppliers.view', 'Factory Suppliers', 'View Factory supplier master data.'),
  ('factory_suppliers.create', 'Factory Suppliers', 'Create Factory supplier master data.'),
  ('factory_suppliers.edit', 'Factory Suppliers', 'Edit Factory supplier master data.'),
  ('factory_suppliers.delete', 'Factory Suppliers', 'Archive Factory supplier master data.'),
  ('factory_suppliers.manage', 'Factory Suppliers', 'Manage Factory supplier master data.'),
  ('factory_suppliers.export', 'Factory Suppliers', 'Export Factory supplier master data.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

grant select, insert, update, delete on public.factory_suppliers to authenticated;
grant select, insert, update, delete on public.factory_raw_material_receiving_batches to authenticated;

alter table public.factory_suppliers enable row level security;
alter table public.factory_raw_material_receiving_batches enable row level security;

drop policy if exists "factory suppliers view" on public.factory_suppliers;
create policy "factory suppliers view" on public.factory_suppliers for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_receiving.create')
  or public.current_user_has_permission('factory_suppliers.view')
  or public.current_user_has_permission('factory_suppliers.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

drop policy if exists "factory suppliers insert" on public.factory_suppliers;
create policy "factory suppliers insert" on public.factory_suppliers for insert to authenticated
with check (
  public.current_user_has_permission('factory_suppliers.create')
  or public.current_user_has_permission('factory_suppliers.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

drop policy if exists "factory suppliers update" on public.factory_suppliers;
create policy "factory suppliers update" on public.factory_suppliers for update to authenticated
using (
  public.current_user_has_permission('factory_suppliers.edit')
  or public.current_user_has_permission('factory_suppliers.delete')
  or public.current_user_has_permission('factory_suppliers.manage')
  or public.current_user_has_permission('factory_settings.manage')
)
with check (
  public.current_user_has_permission('factory_suppliers.edit')
  or public.current_user_has_permission('factory_suppliers.delete')
  or public.current_user_has_permission('factory_suppliers.manage')
  or public.current_user_has_permission('factory_settings.manage')
);

drop policy if exists "factory receiving batches view" on public.factory_raw_material_receiving_batches;
create policy "factory receiving batches view" on public.factory_raw_material_receiving_batches for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

drop policy if exists "factory receiving batches insert" on public.factory_raw_material_receiving_batches;
create policy "factory receiving batches insert" on public.factory_raw_material_receiving_batches for insert to authenticated
with check (public.current_user_has_permission('factory_raw_receiving.create'));

drop policy if exists "factory receiving batches update" on public.factory_raw_material_receiving_batches;
create policy "factory receiving batches update" on public.factory_raw_material_receiving_batches for update to authenticated
using (public.current_user_has_permission('factory_raw_receiving.edit'))
with check (public.current_user_has_permission('factory_raw_receiving.edit'));

create or replace function public.factory_save_raw_material_receiving_batch(
  p_supplier_id uuid,
  p_reference_no text,
  p_received_date date,
  p_remarks text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_supplier public.factory_suppliers%rowtype;
  v_batch_id uuid;
  v_batch_no text;
  v_item jsonb;
  v_index integer := 0;
  v_raw_material_id uuid;
  v_raw_material public.factory_raw_materials%rowtype;
  v_received_qty numeric;
  v_uom text;
  v_receiving_id uuid;
  v_receipt_no text;
  v_storage_location text;
  v_inserted_count integer := 0;
  v_employee_id uuid;
begin
  if not public.current_user_has_permission('factory_raw_receiving.create') then
    raise exception 'Missing permission: factory_raw_receiving.create';
  end if;

  if p_supplier_id is null then
    raise exception 'Supplier is required.';
  end if;

  if p_received_date is null then
    raise exception 'Received Date is required.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one received item.';
  end if;

  select e.id
  into v_employee_id
  from public.employees e
  where e.auth_user_id = auth.uid()
     or e.id = auth.uid()
     or (coalesce(auth.jwt() ->> 'email', '') <> '' and lower(e.email) = lower(auth.jwt() ->> 'email'))
  order by case when e.auth_user_id = auth.uid() then 0 when e.id = auth.uid() then 1 else 2 end
  limit 1;

  select *
  into v_supplier
  from public.factory_suppliers
  where id = p_supplier_id;

  if not found then
    raise exception 'Factory Supplier not found.';
  end if;

  if lower(coalesce(v_supplier.status, '')) <> 'active' then
    raise exception 'Archived Factory Suppliers cannot be selected.';
  end if;

  v_batch_no := 'RMR-' || to_char(now(), 'YYMMDD-HH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  insert into public.factory_raw_material_receiving_batches (
    batch_no,
    reference_no,
    supplier_id,
    supplier_name,
    received_date,
    remarks,
    status,
    created_by,
    updated_at
  )
  values (
    v_batch_no,
    nullif(trim(coalesce(p_reference_no, '')), ''),
    p_supplier_id,
    v_supplier.supplier_name,
    p_received_date,
    nullif(trim(coalesce(p_remarks, '')), ''),
    'active',
    v_employee_id,
    now()
  )
  returning id into v_batch_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_index := v_index + 1;
    v_raw_material_id := nullif(v_item->>'raw_material_id', '')::uuid;
    v_received_qty := nullif(v_item->>'received_qty', '')::numeric;
    v_uom := nullif(trim(coalesce(v_item->>'uom', '')), '');

    if v_raw_material_id is null then
      raise exception 'Raw Material is required for row %.', v_index;
    end if;

    if v_received_qty is null or v_received_qty <= 0 then
      raise exception 'Qty must be greater than 0 for row %.', v_index;
    end if;

    select *
    into v_raw_material
    from public.factory_raw_materials
    where id = v_raw_material_id;

    if not found then
      raise exception 'Raw Material not found for row %.', v_index;
    end if;

    if lower(coalesce(v_raw_material.status, '')) <> 'active' then
      raise exception 'Archived Raw Materials cannot be received for row %.', v_index;
    end if;

    v_uom := coalesce(v_uom, v_raw_material.uom);
    if v_uom is null or trim(v_uom) = '' then
      raise exception 'UOM is required for row %.', v_index;
    end if;

    v_storage_location := nullif(trim(coalesce(v_item->>'storage_location', '')), '');
    v_receipt_no := v_batch_no || '-' || lpad(v_index::text, 2, '0');

    insert into public.factory_raw_material_receivings (
      receipt_no,
      batch_id,
      raw_material_id,
      supplier_id,
      supplier_name,
      batch_no,
      received_qty,
      uom,
      unit_cost,
      total_cost,
      invoice_no,
      received_date,
      expiry_date,
      storage_location,
      remarks,
      received_by,
      updated_at
    )
    values (
      v_receipt_no,
      v_batch_id,
      v_raw_material_id,
      p_supplier_id,
      v_supplier.supplier_name,
      nullif(trim(coalesce(v_item->>'batch_no', '')), ''),
      v_received_qty,
      v_uom,
      0,
      0,
      nullif(trim(coalesce(p_reference_no, '')), ''),
      p_received_date,
      nullif(v_item->>'expiry_date', '')::date,
      coalesce(v_storage_location, v_raw_material.storage_location),
      nullif(trim(concat_ws(' · ', nullif(v_item->>'remarks', ''), nullif(p_remarks, ''))), ''),
      v_employee_id,
      now()
    )
    returning id into v_receiving_id;

    update public.factory_raw_materials
    set current_balance = coalesce(current_balance, 0) + v_received_qty,
        updated_at = now()
    where id = v_raw_material_id;

    if not found then
      raise exception 'Unable to update Raw Material balance for row %.', v_index;
    end if;

    insert into public.factory_raw_material_movements (
      raw_material_id,
      movement_type,
      quantity,
      uom,
      reference_type,
      reference_id,
      reference_no,
      movement_date,
      notes,
      created_by
    )
    values (
      v_raw_material_id,
      'Receiving',
      v_received_qty,
      v_uom,
      'raw_material_receiving',
      v_receiving_id,
      v_receipt_no,
      p_received_date,
      'Raw material receiving recorded.',
      v_employee_id
    );

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'batch_no', v_batch_no,
    'inserted_item_count', v_inserted_count
  );
end;
$$;

grant execute on function public.factory_save_raw_material_receiving_batch(uuid, text, date, text, jsonb) to authenticated;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where lower(r.name) in ('owner', 'admin')
  and p.code like 'factory_%'
on conflict do nothing;
