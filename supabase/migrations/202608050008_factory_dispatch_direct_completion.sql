-- Complete the current Finished Goods Dispatch structure atomically.
-- Existing structure, allocation, stock and movement authority remains in the
-- previously installed save and locked-completion functions.

alter table public.factory_finished_good_dispatches
add column if not exists completed_by uuid references public.employees(id),
add column if not exists completion_request_id uuid,
add column if not exists completion_request_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.factory_finished_good_dispatches'::regclass
      and constraint_row.conname = 'factory_finished_good_dispatches_completion_request_id_key'
  ) then
    alter table public.factory_finished_good_dispatches
    add constraint factory_finished_good_dispatches_completion_request_id_key
    unique (completion_request_id);
  end if;
end;
$$;

create or replace function public.factory_replace_finished_good_dispatch_draft_items(
  p_dispatch_id uuid,
  p_dispatch_date date,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_allocation jsonb;
  v_item_id uuid;
  v_finished_good_id uuid;
  v_batch_id uuid;
  v_quantity numeric;
  v_allocation_quantity numeric;
  v_allocation_total numeric;
  v_batch_count integer;
  v_batch_no text;
  v_batch_payload_total numeric;
  v_batch_payload_totals jsonb := '{}'::jsonb;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispatch must have at least one item.';
  end if;

  delete from public.factory_finished_good_dispatch_items item
  where item.dispatch_id = p_dispatch_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_finished_good_id := nullif(v_item->>'finished_good_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    if v_finished_good_id is null or v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Every dispatch item needs a Packaging SKU and a whole-number quantity greater than 0.';
    end if;

    select finished_good.*
    into v_finished_good
    from public.factory_finished_goods finished_good
    where finished_good.id = v_finished_good_id;
    if not found
      or lower(coalesce(v_finished_good.status, '')) <> 'active'
      or (
        v_finished_good.product_family_id is not null
        and not exists (
          select 1
          from public.factory_product_families product_family
          where product_family.id = v_finished_good.product_family_id
            and lower(coalesce(product_family.status, '')) = 'active'
        )
      ) then
      raise exception 'Packaging SKU is no longer active.';
    end if;

    insert into public.factory_finished_good_dispatch_items (
      dispatch_id, finished_good_id, quantity, batch_no, remarks, created_at
    ) values (
      p_dispatch_id, v_finished_good_id, v_quantity, '', coalesce(v_item->>'remarks', ''), now()
    ) returning id into v_item_id;

    if v_item->'allocations' is null
      or jsonb_typeof(v_item->'allocations') = 'null'
      or (jsonb_typeof(v_item->'allocations') = 'array' and jsonb_array_length(v_item->'allocations') = 0) then
      continue;
    end if;
    if jsonb_typeof(v_item->'allocations') <> 'array' then
      raise exception 'Dispatch batch allocations must be an array.';
    end if;

    v_allocation_total := 0;
    v_batch_count := 0;
    v_batch_no := null;
    for v_allocation in select * from jsonb_array_elements(v_item->'allocations')
    loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_quantity := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_quantity is null or v_allocation_quantity <= 0
        or v_allocation_quantity <> trunc(v_allocation_quantity) then
        raise exception 'Batch allocation quantities must be whole numbers greater than 0.';
      end if;

      select balance.* into v_batch
      from public.factory_finished_good_batch_balances balance
      where balance.id = v_batch_id;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good_id or v_batch.current_balance <= 0 then
        raise exception 'Selected finished-goods batch is unavailable.';
      end if;

      v_batch_payload_total := coalesce(nullif(v_batch_payload_totals->>v_batch.id::text, '')::numeric, 0)
        + v_allocation_quantity;
      if v_batch_payload_total > v_batch.current_balance then
        raise exception 'Allocated quantity exceeds available batch balance.';
      end if;
      v_batch_payload_totals := jsonb_set(
        v_batch_payload_totals,
        array[v_batch.id::text],
        to_jsonb(v_batch_payload_total),
        true
      );

      if v_batch.expiry_date is not null and v_batch.expiry_date < p_dispatch_date then
        raise exception 'Expired finished-goods batches cannot be dispatched.';
      end if;
      if not exists (
        select 1
        from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then
        raise exception 'Selected batch is not in an active Finished Goods storage location.';
      end if;

      insert into public.factory_finished_good_dispatch_batch_allocations (
        dispatch_item_id, batch_balance_id, production_id, quantity, batch_no,
        manufacturing_date, expiry_date, storage_location_id, storage_location, storage_location_type
      ) values (
        v_item_id, v_batch.id, v_batch.production_id, v_allocation_quantity, v_batch.batch_no,
        v_batch.manufacturing_date, v_batch.expiry_date, v_batch.storage_location_id,
        v_batch.storage_location, v_batch.storage_location_type
      );
      v_allocation_total := v_allocation_total + v_allocation_quantity;
      v_batch_count := v_batch_count + 1;
      v_batch_no := v_batch.batch_no;
    end loop;

    if v_allocation_total <> v_quantity then
      raise exception 'Allocated Qty must exactly equal Dispatch Qty.';
    end if;
    update public.factory_finished_good_dispatch_items item
    set batch_no = case when v_batch_count = 1 then v_batch_no else '' end
    where item.id = v_item_id;
  end loop;
end;
$$;

revoke all on function public.factory_replace_finished_good_dispatch_draft_items(uuid, date, jsonb)
from public, anon, authenticated;

create or replace function public.factory_replace_finished_good_dispatch_items(
  p_dispatch_id uuid,
  p_dispatch_date date,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.factory_replace_finished_good_dispatch_draft_items(p_dispatch_id, p_dispatch_date, p_items);
end;
$$;

revoke all on function public.factory_replace_finished_good_dispatch_items(uuid, date, jsonb)
from public, anon, authenticated;

create or replace function public.factory_complete_finished_good_dispatch_locked(p_dispatch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_item record;
  v_allocation record;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_allocation_total numeric;
  v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception using
      errcode = '42501',
      message = 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;

  select dispatch.* into v_dispatch
  from public.factory_finished_good_dispatches dispatch
  where dispatch.id = p_dispatch_id
  for update;
  if not found then raise exception 'Dispatch not found.'; end if;
  if v_dispatch.status <> 'draft' then raise exception 'Only draft dispatches can be completed.'; end if;
  if not exists (
    select 1 from public.factory_finished_good_dispatch_items item where item.dispatch_id = p_dispatch_id
  ) then
    raise exception 'Dispatch must have at least one item.';
  end if;

  perform 1
  from public.factory_finished_good_dispatch_items item
  where item.dispatch_id = p_dispatch_id
  order by item.finished_good_id, item.id
  for update;
  perform 1
  from public.factory_finished_good_dispatch_batch_allocations allocation
  join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
  where item.dispatch_id = p_dispatch_id
  order by allocation.batch_balance_id, allocation.id
  for update of allocation;
  perform 1
  from public.factory_finished_good_batch_balances balance
  where balance.id in (
    select allocation.batch_balance_id
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    where item.dispatch_id = p_dispatch_id
  )
  order by balance.id
  for update;
  perform 1
  from public.factory_productions production
  where production.id in (
    select balance.production_id
    from public.factory_finished_good_batch_balances balance
    join public.factory_finished_good_dispatch_batch_allocations allocation on allocation.batch_balance_id = balance.id
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    where item.dispatch_id = p_dispatch_id
      and balance.production_id is not null
  )
  order by production.id
  for update;

  for v_item in
    select item.*
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
    order by item.finished_good_id, item.created_at, item.id
  loop
    if coalesce(v_item.quantity, 0) <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Dispatch item quantity must be a whole number greater than 0.';
    end if;

    select finished_good.* into v_finished_good
    from public.factory_finished_goods finished_good
    where finished_good.id = v_item.finished_good_id
    for update;
    if not found then raise exception 'Packaging SKU not found.'; end if;
    if lower(coalesce(v_finished_good.status, '')) <> 'active'
      or (
        v_finished_good.product_family_id is not null
        and not exists (
          select 1
          from public.factory_product_families product_family
          where product_family.id = v_finished_good.product_family_id
            and lower(coalesce(product_family.status, '')) = 'active'
        )
      ) then
      raise exception 'Packaging SKU is no longer active.';
    end if;

    select coalesce(sum(balance.current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances balance
    where balance.finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - coalesce(v_finished_good.current_balance, 0)) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before dispatch.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
    end if;

    select coalesce(sum(allocation.quantity), 0) into v_allocation_total
    from public.factory_finished_good_dispatch_batch_allocations allocation
    where allocation.dispatch_item_id = v_item.id;
    if v_allocation_total <> v_item.quantity then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;
    if coalesce(v_finished_good.current_balance, 0) < v_item.quantity then
      raise exception 'Insufficient finished goods balance for %. Available %, requested %.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU'),
        coalesce(v_finished_good.current_balance, 0), v_item.quantity;
    end if;

    for v_allocation in
      select allocation.*
      from public.factory_finished_good_dispatch_batch_allocations allocation
      where allocation.dispatch_item_id = v_item.id
      order by allocation.batch_balance_id, allocation.id
    loop
      select balance.* into v_batch
      from public.factory_finished_good_batch_balances balance
      where balance.id = v_allocation.batch_balance_id
      for update;
      if not found
        or v_batch.finished_good_id <> v_item.finished_good_id
        or (v_batch.expiry_date is not null and v_batch.expiry_date < v_dispatch.dispatch_date) then
        raise exception 'Selected finished-goods batch is unavailable or expired.';
      end if;
      if not exists (
        select 1
        from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then
        raise exception 'Selected batch is not in an active Finished Goods storage location.';
      end if;
      if v_batch.current_balance < v_allocation.quantity then
        raise exception 'Insufficient batch stock.';
      end if;
      update public.factory_finished_good_batch_balances balance
      set current_balance = balance.current_balance - v_allocation.quantity,
          updated_at = now()
      where balance.id = v_batch.id;
    end loop;

    update public.factory_finished_goods finished_good
    set current_balance = finished_good.current_balance - v_item.quantity,
        updated_at = now()
    where finished_good.id = v_item.finished_good_id;

    insert into public.factory_product_stock_movements (
      finished_good_id, product_name, movement_type, quantity, uom, reference_type,
      reference_id, reference_no, movement_date, notes, created_by, dispatch_item_id
    ) values (
      v_item.finished_good_id, v_finished_good.product_name, 'Dispatch Out', -v_item.quantity,
      coalesce(v_finished_good.packaging_type, 'Pack'), 'finished_goods_dispatch',
      v_dispatch.id, v_dispatch.dispatch_no, v_dispatch.dispatch_date,
      'Finished goods Packaging SKU dispatched to ' || v_dispatch.customer_name || '.', v_dispatch.created_by,
      v_item.id
    );
  end loop;

  update public.factory_finished_good_dispatches dispatch
  set status = 'completed', completed_at = now(), updated_at = now()
  where dispatch.id = p_dispatch_id;
  return p_dispatch_id;
end;
$$;

revoke all on function public.factory_complete_finished_good_dispatch_locked(uuid)
from public, anon, authenticated;

create or replace function public.factory_complete_finished_good_dispatch(p_dispatch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_dispatch_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to complete a Dispatch.';
  end if;

  select employee.*
  into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'An active employee profile is required to complete a Dispatch.';
  end if;

  v_dispatch_id := public.factory_complete_finished_good_dispatch_locked(p_dispatch_id);

  update public.factory_finished_good_dispatches dispatch
  set completed_by = v_actor.id
  where dispatch.id = v_dispatch_id;

  return v_dispatch_id;
end;
$$;

revoke all on function public.factory_complete_finished_good_dispatch(uuid) from public, anon;
grant execute on function public.factory_complete_finished_good_dispatch(uuid) to authenticated;

create or replace function public.factory_finished_good_dispatch_request_fingerprint(
  p_customer_id uuid,
  p_dispatch_date date,
  p_reference_no text,
  p_remarks text,
  p_items jsonb
)
returns text
language sql
immutable
set search_path = public
as $$
  with normalized_items as (
    select
      nullif(btrim(coalesce(item.value->>'finished_good_id', '')), '')::uuid as packaging_sku_id,
      trim_scale(nullif(btrim(coalesce(item.value->>'quantity', '')), '')::numeric) as dispatch_qty,
      nullif(btrim(coalesce(item.value->>'remarks', '')), '') as line_remarks,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'batch_balance_id', normalized_allocation.batch_balance_id,
            'allocated_qty', normalized_allocation.allocated_qty
          )
          order by
            normalized_allocation.batch_balance_id::text,
            normalized_allocation.allocated_qty
        )
        from (
          select
            nullif(btrim(coalesce(allocation.value->>'batch_balance_id', '')), '')::uuid as batch_balance_id,
            trim_scale(nullif(btrim(coalesce(allocation.value->>'quantity', '')), '')::numeric) as allocated_qty
          from jsonb_array_elements(
            case
              when item.value->'allocations' is null
                or jsonb_typeof(item.value->'allocations') = 'null' then '[]'::jsonb
              else item.value->'allocations'
            end
          ) allocation(value)
        ) normalized_allocation
      ), '[]'::jsonb) as allocations
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item(value)
  ), canonical_items as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'packaging_sku_id', normalized_item.packaging_sku_id,
        'dispatch_qty', normalized_item.dispatch_qty,
        'remarks', normalized_item.line_remarks,
        'allocations', normalized_item.allocations
      )
      order by
        normalized_item.packaging_sku_id::text,
        normalized_item.dispatch_qty,
        normalized_item.line_remarks,
        normalized_item.allocations::text
    ), '[]'::jsonb) as items
    from normalized_items normalized_item
  )
  select md5(jsonb_build_object(
    'customer_id', p_customer_id::uuid,
    'dispatch_date', p_dispatch_date::date,
    'reference_no', nullif(btrim(coalesce(p_reference_no, '')), ''),
    'remarks', nullif(btrim(coalesce(p_remarks, '')), ''),
    'items', canonical_items.items
  )::text)
  from canonical_items;
