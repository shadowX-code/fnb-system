-- Remove cost and manufacturing-date capture from Raw Material Receiving.
-- Existing historical values remain unchanged; new Draft and Completed items persist NULL.

alter table public.factory_raw_material_receivings
  alter column unit_cost drop not null,
  alter column unit_cost drop default,
  alter column total_cost drop not null,
  alter column total_cost drop default;

create or replace function public.factory_get_raw_material_receiving_defaults(
  p_raw_material_id uuid,
  p_received_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material public.factory_raw_materials%rowtype;
  v_internal_batch_no text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to view Raw Material Receiving defaults.';
  end if;
  if not (
    public.current_user_has_permission('factory_raw_receiving.view')
    or public.current_user_has_permission('factory_raw_receiving.create')
    or public.current_user_has_permission('factory_raw_receiving.edit')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Raw Material Receiving defaults.';
  end if;

  select material.* into v_material
  from public.factory_raw_materials material
  where material.id = p_raw_material_id;

  if not found then raise exception 'Raw Material not found.'; end if;

  v_internal_batch_no := public.factory_raw_receiving_next_internal_batch_no(p_raw_material_id, coalesce(p_received_date, current_date));

  return jsonb_build_object(
    'raw_material_id', v_material.id,
    'uom', v_material.uom,
    'storage_location_id', v_material.storage_location_id,
    'storage_location', v_material.storage_location,
    'expiry_tracking_mode', v_material.expiry_tracking_mode,
    'shelf_life_days', v_material.shelf_life_days,
    'suggested_expiry_date', case
      when v_material.expiry_tracking_mode = 'not_applicable' or v_material.shelf_life_days is null then null
      else coalesce(p_received_date, current_date) + v_material.shelf_life_days
    end,
    'internal_batch_no', v_internal_batch_no
  );
end;
$$;

grant execute on function public.factory_get_raw_material_receiving_defaults(uuid, date) to authenticated;
revoke execute on function public.factory_get_raw_material_receiving_defaults(uuid, date) from public, anon;

create or replace function public.factory_raw_receiving_request_fingerprint(
  p_supplier_id uuid,
  p_received_date date,
  p_reference_no text,
  p_remarks text,
  p_items jsonb
)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  with normalized_items as (
    select
      nullif(btrim(coalesce(item.value->>'raw_material_id', '')), '')::uuid as raw_material_id,
      trim_scale(nullif(btrim(coalesce(item.value->>'received_qty', '')), '')::numeric) as received_qty,
      nullif(btrim(coalesce(item.value->>'uom', '')), '') as uom,
      nullif(btrim(coalesce(item.value->>'supplier_lot_no', '')), '') as supplier_lot_no,
      nullif(btrim(coalesce(item.value->>'remarks', '')), '') as item_remarks,
      case
        when nullif(btrim(coalesce(item.value->>'expiry_source', '')), '') = 'not_applicable' then null
        else nullif(btrim(coalesce(item.value->>'expiry_date', '')), '')::date
      end as expiry_date,
      nullif(btrim(coalesce(item.value->>'storage_location_id', '')), '')::uuid as storage_location_id,
      nullif(btrim(coalesce(item.value->>'expiry_source', '')), '') as expiry_source,
      coalesce(nullif(btrim(coalesce(item.value->>'expiry_confirmed', '')), '')::boolean, false) as expiry_confirmed
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item(value)
  ), canonical_items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'raw_material_id', normalized_item.raw_material_id,
        'received_qty', normalized_item.received_qty,
        'uom', normalized_item.uom,
        'supplier_lot_no', normalized_item.supplier_lot_no,
        'remarks', normalized_item.item_remarks,
        'expiry_date', normalized_item.expiry_date,
        'storage_location_id', normalized_item.storage_location_id,
        'expiry_source', normalized_item.expiry_source,
        'expiry_confirmed', normalized_item.expiry_confirmed
      )
      order by
        normalized_item.raw_material_id::text,
        normalized_item.received_qty,
        normalized_item.uom,
        normalized_item.supplier_lot_no,
        normalized_item.item_remarks,
        normalized_item.expiry_date,
        normalized_item.storage_location_id::text,
        normalized_item.expiry_source,
        normalized_item.expiry_confirmed
    ), '[]'::jsonb) as items
    from normalized_items normalized_item
  )
  select md5(jsonb_build_object(
    'supplier_id', p_supplier_id::uuid,
    'received_date', p_received_date::date,
    'supplier_reference', nullif(btrim(coalesce(p_reference_no, '')), ''),
    'remarks', nullif(btrim(coalesce(p_remarks, '')), ''),
    'items', canonical_items.items
  )::text)
  from canonical_items;
$$;

revoke all on function public.factory_raw_receiving_request_fingerprint(uuid, date, text, text, jsonb)
from public, anon, authenticated;

