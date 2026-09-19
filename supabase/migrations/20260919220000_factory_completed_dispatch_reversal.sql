-- Canonical reversal for completed Finished Goods Dispatches.
-- Original dispatch evidence is immutable; reversal restores the exact allocated
-- batch/location rows and records an explicit positive ledger trail.

insert into public.permissions (code, module, description)
values ('factory_finished_goods_dispatch.reverse', 'Factory Finished Goods Dispatch', 'Reverse a completed Factory finished goods dispatch.')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code = 'factory_finished_goods_dispatch.reverse'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table if not exists public.factory_finished_good_dispatch_reversals (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null unique references public.factory_finished_good_dispatches(id) on delete restrict,
  request_id uuid not null unique,
  reason text not null check (nullif(btrim(reason), '') is not null),
  item_count integer not null check (item_count > 0),
  total_quantity numeric not null check (total_quantity > 0),
  reversed_by uuid not null references public.employees(id) on delete restrict,
  reversed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create table if not exists public.factory_finished_good_dispatch_reversal_items (
  id uuid primary key default gen_random_uuid(),
  reversal_id uuid not null references public.factory_finished_good_dispatch_reversals(id) on delete restrict,
  dispatch_item_id uuid not null references public.factory_finished_good_dispatch_items(id) on delete restrict,
  allocation_id uuid not null unique references public.factory_finished_good_dispatch_batch_allocations(id) on delete restrict,
  original_movement_id uuid not null references public.factory_product_stock_movements(id) on delete restrict,
  reversal_movement_id uuid not null unique references public.factory_product_stock_movements(id) on delete restrict,
  batch_balance_id uuid not null references public.factory_finished_good_batch_balances(id) on delete restrict,
  finished_good_id uuid not null references public.factory_finished_goods(id) on delete restrict,
  storage_location_id uuid not null references public.factory_storage_locations(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (reversal_id, allocation_id)
);

alter table public.factory_finished_good_dispatches
  add column if not exists reversal_id uuid unique references public.factory_finished_good_dispatch_reversals(id) on delete restrict,
  add column if not exists reversal_request_id uuid unique,
  add column if not exists reversal_reason text,
  add column if not exists reversed_by uuid references public.employees(id) on delete restrict,
  add column if not exists reversed_at timestamptz;

create index if not exists factory_finished_good_dispatch_reversal_items_reversal_idx
  on public.factory_finished_good_dispatch_reversal_items(reversal_id, created_at, id);
create index if not exists factory_finished_good_dispatch_reversal_items_batch_idx
  on public.factory_finished_good_dispatch_reversal_items(batch_balance_id);

alter table public.factory_finished_good_dispatch_reversals enable row level security;
alter table public.factory_finished_good_dispatch_reversal_items enable row level security;
revoke all on public.factory_finished_good_dispatch_reversals, public.factory_finished_good_dispatch_reversal_items from public, anon, authenticated;
grant select on public.factory_finished_good_dispatch_reversals, public.factory_finished_good_dispatch_reversal_items to authenticated;

create policy factory_finished_good_dispatch_reversals_select
on public.factory_finished_good_dispatch_reversals for select to authenticated
using (public.current_user_has_permission('factory_finished_goods_dispatch.view'));

create policy factory_finished_good_dispatch_reversal_items_select
on public.factory_finished_good_dispatch_reversal_items for select to authenticated
using (public.current_user_has_permission('factory_finished_goods_dispatch.view'));

create or replace function public.factory_reverse_finished_good_dispatch(
  p_dispatch_id uuid,
  p_reason text,
  p_request_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_dispatch public.factory_finished_good_dispatches%rowtype;
  v_existing public.factory_finished_good_dispatch_reversals%rowtype;
  v_reversal public.factory_finished_good_dispatch_reversals%rowtype;
  v_allocation record;
  v_movement_id uuid;
  v_original_movement_id uuid;
  v_original_movement_count integer;
  v_item_count integer;
  v_total_quantity numeric;
  v_aggregate numeric;
  v_batch_total numeric;
  v_business_date date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_finished_goods_dispatch.reverse') then
    raise exception using errcode = '42501', message = 'Finished Goods Dispatch reverse permission is required.';
  end if;
  if p_dispatch_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'Dispatch and reversal request identity are required.';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'Reversal reason is required.';
  end if;

  v_actor := public.factory_current_active_employee_id();
  perform pg_advisory_xact_lock(hashtextextended('factory_dispatch_reversal_request:' || p_request_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('factory_dispatch_reversal:' || p_dispatch_id::text, 0));

  select * into v_existing
  from public.factory_finished_good_dispatch_reversals reversal
  where reversal.request_id = p_request_id;
  if found then
    if v_existing.dispatch_id is distinct from p_dispatch_id then
      raise exception using errcode = '23505', message = 'Reversal request identity belongs to another Dispatch.';
    end if;
    return p_dispatch_id;
  end if;

  select * into v_dispatch
  from public.factory_finished_good_dispatches dispatch
  where dispatch.id = p_dispatch_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Finished Goods Dispatch not found.';
  end if;
  if lower(coalesce(v_dispatch.status, '')) = 'reversed' or v_dispatch.reversal_id is not null then
    raise exception using errcode = '23505', message = 'Finished Goods Dispatch has already been reversed.';
  end if;
  if lower(coalesce(v_dispatch.status, '')) <> 'completed' then
    raise exception using errcode = '22023', message = 'Only a completed Finished Goods Dispatch can be reversed.';
  end if;

  select count(*), coalesce(sum(item.quantity), 0)
  into v_item_count, v_total_quantity
  from public.factory_finished_good_dispatch_items item
  where item.dispatch_id = p_dispatch_id;
  if v_item_count = 0 or v_total_quantity <= 0 then
    raise exception using errcode = '23514', message = 'Dispatch has no reversible items.';
  end if;

  -- Lock every affected aggregate and all of its batch rows so reconciliation
  -- remains stable while exact source batches are restored.
  perform finished_good.id
  from public.factory_finished_goods finished_good
  where finished_good.id in (
    select distinct item.finished_good_id
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
  )
  order by finished_good.id
  for update;

  perform batch.id
  from public.factory_finished_good_batch_balances batch
  where batch.finished_good_id in (
    select distinct item.finished_good_id
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
  )
  order by batch.finished_good_id, batch.id
  for update;

  if exists (
    select 1
    from public.factory_finished_good_dispatch_items item
    left join lateral (
      select coalesce(sum(allocation.quantity), 0) quantity
      from public.factory_finished_good_dispatch_batch_allocations allocation
      where allocation.dispatch_item_id = item.id
    ) allocated on true
    where item.dispatch_id = p_dispatch_id
      and allocated.quantity is distinct from item.quantity
  ) then
    raise exception using errcode = '23514', message = 'Dispatch allocation evidence no longer reconciles to its item quantities.';
  end if;

  if exists (
    select 1
    from public.factory_finished_good_dispatch_batch_allocations allocation
    join public.factory_finished_good_dispatch_items item on item.id = allocation.dispatch_item_id
    left join public.factory_finished_good_batch_balances batch on batch.id = allocation.batch_balance_id
    where item.dispatch_id = p_dispatch_id
      and (
        batch.id is null
        or batch.finished_good_id is distinct from item.finished_good_id
        or batch.storage_location_id is null
        or allocation.storage_location_id is distinct from batch.storage_location_id
        or nullif(btrim(allocation.batch_no), '') is distinct from nullif(btrim(batch.batch_no), '')
        or allocation.quantity <= 0
      )
  ) then
    raise exception using errcode = '23514', message = 'Dispatch batch or original Location evidence is missing or no longer reconciles.';
  end if;

  for v_allocation in
    select item.id dispatch_item_id, item.finished_good_id, item.quantity item_quantity,
      allocation.id allocation_id, allocation.quantity allocation_quantity,
      allocation.batch_balance_id, batch.storage_location_id,
      finished_good.product_name, coalesce(finished_good.packaging_type, finished_good.uom, 'Pack') uom
    from public.factory_finished_good_dispatch_items item
    join public.factory_finished_good_dispatch_batch_allocations allocation on allocation.dispatch_item_id = item.id
    join public.factory_finished_good_batch_balances batch on batch.id = allocation.batch_balance_id
    join public.factory_finished_goods finished_good on finished_good.id = item.finished_good_id
    where item.dispatch_id = p_dispatch_id
    order by item.id, allocation.id
  loop
    select count(*), min(movement.id)
    into v_original_movement_count, v_original_movement_id
    from public.factory_product_stock_movements movement
    where lower(coalesce(movement.reference_type, '')) = 'finished_goods_dispatch'
      and movement.reference_id = p_dispatch_id
      and movement.dispatch_item_id = v_allocation.dispatch_item_id
      and movement.finished_good_id = v_allocation.finished_good_id
      and movement.quantity = -v_allocation.item_quantity;
    if v_original_movement_count <> 1 then
      raise exception using errcode = '23514', message = 'Original Dispatch stock-out movement is missing or ambiguous.';
    end if;

    update public.factory_finished_good_batch_balances
    set current_balance = current_balance + v_allocation.allocation_quantity,
        updated_at = clock_timestamp()
    where id = v_allocation.batch_balance_id;

    update public.factory_finished_goods
    set current_balance = current_balance + v_allocation.allocation_quantity,
        updated_at = clock_timestamp()
    where id = v_allocation.finished_good_id;

    insert into public.factory_product_stock_movements (
      finished_good_id, product_name, movement_type, quantity, uom,
      reference_type, reference_id, reference_no, movement_date, notes, created_by,
      finished_good_batch_balance_id
    ) values (
      v_allocation.finished_good_id, v_allocation.product_name, 'Dispatch Reversal',
      v_allocation.allocation_quantity, v_allocation.uom,
      'finished_goods_dispatch_reversal', p_dispatch_id, v_dispatch.dispatch_no,
      v_business_date, 'Reversal of ' || v_dispatch.dispatch_no || ': ' || v_reason,
      v_actor, v_allocation.batch_balance_id
    ) returning id into v_movement_id;

    if v_reversal.id is null then
      insert into public.factory_finished_good_dispatch_reversals (
        dispatch_id, request_id, reason, item_count, total_quantity, reversed_by
      ) values (
        p_dispatch_id, p_request_id, v_reason, v_item_count, v_total_quantity, v_actor
      ) returning * into v_reversal;
    end if;

    insert into public.factory_finished_good_dispatch_reversal_items (
      reversal_id, dispatch_item_id, allocation_id, original_movement_id,
      reversal_movement_id, batch_balance_id, finished_good_id,
      storage_location_id, quantity
    ) values (
      v_reversal.id, v_allocation.dispatch_item_id, v_allocation.allocation_id,
      v_original_movement_id, v_movement_id, v_allocation.batch_balance_id,
      v_allocation.finished_good_id, v_allocation.storage_location_id,
      v_allocation.allocation_quantity
    );
  end loop;

  for v_allocation in
    select distinct item.finished_good_id
    from public.factory_finished_good_dispatch_items item
    where item.dispatch_id = p_dispatch_id
  loop
    select current_balance into v_aggregate
    from public.factory_finished_goods
    where id = v_allocation.finished_good_id;
    select coalesce(sum(current_balance), 0) into v_batch_total
    from public.factory_finished_good_batch_balances
    where finished_good_id = v_allocation.finished_good_id;
    if v_aggregate is distinct from v_batch_total then
      raise exception using errcode = '23514', message = 'Finished Goods aggregate and batch balances do not reconcile; reversal was not applied.';
    end if;
  end loop;

  update public.factory_finished_good_dispatches
  set status = 'reversed', reversal_id = v_reversal.id,
      reversal_request_id = p_request_id, reversal_reason = v_reason,
      reversed_by = v_actor, reversed_at = v_reversal.reversed_at,
      updated_at = clock_timestamp()
  where id = p_dispatch_id;

  return p_dispatch_id;
end;
$$;

revoke all on function public.factory_reverse_finished_good_dispatch(uuid, text, uuid) from public, anon;
grant execute on function public.factory_reverse_finished_good_dispatch(uuid, text, uuid) to authenticated;

comment on function public.factory_reverse_finished_good_dispatch(uuid, text, uuid) is
  'Atomically reverses one completed Finished Goods Dispatch into its exact original batch/location balances with immutable linked evidence and idempotent request ownership.';

-- Extend the canonical Product Movement projection without duplicating its
-- established filters. Reversal and transfer movements own an exact batch row
-- directly; older movement types continue through the prior projection.
alter function public.factory_list_product_movements(date, date, text, uuid, text, text)
  rename to factory_list_product_movements_before_dispatch_reversal;

create function public.factory_list_product_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_product_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null,
  p_batch_source_search text default null
) returns table (
  id uuid, finished_good_id uuid, product_name text, movement_type text,
  quantity numeric, uom text, reference_type text, reference_id uuid,
  dispatch_item_id uuid, reference_no text, movement_date date, notes text,
  created_by uuid, created_at timestamptz, batch_no text, source_reference text,
  balance_after numeric, finished_good jsonb, batch_count bigint,
  total_allocated_qty numeric, batch_summary text, batch_allocations jsonb,
  finished_good_name text, finished_good_name_cn text,
  storage_location_name text, storage_location_type text,
  storage_location_count bigint, missing_storage_location_count bigint,
  expiry_date date, earliest_expiry_date date, batch_metadata_diagnostic text
) language sql stable security invoker set search_path = public as $$
  select base.id, base.finished_good_id, base.product_name, base.movement_type,
    base.quantity, base.uom, base.reference_type, base.reference_id,
    base.dispatch_item_id, base.reference_no, base.movement_date, base.notes,
    base.created_by, base.created_at,
    coalesce(direct_batch.batch_no, base.batch_no), base.source_reference,
    base.balance_after, base.finished_good,
    case when direct_batch.id is not null then 1::bigint else base.batch_count end,
    case when direct_batch.id is not null then abs(base.quantity) else base.total_allocated_qty end,
    coalesce(direct_batch.batch_no, base.batch_summary),
    case when direct_batch.id is not null then jsonb_build_array(jsonb_build_object(
      'batch_balance_id', direct_batch.id,
      'batch_no', direct_batch.batch_no,
      'batch_type', direct_batch.source_type,
      'quantity', abs(base.quantity),
      'expiry_date', direct_batch.expiry_date,
      'storage_location_id', direct_batch.storage_location_id,
      'storage_location', coalesce(location.location_name, direct_batch.storage_location),
      'storage_location_type', coalesce(location.location_type, direct_batch.storage_location_type)
    )) else base.batch_allocations end,
    base.finished_good_name, base.finished_good_name_cn,
    case when direct_batch.id is not null then coalesce(location.location_name, direct_batch.storage_location) else base.storage_location_name end,
    case when direct_batch.id is not null then coalesce(location.location_type, direct_batch.storage_location_type) else base.storage_location_type end,
    case when direct_batch.id is not null and direct_batch.storage_location_id is not null then 1::bigint else base.storage_location_count end,
    case when direct_batch.id is not null and direct_batch.storage_location_id is null then 1::bigint when direct_batch.id is not null then 0::bigint else base.missing_storage_location_count end,
    coalesce(direct_batch.expiry_date, base.expiry_date),
    coalesce(direct_batch.expiry_date, base.earliest_expiry_date),
    case when direct_batch.id is not null then null else base.batch_metadata_diagnostic end
  from public.factory_list_product_movements_before_dispatch_reversal(
    p_date_from, p_date_to, p_product_search, p_category_id,
    p_movement_type, null
  ) base
  left join public.factory_product_stock_movements movement on movement.id = base.id
  left join public.factory_finished_good_batch_balances direct_batch
    on direct_batch.id = movement.finished_good_batch_balance_id
  left join public.factory_storage_locations location
    on location.id = direct_batch.storage_location_id
  where nullif(btrim(p_batch_source_search), '') is null
    or concat_ws(' ', coalesce(direct_batch.batch_no, base.batch_summary),
      base.reference_no, base.source_reference, base.notes,
      coalesce(location.location_name, direct_batch.storage_location),
      base.batch_allocations::text) ilike '%' || btrim(p_batch_source_search) || '%';
$$;

revoke all on function public.factory_list_product_movements_before_dispatch_reversal(date, date, text, uuid, text, text) from public, anon;
grant execute on function public.factory_list_product_movements_before_dispatch_reversal(date, date, text, uuid, text, text) to authenticated;
revoke all on function public.factory_list_product_movements(date, date, text, uuid, text, text) from public, anon;
grant execute on function public.factory_list_product_movements(date, date, text, uuid, text, text) to authenticated;