$$;

revoke all on function public.factory_finished_good_dispatch_request_fingerprint(uuid, date, text, text, jsonb)
from public, anon, authenticated;

create or replace function public.factory_save_finished_good_dispatch_draft(
  p_dispatch_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_reference_no text,
  p_dispatch_date date,
  p_remarks text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_finished_good_dispatches%rowtype;
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_dispatch_id uuid;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to save a Dispatch.';
  end if;
  if p_request_id is null then
    raise exception 'Dispatch request ID is required.';
  end if;
  if p_dispatch_id is null then
    if not public.current_user_has_permission('factory_finished_goods_dispatch.create') then
      raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.create';
    end if;
  elsif not public.current_user_has_permission('factory_finished_goods_dispatch.edit') then
    raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.edit';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'An active employee profile is required to save a Dispatch.';
  end if;

  v_fingerprint := public.factory_finished_good_dispatch_request_fingerprint(
    p_customer_id, p_dispatch_date, p_reference_no, p_remarks, p_items
  );
  perform pg_advisory_xact_lock(hashtext('factory_dispatch_request_' || p_request_id::text));

  select dispatch.* into v_existing
  from public.factory_finished_good_dispatches dispatch
  where dispatch.completion_request_id = p_request_id
  for update;

  if found then
    if p_dispatch_id is not null and v_existing.id <> p_dispatch_id then
      raise exception 'This Dispatch request is already linked to another Dispatch.';
    end if;
    if p_dispatch_id is null then
      if v_existing.created_by is distinct from v_actor.id then
        raise exception using errcode = '42501', message = 'Dispatch request is not available.';
      end if;
      if v_existing.status <> 'draft' or v_existing.completion_request_fingerprint is distinct from v_fingerprint then
        raise exception 'This Dispatch request was already completed with different details.';
      end if;
      return v_existing.id;
    end if;
  end if;

  if p_dispatch_id is null then
    v_dispatch_id := public.factory_create_finished_good_dispatch(
      p_customer_id,
      coalesce(p_reference_no, ''),
      p_dispatch_date,
      coalesce(p_remarks, ''),
      v_actor.id,
      p_items
    );
  else
    select dispatch.* into v_dispatch
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = p_dispatch_id
    for update;
    if not found then raise exception 'Dispatch not found.'; end if;
    if v_dispatch.completion_request_id is not null
      and v_dispatch.completion_request_id <> p_request_id then
      raise exception 'This Dispatch is linked to another request.';
    end if;
    v_dispatch_id := public.factory_update_finished_good_dispatch(
      p_dispatch_id,
      p_customer_id,
      coalesce(p_reference_no, ''),
      p_dispatch_date,
      coalesce(p_remarks, ''),
      p_items
    );
  end if;

  update public.factory_finished_good_dispatches dispatch
  set completion_request_id = p_request_id,
      completion_request_fingerprint = v_fingerprint
  where dispatch.id = v_dispatch_id;
  return v_dispatch_id;
end;
$$;

revoke all on function public.factory_save_finished_good_dispatch_draft(uuid, uuid, uuid, text, date, text, jsonb)
from public, anon;
grant execute on function public.factory_save_finished_good_dispatch_draft(uuid, uuid, uuid, text, date, text, jsonb)
to authenticated;

revoke execute on function public.factory_create_finished_good_dispatch(uuid, text, date, text, uuid, jsonb)
from public, anon, authenticated;
revoke execute on function public.factory_update_finished_good_dispatch(uuid, uuid, text, date, text, jsonb)
from public, anon, authenticated;

create or replace function public.factory_get_finished_good_dispatch_result(p_dispatch_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', dispatch.id,
    'dispatch_no', dispatch.dispatch_no,
    'dispatch_date', dispatch.dispatch_date,
    'customer_id', dispatch.customer_id,
    'customer_name', dispatch.customer_name,
    'customer_type', customer.customer_type,
    'reference_no', dispatch.reference_no,
    'status', dispatch.status,
    'remarks', dispatch.remarks,
    'created_by', dispatch.created_by,
    'completed_by', dispatch.completed_by,
    'completed_by_name', coalesce(completer.nickname, completer.full_name),
    'created_at', dispatch.created_at,
    'updated_at', dispatch.updated_at,
    'completed_at', dispatch.completed_at,
    'completion_request_id', dispatch.completion_request_id,
    'total_items', (
      select count(*) from public.factory_finished_good_dispatch_items item where item.dispatch_id = dispatch.id
    ),
    'total_dispatch_qty', (
      select coalesce(sum(item.quantity), 0) from public.factory_finished_good_dispatch_items item where item.dispatch_id = dispatch.id
    ),
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', allocation.id,
        'dispatch_item_id', allocation.dispatch_item_id,
        'batch_id', allocation.batch_balance_id,
        'batch_balance_id', allocation.batch_balance_id,
        'production_id', allocation.production_id,
        'quantity', allocation.quantity,
        'batch_no', allocation.batch_no,
        'manufacturing_date', allocation.manufacturing_date,
        'expiry_date', allocation.expiry_date,
        'storage_location_id', allocation.storage_location_id,
        'storage_location', allocation.storage_location,
        'storage_location_type', allocation.storage_location_type
      ) order by allocation.created_at, allocation.id)
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      where item.dispatch_id = dispatch.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'dispatch_id', item.dispatch_id,
        'finished_good_id', item.finished_good_id,
        'quantity', item.quantity,
        'batch_no', item.batch_no,
        'remarks', item.remarks,
        'product_code', finished_good.product_code,
        'product_name', coalesce(product_family.name_en, finished_good.product_name_en, finished_good.product_name),
        'sku_product_name', coalesce(finished_good.product_name_en, finished_good.product_name),
        'variant_name', finished_good.variant_name,
        'packaging_type', finished_good.packaging_type,
        'pack_size_qty', finished_good.pack_size_qty,
        'pack_size_uom', finished_good.pack_size_uom,
        'base_qty', finished_good.base_qty,
        'base_uom', finished_good.base_uom,
        'allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', allocation.id,
            'batch_id', allocation.batch_balance_id,
            'batch_balance_id', allocation.batch_balance_id,
            'production_id', allocation.production_id,
            'quantity', allocation.quantity,
            'batch_no', allocation.batch_no,
            'batch_type', balance.source_type,
            'manufacturing_date', allocation.manufacturing_date,
            'expiry_date', allocation.expiry_date,
            'storage_location_id', allocation.storage_location_id,
            'storage_location', coalesce(location.location_name, allocation.storage_location),
            'storage_location_type', coalesce(location.location_type, allocation.storage_location_type),
            'current_balance', balance.current_balance,
            'location_valid', location.id is not null
              and lower(coalesce(location.status, '')) = 'active'
              and lower(coalesce(location.location_type, '')) = 'finished goods area',
            'location_issue', case
              when location.id is null then 'Storage location missing'
              when lower(coalesce(location.status, '')) <> 'active' then 'Storage location archived'
              when lower(coalesce(location.location_type, '')) <> 'finished goods area' then 'Storage location is not a Finished Goods Area'
              else ''
            end
          ) order by allocation.created_at, allocation.id)
          from public.factory_finished_good_dispatch_batch_allocations allocation
          join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
          left join public.factory_storage_locations location on location.id = allocation.storage_location_id
          where allocation.dispatch_item_id = item.id
        ), '[]'::jsonb)
      ) order by item.created_at, item.id)
      from public.factory_finished_good_dispatch_items item
      join public.factory_finished_goods finished_good on finished_good.id = item.finished_good_id
      left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
      where item.dispatch_id = dispatch.id
    ), '[]'::jsonb)
  )
  from public.factory_finished_good_dispatches dispatch
  left join public.factory_customers customer on customer.id = dispatch.customer_id
  left join public.employees completer on completer.id = dispatch.completed_by
  where dispatch.id = p_dispatch_id;
