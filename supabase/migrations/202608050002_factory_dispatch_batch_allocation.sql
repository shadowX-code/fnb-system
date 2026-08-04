-- Finished Goods Dispatch batch allocation.
-- Adds draft allocation persistence and validates FEFO batch stock without changing SKU stock accounting.

-- Bootstrap the authoritative ledger before the RPC definitions below reference
-- its row types. Full indexes, RLS and data reconciliation follow later.
create table if not exists public.factory_finished_good_batch_balances (
  id uuid primary key default gen_random_uuid(),
  finished_good_id uuid not null references public.factory_finished_goods(id) on delete restrict,
  production_id uuid references public.factory_productions(id) on delete restrict,
  source_type text not null,
  source_reference_id uuid,
  source_reference_no text,
  batch_no text not null,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid references public.factory_storage_locations(id) on delete restrict,
  storage_location text,
  storage_location_type text,
  opening_qty numeric not null default 0,
  current_balance numeric not null default 0,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_finished_good_batch_balances_source_type_check
    check (source_type in ('production', 'adjustment', 'legacy_unallocated'))
);

-- Dispatch movements retain the exact source line. Historical rows are linked
-- later only when the Dispatch, Packaging SKU and quantity identify one item.
alter table public.factory_product_stock_movements
  add column if not exists dispatch_item_id uuid
    references public.factory_finished_good_dispatch_items(id) on delete restrict;

create index if not exists factory_product_stock_movements_dispatch_item_idx
on public.factory_product_stock_movements (dispatch_item_id);

create or replace function public.factory_validate_product_movement_dispatch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.factory_finished_good_dispatch_items%rowtype;
begin
  if new.dispatch_item_id is null then
    if lower(coalesce(new.reference_type, '')) = 'finished_goods_dispatch' then
      if tg_op = 'INSERT' then
        raise exception 'Finished Goods Dispatch movements require an exact Dispatch Item linkage.';
      elsif old.dispatch_item_id is not null then
        raise exception 'Finished Goods Dispatch movement linkage cannot be removed.';
      end if;
    end if;
    return new;
  end if;

  if lower(coalesce(new.reference_type, '')) <> 'finished_goods_dispatch' then
    raise exception 'Dispatch Item linkage is only valid for Finished Goods Dispatch movements.';
  end if;

  select * into v_item
  from public.factory_finished_good_dispatch_items item
  where item.id = new.dispatch_item_id;

  if v_item.id is null
    or v_item.dispatch_id is distinct from new.reference_id
    or v_item.finished_good_id is distinct from new.finished_good_id
    or v_item.quantity is distinct from abs(new.quantity) then
    raise exception 'Product Movement Dispatch Item does not match the referenced Dispatch and Packaging SKU.';
  end if;

  return new;
end;
$$;

drop trigger if exists factory_validate_product_movement_dispatch_item
on public.factory_product_stock_movements;
create trigger factory_validate_product_movement_dispatch_item
before insert or update of dispatch_item_id, reference_type, reference_id, finished_good_id, quantity
on public.factory_product_stock_movements
for each row execute function public.factory_validate_product_movement_dispatch_item();

create table if not exists public.factory_product_stock_check_batch_adjustments (
  id uuid primary key default gen_random_uuid(),
  stock_check_item_id uuid not null references public.factory_product_stock_check_items(id) on delete cascade,
  batch_balance_id uuid not null references public.factory_finished_good_batch_balances(id) on delete restrict,
  quantity numeric not null,
  created_at timestamptz not null default now(),
  constraint factory_product_stock_check_batch_adjustments_quantity_check
    check (quantity > 0 and quantity = trunc(quantity)),
  constraint factory_product_stock_check_batch_adjustments_item_batch_key
    unique (stock_check_item_id, batch_balance_id)
);

create table if not exists public.factory_finished_good_dispatch_batch_allocations (
  id uuid primary key default gen_random_uuid(),
  dispatch_item_id uuid not null references public.factory_finished_good_dispatch_items(id) on delete cascade,
  production_id uuid not null references public.factory_productions(id) on delete restrict,
  quantity numeric not null,
  batch_no text not null,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid references public.factory_storage_locations(id) on delete set null,
  storage_location text,
  storage_location_type text,
  created_at timestamptz not null default now(),
  constraint factory_finished_good_dispatch_batch_allocations_quantity_check
    check (quantity > 0 and quantity = trunc(quantity)),
  constraint factory_finished_good_dispatch_batch_allocations_item_batch_key
    unique (dispatch_item_id, production_id)
);

alter table public.factory_finished_good_dispatch_batch_allocations
  add column if not exists batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict;
alter table public.factory_finished_good_dispatch_batch_allocations
  alter column production_id drop not null;

create index if not exists factory_finished_good_dispatch_allocations_item_idx
on public.factory_finished_good_dispatch_batch_allocations (dispatch_item_id);

create index if not exists factory_finished_good_dispatch_allocations_production_idx
on public.factory_finished_good_dispatch_batch_allocations (production_id);

alter table public.factory_finished_good_dispatch_batch_allocations enable row level security;

grant select on public.factory_finished_good_dispatch_batch_allocations to authenticated;
revoke insert, update, delete on public.factory_finished_good_dispatch_batch_allocations from authenticated;

drop policy if exists "factory dispatch batch allocations view" on public.factory_finished_good_dispatch_batch_allocations;
create policy "factory dispatch batch allocations view"
on public.factory_finished_good_dispatch_batch_allocations
for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
);

drop function if exists public.factory_get_finished_good_batch_availability(uuid, uuid, date);
create or replace function public.factory_get_finished_good_batch_availability(
  p_finished_good_id uuid,
  p_dispatch_id uuid default null,
  p_dispatch_date date default null
)
returns table (
  production_id uuid,
  batch_no text,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid,
  storage_location text,
  storage_location_type text,
  produced_qty numeric,
  allocated_qty numeric,
  available_qty numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.current_user_has_permission('factory_finished_goods_dispatch.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.create')
    or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Finished Goods Dispatch batches.';
  end if;

  return query
  with allocation_usage as (
    select
      allocation.production_id,
      sum(allocation.quantity) as quantity
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    where dispatch.status <> 'cancelled'
      and (p_dispatch_id is null or dispatch.id <> p_dispatch_id)
    group by allocation.production_id
  ),
  legacy_usage as (
    select
      production.id as production_id,
      sum(item.quantity) as quantity
    from public.factory_productions production
    join public.factory_finished_good_dispatch_items item
      on item.finished_good_id = production.finished_good_id
     and nullif(btrim(item.batch_no), '') = production.batch_no
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    where dispatch.status <> 'cancelled'
      and (p_dispatch_id is null or dispatch.id <> p_dispatch_id)
      and not exists (
        select 1
        from public.factory_finished_good_dispatch_batch_allocations allocation
        where allocation.dispatch_item_id = item.id
      )
    group by production.id
  )
  select
    production.id as production_id,
    production.batch_no as batch_no,
    coalesce(production.manufacturing_date, production.production_date),
    production.expiry_date,
    production.storage_location_id,
    location.location_name as storage_location,
    location.location_type as storage_location_type,
    production.actual_pack_qty as produced_qty,
    coalesce(allocation_usage.quantity, 0) + coalesce(legacy_usage.quantity, 0),
    greatest(
      production.actual_pack_qty
        - coalesce(allocation_usage.quantity, 0)
        - coalesce(legacy_usage.quantity, 0),
      0
    )
  from public.factory_productions production
  join public.factory_storage_locations location on location.id = production.storage_location_id
  left join allocation_usage on allocation_usage.production_id = production.id
  left join legacy_usage on legacy_usage.production_id = production.id
  where production.finished_good_id = p_finished_good_id
    and lower(coalesce(production.status, '')) = 'completed'
    and production.actual_pack_qty is not null
    and production.actual_pack_qty > 0
    and nullif(btrim(production.batch_no), '') is not null
    and lower(coalesce(location.status, '')) = 'active'
    and lower(coalesce(location.location_type, '')) = 'finished goods area'
    and (production.expiry_date is null or production.expiry_date >= coalesce(p_dispatch_date, current_date))
    and production.actual_pack_qty
      - coalesce(allocation_usage.quantity, 0)
      - coalesce(legacy_usage.quantity, 0) > 0
  order by
    production.expiry_date asc nulls last,
    coalesce(production.manufacturing_date, production.production_date) asc,
    production.batch_no asc,
    production.id asc;
end;
$$;

grant execute on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) to authenticated;