create or replace function public.factory_save_raw_material_receiving(
  p_batch_id uuid,
  p_request_id uuid,
  p_supplier_id uuid,
  p_reference_no text,
  p_received_date date,
  p_remarks text,
  p_items jsonb,
  p_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_supplier public.factory_suppliers%rowtype;
  v_batch public.factory_raw_material_receiving_batches%rowtype;
  v_request_batch public.factory_raw_material_receiving_batches%rowtype;
  v_existing_item public.factory_raw_material_receivings%rowtype;
  v_material public.factory_raw_materials%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_seen_ids uuid[] := '{}';
  v_index integer := 0;
  v_batch_prefix text;
  v_next_batch integer;
  v_receipt_no text;
  v_internal_batch_no text;
  v_supplier_lot_no text;
  v_received_qty numeric;
  v_storage_location_id uuid;
  v_expiry_date date;
  v_expiry_source text;
  v_expiry_confirmed boolean;
  v_item_remarks text;
  v_completion_fingerprint text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to save Raw Material Receiving.';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'An active employee profile is required to save Raw Material Receiving.';
  end if;

  if p_batch_id is null then
    if not public.current_user_has_permission('factory_raw_receiving.create') then
      raise exception using errcode = '42501', message = 'Missing permission to create Raw Material Receiving.';
    end if;
  elsif not public.current_user_has_permission('factory_raw_receiving.edit') then
    raise exception using errcode = '42501', message = 'Missing permission to edit Raw Material Receiving.';
  end if;

  if p_supplier_id is null then raise exception 'Supplier is required.'; end if;
  if p_received_date is null then raise exception 'Received Date is required.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one received item.';
  end if;
  if p_request_id is null then raise exception 'Receiving request ID is required.'; end if;

  v_completion_fingerprint := public.factory_raw_receiving_request_fingerprint(
    p_supplier_id, p_received_date, p_reference_no, p_remarks, p_items
  );
  perform pg_advisory_xact_lock(hashtext('factory_raw_receiving_request_' || p_request_id::text));

  select batch_row.* into v_request_batch
  from public.factory_raw_material_receiving_batches batch_row
  where batch_row.completion_request_id = p_request_id
  for update;

  if found then
    if p_batch_id is not null and v_request_batch.id <> p_batch_id then
      raise exception 'This Receiving request is already linked to another Receiving.';
    end if;
    if p_batch_id is null and v_request_batch.created_by is distinct from v_actor.id then
      raise exception using errcode = '42501', message = 'Receiving request is not available.';
    end if;
    if lower(coalesce(v_request_batch.status, '')) in ('active', 'completed') then
      if v_request_batch.completion_payload_fingerprint is distinct from v_completion_fingerprint then
        raise exception 'This Receiving request was already completed with different details.';
      end if;
      return public.factory_raw_receiving_payload(v_request_batch.id);
    end if;
    if lower(coalesce(v_request_batch.status, '')) = 'cancelled' then
      raise exception 'This Receiving request belongs to a Cancelled Receiving.';
    end if;
    if lower(coalesce(v_request_batch.status, '')) <> 'draft' then
      raise exception 'This Receiving request is linked to an incompatible Receiving.';
    end if;
    if not p_complete
      and p_batch_id is null
      and v_request_batch.completion_payload_fingerprint is not distinct from v_completion_fingerprint
    then
      return public.factory_raw_receiving_payload(v_request_batch.id);
    end if;
    p_batch_id := v_request_batch.id;
  end if;

  if p_batch_id is not null then
    select batch_row.* into v_batch
    from public.factory_raw_material_receiving_batches batch_row
    where batch_row.id = p_batch_id
    for update;
    if not found then raise exception 'Raw Material Receiving was not found.'; end if;
    if v_batch.completion_request_id is not null and v_batch.completion_request_id <> p_request_id then
      raise exception 'This Receiving is linked to another request.';
    end if;
  end if;

  if p_complete
    and lower(coalesce(v_batch.status, '')) in ('active', 'completed')
    and v_batch.completion_request_id = p_request_id
  then
    if v_batch.completion_payload_fingerprint is distinct from v_completion_fingerprint then
      raise exception 'This Receiving request was already completed with different details.';
    end if;
    return public.factory_raw_receiving_payload(v_batch.id);
  end if;

  if v_batch.id is not null and exists (
    select 1
    from public.factory_raw_material_movements movement
    join public.factory_raw_material_receivings item on item.id = movement.reference_id
    where item.batch_id = v_batch.id
      and movement.reference_type = 'raw_material_receiving'
  ) then
    raise exception 'Raw Material Receiving with stock history cannot be edited.';
  end if;

  if v_batch.id is not null and lower(coalesce(v_batch.status, '')) <> 'draft' then
    raise exception 'Only Draft Raw Material Receiving can be edited or completed.';
  end if;
  select supplier.* into v_supplier from public.factory_suppliers supplier where supplier.id = p_supplier_id;
  if not found then raise exception 'Factory Supplier not found.'; end if;
  if lower(coalesce(v_supplier.status, '')) <> 'active' then raise exception 'Archived Factory Suppliers cannot be selected.'; end if;

  if v_batch.id is null then
    v_batch_prefix := 'R' || to_char(p_received_date, 'YYMMDD');
    perform pg_advisory_xact_lock(hashtext('factory_raw_receiving:' || v_batch_prefix));
    select coalesce(max(nullif(substring(batch_no from '^R[0-9]{6}-([0-9]+)$'), '')::integer), 0) + 1
    into v_next_batch
    from public.factory_raw_material_receiving_batches
    where batch_no ~ ('^' || v_batch_prefix || '-[0-9]+$');

    insert into public.factory_raw_material_receiving_batches (
      batch_no, reference_no, supplier_id, supplier_name, received_date, remarks,
      status, completion_request_id, completion_payload_fingerprint, created_by, updated_at
    ) values (
      v_batch_prefix || '-' || lpad(v_next_batch::text, 2, '0'), nullif(btrim(p_reference_no), ''),
      v_supplier.id, v_supplier.supplier_name, p_received_date, nullif(btrim(p_remarks), ''),
      'draft', p_request_id, v_completion_fingerprint, v_actor.id, now()
    ) returning * into v_batch;
  else
    update public.factory_raw_material_receiving_batches
    set reference_no = nullif(btrim(p_reference_no), ''), supplier_id = v_supplier.id,
        supplier_name = v_supplier.supplier_name, received_date = p_received_date,
        remarks = nullif(btrim(p_remarks), ''), completion_request_id = coalesce(completion_request_id, p_request_id),
        completion_payload_fingerprint = v_completion_fingerprint, updated_at = now()
    where id = v_batch.id returning * into v_batch;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
    order by nullif(value->>'raw_material_id', '')::uuid::text, value::text
  loop
    v_index := v_index + 1;
    v_item_id := nullif(v_item->>'id', '')::uuid;
    select item.* into v_existing_item
    from public.factory_raw_material_receivings item
    where item.id = v_item_id and item.batch_id = v_batch.id
    for update;

    select material.* into v_material
    from public.factory_raw_materials material
    where material.id = nullif(v_item->>'raw_material_id', '')::uuid;
    if not found then raise exception 'Raw Material is required for row %.', v_index; end if;
    if lower(coalesce(v_material.status, '')) <> 'active' then raise exception 'Archived Raw Materials cannot be received for row %.', v_index; end if;
    if nullif(btrim(v_material.uom), '') is null then raise exception 'UOM is required for row %.', v_index; end if;

    v_received_qty := coalesce(nullif(btrim(v_item->>'received_qty'), '')::numeric, 0);
    v_storage_location_id := nullif(v_item->>'storage_location_id', '')::uuid;
    v_expiry_date := nullif(v_item->>'expiry_date', '')::date;
    v_expiry_source := nullif(btrim(v_item->>'expiry_source'), '');
    v_expiry_confirmed := coalesce(nullif(btrim(v_item->>'expiry_confirmed'), '')::boolean, false);
    v_supplier_lot_no := nullif(btrim(v_item->>'supplier_lot_no'), '');
    v_item_remarks := nullif(btrim(v_item->>'remarks'), '');
    v_internal_batch_no := case when p_complete
      then public.factory_raw_receiving_next_internal_batch_no(v_material.id, p_received_date)
      else null
    end;

    if nullif(btrim(v_item->>'uom'), '') is distinct from v_material.uom then
      raise exception 'A valid UOM is required for row %.', v_index;
    end if;
    if v_expiry_source is not null and v_expiry_source not in ('supplier_label', 'calculated', 'not_applicable') then
      raise exception 'Expiry source is invalid for row %.', v_index;
    end if;

    if p_complete then
      if v_received_qty <= 0 then raise exception 'Qty must be greater than 0 for row %.', v_index; end if;
      if v_storage_location_id is null then raise exception 'Storage Location is required for row %.', v_index; end if;
      select location.* into v_location from public.factory_storage_locations location
      where location.id = v_storage_location_id and lower(coalesce(location.status, '')) = 'active';
      if not found then raise exception 'Active Storage Location not found for row %.', v_index; end if;
      if v_material.expiry_tracking_mode = 'not_applicable' then
        v_expiry_date := null;
        v_expiry_source := 'not_applicable';
        v_expiry_confirmed := true;
      elsif v_material.expiry_tracking_mode = 'required' and v_expiry_date is null then
        raise exception 'Expiry Date is required for row %.', v_index;
      elsif v_expiry_date is null then
        v_expiry_source := null;
        v_expiry_confirmed := false;
      end if;
      if v_expiry_date is not null and (
        not v_expiry_confirmed
        or v_expiry_source is null
        or v_expiry_source not in ('supplier_label', 'calculated')
      ) then
        raise exception 'Confirm the Expiry Date before completing Receiving.';
      end if;
    else
      if v_material.expiry_tracking_mode = 'not_applicable' then
        v_expiry_date := null;
        v_expiry_source := 'not_applicable';
        v_expiry_confirmed := true;
      elsif v_expiry_date is null then
        v_expiry_source := null;
        v_expiry_confirmed := false;
      end if;
      select location.* into v_location from public.factory_storage_locations location where location.id = v_storage_location_id;
    end if;

    v_receipt_no := coalesce(v_existing_item.receipt_no,
      v_batch.batch_no || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
    if v_existing_item.id is null then
      insert into public.factory_raw_material_receivings (
        receipt_no, batch_id, raw_material_id, supplier_id, supplier_name, batch_no,
        supplier_lot_no, internal_batch_no, received_qty, uom, unit_cost, total_cost,
        invoice_no, received_date, manufacturing_date, expiry_date, expiry_source, expiry_confirmed, storage_location_id,
        storage_location, remarks, received_by, updated_at
      ) values (
        v_receipt_no, v_batch.id, v_material.id, v_supplier.id, v_supplier.supplier_name, v_internal_batch_no,
        v_supplier_lot_no, v_internal_batch_no, v_received_qty, v_material.uom, null,
        null, nullif(btrim(p_reference_no), ''), p_received_date,
        null, v_expiry_date, v_expiry_source, v_expiry_confirmed, v_storage_location_id, v_location.location_name,
        v_item_remarks, case when p_complete then v_actor.id else null end, now()
      ) returning id into v_item_id;
    else
      update public.factory_raw_material_receivings
      set receipt_no = v_receipt_no, raw_material_id = v_material.id, supplier_id = v_supplier.id,
          supplier_name = v_supplier.supplier_name, batch_no = v_internal_batch_no,
          supplier_lot_no = v_supplier_lot_no, internal_batch_no = v_internal_batch_no,
          received_qty = v_received_qty, uom = v_material.uom, unit_cost = null,
          total_cost = null, invoice_no = nullif(btrim(p_reference_no), ''),
          received_date = p_received_date, manufacturing_date = null,
          expiry_date = v_expiry_date, expiry_source = v_expiry_source,
          expiry_confirmed = v_expiry_confirmed, storage_location_id = v_storage_location_id,
          storage_location = v_location.location_name, remarks = v_item_remarks,
          received_by = case when p_complete then v_actor.id else null end, updated_at = now()
      where id = v_existing_item.id returning id into v_item_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);
  end loop;

  delete from public.factory_raw_material_receivings item
  where item.batch_id = v_batch.id and not (item.id = any(v_seen_ids));

  if p_complete then
    if exists (
      select 1 from public.factory_raw_material_movements movement
      join public.factory_raw_material_receivings item on item.id = movement.reference_id
      where item.batch_id = v_batch.id and movement.reference_type = 'raw_material_receiving'
    ) then raise exception 'Raw Material Receiving has already affected stock.'; end if;

    for v_existing_item in select * from public.factory_raw_material_receivings where batch_id = v_batch.id order by created_at, id
    loop
      update public.factory_raw_materials
      set current_balance = coalesce(current_balance, 0) + v_existing_item.received_qty, updated_at = now()
      where id = v_existing_item.raw_material_id and lower(coalesce(status, '')) = 'active';
      if not found then raise exception 'Unable to update Raw Material balance.'; end if;

      insert into public.factory_raw_material_movements (
        raw_material_id, movement_type, quantity, uom, reference_type, reference_id,
        reference_no, movement_date, notes, created_by
      ) values (
        v_existing_item.raw_material_id, 'Receiving', v_existing_item.received_qty,
        v_existing_item.uom, 'raw_material_receiving', v_existing_item.id,
        v_existing_item.receipt_no, p_received_date, 'Raw material receiving completed.', v_actor.id
      );
    end loop;

    update public.factory_raw_material_receiving_batches
    set status = 'completed', completion_payload_fingerprint = v_completion_fingerprint,
        completed_by = v_actor.id, completed_at = now(), updated_at = now()
    where id = v_batch.id;
  end if;

  return public.factory_raw_receiving_payload(v_batch.id);
end;
$$;

grant execute on function public.factory_save_raw_material_receiving(uuid, uuid, uuid, text, date, text, jsonb, boolean) to authenticated;
revoke execute on function public.factory_save_raw_material_receiving(uuid, uuid, uuid, text, date, text, jsonb, boolean) from public, anon;