$$;

revoke all on function public.factory_get_finished_good_dispatch_result(uuid)
from public, anon, authenticated;

create or replace function public.factory_save_and_complete_finished_good_dispatch(
  p_dispatch_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_reference_no text,
  p_dispatch_date date,
  p_remarks text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.employees%rowtype;
  v_existing public.factory_finished_good_dispatches%rowtype;
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_dispatch_id uuid;
  v_fingerprint text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to complete a Dispatch.';
  end if;
  if p_request_id is null then
    raise exception 'Dispatch request ID is required.';
  end if;
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;

  select employee.* into v_actor
  from public.employees employee
  where employee.auth_user_id = auth.uid()
    and lower(coalesce(employee.employment_status, '')) = 'active'
  order by employee.id asc
  limit 1;
  if not found then
    raise exception using errcode = '42501', message = 'An active employee profile is required to complete a Dispatch.';
  end if;

  v_fingerprint := public.factory_finished_good_dispatch_request_fingerprint(
    p_customer_id, p_dispatch_date, p_reference_no, p_remarks, p_items
  );
  perform pg_advisory_xact_lock(hashtext('factory_dispatch_request_' || p_request_id::text));

  select dispatch.* into v_existing
  from public.factory_finished_good_dispatches dispatch
  where dispatch.completion_request_id = p_request_id
  for update;

  if found then
    if p_dispatch_id is not null and v_existing.id <> p_dispatch_id then
      raise exception 'This Dispatch request is already linked to another Dispatch.';
    end if;
    if p_dispatch_id is null and v_existing.created_by is distinct from v_actor.id then
      raise exception using errcode = '42501', message = 'Dispatch request is not available.';
    end if;
    if v_existing.status = 'completed' then
      if v_existing.completion_request_fingerprint is distinct from v_fingerprint then
        raise exception 'This Dispatch request was already completed with different details.';
      end if;
      return public.factory_get_finished_good_dispatch_result(v_existing.id);
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'Only draft dispatches can be completed.';
    end if;
    if p_dispatch_id is null and v_existing.completion_request_fingerprint is distinct from v_fingerprint then
      raise exception 'This Dispatch request was already completed with different details.';
    end if;
    v_dispatch_id := v_existing.id;
  elsif p_dispatch_id is not null then
    select dispatch.* into v_dispatch
    from public.factory_finished_good_dispatches dispatch
    where dispatch.id = p_dispatch_id
    for update;
    if not found then raise exception 'Dispatch not found.'; end if;
    if v_dispatch.completion_request_id is not null
      and v_dispatch.completion_request_id <> p_request_id then
      raise exception 'This Dispatch is linked to another request.';
    end if;
    if v_dispatch.status <> 'draft' then
      raise exception 'Only draft dispatches can be completed.';
    end if;
    v_dispatch_id := v_dispatch.id;
  end if;

  if v_dispatch_id is null
    or p_dispatch_id is not null
    or v_existing.completion_request_fingerprint is distinct from v_fingerprint then
    v_dispatch_id := public.factory_save_finished_good_dispatch_draft(
      v_dispatch_id,
      p_request_id,
      p_customer_id,
      p_reference_no,
      p_dispatch_date,
      p_remarks,
      p_items
    );
  end if;

  update public.factory_finished_good_dispatches dispatch
  set completion_request_fingerprint = v_fingerprint
  where dispatch.id = v_dispatch_id;

  perform public.factory_complete_finished_good_dispatch(v_dispatch_id);
  return public.factory_get_finished_good_dispatch_result(v_dispatch_id);
end;
$$;

revoke all on function public.factory_save_and_complete_finished_good_dispatch(uuid, uuid, uuid, text, date, text, jsonb)
from public, anon;
grant execute on function public.factory_save_and_complete_finished_good_dispatch(uuid, uuid, uuid, text, date, text, jsonb)
to authenticated;

-- An archived Packaging SKU remains represented in inventory, but none of its
-- batches may be offered for a new Dispatch allocation.
create or replace function public.factory_get_finished_good_batch_availability(
  p_finished_good_id uuid, p_dispatch_id uuid default null, p_dispatch_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not (
    public.current_user_has_permission('factory_finished_goods_dispatch.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.create')
    or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
    or public.current_user_has_permission('factory_product_stock_check.create')
    or public.current_user_has_permission('factory_product_stock_check.edit')
    or public.current_user_has_permission('factory_product_stock_check.approve')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Finished Goods batches.';
  end if;

  with finished_good as (
    select finished_good.id, finished_good.status,
      finished_good.product_family_id,
      product_family.status as product_family_status,
      coalesce(finished_good.current_balance, 0) as aggregate_balance
    from public.factory_finished_goods finished_good
    left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
    where finished_good.id = p_finished_good_id
  ), provisional as (
    select allocation.batch_balance_id,
      sum(allocation.quantity) filter (
        where dispatch.status = 'draft'
          and (p_dispatch_id is null or dispatch.id <> p_dispatch_id)
      ) as dispatch_qty
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    group by allocation.batch_balance_id
  ), check_provisional as (
    select adjustment.batch_balance_id, sum(adjustment.quantity) as quantity
    from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
    where stock_check.status in ('draft', 'submitted')
    group by adjustment.batch_balance_id
  ), classified as (
    select balance.id as batch_id, balance.production_id, balance.source_type as batch_type,
      balance.batch_no, balance.manufacturing_date, balance.expiry_date,
      balance.storage_location_id, coalesce(location.location_name, balance.storage_location) as storage_location,
      coalesce(location.location_type, balance.storage_location_type) as storage_location_type,
      location.status as storage_location_status, balance.opening_qty as produced_qty,
      balance.opening_qty - balance.current_balance as allocated_qty,
      coalesce(provisional.dispatch_qty, 0) + coalesce(check_provisional.quantity, 0) as provisional_qty,
      balance.current_balance,
      case
        when lower(coalesce(finished_good.status, '')) <> 'active'
          or (finished_good.product_family_id is not null and lower(coalesce(finished_good.product_family_status, '')) <> 'active')
          then 'Packaging SKU Inactive'
        when balance.source_type = 'legacy_unallocated' then 'Reconciliation Required'
        when balance.storage_location_id is null then 'Storage Location Missing'
        when location.id is null then 'Metadata unavailable'
        when lower(coalesce(location.status, '')) <> 'active' then 'Storage Location Archived'
        when lower(coalesce(location.location_type, '')) <> 'finished goods area' then 'Not a Finished Goods Area'
        when p_dispatch_date is not null and balance.expiry_date is not null
          and balance.expiry_date < p_dispatch_date then 'Expired'
        when nullif(btrim(balance.batch_no), '') is null then 'Metadata unavailable'
        else null
      end as exclusion_reason
    from public.factory_finished_good_batch_balances balance
    cross join finished_good
    left join public.factory_storage_locations location on location.id = balance.storage_location_id
    left join provisional on provisional.batch_balance_id = balance.id
    left join check_provisional on check_provisional.batch_balance_id = balance.id
    where balance.finished_good_id = p_finished_good_id
      and balance.current_balance > 0
  ), totals as (
    select coalesce(sum(classified.current_balance) filter (where classified.exclusion_reason is null), 0) as allocatable_balance,
      coalesce(sum(classified.current_balance), 0) as represented_balance
    from classified
  )
  select jsonb_build_object(
    'finished_good_id', finished_good.id,
    'aggregate_balance', finished_good.aggregate_balance,
    'allocatable_batch_balance', totals.allocatable_balance,
    'unavailable_balance', greatest(finished_good.aggregate_balance - totals.allocatable_balance, 0),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', classified.batch_id,
        'production_id', classified.production_id,
        'batch_type', classified.batch_type,
        'batch_no', classified.batch_no,
        'manufacturing_date', classified.manufacturing_date,
        'expiry_date', classified.expiry_date,
        'storage_location_id', classified.storage_location_id,
        'storage_location', classified.storage_location,
        'storage_location_type', classified.storage_location_type,
        'storage_location_status', classified.storage_location_status,
        'produced_qty', classified.produced_qty,
        'allocated_qty', classified.allocated_qty,
        'provisional_qty', classified.provisional_qty,
        'available_qty', classified.current_balance
      ) order by classified.expiry_date asc nulls last,
        classified.manufacturing_date asc nulls last,
        classified.batch_no asc,
        classified.batch_id asc)
      from classified
      where classified.exclusion_reason is null
    ), '[]'::jsonb),
    'unavailable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', classified.batch_id,
        'production_id', classified.production_id,
        'batch_type', classified.batch_type,
        'batch_no', classified.batch_no,
        'manufacturing_date', classified.manufacturing_date,
        'expiry_date', classified.expiry_date,
        'storage_location_id', classified.storage_location_id,
        'storage_location', classified.storage_location,
        'storage_location_type', classified.storage_location_type,
        'storage_location_status', classified.storage_location_status,
        'unavailable_qty', classified.current_balance,
        'exclusion_reason', classified.exclusion_reason
      ) order by classified.expiry_date asc nulls last,
        classified.manufacturing_date asc nulls last,
        classified.batch_no asc,
        classified.batch_id asc)
      from classified
      where classified.exclusion_reason is not null
    ), '[]'::jsonb) || case
      when finished_good.aggregate_balance > totals.represented_balance then jsonb_build_array(jsonb_build_object(
        'batch_id', null,
        'production_id', null,
        'batch_type', 'legacy_unallocated',
        'batch_no', 'Legacy / Unallocated',
        'manufacturing_date', null,
        'expiry_date', null,
        'storage_location_id', null,
        'storage_location', null,
        'storage_location_type', null,
        'storage_location_status', null,
        'unavailable_qty', finished_good.aggregate_balance - totals.represented_balance,
        'exclusion_reason', case
          when lower(coalesce(finished_good.status, '')) <> 'active'
            or (finished_good.product_family_id is not null and lower(coalesce(finished_good.product_family_status, '')) <> 'active')
            then 'Packaging SKU Inactive'
          else 'Reconciliation Required'
        end
      ))
      else '[]'::jsonb
    end
  )
  into v_result
  from finished_good
  cross join totals;

  if v_result is null then
    raise exception 'Packaging SKU not found.';
  end if;

  return v_result;
end;
$$;

revoke all on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) from public;
grant execute on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) to authenticated;
