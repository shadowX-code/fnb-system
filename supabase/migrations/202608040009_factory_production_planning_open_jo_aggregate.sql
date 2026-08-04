-- Complete open Job Order reservations for Factory Production Planning.
-- The function is read-only and SECURITY INVOKER so factory_job_orders RLS
-- remains the authoritative row-access boundary.

create or replace function public.factory_get_open_job_order_qty_by_sku()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.current_user_has_permission('factory_job_orders.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Job Orders.';
  end if;

  with open_jobs as materialized (
    select
      job.id,
      job.finished_good_id as packaging_sku_id,
      job.target_pack_qty,
      coalesce(nullif(job.target_production_qty, 0), nullif(job.target_quantity, 0)) as production_quantity,
      lower(trim(coalesce(job.uom, ''))) as production_uom,
      coalesce(product.pack_size_qty, product.base_qty) as pack_size_quantity,
      lower(trim(coalesce(product.pack_size_uom, product.base_uom, ''))) as pack_size_uom,
      product.id as resolved_packaging_sku_id
    from public.factory_job_orders job
    left join public.factory_finished_goods product on product.id = job.finished_good_id
    where lower(trim(coalesce(job.status, ''))) in ('draft', 'planned', 'released', 'in_progress')
  ),
  normalized as (
    select
      open_job.*,
      case
        when open_job.production_uom in ('kg', 'kilogram', 'kilograms') then 'mass'
        when open_job.production_uom in ('g', 'gram', 'grams') then 'mass'
        when open_job.production_uom in ('l', 'litre', 'liter', 'litres', 'liters') then 'volume'
        when open_job.production_uom in ('ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then 'volume'
        when open_job.production_uom <> '' then open_job.production_uom
        else null
      end as production_uom_family,
      case
        when open_job.pack_size_uom in ('kg', 'kilogram', 'kilograms') then 'mass'
        when open_job.pack_size_uom in ('g', 'gram', 'grams') then 'mass'
        when open_job.pack_size_uom in ('l', 'litre', 'liter', 'litres', 'liters') then 'volume'
        when open_job.pack_size_uom in ('ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then 'volume'
        when open_job.pack_size_uom <> '' then open_job.pack_size_uom
        else null
      end as pack_size_uom_family,
      case
        when open_job.production_uom in ('g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then 0.001
        else 1
      end as production_factor,
      case
        when open_job.pack_size_uom in ('g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter', 'millilitres', 'milliliters') then 0.001
        else 1
      end as pack_size_factor
    from open_jobs open_job
  ),
  resolved as (
    select
      normalized.*,
      case
        when coalesce(normalized.target_pack_qty, 0) > 0 then normalized.target_pack_qty
        when coalesce(normalized.production_quantity, 0) > 0
          and coalesce(normalized.pack_size_quantity, 0) > 0
          and normalized.production_uom_family is not null
          and normalized.production_uom_family = normalized.pack_size_uom_family
          then (normalized.production_quantity * normalized.production_factor)
            / (normalized.pack_size_quantity * normalized.pack_size_factor)
        else null
      end as resolved_pack_quantity
    from normalized
  ),
  aggregates as (
    select
      resolved.packaging_sku_id,
      coalesce(sum(resolved.resolved_pack_quantity), 0) as open_job_order_qty,
      count(*)::bigint as open_job_order_count,
      count(*) filter (where resolved.resolved_pack_quantity is not null)::bigint as counted_job_order_count,
      count(*) filter (where resolved.resolved_pack_quantity is null)::bigint as invalid_job_order_count
    from resolved
    where resolved.packaging_sku_id is not null
    group by resolved.packaging_sku_id
  )
  select jsonb_build_object(
    'aggregates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'packaging_sku_id', agg.packaging_sku_id,
          'open_job_order_qty', agg.open_job_order_qty,
          'open_job_order_count', agg.open_job_order_count,
          'counted_job_order_count', agg.counted_job_order_count,
          'invalid_job_order_count', agg.invalid_job_order_count
        )
        order by agg.packaging_sku_id
      )
      from aggregates agg
    ), '[]'::jsonb),
    'diagnostics', jsonb_build_object(
      'qualifying_job_order_count', (select count(*) from resolved),
      'missing_packaging_sku_count', (
        select count(*)
        from resolved
        where resolved.packaging_sku_id is null or resolved.resolved_packaging_sku_id is null
      ),
      'invalid_quantity_count', (
        select count(*)
        from resolved
        where resolved.resolved_pack_quantity is null
      )
    )
  )
  into v_result;

  return coalesce(v_result, jsonb_build_object('aggregates', '[]'::jsonb, 'diagnostics', '{}'::jsonb));
end;
$$;

revoke all on function public.factory_get_open_job_order_qty_by_sku() from public;
grant execute on function public.factory_get_open_job_order_qty_by_sku() to authenticated;

comment on function public.factory_get_open_job_order_qty_by_sku() is
  'Returns complete pack-unit reservations for draft, legacy planned, released, and in-progress Factory Job Orders visible through caller RLS.';
