-- Add exact batch presentation metadata to the Product Movement read model.
-- Stock quantities, balance calculations and movement posting are unchanged.

alter table public.factory_product_stock_movements
  add column if not exists stock_check_item_id uuid
    references public.factory_product_stock_check_items(id) on delete restrict;

create index if not exists factory_product_stock_movements_stock_check_item_idx
  on public.factory_product_stock_movements (stock_check_item_id)
  where stock_check_item_id is not null;

create or replace function public.factory_assign_product_movement_stock_check_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.stock_check_item_id is distinct from old.stock_check_item_id
      or (
        old.stock_check_item_id is not null
        and (
          new.reference_type is distinct from old.reference_type
          or new.reference_id is distinct from old.reference_id
          or new.finished_good_id is distinct from old.finished_good_id
        )
      ) then
      raise exception 'Product Movement Stock Check linkage is immutable.';
    end if;
    return new;
  end if;

  if lower(coalesce(new.reference_type, '')) = 'product_stock_check'
    and new.reference_id is not null
    and new.finished_good_id is not null
    and new.stock_check_item_id is null then
    select min(item.id::text)::uuid
    into v_item_id
    from public.factory_product_stock_check_items item
    where item.stock_check_id = new.reference_id
      and item.finished_good_id = new.finished_good_id
    having count(*) = 1;
    new.stock_check_item_id := v_item_id;
  end if;

  return new;
end;
$$;

drop trigger if exists factory_product_movement_stock_check_item_guard
  on public.factory_product_stock_movements;
create trigger factory_product_movement_stock_check_item_guard
before insert or update of stock_check_item_id, reference_type, reference_id, finished_good_id
on public.factory_product_stock_movements
for each row execute function public.factory_assign_product_movement_stock_check_item();

do $$
begin
  if to_regprocedure(
    'public.factory_list_product_movements_v1(date,date,text,uuid,text,text)'
  ) is null then
    alter function public.factory_list_product_movements(
      date, date, text, uuid, text, text
    ) rename to factory_list_product_movements_v1;
  end if;
end;
$$;

