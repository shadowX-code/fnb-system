-- Read-only server pagination for the Product Movements ledger.
-- Running balances are derived over the complete ledger before filters are
-- applied. PostgREST applies range pagination to the filtered function result.

create index if not exists factory_product_stock_movements_ledger_order_idx
  on public.factory_product_stock_movements (movement_date desc, created_at desc, id desc);

create index if not exists factory_product_stock_movements_sku_ledger_order_idx
  on public.factory_product_stock_movements (finished_good_id, movement_date desc, created_at desc, id desc);

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
  reference_no text,
  movement_date date,
  notes text,
  created_by uuid,
  created_at timestamptz,
  batch_no text,
  source_reference text,
  balance_after numeric,
  finished_good jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with ledger as (
    select
      movement.id,
      movement.finished_good_id,
      movement.product_name,
      movement.movement_type,
      movement.quantity,
      movement.uom,
      movement.reference_type,
      movement.reference_id,
      movement.reference_no,
      movement.movement_date,
      movement.notes,
      movement.created_by,
      movement.created_at,
      production.batch_no,
      coalesce(job_order.job_order_no, movement.reference_no) as source_reference,
      case
        when finished_good.id is null then null
        else coalesce(finished_good.current_balance, 0)
          - coalesce(
              sum(movement.quantity) over (
                partition by coalesce(movement.finished_good_id, movement.id)
                order by movement.movement_date desc, movement.created_at desc, movement.id desc
                rows between unbounded preceding and 1 preceding
              ),
              0
            )
      end as balance_after,
      jsonb_build_object(
        'id', finished_good.id,
        'product_code', finished_good.product_code,
        'product_name', finished_good.product_name,
        'product_name_en', finished_good.product_name_en,
        'product_name_cn', finished_good.product_name_cn,
        'product_name_bm', finished_good.product_name_bm,
        'product_family_id', finished_good.product_family_id,
        'variant_name', finished_good.variant_name,
        'packaging_type', finished_good.packaging_type,
        'pack_size_qty', finished_good.pack_size_qty,
        'pack_size_uom', finished_good.pack_size_uom,
        'base_qty', finished_good.base_qty,
        'base_uom', finished_good.base_uom,
        'category_id', finished_good.category_id,
        'category', finished_good.category,
        'uom', finished_good.uom,
        'current_balance', finished_good.current_balance,
        'status', finished_good.status,
        'category_ref', jsonb_build_object('name', category.name),
        'product_family', jsonb_build_object('name_en', product_family.name_en)
      ) as finished_good
    from public.factory_product_stock_movements movement
    left join public.factory_finished_goods finished_good
      on finished_good.id = movement.finished_good_id
    left join public.factory_finished_good_categories category
      on category.id = finished_good.category_id
    left join public.factory_product_families product_family
      on product_family.id = finished_good.product_family_id
    left join lateral (
      select production_row.id, production_row.batch_no, production_row.job_order_id
      from public.factory_productions production_row
      where production_row.id = movement.reference_id
         or (
           movement.reference_type = 'production'
           and production_row.production_no = movement.reference_no
         )
      order by (production_row.id = movement.reference_id) desc
      limit 1
    ) production on true
    left join public.factory_job_orders job_order
      on job_order.id = production.job_order_id
  )
  select
    ledger.id,
    ledger.finished_good_id,
    ledger.product_name,
    ledger.movement_type,
    ledger.quantity,
    ledger.uom,
    ledger.reference_type,
    ledger.reference_id,
    ledger.reference_no,
    ledger.movement_date,
    ledger.notes,
    ledger.created_by,
    ledger.created_at,
    ledger.batch_no,
    ledger.source_reference,
    ledger.balance_after,
    ledger.finished_good
  from ledger
  where (p_date_from is null or ledger.movement_date >= p_date_from)
    and (p_date_to is null or ledger.movement_date <= p_date_to)
    and (
      nullif(btrim(p_product_search), '') is null
      or concat_ws(
        ' ',
        ledger.product_name,
        ledger.finished_good ->> 'product_name',
        ledger.finished_good ->> 'product_name_en',
        ledger.finished_good ->> 'product_code',
        ledger.finished_good ->> 'variant_name',
        ledger.finished_good #>> '{product_family,name_en}'
      ) ilike '%' || btrim(p_product_search) || '%'
    )
    and (p_category_id is null or (ledger.finished_good ->> 'category_id')::uuid = p_category_id)
    and (nullif(btrim(p_movement_type), '') is null or ledger.movement_type = p_movement_type)
    and (
      nullif(btrim(p_batch_source_search), '') is null
      or concat_ws(
        ' ',
        ledger.batch_no,
        ledger.reference_no,
        ledger.reference_type,
        ledger.source_reference,
        ledger.notes
      ) ilike '%' || btrim(p_batch_source_search) || '%'
    )
  order by ledger.movement_date desc, ledger.created_at desc, ledger.id desc;
$$;

create or replace function public.factory_product_movements_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_product_search text default null,
  p_category_id uuid default null,
  p_movement_type text default null,
  p_batch_source_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as materialized (
    select *
    from public.factory_list_product_movements(
      p_date_from,
      p_date_to,
      p_product_search,
      p_category_id,
      p_movement_type,
      p_batch_source_search
    )
  ),
  filtered_skus as (
    select distinct on (filtered.finished_good_id)
      filtered.finished_good_id as id,
      filtered.finished_good ->> 'product_code' as product_code,
      filtered.finished_good ->> 'packaging_type' as packaging_type,
      filtered.finished_good -> 'pack_size_qty' as pack_size_qty,
      filtered.finished_good ->> 'pack_size_uom' as pack_size_uom,
      filtered.finished_good -> 'base_qty' as base_qty,
      filtered.finished_good ->> 'base_uom' as base_uom,
      filtered.finished_good -> 'current_balance' as current_balance
    from filtered
    where filtered.finished_good_id is not null
    order by filtered.finished_good_id
  ),
  movement_types as (
    select distinct movement.movement_type
    from public.factory_product_stock_movements movement
    where nullif(btrim(movement.movement_type), '') is not null
  ),
  category_options as (
    select distinct
      finished_good.category_id as id,
      coalesce(nullif(btrim(category.name), ''), nullif(btrim(finished_good.category), ''), 'Uncategorized') as name
    from public.factory_product_stock_movements movement
    join public.factory_finished_goods finished_good
      on finished_good.id = movement.finished_good_id
    left join public.factory_finished_good_categories category
      on category.id = finished_good.category_id
    where finished_good.category_id is not null
  )
  select jsonb_build_object(
    'stock_in_count', (select count(*) from filtered where quantity > 0),
    'stock_out_count', (select count(*) from filtered where quantity < 0),
    'filtered_skus', coalesce(
      (select jsonb_agg(to_jsonb(filtered_sku) order by filtered_sku.product_code) from filtered_skus filtered_sku),
      '[]'::jsonb
    ),
    'movement_types', coalesce(
      (select jsonb_agg(movement_types.movement_type order by movement_types.movement_type) from movement_types),
      '[]'::jsonb
    ),
    'categories', coalesce(
      (select jsonb_agg(to_jsonb(category_option) order by category_option.name) from category_options category_option),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.factory_list_product_movements(date, date, text, uuid, text, text) from public;
revoke all on function public.factory_product_movements_summary(date, date, text, uuid, text, text) from public;
grant execute on function public.factory_list_product_movements(date, date, text, uuid, text, text) to authenticated;
grant execute on function public.factory_product_movements_summary(date, date, text, uuid, text, text) to authenticated;
