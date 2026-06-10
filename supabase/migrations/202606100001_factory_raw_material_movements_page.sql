-- Factory Raw Material Movements page support.
-- Adds a dedicated movement-view permission and preserves storage_location_id through batch receiving.

insert into public.permissions (code, module, description)
values
  ('factory_raw_movements.view', 'Factory Raw Material Movements', 'View Factory raw material stock movement history.'),
  ('factory_raw_movements.export', 'Factory Raw Material Movements', 'Export Factory raw material stock movement history.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

alter table public.factory_raw_material_receivings
  add column if not exists storage_location_id uuid references public.factory_storage_locations(id) on delete set null;

drop policy if exists "factory raw movements view" on public.factory_raw_material_movements;
create policy "factory raw movements view" on public.factory_raw_material_movements for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_raw_movements.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production_reports.view')
);

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
  v_storage_location_id uuid;
  v_storage_location_name text;
  v_received_qty numeric;
  v_uom text;
  v_receiving_id uuid;
  v_receipt_no text;
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
    v_storage_location_id := nullif(v_item->>'storage_location_id', '')::uuid;
    v_received_qty := nullif(v_item->>'received_qty', '')::numeric;
    v_uom := nullif(trim(coalesce(v_item->>'uom', '')), '');
    v_storage_location_name := nullif(trim(coalesce(v_item->>'storage_location', '')), '');

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

    if v_storage_location_id is not null then
      select location_name
      into v_storage_location_name
      from public.factory_storage_locations
      where id = v_storage_location_id
        and lower(coalesce(status, 'active')) = 'active';

      if not found then
        raise exception 'Active Storage Location not found for row %.', v_index;
      end if;
    end if;

    v_uom := coalesce(v_uom, v_raw_material.uom);
    if v_uom is null or trim(v_uom) = '' then
      raise exception 'UOM is required for row %.', v_index;
    end if;

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
      storage_location_id,
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
      v_storage_location_id,
      coalesce(v_storage_location_name, v_raw_material.storage_location),
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