create or replace function public.factory_list_product_movements(
  p_date_from date default null,
  p_date_to date default null,
  p_product_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null,
  p_batch_source_search text default null
)
returns table (
  id uuid,
  finished_good_id uuid,
  product_name text,
  movement_type text,
  quantity numeric,
  uom text,
  reference_type text,
  reference_id uuid,
  dispatch_item_id uuid,
  reference_no text,
  movement_date date,
  notes text,
  created_by uuid,
  created_at timestamptz,
  batch_no text,
  source_reference text,
  balance_after numeric,
  finished_good jsonb,
  batch_count bigint,
  total_allocated_qty numeric,
  batch_summary text,
  batch_allocations jsonb,
  finished_good_name text,
  finished_good_name_cn text,
  storage_location_name text,
  storage_location_type text,
  storage_location_count bigint,
  missing_storage_location_count bigint,
  expiry_date date,
  earliest_expiry_date date,
  batch_metadata_diagnostic text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    movement.id,
    movement.finished_good_id,
    movement.product_name,
    movement.movement_type,
    movement.quantity,
    movement.uom,
    movement.reference_type,
    movement.reference_id,
    movement.dispatch_item_id,
    movement.reference_no,
    movement.movement_date,
    movement.notes,
    movement.created_by,
    movement.created_at,
    case when exact_batch.batch_count = 1 then exact_batch.single_batch_no end,
    movement.source_reference,
    movement.balance_after,
    movement.finished_good,
    coalesce(exact_batch.batch_count, 0),
    coalesce(exact_batch.total_qty, 0),
    case
      when exact_batch.batch_count > 1 then exact_batch.batch_count::text || ' Batches'
      when exact_batch.batch_count = 1 then exact_batch.single_batch_no
    end,
    coalesce(exact_batch.allocations, '[]'::jsonb),
    coalesce(
      nullif(btrim(product_family.name_en), ''),
      nullif(btrim(finished_good.product_name_en), ''),
      nullif(btrim(finished_good.product_name), ''),
      nullif(btrim(movement.product_name), '')
    ),
    coalesce(
      nullif(btrim(product_family.name_cn), ''),
      nullif(btrim(finished_good.product_name_cn), '')
    ),
    case
      when exact_batch.missing_storage_location_count = 0
       and exact_batch.storage_location_count = 1
      then exact_batch.single_storage_location
    end,
    case
      when exact_batch.missing_storage_location_count = 0
       and exact_batch.storage_location_count = 1
      then exact_batch.single_storage_location_type
    end,
    coalesce(exact_batch.storage_location_count, 0),
    coalesce(exact_batch.missing_storage_location_count, 0),
    case when exact_batch.batch_count = 1 then exact_batch.earliest_expiry_date end,
    exact_batch.earliest_expiry_date,
    case
      when coalesce(exact_batch.batch_count, 0) = 0
       and lower(coalesce(movement.reference_type, '')) in (
         'production', 'finished_goods_dispatch', 'product_stock_check'
       )
      then 'Historical allocation unresolved'
    end
  from public.factory_list_product_movements_v1(
    p_date_from,
    p_date_to,
    p_product_search,
    p_category_id,
    p_movement_type,
    null
  ) movement
  left join public.factory_product_stock_movements movement_link
    on movement_link.id = movement.id
  left join public.factory_finished_goods finished_good
    on finished_good.id = movement.finished_good_id
  left join public.factory_product_families product_family
    on product_family.id = finished_good.product_family_id
  left join lateral (
    with raw_allocation as (
      select balance.id, balance.batch_no, balance.source_type, allocation.quantity,
        balance.expiry_date, balance.storage_location_id,
        coalesce(location.location_name, balance.storage_location) as storage_location,
        coalesce(location.location_type, balance.storage_location_type) as storage_location_type
      from public.factory_finished_good_dispatch_batch_allocations allocation
      join public.factory_finished_good_dispatch_items dispatch_item
        on dispatch_item.id = allocation.dispatch_item_id
      join public.factory_finished_good_batch_balances balance
        on balance.id = allocation.batch_balance_id
      left join public.factory_storage_locations location
        on location.id = balance.storage_location_id
      where lower(coalesce(movement.reference_type, '')) = 'finished_goods_dispatch'
        and movement.reference_id is not null
        and movement.dispatch_item_id is not null
        and dispatch_item.id = movement.dispatch_item_id
        and dispatch_item.dispatch_id = movement.reference_id

      union all

      select balance.id, balance.batch_no, balance.source_type, abs(movement.quantity),
        balance.expiry_date, balance.storage_location_id,
        coalesce(location.location_name, balance.storage_location),
        coalesce(location.location_type, balance.storage_location_type)
      from public.factory_finished_good_batch_balances balance
      left join public.factory_storage_locations location
        on location.id = balance.storage_location_id
      where lower(coalesce(movement.reference_type, '')) = 'production'
        and movement.reference_id is not null
        and balance.production_id = movement.reference_id

      union all

      select balance.id, balance.batch_no, balance.source_type, adjustment.quantity,
        balance.expiry_date, balance.storage_location_id,
        coalesce(location.location_name, balance.storage_location),
        coalesce(location.location_type, balance.storage_location_type)
      from public.factory_product_stock_check_batch_adjustments adjustment
      join public.factory_finished_good_batch_balances balance
        on balance.id = adjustment.batch_balance_id
      left join public.factory_storage_locations location
        on location.id = balance.storage_location_id
      where lower(coalesce(movement.reference_type, '')) = 'product_stock_check'
        and movement_link.stock_check_item_id is not null
        and movement.quantity < 0
        and adjustment.stock_check_item_id = movement_link.stock_check_item_id

      union all

      select balance.id, balance.batch_no, balance.source_type, abs(movement.quantity),
        balance.expiry_date, balance.storage_location_id,
        coalesce(location.location_name, balance.storage_location),
        coalesce(location.location_type, balance.storage_location_type)
      from public.factory_product_stock_check_items stock_check_item
      join public.factory_finished_good_batch_balances balance
        on balance.source_type = 'adjustment'
       and balance.finished_good_id = stock_check_item.finished_good_id
       and balance.storage_location_id = stock_check_item.adjustment_storage_location_id
      left join public.factory_storage_locations location
        on location.id = balance.storage_location_id
      where lower(coalesce(movement.reference_type, '')) = 'product_stock_check'
        and movement_link.stock_check_item_id is not null
        and movement.quantity > 0
        and stock_check_item.id = movement_link.stock_check_item_id
    ), candidate as (
      select raw_allocation.id, raw_allocation.batch_no, raw_allocation.source_type,
        sum(raw_allocation.quantity) as quantity, raw_allocation.expiry_date,
        raw_allocation.storage_location_id, raw_allocation.storage_location,
        raw_allocation.storage_location_type
      from raw_allocation
      group by raw_allocation.id, raw_allocation.batch_no, raw_allocation.source_type,
        raw_allocation.expiry_date, raw_allocation.storage_location_id,
        raw_allocation.storage_location, raw_allocation.storage_location_type
    )
    select count(*) as batch_count,
      coalesce(sum(candidate.quantity), 0) as total_qty,
      min(candidate.batch_no) as single_batch_no,
      count(distinct candidate.storage_location_id) as storage_location_count,
      count(*) filter (where candidate.storage_location_id is null) as missing_storage_location_count,
      min(candidate.storage_location) as single_storage_location,
      min(candidate.storage_location_type) as single_storage_location_type,
      min(candidate.expiry_date) as earliest_expiry_date,
      jsonb_agg(jsonb_build_object(
        'batch_balance_id', candidate.id,
        'batch_no', candidate.batch_no,
        'batch_type', candidate.source_type,
        'quantity', candidate.quantity,
        'expiry_date', candidate.expiry_date,
        'storage_location_id', candidate.storage_location_id,
        'storage_location', candidate.storage_location,
        'storage_location_type', candidate.storage_location_type
      ) order by candidate.expiry_date asc nulls last, candidate.batch_no, candidate.id) as allocations
    from candidate
  ) exact_batch on true
  where nullif(btrim(p_batch_source_search), '') is null
     or concat_ws(' ',
       case
         when exact_batch.batch_count > 1 then exact_batch.batch_count::text || ' Batches'
         when exact_batch.batch_count = 1 then exact_batch.single_batch_no
       end,
       movement.reference_no,
       movement.source_reference,
       movement.notes,
       exact_batch.allocations::text
     ) ilike '%' || btrim(p_batch_source_search) || '%';
$$;

revoke all on function public.factory_list_product_movements_v1(
  date, date, text, uuid, text, text
) from public, anon;
grant execute on function public.factory_list_product_movements_v1(
  date, date, text, uuid, text, text
) to authenticated;

revoke all on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) from public, anon;
grant execute on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) to authenticated;

comment on function public.factory_list_product_movements(
  date, date, text, uuid, text, text
) is 'Returns Product Movements with ID-authoritative batch, storage and expiry metadata; unresolved history remains explicitly unresolved.';