-- Final installed dispatch-structure writer (later than the compatibility
-- definition above): drafts are provisional and never reserve batch stock.
create or replace function public.factory_replace_finished_good_dispatch_items_ledger(
  p_dispatch_id uuid, p_dispatch_date date, p_items jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb; v_allocation jsonb; v_item_id uuid; v_finished_good_id uuid;
  v_batch_id uuid; v_quantity numeric; v_allocation_quantity numeric;
  v_allocation_total numeric; v_batch_count integer; v_batch_no text;
  v_batch_payload_total numeric;
  v_batch_payload_totals jsonb := '{}'::jsonb;
  v_batch public.factory_finished_good_batch_balances%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispatch must have at least one item.';
  end if;
  delete from public.factory_finished_good_dispatch_items where dispatch_id = p_dispatch_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_finished_good_id := nullif(v_item->>'finished_good_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    if v_finished_good_id is null or v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Every dispatch item needs a Packaging SKU and a whole-number quantity greater than 0.';
    end if;
    if jsonb_typeof(v_item->'allocations') <> 'array' or jsonb_array_length(v_item->'allocations') = 0 then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;
    insert into public.factory_finished_good_dispatch_items
      (dispatch_id, finished_good_id, quantity, batch_no, remarks, created_at)
    values (p_dispatch_id, v_finished_good_id, v_quantity, '', coalesce(v_item->>'remarks', ''), now())
    returning id into v_item_id;
    v_allocation_total := 0; v_batch_count := 0; v_batch_no := null;
    for v_allocation in select * from jsonb_array_elements(v_item->'allocations') loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_quantity := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_quantity is null or v_allocation_quantity <= 0
        or v_allocation_quantity <> trunc(v_allocation_quantity) then
        raise exception 'Batch allocation quantities must be whole numbers greater than 0.';
      end if;
      select * into v_batch from public.factory_finished_good_batch_balances where id = v_batch_id;
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
        select 1 from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then raise exception 'Selected batch is not in an active Finished Goods storage location.'; end if;
      insert into public.factory_finished_good_dispatch_batch_allocations (
        dispatch_item_id, batch_balance_id, production_id, quantity, batch_no,
        manufacturing_date, expiry_date, storage_location_id, storage_location, storage_location_type
      ) values (
        v_item_id, v_batch.id, v_batch.production_id, v_allocation_quantity, v_batch.batch_no,
        v_batch.manufacturing_date, v_batch.expiry_date, v_batch.storage_location_id,
        v_batch.storage_location, v_batch.storage_location_type
      );
      v_allocation_total := v_allocation_total + v_allocation_quantity;
      v_batch_count := v_batch_count + 1; v_batch_no := v_batch.batch_no;
    end loop;
    if v_allocation_total <> v_quantity then raise exception 'Allocated Qty must exactly equal Dispatch Qty.'; end if;
    update public.factory_finished_good_dispatch_items
    set batch_no = case when v_batch_count = 1 then v_batch_no else '' end where id = v_item_id;
  end loop;
end;
$$;
revoke all on function public.factory_replace_finished_good_dispatch_items_ledger(uuid, date, jsonb) from public, authenticated;

-- Final installed completion function. Locking and validation happen before any
-- batch, aggregate or movement mutation, and all work shares one transaction.
create or replace function public.factory_complete_finished_good_dispatch_locked(p_dispatch_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_dispatch public.factory_finished_good_dispatches%rowtype; v_item record;
  v_allocation record; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_allocation_total numeric; v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;
  select * into v_dispatch from public.factory_finished_good_dispatches where id = p_dispatch_id for update;
  if v_dispatch.id is null then raise exception 'Dispatch not found.'; end if;
  if v_dispatch.status <> 'draft' then raise exception 'Only draft dispatches can be completed.'; end if;
  if not exists (select 1 from public.factory_finished_good_dispatch_items where dispatch_id = p_dispatch_id) then
    raise exception 'Dispatch must have at least one item.';
  end if;
  perform 1 from public.factory_finished_good_dispatch_items
    where dispatch_id = p_dispatch_id order by finished_good_id, id for update;
  perform 1 from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    where item.dispatch_id = p_dispatch_id order by allocation.batch_balance_id, allocation.id for update of allocation;
  perform 1 from public.factory_finished_good_batch_balances balance
    where balance.id in (
      select allocation.batch_balance_id from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      where item.dispatch_id = p_dispatch_id
    ) order by balance.id for update;
  perform 1 from public.factory_productions production
    where production.id in (
      select balance.production_id from public.factory_finished_good_batch_balances balance
      join public.factory_finished_good_dispatch_batch_allocations allocation on allocation.batch_balance_id = balance.id
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      where item.dispatch_id = p_dispatch_id and balance.production_id is not null
    ) order by production.id for update;
  for v_item in
    select * from public.factory_finished_good_dispatch_items
    where dispatch_id = p_dispatch_id order by finished_good_id, created_at, id
  loop
    if coalesce(v_item.quantity, 0) <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Dispatch item quantity must be a whole number greater than 0.';
    end if;
    select * into v_finished_good from public.factory_finished_goods where id = v_item.finished_good_id for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    select coalesce(sum(current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances where finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - coalesce(v_finished_good.current_balance, 0)) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before dispatch.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
    end if;
    select coalesce(sum(quantity), 0) into v_allocation_total
    from public.factory_finished_good_dispatch_batch_allocations where dispatch_item_id = v_item.id;
    if v_allocation_total <> v_item.quantity then raise exception 'Confirm a complete batch allocation for every dispatch line.'; end if;
    if coalesce(v_finished_good.current_balance, 0) < v_item.quantity then
      raise exception 'Insufficient finished goods balance for %. Available %, requested %.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU'),
        coalesce(v_finished_good.current_balance, 0), v_item.quantity;
    end if;
    for v_allocation in
      select * from public.factory_finished_good_dispatch_batch_allocations
      where dispatch_item_id = v_item.id order by batch_balance_id, id
    loop
      select * into v_batch from public.factory_finished_good_batch_balances
      where id = v_allocation.batch_balance_id for update;
      if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
        or (v_batch.expiry_date is not null and v_batch.expiry_date < v_dispatch.dispatch_date) then
        raise exception 'Selected finished-goods batch is unavailable or expired.';
      end if;
      if not exists (
        select 1 from public.factory_storage_locations location where location.id = v_batch.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then raise exception 'Selected batch is not in an active Finished Goods storage location.'; end if;
      if v_batch.current_balance < v_allocation.quantity then raise exception 'Insufficient batch stock.'; end if;
      update public.factory_finished_good_batch_balances
      set current_balance = current_balance - v_allocation.quantity, updated_at = now() where id = v_batch.id;
    end loop;
    update public.factory_finished_goods
    set current_balance = current_balance - v_item.quantity, updated_at = now() where id = v_item.finished_good_id;
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
  update public.factory_finished_good_dispatches
  set status = 'completed', completed_at = now(), updated_at = now() where id = p_dispatch_id;
  return p_dispatch_id;
end;
$$;
revoke all on function public.factory_complete_finished_good_dispatch_locked(uuid) from public, authenticated;

create or replace function public.factory_replace_finished_good_dispatch_items(
  p_dispatch_id uuid, p_dispatch_date date, p_items jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb; v_allocation jsonb; v_item_id uuid; v_finished_good_id uuid;
  v_batch_id uuid; v_quantity numeric; v_allocation_quantity numeric;
  v_allocation_total numeric; v_batch_count integer; v_batch_no text;
  v_batch public.factory_finished_good_batch_balances%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Dispatch must have at least one item.';
  end if;
  delete from public.factory_finished_good_dispatch_items where dispatch_id = p_dispatch_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_finished_good_id := nullif(v_item->>'finished_good_id', '')::uuid;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    if v_finished_good_id is null or v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
      raise exception 'Every dispatch item needs a Packaging SKU and a whole-number quantity greater than 0.';
    end if;
    if jsonb_typeof(v_item->'allocations') <> 'array' or jsonb_array_length(v_item->'allocations') = 0 then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;
    insert into public.factory_finished_good_dispatch_items
      (dispatch_id, finished_good_id, quantity, batch_no, remarks, created_at)
    values (p_dispatch_id, v_finished_good_id, v_quantity, '', coalesce(v_item->>'remarks', ''), now())
    returning id into v_item_id;
    v_allocation_total := 0; v_batch_count := 0; v_batch_no := null;
    for v_allocation in select * from jsonb_array_elements(v_item->'allocations') loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_quantity := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_quantity is null or v_allocation_quantity <= 0
        or v_allocation_quantity <> trunc(v_allocation_quantity) then
        raise exception 'Batch allocation quantities must be whole numbers greater than 0.';
      end if;
      select * into v_batch from public.factory_finished_good_batch_balances where id = v_batch_id;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good_id or v_batch.current_balance <= 0 then
        raise exception 'Selected finished-goods batch is unavailable.';
      end if;
      if v_batch.expiry_date is not null and v_batch.expiry_date < p_dispatch_date then
        raise exception 'Expired finished-goods batches cannot be dispatched.';
      end if;
      if not exists (
        select 1 from public.factory_storage_locations location
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
      v_batch_count := v_batch_count + 1; v_batch_no := v_batch.batch_no;
    end loop;
    if v_allocation_total <> v_quantity then raise exception 'Allocated Qty must exactly equal Dispatch Qty.'; end if;
    update public.factory_finished_good_dispatch_items
    set batch_no = case when v_batch_count = 1 then v_batch_no else '' end where id = v_item_id;
  end loop;
end;
$$;
revoke all on function public.factory_replace_finished_good_dispatch_items(uuid, date, jsonb) from public, authenticated;

create or replace function public.factory_save_product_stock_check_batch_adjustments(
  p_stock_check_id uuid, p_rows jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype; v_row jsonb; v_allocation jsonb;
  v_item public.factory_product_stock_check_items%rowtype; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_finished_good_id uuid; v_batch_id uuid; v_quantity numeric; v_total numeric;
begin
  if not (
    public.current_user_has_permission('factory_product_stock_check.create')
    or public.current_user_has_permission('factory_product_stock_check.edit')
    or public.current_user_has_permission('factory_product_stock_check.submit')
  ) then raise exception using errcode = '42501', message = 'Insufficient permission to save Product Stock Check batch adjustments.'; end if;
  select * into v_check from public.factory_product_stock_checks where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status not in ('draft', 'submitted') then raise exception 'Only Draft or Submitted stock checks can store batch adjustments.'; end if;
  delete from public.factory_product_stock_check_batch_adjustments adjustment
  using public.factory_product_stock_check_items item
  where adjustment.stock_check_item_id = item.id and item.stock_check_id = p_stock_check_id;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_finished_good_id := nullif(v_row->>'finished_good_id', '')::uuid;
    select * into v_item from public.factory_product_stock_check_items
    where stock_check_id = p_stock_check_id and finished_good_id = v_finished_good_id;
    if v_item.id is null then raise exception 'Product Stock Check item not found.'; end if;
    v_total := 0;
    for v_allocation in select * from jsonb_array_elements(coalesce(v_row->'allocations', '[]'::jsonb)) loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_quantity := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_quantity is null or v_quantity <= 0 or v_quantity <> trunc(v_quantity) then
        raise exception 'Batch reduction quantities must be whole numbers greater than 0.';
      end if;
      select * into v_batch from public.factory_finished_good_batch_balances where id = v_batch_id;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good_id then
        raise exception 'Stock Check batch does not belong to the selected Packaging SKU.';
      end if;
      insert into public.factory_product_stock_check_batch_adjustments
        (stock_check_item_id, batch_balance_id, quantity)
      values (v_item.id, v_batch_id, v_quantity);
      v_total := v_total + v_quantity;
    end loop;
    if v_item.variance_qty < 0 and v_total <> abs(v_item.variance_qty) then
      raise exception 'Negative Product Stock Check variance must be fully allocated across batches.';
    end if;
    if v_item.variance_qty >= 0 and v_total <> 0 then
      raise exception 'Batch reductions are only allowed for negative Product Stock Check variance.';
    end if;
  end loop;
end;
$$;
grant execute on function public.factory_save_product_stock_check_batch_adjustments(uuid, jsonb) to authenticated;

create or replace function public.factory_approve_product_stock_check(p_stock_check_id uuid, p_approved_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype; v_item record; v_adjustment record;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_location public.factory_storage_locations%rowtype; v_total numeric; v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_product_stock_check.approve') then
    raise exception using errcode = '42501', message = 'Insufficient permission to approve Product Stock Check.';
  end if;
  select * into v_check from public.factory_product_stock_checks where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
  if v_check.status <> 'submitted' then raise exception 'Only submitted stock checks can be approved.'; end if;
  perform 1 from public.factory_product_stock_check_items
    where stock_check_id = p_stock_check_id order by finished_good_id, id for update;
  perform 1 from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    where item.stock_check_id = p_stock_check_id order by adjustment.batch_balance_id, adjustment.id for update of adjustment;
  perform 1 from public.factory_finished_good_batch_balances balance
    where balance.id in (
      select adjustment.batch_balance_id
      from public.factory_product_stock_check_batch_adjustments adjustment
      join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
      where item.stock_check_id = p_stock_check_id
    ) order by balance.id for update;
  for v_item in
    select item.*, product.product_name,
      product.storage_location_id as current_default_storage_location_id
    from public.factory_product_stock_check_items item
    join public.factory_finished_goods product on product.id = item.finished_good_id
    where item.stock_check_id = p_stock_check_id order by item.finished_good_id, item.id
  loop
    if v_item.variance_qty <> 0 and coalesce(btrim(v_item.variance_reason), '') = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    if v_item.system_qty <> trunc(v_item.system_qty)
      or v_item.physical_qty <> trunc(v_item.physical_qty)
      or v_item.variance_qty <> trunc(v_item.variance_qty) then
      raise exception 'Product Stock Check quantities must be whole pack quantities.';
    end if;
    select coalesce(sum(current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances where finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - v_item.system_qty) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before approval.', v_item.product_name;
    end if;
    if v_item.variance_qty < 0 then
      select coalesce(sum(adjustment.quantity), 0) into v_total
      from public.factory_product_stock_check_batch_adjustments adjustment
      where adjustment.stock_check_item_id = v_item.id;
      if v_total <> abs(v_item.variance_qty) then
        raise exception 'Negative Product Stock Check variance must be fully allocated across batches.';
      end if;
      for v_adjustment in
        select adjustment.* from public.factory_product_stock_check_batch_adjustments adjustment
        where adjustment.stock_check_item_id = v_item.id order by adjustment.batch_balance_id, adjustment.id
      loop
        select * into v_batch from public.factory_finished_good_batch_balances where id = v_adjustment.batch_balance_id for update;
        if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
          or v_batch.current_balance < v_adjustment.quantity then
          raise exception 'Insufficient batch stock.';
        end if;
        select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
        if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
          or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
          raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
        end if;
        -- Expired batches remain countable because a physical Stock Check must
        -- account for stock that still exists. Dispatch eligibility is unchanged.
        update public.factory_finished_good_batch_balances
        set current_balance = current_balance - v_adjustment.quantity, updated_at = now()
        where id = v_batch.id;
      end loop;
    elsif v_item.variance_qty > 0 then
      select * into v_location from public.factory_storage_locations
      where id = coalesce(v_item.adjustment_storage_location_id, v_item.current_default_storage_location_id);
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Positive Product Stock Check variance requires an active Finished Goods default storage location.';
      end if;
      insert into public.factory_finished_good_batch_balances (
        finished_good_id, source_type, source_reference_id, source_reference_no, batch_no,
        manufacturing_date, storage_location_id, storage_location, storage_location_type,
        opening_qty, current_balance, remarks
      ) values (
        v_item.finished_good_id, 'adjustment', p_stock_check_id, v_check.check_no,
        'ADJ-' || coalesce(nullif(v_item.product_name, ''), left(v_item.finished_good_id::text, 8)),
        v_check.check_date, v_location.id, v_location.location_name, v_location.location_type,
        v_item.variance_qty, v_item.variance_qty, v_item.variance_reason
      ) on conflict (finished_good_id, storage_location_id) where source_type = 'adjustment'
      do update set opening_qty = factory_finished_good_batch_balances.opening_qty + excluded.opening_qty,
        current_balance = factory_finished_good_batch_balances.current_balance + excluded.current_balance,
        source_reference_id = excluded.source_reference_id, source_reference_no = excluded.source_reference_no,
        remarks = excluded.remarks, updated_at = now();
    end if;
    if v_item.variance_qty <> 0 then
      perform public.factory_adjust_finished_good_balance(v_item.finished_good_id, v_item.variance_qty);
      insert into public.factory_product_stock_movements (
        finished_good_id, product_name, movement_type, quantity, uom, reference_type,
        reference_id, reference_no, movement_date, notes, created_by
      ) values (
        v_item.finished_good_id, v_item.product_name, 'Stock Check Adjustment', v_item.variance_qty,
        v_item.uom, 'product_stock_check', p_stock_check_id, v_check.check_no,
        coalesce(v_check.check_date, current_date),
        'Approved finished goods stock check adjustment. Batch inventory updated explicitly.', p_approved_by
      );
    end if;
  end loop;
  update public.factory_product_stock_checks set status = 'approved', approved_by = p_approved_by,
    approved_at = now(), submitted_at = coalesce(submitted_at, now()), updated_at = now()
  where id = p_stock_check_id;
end;
$$;
grant execute on function public.factory_approve_product_stock_check(uuid, uuid) to authenticated;

create or replace function public.factory_complete_finished_good_dispatch(p_dispatch_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_dispatch public.factory_finished_good_dispatches%rowtype; v_item record;
  v_allocation record; v_batch public.factory_finished_good_batch_balances%rowtype;
  v_finished_good public.factory_finished_goods%rowtype;
  v_allocation_total numeric; v_batch_total numeric;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception using errcode = '42501', message = 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;
  -- Global lock order: header, items, allocations, batch ledger, Production rows.
  select * into v_dispatch from public.factory_finished_good_dispatches
  where id = p_dispatch_id for update;
  if v_dispatch.id is null then raise exception 'Dispatch not found.'; end if;
  if v_dispatch.status <> 'draft' then raise exception 'Only draft dispatches can be completed.'; end if;
  if not exists (select 1 from public.factory_finished_good_dispatch_items where dispatch_id = p_dispatch_id) then
    raise exception 'Dispatch must have at least one item.';
  end if;
  perform 1 from public.factory_finished_good_dispatch_items
    where dispatch_id = p_dispatch_id order by finished_good_id, id for update;
  perform 1 from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    where item.dispatch_id = p_dispatch_id order by allocation.batch_balance_id, allocation.id for update of allocation;
  perform 1 from public.factory_finished_good_batch_balances balance
    where balance.id in (
      select allocation.batch_balance_id
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      where item.dispatch_id = p_dispatch_id
    ) order by balance.id for update;
  perform 1 from public.factory_productions production
    where production.id in (
      select balance.production_id
      from public.factory_finished_good_batch_balances balance
      join public.factory_finished_good_dispatch_batch_allocations allocation on allocation.batch_balance_id = balance.id
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      where item.dispatch_id = p_dispatch_id and balance.production_id is not null
    ) order by production.id for update;

  for v_item in
    select * from public.factory_finished_good_dispatch_items
    where dispatch_id = p_dispatch_id order by finished_good_id, created_at, id
  loop
    if coalesce(v_item.quantity, 0) <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Dispatch item quantity must be a whole number greater than 0.';
    end if;
    select * into v_finished_good from public.factory_finished_goods
    where id = v_item.finished_good_id for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    select coalesce(sum(current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances where finished_good_id = v_item.finished_good_id;
    if abs(v_batch_total - coalesce(v_finished_good.current_balance, 0)) > 0.0001 then
      raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before dispatch.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
    end if;
    select coalesce(sum(quantity), 0) into v_allocation_total
    from public.factory_finished_good_dispatch_batch_allocations where dispatch_item_id = v_item.id;
    if v_allocation_total <> v_item.quantity then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;
    if coalesce(v_finished_good.current_balance, 0) < v_item.quantity then
      raise exception 'Insufficient finished goods balance for %. Available %, requested %.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU'),
        coalesce(v_finished_good.current_balance, 0), v_item.quantity;
    end if;
    for v_allocation in
      select * from public.factory_finished_good_dispatch_batch_allocations
      where dispatch_item_id = v_item.id order by batch_balance_id, id
    loop
      select * into v_batch from public.factory_finished_good_batch_balances
      where id = v_allocation.batch_balance_id for update;
      if v_batch.id is null or v_batch.finished_good_id <> v_item.finished_good_id
        or (v_batch.expiry_date is not null and v_batch.expiry_date < v_dispatch.dispatch_date) then
        raise exception 'Selected finished-goods batch is unavailable or expired.';
      end if;
      if not exists (
        select 1 from public.factory_storage_locations location
        where location.id = v_batch.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then raise exception 'Selected batch is not in an active Finished Goods storage location.'; end if;
      if v_batch.current_balance < v_allocation.quantity then
        raise exception 'Insufficient batch stock.';
      end if;
      update public.factory_finished_good_batch_balances
      set current_balance = current_balance - v_allocation.quantity, updated_at = now()
      where id = v_batch.id;
    end loop;
    update public.factory_finished_goods
    set current_balance = current_balance - v_item.quantity, updated_at = now()
    where id = v_item.finished_good_id;
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
  update public.factory_finished_good_dispatches
  set status = 'completed', completed_at = now(), updated_at = now() where id = p_dispatch_id;
  return p_dispatch_id;
end;
$$;
grant execute on function public.factory_complete_finished_good_dispatch(uuid) to authenticated;

-- Final integrity hardening: Product Stock Check structure authority, legacy
-- diagnostics and rerun-safe balance reconstruction.
alter table public.factory_product_stock_check_items
  add column if not exists adjustment_storage_location_id uuid
    references public.factory_storage_locations(id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'factory_product_stock_check_items_system_whole') then
    alter table public.factory_product_stock_check_items
      add constraint factory_product_stock_check_items_system_whole
      check (system_qty = trunc(system_qty)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factory_product_stock_check_items_physical_whole') then
    alter table public.factory_product_stock_check_items
      add constraint factory_product_stock_check_items_physical_whole
      check (physical_qty = trunc(physical_qty)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factory_product_stock_check_items_variance_whole') then
    alter table public.factory_product_stock_check_items
      add constraint factory_product_stock_check_items_variance_whole
      check (variance_qty = trunc(variance_qty)) not valid;
  end if;
end;
$$;

create table if not exists public.factory_finished_good_batch_reconciliation_diagnostics (
  id uuid primary key default gen_random_uuid(),
  diagnostic_key text not null unique,
  dispatch_id uuid not null references public.factory_finished_good_dispatches(id) on delete cascade,
  dispatch_item_id uuid not null references public.factory_finished_good_dispatch_items(id) on delete cascade,
  finished_good_id uuid not null references public.factory_finished_goods(id) on delete restrict,
  legacy_batch_reference text,
  matching_production_count integer not null,
  affected_quantity numeric not null,
  diagnostic_status text not null,
  dispatch_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_finished_good_batch_reconciliation_diagnostics_status_check
    check (diagnostic_status in ('unique_match', 'ambiguous_match', 'no_match'))
);
create index if not exists factory_finished_good_batch_diagnostics_sku_idx
on public.factory_finished_good_batch_reconciliation_diagnostics (finished_good_id, diagnostic_status);
alter table public.factory_finished_good_batch_reconciliation_diagnostics enable row level security;
grant select on public.factory_finished_good_batch_reconciliation_diagnostics to authenticated;
revoke insert, update, delete on public.factory_finished_good_batch_reconciliation_diagnostics from authenticated;
drop policy if exists "factory finished good batch diagnostics view" on public.factory_finished_good_batch_reconciliation_diagnostics;
create policy "factory finished good batch diagnostics view"
on public.factory_finished_good_batch_reconciliation_diagnostics for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_product_stock_check.view')
);

-- Stock Check item writes are controlled by the structure RPC below.
revoke insert, update, delete on public.factory_product_stock_check_items from authenticated;
drop policy if exists "factory product stock check items manage" on public.factory_product_stock_check_items;

create or replace function public.factory_save_product_stock_check_structure(
  p_stock_check_id uuid,
  p_check_date date,
  p_notes text,
  p_target_status text,
  p_created_by uuid,
  p_rows jsonb
)
returns table (id uuid, check_no text)
language plpgsql security definer set search_path = public as $$
declare
  v_check public.factory_product_stock_checks%rowtype;
  v_check_id uuid;
  v_check_no text;
  v_date date := coalesce(p_check_date, current_date);
  v_status text := lower(coalesce(p_target_status, 'draft'));
  v_prefix text := 'FGSC' || to_char(coalesce(p_check_date, current_date), 'YYMMDD');
  v_next integer;
  v_row jsonb;
  v_allocation jsonb;
  v_finished_good public.factory_finished_goods%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_item_id uuid;
  v_finished_good_id uuid;
  v_physical_qty numeric;
  v_system_qty numeric;
  v_variance_qty numeric;
  v_variance_percent numeric;
  v_variance_status text;
  v_reason text;
  v_adjustment_location_id uuid;
  v_batch_total numeric;
  v_batch public.factory_finished_good_batch_balances%rowtype;
  v_batch_id uuid;
  v_allocation_qty numeric;
  v_allocation_total numeric;
begin
  if v_status not in ('draft', 'submitted') then
    raise exception 'Product Stock Check status must be Draft or Submitted.';
  end if;
  if v_status = 'submitted'
    and not public.current_user_has_permission('factory_product_stock_check.submit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to submit Product Stock Check.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Product Stock Check requires at least one item.';
  end if;

  if p_stock_check_id is null then
    if not public.current_user_has_permission('factory_product_stock_check.create') then
      raise exception using errcode = '42501', message = 'Insufficient permission to create Product Stock Check.';
    end if;
    perform pg_advisory_xact_lock(hashtext('factory_product_stock_check_' || v_prefix));
    select coalesce(max(nullif(regexp_replace(stock_check.check_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
    into v_next from public.factory_product_stock_checks stock_check
    where stock_check.check_no ~ ('^' || v_prefix || '-[0-9]+$');
    v_check_no := v_prefix || '-' || lpad(v_next::text, 2, '0');
    insert into public.factory_product_stock_checks (
      check_no, check_date, status, notes, created_by, submitted_by, submitted_at, created_at, updated_at
    ) values (
      v_check_no, v_date, 'draft', coalesce(p_notes, ''), p_created_by,
      case when v_status = 'submitted' then p_created_by end,
      case when v_status = 'submitted' then now() end, now(), now()
    ) returning factory_product_stock_checks.id into v_check_id;
  else
    if not (
      public.current_user_has_permission('factory_product_stock_check.edit')
      or public.current_user_has_permission('factory_product_stock_check.submit')
    ) then raise exception using errcode = '42501', message = 'Insufficient permission to edit Product Stock Check.'; end if;
    select * into v_check from public.factory_product_stock_checks
    where factory_product_stock_checks.id = p_stock_check_id for update;
    if v_check.id is null then raise exception 'Finished goods stock check not found.'; end if;
    if lower(coalesce(v_check.status, '')) <> 'draft' then
      raise exception 'Only Draft Product Stock Checks can be edited or submitted.';
    end if;
    v_check_id := v_check.id;
    v_check_no := v_check.check_no;
    update public.factory_product_stock_checks
    set check_date = v_date, notes = coalesce(p_notes, ''), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;

  delete from public.factory_product_stock_check_items where stock_check_id = v_check_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_finished_good_id := nullif(v_row->>'finished_good_id', '')::uuid;
    if exists (
      select 1 from public.factory_product_stock_check_items
      where stock_check_id = v_check_id and finished_good_id = v_finished_good_id
    ) then raise exception 'Packaging SKU appears more than once in Product Stock Check.'; end if;
    select * into v_finished_good from public.factory_finished_goods
    where factory_finished_goods.id = v_finished_good_id for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    v_system_qty := coalesce(v_finished_good.current_balance, 0);
    if v_system_qty <> trunc(v_system_qty) then
      raise exception 'Packaging SKU system balance must be a whole number before Stock Check.';
    end if;
    if v_status = 'submitted' and (not (v_row ? 'physical_qty') or v_row->>'physical_qty' is null) then
      raise exception 'Physical Qty is required before submitting Product Stock Check.';
    end if;
    v_physical_qty := coalesce(nullif(v_row->>'physical_qty', '')::numeric, v_system_qty);
    if v_physical_qty < 0 or v_physical_qty <> trunc(v_physical_qty) then
      raise exception 'Physical Qty must be a whole number.';
    end if;
    v_variance_qty := v_physical_qty - v_system_qty;
    if v_status = 'submitted' then
      select coalesce(sum(current_balance), 0) into v_batch_total
      from public.factory_finished_good_batch_balances where finished_good_id = v_finished_good.id;
      if abs(v_batch_total - v_system_qty) > 0.0001 then
        raise exception 'Finished Goods batch inventory is unreconciled for %. Reconcile it before submitting.',
          coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU');
      end if;
    end if;
    v_variance_percent := case when v_system_qty = 0
      then case when v_variance_qty = 0 then 0 else 100 end
      else (v_variance_qty / v_system_qty) * 100 end;
    v_variance_status := case
      when v_variance_qty = 0 then 'Normal'
      when v_system_qty <= 0 or abs(v_variance_percent) >= 10 then 'Critical'
      else 'Variance' end;
    v_reason := btrim(coalesce(v_row->>'variance_reason', ''));
    if v_status = 'submitted' and v_variance_qty <> 0 and v_reason = '' then
      raise exception 'Variance reason is required for Product Stock Check adjustments.';
    end if;
    v_adjustment_location_id := null;
    if v_variance_qty > 0 then
      select * into v_location from public.factory_storage_locations
      where factory_storage_locations.id = v_finished_good.storage_location_id;
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Positive Product Stock Check variance requires an active Finished Goods default storage location.';
      end if;
      v_adjustment_location_id := v_location.id;
    end if;
    insert into public.factory_product_stock_check_items (
      stock_check_id, finished_good_id, system_qty, physical_qty, variance_qty,
      variance_percent, variance_status, variance_reason, uom,
      adjustment_storage_location_id, created_at, updated_at
    ) values (
      v_check_id, v_finished_good.id, v_system_qty, v_physical_qty, v_variance_qty,
      v_variance_percent, v_variance_status, v_reason, coalesce(v_finished_good.packaging_type, 'Pack'),
      v_adjustment_location_id, now(), now()
    ) returning factory_product_stock_check_items.id into v_item_id;

    v_allocation_total := 0;
    for v_allocation in select * from jsonb_array_elements(coalesce(v_row->'allocations', '[]'::jsonb)) loop
      v_batch_id := nullif(v_allocation->>'batch_balance_id', '')::uuid;
      v_allocation_qty := nullif(v_allocation->>'quantity', '')::numeric;
      if v_batch_id is null or v_allocation_qty is null or v_allocation_qty <= 0
        or v_allocation_qty <> trunc(v_allocation_qty) then
        raise exception 'Batch reduction quantities must be whole numbers greater than 0.';
      end if;
      select * into v_batch from public.factory_finished_good_batch_balances where id = v_batch_id for update;
      if v_batch.id is null or v_batch.finished_good_id <> v_finished_good.id then
        raise exception 'Stock Check batch does not belong to the selected Packaging SKU.';
      end if;
      if v_batch.current_balance < v_allocation_qty then
        raise exception 'Stock Check batch allocation exceeds its current balance.';
      end if;
      select * into v_location from public.factory_storage_locations where id = v_batch.storage_location_id;
      if v_location.id is null or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Stock Check batch must be in an active Finished Goods storage location.';
      end if;
      insert into public.factory_product_stock_check_batch_adjustments
        (stock_check_item_id, batch_balance_id, quantity)
      values (v_item_id, v_batch.id, v_allocation_qty);
      v_allocation_total := v_allocation_total + v_allocation_qty;
    end loop;
    if v_variance_qty < 0 and v_allocation_total <> abs(v_variance_qty) then
      raise exception 'Negative Product Stock Check variance must be fully allocated across batches.';
    end if;
    if v_variance_qty >= 0 and v_allocation_total <> 0 then
      raise exception 'Batch reductions are only allowed for negative Product Stock Check variance.';
    end if;
  end loop;

  if v_status = 'submitted' then
    update public.factory_product_stock_checks
    set status = 'submitted', submitted_by = p_created_by,
      submitted_at = now(), updated_at = now()
    where factory_product_stock_checks.id = v_check_id;
  end if;
  return query select v_check_id, v_check_no;
end;
$$;
grant execute on function public.factory_save_product_stock_check_structure(uuid, date, text, text, uuid, jsonb) to authenticated;

-- Retire the pre-structure allocation-only write path. The structure RPC owns
-- header, item and allocation replacement in one transaction.
revoke execute on function public.factory_save_product_stock_check_batch_adjustments(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.factory_delete_product_stock_check_draft(p_stock_check_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_check public.factory_product_stock_checks%rowtype;
begin
  if not public.current_user_has_permission('factory_product_stock_check.edit') then
    raise exception using errcode = '42501', message = 'Insufficient permission to delete Product Stock Check.';
  end if;
  select * into v_check from public.factory_product_stock_checks
  where id = p_stock_check_id for update;
  if v_check.id is null then raise exception 'Product Stock Check not found.'; end if;
  if lower(coalesce(v_check.status, '')) <> 'draft' then
    raise exception 'Only Draft Product Stock Checks can be deleted.';
  end if;
  delete from public.factory_product_stock_checks where id = v_check.id;
  return v_check.id;
end;
$$;
grant execute on function public.factory_delete_product_stock_check_draft(uuid) to authenticated;

-- Header mutations are also routed through controlled RPCs so a caller cannot
-- bypass Draft-only structure editing or the validated submit transition.
revoke insert, update, delete on public.factory_product_stock_checks from authenticated;
drop policy if exists "factory product stock checks manage" on public.factory_product_stock_checks;

create or replace function public.factory_cancel_finished_goods_dispatch(p_dispatch_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_dispatch public.factory_finished_good_dispatches%rowtype;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.delete') then
    raise exception using errcode = '42501', message = 'Insufficient permission to cancel Finished Goods Dispatch.';
  end if;
  select * into v_dispatch from public.factory_finished_good_dispatches
  where id = p_dispatch_id for update;
  if v_dispatch.id is null then raise exception 'Dispatch not found.'; end if;
  if lower(coalesce(v_dispatch.status, '')) <> 'draft' then
    raise exception 'Only Draft Finished Goods Dispatches can be cancelled.';
  end if;
  delete from public.factory_finished_good_dispatch_batch_allocations allocation
  using public.factory_finished_good_dispatch_items item
  where allocation.dispatch_item_id = item.id and item.dispatch_id = p_dispatch_id;
  update public.factory_finished_good_dispatches
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_dispatch_id;
  return p_dispatch_id;
end;
$$;
grant execute on function public.factory_cancel_finished_goods_dispatch(uuid) to authenticated;

revoke insert, update, delete on public.factory_finished_good_dispatches from authenticated;
drop policy if exists "factory finished goods dispatch insert" on public.factory_finished_good_dispatches;
drop policy if exists "factory finished goods dispatch update" on public.factory_finished_good_dispatches;

-- Dispatch structure is mutable only through the controlled create/update RPCs.
revoke insert, update, delete on public.factory_finished_good_dispatch_items from authenticated;
drop policy if exists "factory finished goods dispatch items manage" on public.factory_finished_good_dispatch_items;
drop policy if exists "factory finished goods dispatch items insert" on public.factory_finished_good_dispatch_items;
drop policy if exists "factory finished goods dispatch items update" on public.factory_finished_good_dispatch_items;
drop policy if exists "factory finished goods dispatch items delete" on public.factory_finished_good_dispatch_items;
revoke insert, update, delete on public.factory_finished_good_dispatch_batch_allocations from authenticated;

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
declare
  v_item jsonb;
  v_allocation jsonb;
  v_item_id uuid;
  v_finished_good_id uuid;
  v_production_id uuid;
  v_quantity numeric;
  v_allocation_quantity numeric;
  v_allocation_total numeric;
  v_batch_count integer;
  v_batch_no text;
  v_production public.factory_productions%rowtype;
  v_location public.factory_storage_locations%rowtype;
  v_used_quantity numeric;
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
    if jsonb_typeof(v_item->'allocations') <> 'array' or jsonb_array_length(v_item->'allocations') = 0 then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;

    insert into public.factory_finished_good_dispatch_items (
      dispatch_id, finished_good_id, quantity, batch_no, remarks, created_at
    ) values (
      p_dispatch_id, v_finished_good_id, v_quantity, '', coalesce(v_item->>'remarks', ''), now()
    ) returning id into v_item_id;

    v_allocation_total := 0;
    v_batch_count := 0;
    v_batch_no := null;

    for v_allocation in select * from jsonb_array_elements(v_item->'allocations')
    loop
      v_production_id := nullif(v_allocation->>'production_id', '')::uuid;
      v_allocation_quantity := nullif(v_allocation->>'quantity', '')::numeric;
      if v_production_id is null or v_allocation_quantity is null
        or v_allocation_quantity <= 0 or v_allocation_quantity <> trunc(v_allocation_quantity) then
        raise exception 'Batch allocation quantities must be whole numbers greater than 0.';
      end if;

      perform pg_advisory_xact_lock(hashtext('factory_finished_good_batch_' || v_production_id::text));
      select * into v_production
      from public.factory_productions production
      where production.id = v_production_id
      for update;

      if v_production.id is null
        or v_production.finished_good_id <> v_finished_good_id
        or lower(coalesce(v_production.status, '')) <> 'completed'
        or v_production.actual_pack_qty is null
        or v_production.actual_pack_qty <= 0 then
        raise exception 'Selected Production batch is unavailable.';
      end if;
      if v_production.expiry_date is not null and v_production.expiry_date < p_dispatch_date then
        raise exception 'Expired Production batches cannot be dispatched.';
      end if;

      select * into v_location
      from public.factory_storage_locations location
      where location.id = v_production.storage_location_id;
      if v_location.id is null
        or lower(coalesce(v_location.status, '')) <> 'active'
        or lower(coalesce(v_location.location_type, '')) <> 'finished goods area' then
        raise exception 'Selected Production batch is not in an active Finished Goods storage location.';
      end if;

      insert into public.factory_finished_good_dispatch_batch_allocations (
        dispatch_item_id, production_id, quantity, batch_no, manufacturing_date,
        expiry_date, storage_location_id, storage_location, storage_location_type
      ) values (
        v_item_id, v_production_id, v_allocation_quantity, v_production.batch_no,
        coalesce(v_production.manufacturing_date, v_production.production_date),
        v_production.expiry_date, v_production.storage_location_id,
        v_location.location_name, v_location.location_type
      );

      select coalesce(sum(allocation.quantity), 0)
      into v_used_quantity
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
      where allocation.production_id = v_production_id
        and dispatch.status <> 'cancelled';

      if v_used_quantity > v_production.actual_pack_qty then
        raise exception 'Batch % has insufficient available balance.', v_production.batch_no;
      end if;

      v_allocation_total := v_allocation_total + v_allocation_quantity;
      v_batch_count := v_batch_count + 1;
      v_batch_no := v_production.batch_no;
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

revoke all on function public.factory_replace_finished_good_dispatch_items(uuid, date, jsonb) from public, authenticated;

create or replace function public.factory_create_finished_good_dispatch(
  p_customer_id uuid,
  p_reference_no text,
  p_dispatch_date date,
  p_remarks text,
  p_created_by uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.factory_customers%rowtype;
  v_dispatch_id uuid;
  v_dispatch_no text;
  v_dispatch_date date := coalesce(p_dispatch_date, current_date);
  v_prefix text := 'D' || to_char(coalesce(p_dispatch_date, current_date), 'YYMMDD');
  v_next integer;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.create') then
    raise exception 'Missing permission: factory_finished_goods_dispatch.create';
  end if;

  select * into v_customer
  from public.factory_customers customer
  where customer.id = p_customer_id and customer.status = 'active';
  if v_customer.id is null then raise exception 'Active customer not found.'; end if;

  perform pg_advisory_xact_lock(hashtext('factory_dispatch_' || v_prefix));
  select coalesce(max(nullif(regexp_replace(dispatch.dispatch_no, '^' || v_prefix || '-', ''), '')::integer), 0) + 1
  into v_next
  from public.factory_finished_good_dispatches dispatch
  where dispatch.dispatch_no ~ ('^' || v_prefix || '-[0-9]+$');
  v_dispatch_no := v_prefix || '-' || lpad(v_next::text, 2, '0');

  insert into public.factory_finished_good_dispatches (
    dispatch_no, dispatch_date, customer_id, customer_name, reference_no,
    status, remarks, created_by, created_at, updated_at
  ) values (
    v_dispatch_no, v_dispatch_date, v_customer.id, v_customer.customer_name,
    coalesce(p_reference_no, ''), 'draft', coalesce(p_remarks, ''), p_created_by, now(), now()
  ) returning id into v_dispatch_id;

  perform public.factory_replace_finished_good_dispatch_items(v_dispatch_id, v_dispatch_date, p_items);
  return v_dispatch_id;
end;
$$;

create or replace function public.factory_update_finished_good_dispatch(
  p_dispatch_id uuid,
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
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_customer public.factory_customers%rowtype;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.edit') then
    raise exception 'Missing permission: factory_finished_goods_dispatch.edit';
  end if;
  select * into v_dispatch
  from public.factory_finished_good_dispatches dispatch
  where dispatch.id = p_dispatch_id
  for update;
  if v_dispatch.id is null then raise exception 'Dispatch not found.'; end if;
  if v_dispatch.status <> 'draft' then raise exception 'Only draft dispatches can be edited.'; end if;

  select * into v_customer
  from public.factory_customers customer
  where customer.id = p_customer_id and customer.status = 'active';
  if v_customer.id is null then raise exception 'Active customer not found.'; end if;

  update public.factory_finished_good_dispatches dispatch
  set dispatch_date = p_dispatch_date,
      customer_id = v_customer.id,
      customer_name = v_customer.customer_name,
      reference_no = coalesce(p_reference_no, ''),
      remarks = coalesce(p_remarks, ''),
      updated_at = now()
  where dispatch.id = p_dispatch_id;

  perform public.factory_replace_finished_good_dispatch_items(p_dispatch_id, p_dispatch_date, p_items);
  return p_dispatch_id;
end;
$$;

grant execute on function public.factory_create_finished_good_dispatch(uuid, text, date, text, uuid, jsonb) to authenticated;
grant execute on function public.factory_update_finished_good_dispatch(uuid, uuid, text, date, text, jsonb) to authenticated;

create or replace function public.factory_complete_finished_good_dispatch(p_dispatch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_item record;
  v_finished_good public.factory_finished_goods%rowtype;
  v_allocation_total numeric;
  v_allocation record;
  v_production public.factory_productions%rowtype;
  v_used_quantity numeric;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.complete') then
    raise exception 'Missing permission: factory_finished_goods_dispatch.complete';
  end if;
  select * into v_dispatch
  from public.factory_finished_good_dispatches dispatch
  where dispatch.id = p_dispatch_id
  for update;
  if v_dispatch.id is null then raise exception 'Dispatch not found.'; end if;
  if v_dispatch.status <> 'draft' then raise exception 'Only draft dispatches can be completed.'; end if;
  if not exists (
    select 1 from public.factory_finished_good_dispatch_items item where item.dispatch_id = p_dispatch_id
  ) then
    raise exception 'Dispatch must have at least one item.';
  end if;

  for v_item in
    select item.*
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
    order by item.created_at, item.id
  loop
    if coalesce(v_item.quantity, 0) <= 0 or v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'Dispatch item quantity must be a whole number greater than 0.';
    end if;
    select coalesce(sum(allocation.quantity), 0) into v_allocation_total
    from public.factory_finished_good_dispatch_batch_allocations allocation
    where allocation.dispatch_item_id = v_item.id;
    if v_allocation_total <> v_item.quantity then
      raise exception 'Confirm a complete batch allocation for every dispatch line.';
    end if;

    for v_allocation in
      select allocation.*
      from public.factory_finished_good_dispatch_batch_allocations allocation
      where allocation.dispatch_item_id = v_item.id
      order by allocation.created_at, allocation.id
    loop
      perform pg_advisory_xact_lock(hashtext('factory_finished_good_batch_' || v_allocation.production_id::text));
      select * into v_production
      from public.factory_productions production
      where production.id = v_allocation.production_id
      for update;
      if v_production.id is null
        or v_production.finished_good_id <> v_item.finished_good_id
        or lower(coalesce(v_production.status, '')) <> 'completed'
        or v_production.actual_pack_qty is null
        or v_production.actual_pack_qty <= 0
        or (v_production.expiry_date is not null and v_production.expiry_date < v_dispatch.dispatch_date) then
        raise exception 'Selected Production batch is unavailable or expired.';
      end if;
      if not exists (
        select 1
        from public.factory_storage_locations location
        where location.id = v_production.storage_location_id
          and lower(coalesce(location.status, '')) = 'active'
          and lower(coalesce(location.location_type, '')) = 'finished goods area'
      ) then
        raise exception 'Selected Production batch is not in an active Finished Goods storage location.';
      end if;
      select coalesce(sum(allocation.quantity), 0) into v_used_quantity
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
      where allocation.production_id = v_allocation.production_id
        and dispatch.status <> 'cancelled';
      if v_used_quantity > v_production.actual_pack_qty then
        raise exception 'Batch % has insufficient available balance.', v_production.batch_no;
      end if;
    end loop;

    select * into v_finished_good
    from public.factory_finished_goods finished_good
    where finished_good.id = v_item.finished_good_id
    for update;
    if v_finished_good.id is null then raise exception 'Packaging SKU not found.'; end if;
    if coalesce(v_finished_good.current_balance, 0) < v_item.quantity then
      raise exception 'Insufficient finished goods balance for %. Available %, requested %.',
        coalesce(v_finished_good.product_code, v_finished_good.product_name, 'Packaging SKU'),
        coalesce(v_finished_good.current_balance, 0), v_item.quantity;
    end if;

    update public.factory_finished_goods finished_good
    set current_balance = coalesce(finished_good.current_balance, 0) - v_item.quantity,
        updated_at = now()
    where finished_good.id = v_item.finished_good_id;

    insert into public.factory_product_stock_movements (
      finished_good_id, product_name, movement_type, quantity, uom,
      reference_type, reference_id, reference_no, movement_date, notes, created_by, dispatch_item_id
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

grant execute on function public.factory_complete_finished_good_dispatch(uuid) to authenticated;

-- Authoritative finished-goods batch ledger. Production, explicit stock-check
-- adjustments and the one-time legacy/unallocated reconciliation are separate
-- inventory sources; no synthetic Production records are created.
create table if not exists public.factory_finished_good_batch_balances (
  id uuid primary key default gen_random_uuid(),
  finished_good_id uuid not null references public.factory_finished_goods(id) on delete restrict,
  production_id uuid references public.factory_productions(id) on delete restrict,
  source_type text not null,
  source_reference_id uuid,
  source_reference_no text,
  batch_no text not null,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid references public.factory_storage_locations(id) on delete restrict,
  storage_location text,
  storage_location_type text,
  opening_qty numeric not null default 0,
  current_balance numeric not null default 0,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_finished_good_batch_balances_source_type_check
    check (source_type in ('production', 'adjustment', 'legacy_unallocated'))
);

create unique index if not exists factory_finished_good_batch_balances_production_key
on public.factory_finished_good_batch_balances (production_id)
where production_id is not null;
create unique index if not exists factory_finished_good_batch_balances_adjustment_key
on public.factory_finished_good_batch_balances (finished_good_id, storage_location_id)
where source_type = 'adjustment';
create unique index if not exists factory_finished_good_batch_balances_legacy_key
on public.factory_finished_good_batch_balances (finished_good_id)
where source_type = 'legacy_unallocated';
create index if not exists factory_finished_good_batch_balances_fefo_idx
on public.factory_finished_good_batch_balances
  (finished_good_id, expiry_date, manufacturing_date, batch_no, id);

alter table public.factory_finished_good_batch_balances enable row level security;
grant select on public.factory_finished_good_batch_balances to authenticated;
revoke insert, update, delete on public.factory_finished_good_batch_balances from authenticated;
drop policy if exists "factory finished good batch balances view" on public.factory_finished_good_batch_balances;
create policy "factory finished good batch balances view"
on public.factory_finished_good_batch_balances for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
  or public.current_user_has_permission('factory_product_stock_check.view')
  or public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

alter table public.factory_finished_good_dispatch_batch_allocations
  add column if not exists batch_balance_id uuid references public.factory_finished_good_batch_balances(id) on delete restrict;
alter table public.factory_finished_good_dispatch_batch_allocations
  alter column production_id drop not null;
create unique index if not exists factory_finished_good_dispatch_allocations_item_balance_key
on public.factory_finished_good_dispatch_batch_allocations (dispatch_item_id, batch_balance_id)
where batch_balance_id is not null;

create table if not exists public.factory_product_stock_check_batch_adjustments (
  id uuid primary key default gen_random_uuid(),
  stock_check_item_id uuid not null references public.factory_product_stock_check_items(id) on delete cascade,
  batch_balance_id uuid not null references public.factory_finished_good_batch_balances(id) on delete restrict,
  quantity numeric not null,
  created_at timestamptz not null default now(),
  constraint factory_product_stock_check_batch_adjustments_quantity_check
    check (quantity > 0 and quantity = trunc(quantity)),
  constraint factory_product_stock_check_batch_adjustments_item_batch_key
    unique (stock_check_item_id, batch_balance_id)
);
create index if not exists factory_product_stock_check_batch_adjustments_batch_idx
on public.factory_product_stock_check_batch_adjustments (batch_balance_id);
alter table public.factory_product_stock_check_batch_adjustments enable row level security;
grant select on public.factory_product_stock_check_batch_adjustments to authenticated;
revoke insert, update, delete on public.factory_product_stock_check_batch_adjustments from authenticated;
drop policy if exists "factory product stock check batch adjustments view" on public.factory_product_stock_check_batch_adjustments;
create policy "factory product stock check batch adjustments view"
on public.factory_product_stock_check_batch_adjustments for select to authenticated
using (
  public.current_user_has_permission('factory_product_stock_check.view')
  or public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

-- Stock Check allocation reads resolve the current location state through the
-- batch FK. This extends read access only; location mutations remain unchanged.
drop policy if exists "factory storage locations view" on public.factory_storage_locations;
create policy "factory storage locations view" on public.factory_storage_locations
for select to authenticated
using (
  public.current_user_has_permission('factory_dashboard.view')
  or public.current_user_has_permission('factory_raw_inventory.view')
  or public.current_user_has_permission('factory_raw_receiving.view')
  or public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_production.view')
  or public.current_user_has_permission('factory_production.complete')
  or public.current_user_has_permission('factory_batch_traceability.view')
  or public.current_user_has_permission('factory_storage_locations.view')
  or public.current_user_has_permission('factory_storage_locations.manage')
  or public.current_user_has_permission('factory_settings.manage')
  or public.current_user_has_permission('factory_product_stock_check.view')
  or public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.submit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
);

-- Packaging SKU batches are whole-pack ledgers. Stop before the first backfill
-- write if historical Production contains an incompatible fractional quantity.
do $$
declare v_fractional record;
begin
  select production.id, production.batch_no, production.finished_good_id,
    production.actual_pack_qty
  into v_fractional
  from public.factory_productions production
  where lower(coalesce(production.status, '')) = 'completed'
    and production.finished_good_id is not null
    and production.actual_pack_qty > 0
    and production.actual_pack_qty <> trunc(production.actual_pack_qty)
    and nullif(btrim(production.batch_no), '') is not null
  order by production.id
  limit 1;

  if found then
    raise exception 'Fractional historical Production pack quantities must be resolved before enabling batch inventory. Production ID: %, Batch No: %, Packaging SKU: %, Actual Pack Qty: %.',
      v_fractional.id,
      coalesce(v_fractional.batch_no, '(blank)'),
      v_fractional.finished_good_id,
      v_fractional.actual_pack_qty;
  end if;
end;
$$;

-- Existing Production output becomes Production batch inventory. Completed legacy
-- dispatches with an unambiguous batch reference are deducted; the residual is
-- represented explicitly, preserving the aggregate SKU balance exactly.
insert into public.factory_finished_good_batch_balances (
  finished_good_id, production_id, source_type, source_reference_id,
  source_reference_no, batch_no, manufacturing_date, expiry_date,
  storage_location_id, storage_location, storage_location_type,
  opening_qty, current_balance, remarks
)
select production.finished_good_id, production.id, 'production', production.id,
  production.production_no, production.batch_no,
  coalesce(production.manufacturing_date, production.production_date), production.expiry_date,
  production.storage_location_id, location.location_name, location.location_type,
  production.actual_pack_qty, production.actual_pack_qty, 'Production batch inventory.'
from public.factory_productions production
left join public.factory_storage_locations location on location.id = production.storage_location_id
where lower(coalesce(production.status, '')) = 'completed'
  and production.finished_good_id is not null
  and production.actual_pack_qty > 0
  and nullif(btrim(production.batch_no), '') is not null
on conflict (production_id) where production_id is not null do nothing;

insert into public.factory_finished_good_batch_balances (
  finished_good_id, source_type, source_reference_no, batch_no,
  storage_location_id, storage_location, storage_location_type,
  opening_qty, current_balance, remarks
)
select finished_good.id, 'legacy_unallocated', 'MIGRATION-202608040010',
  'UNALLOCATED-' || coalesce(nullif(finished_good.product_code, ''), left(finished_good.id::text, 8)),
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area'
       then location.id end,
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area'
       then location.location_name end,
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area'
       then location.location_type end,
  finished_good.current_balance - coalesce(batch.total, 0),
  finished_good.current_balance - coalesce(batch.total, 0),
  'Explicit legacy/unallocated reconciliation bucket; review before dispatch.'
from public.factory_finished_goods finished_good
left join public.factory_storage_locations location on location.id = finished_good.storage_location_id
left join (
  select finished_good_id, sum(current_balance) as total
  from public.factory_finished_good_batch_balances group by finished_good_id
) batch on batch.finished_good_id = finished_good.id
where finished_good.current_balance <> coalesce(batch.total, 0)
on conflict (finished_good_id) where source_type = 'legacy_unallocated' do nothing;

create or replace function public.factory_capture_completed_production_batch()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_location public.factory_storage_locations%rowtype;
begin
  if lower(coalesce(new.status, '')) <> 'completed' or new.finished_good_id is null
    or coalesce(new.actual_pack_qty, 0) <= 0 or nullif(btrim(new.batch_no), '') is null then
    return new;
  end if;
  select * into v_location from public.factory_storage_locations where id = new.storage_location_id;
  insert into public.factory_finished_good_batch_balances (
    finished_good_id, production_id, source_type, source_reference_id, source_reference_no,
    batch_no, manufacturing_date, expiry_date, storage_location_id, storage_location,
    storage_location_type, opening_qty, current_balance, remarks
  ) values (
    new.finished_good_id, new.id, 'production', new.id, new.production_no,
    new.batch_no, coalesce(new.manufacturing_date, new.production_date), new.expiry_date,
    new.storage_location_id, v_location.location_name, v_location.location_type,
    new.actual_pack_qty, new.actual_pack_qty, 'Production batch inventory.'
  ) on conflict (production_id) where production_id is not null do nothing;
  return new;
end;
$$;
drop trigger if exists factory_capture_completed_production_batch on public.factory_productions;
create trigger factory_capture_completed_production_batch
after insert on public.factory_productions for each row
execute function public.factory_capture_completed_production_batch();

create or replace function public.factory_get_finished_good_inventory_reconciliation(
  p_finished_good_id uuid default null
)
returns table (
  finished_good_id uuid, aggregate_balance numeric, production_balance numeric,
  adjustment_balance numeric, legacy_unallocated_balance numeric,
  batch_balance numeric, variance numeric, reconciliation_status text
)
language plpgsql security definer set search_path = public as $$
begin
  if not (
    public.current_user_has_permission('factory_finished_goods.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
    or public.current_user_has_permission('factory_product_stock_check.view')
    or public.current_user_has_permission('factory_product_stock_check.approve')
  ) then
    raise exception using errcode = '42501', message = 'Insufficient permission to reconcile Finished Goods inventory.';
  end if;
  return query
  select finished_good.id, coalesce(finished_good.current_balance, 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'production'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'adjustment'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0),
    coalesce(sum(balance.current_balance), 0),
    coalesce(finished_good.current_balance, 0) - coalesce(sum(balance.current_balance), 0),
    case
      when abs(coalesce(finished_good.current_balance, 0) - coalesce(sum(balance.current_balance), 0)) > 0.0001 then 'unreconciled'
      when coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0) <> 0 then 'legacy_unallocated'
      else 'reconciled'
    end
  from public.factory_finished_goods finished_good
  left join public.factory_finished_good_batch_balances balance on balance.finished_good_id = finished_good.id
  where p_finished_good_id is null or finished_good.id = p_finished_good_id
  group by finished_good.id, finished_good.current_balance;
end;
$$;
grant execute on function public.factory_get_finished_good_inventory_reconciliation(uuid) to authenticated;

-- Authoritative, parent-paginated Finished Goods batch traceability. Dispatch
-- allocations are aggregated per batch inside the statement, so PostgREST
-- pagination never truncates or duplicates child allocation history.
create or replace function public.factory_list_finished_good_batch_traceability(
  p_date_from date default null,
  p_date_to date default null,
  p_finished_good_id uuid default null,
  p_batch_no text default null,
  p_batch_type text default null,
  p_expiry_status text default null,
  p_storage_location_id uuid default null,
  p_reconciliation_status text default null,
  p_search text default null
)
returns table (
  id uuid,
  batch_balance_id uuid,
  batch_type text,
  finished_good_id uuid,
  packaging_sku_code text,
  packaging_sku_name text,
  finished_good_name text,
  batch_no text,
  original_qty numeric,
  completed_dispatch_qty numeric,
  completed_negative_adjustment_qty numeric,
  current_balance numeric,
  provisional_draft_qty numeric,
  production_start_date date,
  production_start_time time,
  manufacturing_date date,
  expiry_date date,
  storage_location_id uuid,
  storage_location_name text,
  storage_location_type text,
  storage_location_status text,
  production_id uuid,
  source_reference_id uuid,
  source_reference text,
  source_reason text,
  production_reference text,
  recipe_version text,
  sop_name text,
  sop_version text,
  qc_status text,
  operator_name text,
  reconciliation_status text,
  dispatch_allocations jsonb,
  diagnostics jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_permission('factory_batch_traceability.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Batch Traceability.';
  end if;

  return query
  with dispatch_totals as (
    select allocation.batch_balance_id,
      coalesce(sum(allocation.quantity) filter (where lower(coalesce(dispatch.status, '')) = 'completed'), 0) as completed_qty,
      coalesce(sum(allocation.quantity) filter (where lower(coalesce(dispatch.status, '')) = 'draft'), 0) as provisional_qty,
      coalesce(jsonb_agg(jsonb_build_object(
        'allocation_id', allocation.id,
        'dispatch_id', dispatch.id,
        'dispatch_item_id', item.id,
        'dispatch_no', dispatch.dispatch_no,
        'customer_id', dispatch.customer_id,
        'customer', dispatch.customer_name,
        'dispatch_date', dispatch.dispatch_date,
        'quantity', allocation.quantity,
        'dispatch_status', dispatch.status
      ) order by dispatch.dispatch_date desc, dispatch.created_at desc, allocation.id desc)
        filter (where lower(coalesce(dispatch.status, '')) = 'completed'), '[]'::jsonb) as completed_allocations
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    group by allocation.batch_balance_id
  ), negative_adjustments as (
    select adjustment.batch_balance_id,
      coalesce(sum(adjustment.quantity) filter (where lower(coalesce(stock_check.status, '')) = 'approved'), 0) as completed_qty
    from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
    group by adjustment.batch_balance_id
  ), sku_reconciliation as (
    select finished_good.id as finished_good_id,
      coalesce(finished_good.current_balance, 0) - coalesce(sum(balance.current_balance), 0) as variance,
      coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0) as legacy_balance
    from public.factory_finished_goods finished_good
    left join public.factory_finished_good_batch_balances balance on balance.finished_good_id = finished_good.id
    group by finished_good.id, finished_good.current_balance
  ), diagnostic_rollup as (
    select diagnostic.finished_good_id,
      count(*) filter (where diagnostic.diagnostic_status = 'ambiguous_match') as ambiguous_count,
      count(*) filter (where diagnostic.diagnostic_status = 'no_match') as unmatched_count
    from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
    group by diagnostic.finished_good_id
  ), base as (
    select balance.*,
      finished_good.product_code,
      coalesce(product_family.name_en, finished_good.product_name_en, finished_good.product_name) as family_name,
      coalesce(finished_good.product_name_en, finished_good.product_name) as sku_name,
      production.production_date as production_start_date,
      production.start_time as production_start_time,
      production.production_no,
      production.qc_status,
      production.operator_name,
      production.production_sop_id,
      sop.title as sop_name,
      coalesce(production.sop_version, sop.version) as linked_sop_version,
      sop.recipe_version as linked_recipe_version,
      location.location_name as current_location_name,
      location.location_type as current_location_type,
      location.status as current_location_status,
      coalesce(dispatch_totals.completed_qty, 0) as dispatch_qty,
      coalesce(dispatch_totals.provisional_qty, 0) as draft_qty,
      coalesce(dispatch_totals.completed_allocations, '[]'::jsonb) as dispatch_history,
      coalesce(negative_adjustments.completed_qty, 0) as negative_adjustment_qty,
      case
        when abs(coalesce(sku_reconciliation.variance, 0)) > 0.0001 then 'mismatch'
        when coalesce(diagnostic_rollup.ambiguous_count, 0) > 0 or coalesce(diagnostic_rollup.unmatched_count, 0) > 0 then 'review_required'
        when coalesce(sku_reconciliation.legacy_balance, 0) > 0 then 'legacy_unallocated'
        else 'reconciled'
      end as reconciliation,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'diagnostic_id', diagnostic.id,
          'status', diagnostic.diagnostic_status,
          'dispatch_id', diagnostic.dispatch_id,
          'dispatch_no', diagnostic.dispatch_no,
          'dispatch_item_id', diagnostic.dispatch_item_id,
          'packaging_sku_id', diagnostic.finished_good_id,
          'legacy_batch_reference', diagnostic.legacy_batch_reference,
          'affected_quantity', diagnostic.affected_quantity,
          'matching_batch_count', diagnostic.matching_production_count,
          'message', case diagnostic.diagnostic_status
            when 'ambiguous_match' then 'Historical batch reference matches multiple Production batches.'
            when 'no_match' then 'Historical batch reference does not match a Production batch.'
            else 'Historical batch reference uniquely matched a Production batch.'
          end
        ) order by diagnostic.dispatch_no, diagnostic.dispatch_item_id)
        from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
        where diagnostic.finished_good_id = balance.finished_good_id
          and (
            diagnostic.legacy_batch_reference = balance.batch_no
            or balance.source_type = 'legacy_unallocated'
          )
      ), '[]'::jsonb) as batch_diagnostics
    from public.factory_finished_good_batch_balances balance
    join public.factory_finished_goods finished_good on finished_good.id = balance.finished_good_id
    left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
    left join public.factory_productions production on production.id = balance.production_id
    left join public.factory_production_sops sop on sop.id = production.production_sop_id
    left join public.factory_storage_locations location on location.id = balance.storage_location_id
    left join dispatch_totals on dispatch_totals.batch_balance_id = balance.id
    left join negative_adjustments on negative_adjustments.batch_balance_id = balance.id
    left join sku_reconciliation on sku_reconciliation.finished_good_id = balance.finished_good_id
    left join diagnostic_rollup on diagnostic_rollup.finished_good_id = balance.finished_good_id
  )
  select base.id, base.id, base.source_type, base.finished_good_id,
    base.product_code, base.sku_name, base.family_name, base.batch_no,
    base.opening_qty, base.dispatch_qty, base.negative_adjustment_qty,
    base.current_balance, base.draft_qty,
    base.production_start_date, base.production_start_time,
    base.manufacturing_date, base.expiry_date,
    base.storage_location_id,
    coalesce(base.current_location_name, base.storage_location),
    coalesce(base.current_location_type, base.storage_location_type),
    base.current_location_status,
    base.production_id, base.source_reference_id, base.source_reference_no,
    base.remarks, base.production_no,
    base.linked_recipe_version, base.sop_name, base.linked_sop_version,
    base.qc_status, base.operator_name, base.reconciliation,
    base.dispatch_history, base.batch_diagnostics, base.created_at
  from base
  where (p_date_from is null or base.manufacturing_date >= p_date_from)
    and (p_date_to is null or base.manufacturing_date <= p_date_to)
    and (p_finished_good_id is null or base.finished_good_id = p_finished_good_id)
    and (nullif(btrim(p_batch_no), '') is null or base.batch_no ilike '%' || btrim(p_batch_no) || '%')
    and (nullif(btrim(p_batch_type), '') is null or base.source_type = lower(btrim(p_batch_type)))
    and (p_storage_location_id is null or base.storage_location_id = p_storage_location_id)
    and (nullif(btrim(p_reconciliation_status), '') is null or base.reconciliation = lower(btrim(p_reconciliation_status)))
    and (
      nullif(btrim(p_expiry_status), '') is null
      or (lower(btrim(p_expiry_status)) = 'expired' and base.expiry_date < current_date)
      or (lower(btrim(p_expiry_status)) = 'expiring_30' and base.expiry_date between current_date and current_date + 30)
      or (lower(btrim(p_expiry_status)) = 'valid' and base.expiry_date > current_date + 30)
      or (lower(btrim(p_expiry_status)) = 'no_expiry' and base.expiry_date is null)
    )
    and (
      nullif(btrim(p_search), '') is null
      or concat_ws(' ', base.batch_no, base.product_code, base.sku_name, base.family_name,
        base.source_reference_no, base.production_no, base.current_location_name) ilike '%' || btrim(p_search) || '%'
    )
  order by base.manufacturing_date desc nulls last, base.created_at desc, base.id desc;
end;
$$;

revoke all on function public.factory_list_finished_good_batch_traceability(date, date, uuid, text, text, text, uuid, text, text) from public;
grant execute on function public.factory_list_finished_good_batch_traceability(date, date, uuid, text, text, text, uuid, text, text) to authenticated;

create or replace function public.factory_finished_good_batch_traceability_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_finished_good_id uuid default null,
  p_batch_no text default null,
  p_batch_type text default null,
  p_expiry_status text default null,
  p_storage_location_id uuid default null,
  p_reconciliation_status text default null,
  p_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as materialized (
    select * from public.factory_list_finished_good_batch_traceability(
      p_date_from, p_date_to, p_finished_good_id, p_batch_no, p_batch_type,
      p_expiry_status, p_storage_location_id, p_reconciliation_status, p_search
    )
  )
  select jsonb_build_object(
    'batches', count(*),
    'available', count(*) filter (where current_balance > 0 and (expiry_date is null or expiry_date >= current_date)),
    'depleted', count(*) filter (where current_balance <= 0),
    'warnings', count(*) filter (where reconciliation_status in ('mismatch', 'review_required') or expiry_date < current_date),
    'remaining_qty', coalesce(sum(current_balance), 0)
  ) from filtered;
$$;

revoke all on function public.factory_finished_good_batch_traceability_summary(date, date, uuid, text, text, text, uuid, text, text) from public;
grant execute on function public.factory_finished_good_batch_traceability_summary(date, date, uuid, text, text, text, uuid, text, text) to authenticated;

create or replace function public.factory_get_finished_good_dispatch_allocation_details(p_dispatch_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.current_user_has_permission('factory_finished_goods_dispatch.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Dispatch batch allocations.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'dispatch_id', item.dispatch_id,
    'dispatch_item_id', item.id,
    'allocation_id', allocation.id,
    'batch_balance_id', allocation.batch_balance_id,
    'production_id', allocation.production_id,
    'quantity', allocation.quantity,
    'batch_no', coalesce(balance.batch_no, allocation.batch_no),
    'batch_type', coalesce(balance.source_type, 'production'),
    'manufacturing_date', coalesce(balance.manufacturing_date, allocation.manufacturing_date),
    'expiry_date', coalesce(balance.expiry_date, allocation.expiry_date),
    'storage_location_id', coalesce(balance.storage_location_id, allocation.storage_location_id),
    'storage_location', coalesce(location.location_name, balance.storage_location, allocation.storage_location),
    'storage_location_type', coalesce(location.location_type, balance.storage_location_type, allocation.storage_location_type),
    'storage_location_status', location.status,
    'current_balance', balance.current_balance,
    'location_valid', location.id is not null
      and lower(coalesce(location.status, '')) = 'active'
      and lower(coalesce(location.location_type, '')) = 'finished goods area',
    'location_issue', case
      when coalesce(balance.storage_location_id, allocation.storage_location_id) is null or location.id is null then 'Storage location missing'
      when lower(coalesce(location.status, '')) <> 'active' then 'Storage location archived'
      when lower(coalesce(location.location_type, '')) <> 'finished goods area' then 'Storage location is not a Finished Goods Area'
      else '' end
  ) order by item.dispatch_id, item.created_at, item.id, allocation.created_at, allocation.id), '[]'::jsonb)
  into v_result
  from public.factory_finished_good_dispatch_batch_allocations allocation
  join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
  left join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
  left join public.factory_storage_locations location on location.id = coalesce(balance.storage_location_id, allocation.storage_location_id)
  where item.dispatch_id = any(coalesce(p_dispatch_ids, array[]::uuid[]));
  return v_result;
end;
$$;

revoke all on function public.factory_get_finished_good_dispatch_allocation_details(uuid[]) from public;
grant execute on function public.factory_get_finished_good_dispatch_allocation_details(uuid[]) to authenticated;

-- Replace the Product Movement read model only. Existing movement rows, signs,
-- quantities and running-balance arithmetic remain unchanged.
create index if not exists factory_product_movements_dispatch_trace_idx
on public.factory_product_stock_movements
  (reference_type, reference_id, finished_good_id, created_at, id);
create index if not exists factory_dispatch_items_trace_idx
on public.factory_finished_good_dispatch_items
  (dispatch_id, finished_good_id, created_at, id);

-- Historical Dispatch movements are linked only when one line matches the
-- referenced Dispatch, Packaging SKU and absolute movement quantity. Ambiguous
-- history remains null and is labelled as unresolved by the read model.
with historical_match as (
  select movement.id as movement_id,
    (array_agg(item.id order by item.id::text))[1] as dispatch_item_id
  from public.factory_product_stock_movements movement
  join public.factory_finished_good_dispatches dispatch
    on dispatch.id = movement.reference_id
   and dispatch.dispatch_no = movement.reference_no
  join public.factory_finished_good_dispatch_items item
    on item.dispatch_id = dispatch.id
   and item.finished_good_id = movement.finished_good_id
   and item.quantity = abs(movement.quantity)
  where lower(coalesce(movement.reference_type, '')) = 'finished_goods_dispatch'
    and movement.quantity < 0
    and movement.dispatch_item_id is null
  group by movement.id
  having count(*) = 1
)
update public.factory_product_stock_movements movement
set dispatch_item_id = historical_match.dispatch_item_id
from historical_match
where movement.id = historical_match.movement_id;

drop function if exists public.factory_product_movements_summary(date, date, text, uuid, text, text);
drop function if exists public.factory_list_product_movements(date, date, text, uuid, text, text);

create function public.factory_list_product_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_product_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null,
  p_batch_source_search text default null
)
returns table (
  id uuid, finished_good_id uuid, product_name text, movement_type text,
  quantity numeric, uom text, reference_type text, reference_id uuid,
  dispatch_item_id uuid, reference_no text, movement_date date, notes text, created_by uuid,
  created_at timestamptz, batch_no text, source_reference text,
  balance_after numeric, finished_good jsonb, batch_count bigint,
  total_allocated_qty numeric, batch_summary text, batch_allocations jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.current_user_has_permission('factory_product_movements.view') then
    raise exception using errcode = '42501', message = 'Insufficient permission to view Product Movements.';
  end if;

  return query
  with ledger as (
    select movement.*,
      production.batch_no as production_batch_no,
      coalesce(job_order.job_order_no, movement.reference_no) as source_reference,
      case when finished_good.id is null then null else coalesce(finished_good.current_balance, 0)
        - coalesce(sum(movement.quantity) over (
            partition by coalesce(movement.finished_good_id, movement.id)
            order by movement.movement_date desc, movement.created_at desc, movement.id desc
            rows between unbounded preceding and 1 preceding
          ), 0) end as balance_after,
      jsonb_build_object(
        'id', finished_good.id, 'product_code', finished_good.product_code,
        'product_name', finished_good.product_name, 'product_name_en', finished_good.product_name_en,
        'product_family_id', finished_good.product_family_id, 'variant_name', finished_good.variant_name,
        'packaging_type', finished_good.packaging_type, 'pack_size_qty', finished_good.pack_size_qty,
        'pack_size_uom', finished_good.pack_size_uom, 'base_qty', finished_good.base_qty,
        'base_uom', finished_good.base_uom, 'category_id', finished_good.category_id,
        'category', finished_good.category, 'uom', finished_good.uom,
        'current_balance', finished_good.current_balance,
        'category_ref', jsonb_build_object('name', category.name),
        'product_family', jsonb_build_object('name_en', product_family.name_en)
      ) as finished_good
    from public.factory_product_stock_movements movement
    left join public.factory_finished_goods finished_good on finished_good.id = movement.finished_good_id
    left join public.factory_finished_good_categories category on category.id = finished_good.category_id
    left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
    left join lateral (
      select production_row.id, production_row.batch_no, production_row.job_order_id
      from public.factory_productions production_row
      where production_row.id = movement.reference_id
        or (movement.reference_type = 'production' and production_row.production_no = movement.reference_no)
      order by (production_row.id = movement.reference_id) desc limit 1
    ) production on true
    left join public.factory_job_orders job_order on job_order.id = production.job_order_id
  ), enriched as (
    select ledger.*,
      coalesce(batch_data.allocations, '[]'::jsonb) as allocations,
      coalesce(batch_data.batch_count, 0) as allocation_count,
      coalesce(batch_data.total_qty, 0) as allocation_qty,
      case
        when coalesce(batch_data.batch_count, 0) > 1 then batch_data.batch_count::text || ' Batches'
        when coalesce(batch_data.batch_count, 0) = 1 and batch_data.single_type = 'adjustment' then 'Adjustment'
        when coalesce(batch_data.batch_count, 0) = 1 and batch_data.single_type = 'legacy_unallocated' then 'Legacy / Unallocated'
        when coalesce(batch_data.batch_count, 0) = 1 then batch_data.single_batch_no
        when ledger.reference_type = 'finished_goods_dispatch' and coalesce(batch_data.batch_count, 0) = 0 then 'Historical allocation unresolved'
        else ledger.production_batch_no
      end as resolved_batch_summary
    from ledger
    left join lateral (
      with raw_candidate as (
        select balance.id, balance.batch_no, balance.source_type, allocation.quantity,
          balance.expiry_date,
          coalesce(location.location_name, balance.storage_location) as storage_location,
          coalesce(location.location_type, balance.storage_location_type) as storage_location_type
        from public.factory_finished_good_dispatch_batch_allocations allocation
        join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
        join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
        join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
        left join public.factory_storage_locations location on location.id = balance.storage_location_id
        where ledger.reference_type = 'finished_goods_dispatch'
          and dispatch.id = ledger.reference_id
          and item.finished_good_id = ledger.finished_good_id
          and item.id = ledger.dispatch_item_id
          and lower(coalesce(dispatch.status, '')) = 'completed'
        union all
        select balance.id, balance.batch_no, balance.source_type, diagnostic.affected_quantity,
          balance.expiry_date,
          coalesce(location.location_name, balance.storage_location),
          coalesce(location.location_type, balance.storage_location_type)
        from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
        join public.factory_productions production
          on production.finished_good_id = diagnostic.finished_good_id
         and production.batch_no = diagnostic.legacy_batch_reference
         and lower(coalesce(production.status, '')) = 'completed'
        join public.factory_finished_good_batch_balances balance on balance.production_id = production.id
        left join public.factory_storage_locations location on location.id = balance.storage_location_id
        where ledger.reference_type = 'finished_goods_dispatch'
          and diagnostic.dispatch_item_id = ledger.dispatch_item_id
          and diagnostic.diagnostic_status = 'unique_match'
        union all
        select balance.id, balance.batch_no, balance.source_type, abs(ledger.quantity),
          balance.expiry_date, coalesce(location.location_name, balance.storage_location),
          coalesce(location.location_type, balance.storage_location_type)
        from public.factory_finished_good_batch_balances balance
        left join public.factory_storage_locations location on location.id = balance.storage_location_id
        where ledger.reference_type = 'production' and balance.production_id = ledger.reference_id
        union all
        select balance.id, balance.batch_no, balance.source_type, adjustment.quantity,
          balance.expiry_date, coalesce(location.location_name, balance.storage_location),
          coalesce(location.location_type, balance.storage_location_type)
        from public.factory_product_stock_check_batch_adjustments adjustment
        join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
        join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
        join public.factory_finished_good_batch_balances balance on balance.id = adjustment.batch_balance_id
        left join public.factory_storage_locations location on location.id = balance.storage_location_id
        where ledger.reference_type = 'product_stock_check'
          and stock_check.id = ledger.reference_id and item.finished_good_id = ledger.finished_good_id
        union all
        select balance.id, balance.batch_no, balance.source_type, abs(ledger.quantity),
          balance.expiry_date, coalesce(location.location_name, balance.storage_location),
          coalesce(location.location_type, balance.storage_location_type)
        from public.factory_finished_good_batch_balances balance
        left join public.factory_storage_locations location on location.id = balance.storage_location_id
        where ledger.reference_type = 'product_stock_check'
          and ledger.quantity > 0 and balance.source_type = 'adjustment'
          and balance.source_reference_id = ledger.reference_id
          and balance.finished_good_id = ledger.finished_good_id
      ), candidate as (
        select raw_candidate.id, raw_candidate.batch_no, raw_candidate.source_type,
          sum(raw_candidate.quantity) as quantity, raw_candidate.expiry_date,
          raw_candidate.storage_location, raw_candidate.storage_location_type
        from raw_candidate
        group by raw_candidate.id, raw_candidate.batch_no, raw_candidate.source_type,
          raw_candidate.expiry_date, raw_candidate.storage_location, raw_candidate.storage_location_type
      )
      select count(*) as batch_count, coalesce(sum(candidate.quantity), 0) as total_qty,
        min(candidate.batch_no) as single_batch_no, min(candidate.source_type) as single_type,
        jsonb_agg(jsonb_build_object(
          'batch_balance_id', candidate.id, 'batch_no', candidate.batch_no,
          'batch_type', candidate.source_type, 'quantity', candidate.quantity,
          'expiry_date', candidate.expiry_date, 'storage_location', candidate.storage_location,
          'storage_location_type', candidate.storage_location_type
        ) order by candidate.expiry_date asc nulls last, candidate.batch_no, candidate.id) as allocations
      from candidate
    ) batch_data on true
  )
  select enriched.id, enriched.finished_good_id, enriched.product_name, enriched.movement_type,
    enriched.quantity, enriched.uom, enriched.reference_type, enriched.reference_id,
    enriched.dispatch_item_id, enriched.reference_no, enriched.movement_date, enriched.notes, enriched.created_by,
    enriched.created_at, enriched.resolved_batch_summary, enriched.source_reference,
    enriched.balance_after, enriched.finished_good, enriched.allocation_count,
    enriched.allocation_qty, enriched.resolved_batch_summary, enriched.allocations
  from enriched
  where (p_date_from is null or enriched.movement_date >= p_date_from)
    and (p_date_to is null or enriched.movement_date <= p_date_to)
    and (nullif(btrim(p_product_search), '') is null or concat_ws(' ', enriched.product_name,
      enriched.finished_good ->> 'product_name', enriched.finished_good ->> 'product_name_en',
      enriched.finished_good ->> 'product_code', enriched.finished_good ->> 'variant_name',
      enriched.finished_good #>> '{product_family,name_en}') ilike '%' || btrim(p_product_search) || '%')
    and (p_category_id is null or (enriched.finished_good ->> 'category_id')::uuid = p_category_id)
    and (nullif(btrim(p_movement_type), '') is null or enriched.movement_type = p_movement_type)
    and (nullif(btrim(p_batch_source_search), '') is null or concat_ws(' ',
      enriched.resolved_batch_summary, enriched.reference_no, enriched.reference_type,
      enriched.source_reference, enriched.notes, enriched.allocations::text) ilike '%' || btrim(p_batch_source_search) || '%')
  order by enriched.movement_date desc, enriched.created_at desc, enriched.id desc;
end;
$$;

create function public.factory_product_movements_summary(
  p_date_from date default null, p_date_to date default null,
  p_product_search text default null, p_category_id uuid default null,
  p_movement_type text default null, p_batch_source_search text default null
)
returns jsonb language sql stable security invoker set search_path = public as $$
  with filtered as materialized (
    select * from public.factory_list_product_movements(p_date_from, p_date_to,
      p_product_search, p_category_id, p_movement_type, p_batch_source_search)
  ), filtered_skus as (
    select distinct on (finished_good_id) finished_good_id as id,
      finished_good ->> 'product_code' as product_code,
      finished_good ->> 'packaging_type' as packaging_type,
      finished_good -> 'pack_size_qty' as pack_size_qty,
      finished_good ->> 'pack_size_uom' as pack_size_uom,
      finished_good -> 'base_qty' as base_qty,
      finished_good ->> 'base_uom' as base_uom,
      finished_good -> 'current_balance' as current_balance
    from filtered where finished_good_id is not null order by finished_good_id
  ), movement_types as (
    select distinct movement_type from public.factory_product_stock_movements
    where nullif(btrim(movement_type), '') is not null
  ), category_options as (
    select distinct finished_good.category_id as id,
      coalesce(nullif(btrim(category.name), ''), nullif(btrim(finished_good.category), ''), 'Uncategorized') as name
    from public.factory_product_stock_movements movement
    join public.factory_finished_goods finished_good on finished_good.id = movement.finished_good_id
    left join public.factory_finished_good_categories category on category.id = finished_good.category_id
    where finished_good.category_id is not null
  )
  select jsonb_build_object(
    'stock_in_count', (select count(*) from filtered where quantity > 0),
    'stock_out_count', (select count(*) from filtered where quantity < 0),
    'filtered_skus', coalesce((select jsonb_agg(to_jsonb(row) order by row.product_code) from filtered_skus row), '[]'::jsonb),
    'movement_types', coalesce((select jsonb_agg(movement_type order by movement_type) from movement_types), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(row) order by row.name) from category_options row), '[]'::jsonb)
  );
$$;

revoke all on function public.factory_list_product_movements(date, date, text, uuid, text, text) from public;
revoke all on function public.factory_product_movements_summary(date, date, text, uuid, text, text) from public;
grant execute on function public.factory_list_product_movements(date, date, text, uuid, text, text) to authenticated;
grant execute on function public.factory_product_movements_summary(date, date, text, uuid, text, text) to authenticated;

-- Read contracts for operational SECURITY INVOKER surfaces. Batch Traceability
-- itself is encapsulated by its permission-checked SECURITY DEFINER RPC, so it
-- does not grant broad access to Dispatch or Stock Check source tables.
drop policy if exists "factory finished good batch balances view" on public.factory_finished_good_batch_balances;
create policy "factory finished good batch balances view"
on public.factory_finished_good_batch_balances for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
  or public.current_user_has_permission('factory_product_stock_check.view')
  or public.current_user_has_permission('factory_product_stock_check.create')
  or public.current_user_has_permission('factory_product_stock_check.edit')
  or public.current_user_has_permission('factory_product_stock_check.approve')
  or public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory dispatch batch allocations view" on public.factory_finished_good_dispatch_batch_allocations;
create policy "factory dispatch batch allocations view"
on public.factory_finished_good_dispatch_batch_allocations for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.create')
  or public.current_user_has_permission('factory_finished_goods_dispatch.edit')
  or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
  or public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory finished good batch diagnostics view" on public.factory_finished_good_batch_reconciliation_diagnostics;
create policy "factory finished good batch diagnostics view"
on public.factory_finished_good_batch_reconciliation_diagnostics for select to authenticated
using (
  public.current_user_has_permission('factory_finished_goods.view')
  or public.current_user_has_permission('factory_finished_goods_dispatch.view')
  or public.current_user_has_permission('factory_product_stock_check.view')
);

drop policy if exists "factory batch traceability finished goods read" on public.factory_finished_goods;
create policy "factory batch traceability finished goods read"
on public.factory_finished_goods for select to authenticated
using (
  public.current_user_has_permission('factory_batch_traceability.view')
  or public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory batch traceability product families read" on public.factory_product_families;
create policy "factory batch traceability product families read"
on public.factory_product_families for select to authenticated
using (public.current_user_has_permission('factory_batch_traceability.view'));

drop policy if exists "factory batch traceability sops read" on public.factory_production_sops;
create policy "factory batch traceability sops read"
on public.factory_production_sops for select to authenticated
using (public.current_user_has_permission('factory_batch_traceability.view'));

drop policy if exists "factory batch traceability dispatch read" on public.factory_finished_good_dispatches;
create policy "factory batch traceability dispatch read"
on public.factory_finished_good_dispatches for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory batch traceability dispatch items read" on public.factory_finished_good_dispatch_items;
create policy "factory batch traceability dispatch items read"
on public.factory_finished_good_dispatch_items for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory batch traceability stock checks read" on public.factory_product_stock_checks;
create policy "factory batch traceability stock checks read"
on public.factory_product_stock_checks for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory batch traceability stock check items read" on public.factory_product_stock_check_items;
create policy "factory batch traceability stock check items read"
on public.factory_product_stock_check_items for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
);

drop policy if exists "factory batch traceability stock check allocations read" on public.factory_product_stock_check_batch_adjustments;
create policy "factory batch traceability stock check allocations read"
on public.factory_product_stock_check_batch_adjustments for select to authenticated
using (
  public.current_user_has_permission('factory_product_movements.view')
);

drop function if exists public.factory_get_finished_good_batch_availability(uuid, uuid, date);
create or replace function public.factory_get_finished_good_batch_availability(
  p_finished_good_id uuid, p_dispatch_id uuid default null, p_dispatch_date date default null
)
returns table (
  batch_id uuid, production_id uuid, batch_type text, batch_no text, manufacturing_date date,
  expiry_date date, storage_location_id uuid, storage_location text,
  storage_location_type text, produced_qty numeric, allocated_qty numeric,
  provisional_qty numeric, available_qty numeric
)
language plpgsql security definer set search_path = public as $$
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
  return query
  with provisional as (
    select allocation.batch_balance_id,
      sum(allocation.quantity) filter (where dispatch.status = 'draft' and (p_dispatch_id is null or dispatch.id <> p_dispatch_id)) as dispatch_qty
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
  )
  select balance.id, balance.production_id, balance.source_type, balance.batch_no, balance.manufacturing_date,
    balance.expiry_date, balance.storage_location_id, balance.storage_location,
    balance.storage_location_type, balance.opening_qty,
    balance.opening_qty - balance.current_balance,
    coalesce(provisional.dispatch_qty, 0) + coalesce(check_provisional.quantity, 0),
    balance.current_balance
  from public.factory_finished_good_batch_balances balance
  join public.factory_storage_locations location on location.id = balance.storage_location_id
  left join provisional on provisional.batch_balance_id = balance.id
  left join check_provisional on check_provisional.batch_balance_id = balance.id
  where balance.finished_good_id = p_finished_good_id
    and balance.current_balance > 0
    and lower(coalesce(location.status, '')) = 'active'
    and lower(coalesce(location.location_type, '')) = 'finished goods area'
    and (p_dispatch_date is null or balance.expiry_date is null or balance.expiry_date >= p_dispatch_date)
  order by balance.expiry_date asc nulls last,
    balance.manufacturing_date asc nulls last,
    balance.batch_no asc,
    balance.id asc;
end;
$$;
grant execute on function public.factory_get_finished_good_batch_availability(uuid, uuid, date) to authenticated;

-- Install the hardened implementations after all compatibility replacements.
create or replace function public.factory_replace_finished_good_dispatch_items(
  p_dispatch_id uuid, p_dispatch_date date, p_items jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.factory_replace_finished_good_dispatch_items_ledger(p_dispatch_id, p_dispatch_date, p_items);
end;
$$;
revoke all on function public.factory_replace_finished_good_dispatch_items(uuid, date, jsonb) from public, authenticated;

create or replace function public.factory_complete_finished_good_dispatch(p_dispatch_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  return public.factory_complete_finished_good_dispatch_locked(p_dispatch_id);
end;
$$;
grant execute on function public.factory_complete_finished_good_dispatch(uuid) to authenticated;

-- Rebuild diagnostics from immutable completed Dispatch history. Explicitly
-- allocated rows are excluded so historical usage is never counted twice.
delete from public.factory_finished_good_batch_reconciliation_diagnostics
where diagnostic_key like 'legacy-dispatch:%';

insert into public.factory_finished_good_batch_reconciliation_diagnostics (
  diagnostic_key, dispatch_id, dispatch_item_id, finished_good_id,
  legacy_batch_reference, matching_production_count, affected_quantity,
  diagnostic_status, dispatch_no, updated_at
)
select
  'legacy-dispatch:' || item.id::text,
  dispatch.id,
  item.id,
  item.finished_good_id,
  nullif(btrim(item.batch_no), ''),
  match.match_count,
  item.quantity,
  case when match.match_count = 1 then 'unique_match'
       when match.match_count > 1 then 'ambiguous_match'
       else 'no_match' end,
  dispatch.dispatch_no,
  now()
from public.factory_finished_good_dispatch_items item
join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
cross join lateral (
  select count(*)::integer as match_count
  from public.factory_productions production
  where production.finished_good_id = item.finished_good_id
    and lower(coalesce(production.status, '')) = 'completed'
    and nullif(btrim(production.batch_no), '') = nullif(btrim(item.batch_no), '')
) match
where lower(coalesce(dispatch.status, '')) = 'completed'
  and not exists (
    select 1 from public.factory_finished_good_dispatch_batch_allocations allocation
    where allocation.dispatch_item_id = item.id
  )
on conflict (diagnostic_key) do update
set legacy_batch_reference = excluded.legacy_batch_reference,
    matching_production_count = excluded.matching_production_count,
    affected_quantity = excluded.affected_quantity,
    diagnostic_status = excluded.diagnostic_status,
    dispatch_no = excluded.dispatch_no,
    updated_at = now();

-- Production balances are assigned from immutable output and completed usage.
-- The assignment, rather than decrementing current_balance, makes reruns stable.
do $$
begin
  if exists (
    with legacy_usage as (
      select production.id as production_id, sum(diagnostic.affected_quantity) as quantity
      from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
      join public.factory_productions production
        on production.finished_good_id = diagnostic.finished_good_id
       and production.batch_no = diagnostic.legacy_batch_reference
       and lower(coalesce(production.status, '')) = 'completed'
      where diagnostic.diagnostic_status = 'unique_match'
      group by production.id
    ), explicit_dispatch_usage as (
      select balance.production_id, sum(allocation.quantity) as quantity
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
      join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
      where lower(coalesce(dispatch.status, '')) = 'completed' and balance.production_id is not null
      group by balance.production_id
    ), negative_adjustment_usage as (
      select balance.production_id, sum(adjustment.quantity) as quantity
      from public.factory_product_stock_check_batch_adjustments adjustment
      join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
      join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
      join public.factory_finished_good_batch_balances balance on balance.id = adjustment.batch_balance_id
      where lower(coalesce(stock_check.status, '')) = 'approved' and balance.production_id is not null
      group by balance.production_id
    )
    select 1 from public.factory_productions production
    left join legacy_usage on legacy_usage.production_id = production.id
    left join explicit_dispatch_usage on explicit_dispatch_usage.production_id = production.id
    left join negative_adjustment_usage on negative_adjustment_usage.production_id = production.id
    where lower(coalesce(production.status, '')) = 'completed'
      and production.actual_pack_qty
        - coalesce(legacy_usage.quantity, 0)
        - coalesce(explicit_dispatch_usage.quantity, 0)
        - coalesce(negative_adjustment_usage.quantity, 0) < 0
  ) then
    raise exception 'Historical completed usage exceeds a Production batch output. Resolve batch reconciliation diagnostics before applying migration.';
  end if;
end;
$$;

with legacy_usage as (
  select production.id as production_id, sum(diagnostic.affected_quantity) as quantity
  from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
  join public.factory_productions production
    on production.finished_good_id = diagnostic.finished_good_id
   and production.batch_no = diagnostic.legacy_batch_reference
   and lower(coalesce(production.status, '')) = 'completed'
  where diagnostic.diagnostic_status = 'unique_match'
  group by production.id
), explicit_dispatch_usage as (
  select balance.production_id, sum(allocation.quantity) as quantity
  from public.factory_finished_good_dispatch_batch_allocations allocation
  join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
  join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
  join public.factory_finished_good_batch_balances balance on balance.id = allocation.batch_balance_id
  where lower(coalesce(dispatch.status, '')) = 'completed' and balance.production_id is not null
  group by balance.production_id
), negative_adjustment_usage as (
  select balance.production_id, sum(adjustment.quantity) as quantity
  from public.factory_product_stock_check_batch_adjustments adjustment
  join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
  join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
  join public.factory_finished_good_batch_balances balance on balance.id = adjustment.batch_balance_id
  where lower(coalesce(stock_check.status, '')) = 'approved' and balance.production_id is not null
  group by balance.production_id
), calculated as (
  select production.*,
    production.actual_pack_qty
      - coalesce(legacy_usage.quantity, 0)
      - coalesce(explicit_dispatch_usage.quantity, 0)
      - coalesce(negative_adjustment_usage.quantity, 0) as calculated_balance
  from public.factory_productions production
  left join legacy_usage on legacy_usage.production_id = production.id
  left join explicit_dispatch_usage on explicit_dispatch_usage.production_id = production.id
  left join negative_adjustment_usage on negative_adjustment_usage.production_id = production.id
  where lower(coalesce(production.status, '')) = 'completed'
    and production.finished_good_id is not null
    and production.actual_pack_qty > 0
    and production.actual_pack_qty = trunc(production.actual_pack_qty)
    and nullif(btrim(production.batch_no), '') is not null
)
insert into public.factory_finished_good_batch_balances (
  finished_good_id, production_id, source_type, source_reference_id,
  source_reference_no, batch_no, manufacturing_date, expiry_date,
  storage_location_id, storage_location, storage_location_type,
  opening_qty, current_balance, remarks
)
select calculated.finished_good_id, calculated.id, 'production', calculated.id,
  calculated.production_no, calculated.batch_no,
  coalesce(calculated.manufacturing_date, calculated.production_date), calculated.expiry_date,
  calculated.storage_location_id, location.location_name, location.location_type,
  calculated.actual_pack_qty, calculated.calculated_balance, 'Production batch inventory.'
from calculated
left join public.factory_storage_locations location on location.id = calculated.storage_location_id
on conflict (production_id) where production_id is not null do update
set finished_good_id = excluded.finished_good_id,
    source_reference_id = excluded.source_reference_id,
    source_reference_no = excluded.source_reference_no,
    batch_no = excluded.batch_no,
    manufacturing_date = excluded.manufacturing_date,
    expiry_date = excluded.expiry_date,
    storage_location_id = excluded.storage_location_id,
    storage_location = excluded.storage_location,
    storage_location_type = excluded.storage_location_type,
    opening_qty = excluded.opening_qty,
    current_balance = excluded.current_balance,
    remarks = excluded.remarks,
    updated_at = now();

-- Reconstruct explicit Adjustment buckets from approved positive checks that
-- carry a destination snapshot. Older unsnapshotted adjustments remain in the
-- legacy/unallocated residual instead of being assigned speculatively.
with positive_adjustments as (
  select item.finished_good_id, item.adjustment_storage_location_id,
    sum(item.variance_qty) as opening_qty
  from public.factory_product_stock_check_items item
  join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
  where lower(coalesce(stock_check.status, '')) = 'approved'
    and item.variance_qty > 0 and item.adjustment_storage_location_id is not null
  group by item.finished_good_id, item.adjustment_storage_location_id
)
insert into public.factory_finished_good_batch_balances (
  finished_good_id, source_type, source_reference_no, batch_no,
  storage_location_id, storage_location, storage_location_type,
  opening_qty, current_balance, remarks
)
select positive.finished_good_id, 'adjustment', 'PRODUCT-STOCK-CHECK',
  'ADJ-' || coalesce(nullif(finished_good.product_code, ''), left(positive.finished_good_id::text, 8)),
  positive.adjustment_storage_location_id, location.location_name, location.location_type,
  positive.opening_qty, positive.opening_qty, 'Approved Product Stock Check adjustment inventory.'
from positive_adjustments positive
join public.factory_finished_goods finished_good on finished_good.id = positive.finished_good_id
join public.factory_storage_locations location on location.id = positive.adjustment_storage_location_id
on conflict (finished_good_id, storage_location_id) where source_type = 'adjustment' do update
set opening_qty = excluded.opening_qty,
    storage_location = excluded.storage_location,
    storage_location_type = excluded.storage_location_type,
    remarks = excluded.remarks,
    updated_at = now();

do $$
begin
  if exists (
    with completed_dispatch as (
      select allocation.batch_balance_id, sum(allocation.quantity) as quantity
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
      join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
      where lower(coalesce(dispatch.status, '')) = 'completed'
      group by allocation.batch_balance_id
    ), completed_adjustment as (
      select adjustment.batch_balance_id, sum(adjustment.quantity) as quantity
      from public.factory_product_stock_check_batch_adjustments adjustment
      join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
      join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
      where lower(coalesce(stock_check.status, '')) = 'approved'
      group by adjustment.batch_balance_id
    )
    select 1 from public.factory_finished_good_batch_balances balance
    left join completed_dispatch on completed_dispatch.batch_balance_id = balance.id
    left join completed_adjustment on completed_adjustment.batch_balance_id = balance.id
    where balance.source_type = 'adjustment'
      and balance.opening_qty - coalesce(completed_dispatch.quantity, 0)
        - coalesce(completed_adjustment.quantity, 0) < 0
  ) then
    raise exception 'Completed usage exceeds an Adjustment batch balance. Resolve batch reconciliation before applying migration.';
  end if;
end;
$$;

with completed_dispatch as (
  select allocation.batch_balance_id, sum(allocation.quantity) as quantity
  from public.factory_finished_good_dispatch_batch_allocations allocation
  join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
  join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
  where lower(coalesce(dispatch.status, '')) = 'completed'
  group by allocation.batch_balance_id
), completed_adjustment as (
  select adjustment.batch_balance_id, sum(adjustment.quantity) as quantity
  from public.factory_product_stock_check_batch_adjustments adjustment
  join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
  join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
  where lower(coalesce(stock_check.status, '')) = 'approved'
  group by adjustment.batch_balance_id
)
update public.factory_finished_good_batch_balances balance
set current_balance = balance.opening_qty
    - coalesce(completed_dispatch.quantity, 0)
    - coalesce(completed_adjustment.quantity, 0),
    updated_at = now()
from completed_dispatch full join completed_adjustment
  on completed_adjustment.batch_balance_id = completed_dispatch.batch_balance_id
where balance.source_type = 'adjustment'
  and balance.id = coalesce(completed_dispatch.batch_balance_id, completed_adjustment.batch_balance_id);

-- Adjustment buckets without completed usage still reset to opening quantity.
update public.factory_finished_good_batch_balances balance
set current_balance = balance.opening_qty, updated_at = now()
where balance.source_type = 'adjustment'
  and not exists (
    select 1 from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    join public.factory_finished_good_dispatches dispatch on dispatch.id = item.dispatch_id
    where allocation.batch_balance_id = balance.id and lower(coalesce(dispatch.status, '')) = 'completed'
  )
  and not exists (
    select 1 from public.factory_product_stock_check_batch_adjustments adjustment
    join public.factory_product_stock_check_items item on item.id = adjustment.stock_check_item_id
    join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
    where adjustment.batch_balance_id = balance.id and lower(coalesce(stock_check.status, '')) = 'approved'
  );

do $$
begin
  if exists (
    select 1
    from public.factory_finished_goods finished_good
    left join (
      select finished_good_id, sum(current_balance) as known_balance
      from public.factory_finished_good_batch_balances
      where source_type in ('production', 'adjustment')
      group by finished_good_id
    ) known on known.finished_good_id = finished_good.id
    where coalesce(finished_good.current_balance, 0) - coalesce(known.known_balance, 0) < 0
  ) then
    raise exception 'Known Production and Adjustment batch balances exceed aggregate Finished Goods balance. Resolve reconciliation before applying migration.';
  end if;
end;
$$;

insert into public.factory_finished_good_batch_balances (
  finished_good_id, source_type, source_reference_no, batch_no,
  storage_location_id, storage_location, storage_location_type,
  opening_qty, current_balance, remarks
)
select finished_good.id, 'legacy_unallocated', 'MIGRATION-202608040010',
  'UNALLOCATED-' || coalesce(nullif(finished_good.product_code, ''), left(finished_good.id::text, 8)),
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area' then location.id end,
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area' then location.location_name end,
  case when lower(coalesce(location.status, '')) = 'active'
         and lower(coalesce(location.location_type, '')) = 'finished goods area' then location.location_type end,
  coalesce(finished_good.current_balance, 0) - coalesce(known.known_balance, 0),
  coalesce(finished_good.current_balance, 0) - coalesce(known.known_balance, 0),
  'Explicit legacy/unallocated reconciliation bucket; review diagnostics before dispatch.'
from public.factory_finished_goods finished_good
left join public.factory_storage_locations location on location.id = finished_good.storage_location_id
left join (
  select finished_good_id, sum(current_balance) as known_balance
  from public.factory_finished_good_batch_balances
  where source_type in ('production', 'adjustment')
  group by finished_good_id
) known on known.finished_good_id = finished_good.id
on conflict (finished_good_id) where source_type = 'legacy_unallocated' do update
set storage_location_id = excluded.storage_location_id,
    storage_location = excluded.storage_location,
    storage_location_type = excluded.storage_location_type,
    opening_qty = excluded.opening_qty,
    current_balance = excluded.current_balance,
    remarks = excluded.remarks,
    updated_at = now();

drop function if exists public.factory_get_finished_good_inventory_reconciliation(uuid);
create or replace function public.factory_get_finished_good_inventory_reconciliation(
  p_finished_good_id uuid default null
)
returns table (
  finished_good_id uuid, aggregate_balance numeric, production_balance numeric,
  adjustment_balance numeric, legacy_unallocated_balance numeric,
  batch_balance numeric, variance numeric, reconciliation_status text,
  ambiguous_reference_count bigint, unmatched_reference_count bigint,
  affected_quantity numeric, affected_dispatch_references jsonb
)
language plpgsql security definer set search_path = public as $$
begin
  if not (
    public.current_user_has_permission('factory_finished_goods.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.view')
    or public.current_user_has_permission('factory_finished_goods_dispatch.complete')
    or public.current_user_has_permission('factory_product_stock_check.view')
    or public.current_user_has_permission('factory_product_stock_check.create')
    or public.current_user_has_permission('factory_product_stock_check.edit')
    or public.current_user_has_permission('factory_product_stock_check.approve')
  ) then raise exception using errcode = '42501', message = 'Insufficient permission to reconcile Finished Goods inventory.'; end if;
  return query
  with diagnostics as (
    select diagnostic.finished_good_id,
      count(*) filter (where diagnostic.diagnostic_status = 'ambiguous_match') as ambiguous_count,
      count(*) filter (where diagnostic.diagnostic_status = 'no_match') as unmatched_count,
      coalesce(sum(diagnostic.affected_quantity) filter (
        where diagnostic.diagnostic_status in ('ambiguous_match', 'no_match')), 0) as affected_qty,
      coalesce(jsonb_agg(jsonb_build_object(
        'dispatch_id', diagnostic.dispatch_id,
        'dispatch_item_id', diagnostic.dispatch_item_id,
        'dispatch_no', diagnostic.dispatch_no,
        'batch_reference', diagnostic.legacy_batch_reference,
        'status', diagnostic.diagnostic_status,
        'quantity', diagnostic.affected_quantity
      ) order by diagnostic.dispatch_no, diagnostic.dispatch_item_id) filter (
        where diagnostic.diagnostic_status in ('ambiguous_match', 'no_match')), '[]'::jsonb) as references
    from public.factory_finished_good_batch_reconciliation_diagnostics diagnostic
    group by diagnostic.finished_good_id
  )
  select finished_good.id, coalesce(finished_good.current_balance, 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'production'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'adjustment'), 0),
    coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0),
    coalesce(sum(balance.current_balance), 0),
    coalesce(finished_good.current_balance, 0) - coalesce(sum(balance.current_balance), 0),
    case
      when abs(coalesce(finished_good.current_balance, 0) - coalesce(sum(balance.current_balance), 0)) > 0.0001 then 'mismatch'
      when coalesce(diagnostics.ambiguous_count, 0) > 0 or coalesce(diagnostics.unmatched_count, 0) > 0 then 'review_required'
      when coalesce(sum(balance.current_balance) filter (where balance.source_type = 'legacy_unallocated'), 0) > 0 then 'legacy_unallocated'
      else 'reconciled' end,
    coalesce(diagnostics.ambiguous_count, 0), coalesce(diagnostics.unmatched_count, 0),
    coalesce(diagnostics.affected_qty, 0), coalesce(diagnostics.references, '[]'::jsonb)
  from public.factory_finished_goods finished_good
  left join public.factory_finished_good_batch_balances balance on balance.finished_good_id = finished_good.id
  left join diagnostics on diagnostics.finished_good_id = finished_good.id
  where p_finished_good_id is null or finished_good.id = p_finished_good_id
  group by finished_good.id, finished_good.current_balance,
    diagnostics.ambiguous_count, diagnostics.unmatched_count,
    diagnostics.affected_qty, diagnostics.references;
end;
$$;
grant execute on function public.factory_get_finished_good_inventory_reconciliation(uuid) to authenticated;
