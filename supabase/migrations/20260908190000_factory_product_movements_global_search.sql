-- One free-text Product Movement search must be an OR across the canonical
-- product/SKU and batch/source ledger dimensions. Keep the established read
-- RPCs unchanged for compatibility with any existing callers.
create function public.factory_list_product_movements_global_search(
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null
)
returns table (
  id uuid, finished_good_id uuid, product_name text, movement_type text,
  quantity numeric, uom text, reference_type text, reference_id uuid,
  dispatch_item_id uuid, reference_no text, movement_date date, notes text, created_by uuid,
  created_at timestamptz, batch_no text, source_reference text,
  balance_after numeric, finished_good jsonb, batch_count bigint,
  total_allocated_qty numeric, batch_summary text, batch_allocations jsonb,
  finished_good_name text, finished_good_name_cn text,
  storage_location_name text, storage_location_type text,
  storage_location_count bigint, missing_storage_location_count bigint,
  expiry_date date, earliest_expiry_date date, batch_metadata_diagnostic text
)
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.factory_list_product_movements(
    p_date_from, p_date_to, p_search, p_category_id, p_movement_type, null
  )
  union
  select *
  from public.factory_list_product_movements(
    p_date_from, p_date_to, null, p_category_id, p_movement_type, p_search
  );
$$;

create function public.factory_product_movements_global_search_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as materialized (
    select * from public.factory_list_product_movements_global_search(
      p_date_from, p_date_to, p_search, p_category_id, p_movement_type
    )
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

revoke all on function public.factory_list_product_movements_global_search(date, date, text, uuid, text) from public;
revoke all on function public.factory_product_movements_global_search_summary(date, date, text, uuid, text) from public;
grant execute on function public.factory_list_product_movements_global_search(date, date, text, uuid, text) to authenticated;
grant execute on function public.factory_product_movements_global_search_summary(date, date, text, uuid, text) to authenticated;
