-- Project exact persisted Raw Material batch allocations into Finished Goods Batch Traceability.
-- Historical Production without allocation rows remains explicitly unavailable; no usage is inferred.

create or replace function public.factory_get_finished_good_batch_traceability_detail(
  p_batch_balance_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_detail jsonb;
begin
  if not public.current_user_has_permission('factory_batch_traceability.view') then
    raise exception using
      errcode = '42501',
      message = 'Insufficient permission to view Batch Traceability.';
  end if;

  select jsonb_build_object(
        'batch_balance_id', balance.id,
        'finished_good_name_cn', coalesce(
          nullif(btrim(product_family.name_cn), ''),
          nullif(btrim(finished_good.product_name_cn), '')
        ),
        'pack_size_qty', finished_good.pack_size_qty,
        'pack_size_uom', nullif(btrim(finished_good.pack_size_uom), ''),
        'packaging_type', nullif(btrim(finished_good.packaging_type), ''),
        'job_order_id', job.id,
        'job_order_no', nullif(btrim(job.job_order_no), ''),
        'source_event_at', case when balance.source_type = 'production' then production.completed_at else null end,
        'raw_material_usage_available', balance.source_type = 'production' and raw_material_usage.allocation_count > 0,
        'raw_material_usage', coalesce(raw_material_usage.rows, '[]'::jsonb),
        'stock_check_id', case when balance.source_type = 'adjustment' and adjustment_events.event_count = 1 and adjustment_events.carried_forward_qty = 0 then adjustment_events.single_stock_check_id end,
        'stock_check_reference', case when balance.source_type = 'adjustment' and adjustment_events.event_count = 1 and adjustment_events.carried_forward_qty = 0 then adjustment_events.single_stock_check_reference end,
        'adjustment_reason', case when balance.source_type = 'adjustment' and adjustment_events.event_count = 1 and adjustment_events.carried_forward_qty = 0 then adjustment_events.single_reason end,
        'adjustment_approved_by', case when balance.source_type = 'adjustment' and adjustment_events.event_count = 1 and adjustment_events.carried_forward_qty = 0 then adjustment_events.single_approved_by end,
        'adjustment_date', case when balance.source_type = 'adjustment' and adjustment_events.event_count = 1 and adjustment_events.carried_forward_qty = 0 then adjustment_events.single_adjustment_date end,
        'positive_adjustment_events', coalesce(adjustment_events.events, '[]'::jsonb),
        'adjustment_carried_forward_qty', case when balance.source_type = 'adjustment' then adjustment_events.carried_forward_qty else 0 end,
        'stock_check_adjustments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'adjustment_id', adjustment.id,
              'stock_check_id', adjustment_check.id,
              'stock_check_reference', nullif(btrim(adjustment_check.check_no), ''),
              'adjustment_date', coalesce(adjustment_check.approved_at, adjustment.created_at),
              'quantity', adjustment.quantity,
              'reason', nullif(btrim(stock_check_item.variance_reason), '')
            ) order by coalesce(adjustment_check.approved_at, adjustment.created_at), adjustment.id
          )
          from public.factory_product_stock_check_batch_adjustments adjustment
          join public.factory_product_stock_check_items stock_check_item on stock_check_item.id = adjustment.stock_check_item_id
          join public.factory_product_stock_checks adjustment_check on adjustment_check.id = stock_check_item.stock_check_id
          where adjustment.batch_balance_id = balance.id
            and lower(coalesce(adjustment_check.status, '')) = 'approved'
        ), '[]'::jsonb)
      )
  into v_detail
  from public.factory_finished_good_batch_balances balance
  join public.factory_finished_goods finished_good on finished_good.id = balance.finished_good_id
  left join public.factory_product_families product_family on product_family.id = finished_good.product_family_id
  left join public.factory_productions production on production.id = balance.production_id
  left join public.factory_job_orders job on job.id = production.job_order_id
  left join lateral (
    select
      count(allocation.id) as allocation_count,
      jsonb_agg(jsonb_build_object(
        'id', allocation.id,
        'production_material_usage_id', usage.id,
        'raw_material_id', material.id,
        'raw_material_code', nullif(btrim(material.material_code), ''),
        'raw_material_name', material.name,
        'raw_material_batch_balance_id', raw_batch.id,
        'batch_no', coalesce(
          nullif(btrim(raw_batch.internal_batch_no), ''),
          nullif(btrim(receiving.internal_batch_no), ''),
          nullif(btrim(receiving.batch_no), ''),
          nullif(btrim(raw_batch.supplier_lot_no), '')
        ),
        'used_qty', allocation.allocated_qty,
        'used_uom', usage.uom,
        'receiving_no', nullif(btrim(receiving.receipt_no), ''),
        'receiving_date', coalesce(receiving.received_date, raw_batch.received_date),
        'supplier_name', coalesce(
          nullif(btrim(supplier.supplier_name), ''),
          nullif(btrim(receiving.supplier_name), ''),
          nullif(btrim(receiving_batch.supplier_name), '')
        ),
        'storage_location_name', nullif(btrim(storage.location_name), ''),
        'storage_location_type', nullif(btrim(storage.location_type), '')
      ) order by material.name, raw_batch.internal_batch_no, allocation.id) as rows
    from public.factory_production_material_usage_batch_allocations allocation
    join public.factory_production_material_usage usage on usage.id = allocation.production_material_usage_id
    join public.factory_raw_materials material on material.id = usage.raw_material_id
    join public.factory_raw_material_batch_balances raw_batch on raw_batch.id = allocation.raw_material_batch_balance_id
    left join public.factory_raw_material_receivings receiving on receiving.id = raw_batch.receiving_item_id
    left join public.factory_raw_material_receiving_batches receiving_batch on receiving_batch.id = receiving.batch_id
    left join public.factory_suppliers supplier on supplier.id = coalesce(receiving.supplier_id, receiving_batch.supplier_id)
    left join public.factory_storage_locations storage on storage.id = raw_batch.storage_location_id
    where usage.production_id = balance.production_id
  ) raw_material_usage on balance.source_type = 'production'
  left join lateral (
    with exact_event as (
      select item.id as stock_check_item_id,
        stock_check.id as stock_check_id,
        nullif(btrim(stock_check.check_no), '') as stock_check_reference,
        stock_check.approved_at as adjustment_date,
        item.variance_qty as quantity,
        nullif(btrim(item.variance_reason), '') as reason,
        coalesce(nullif(btrim(approver.nickname), ''), nullif(btrim(approver.full_name), '')) as approved_by
      from public.factory_product_stock_check_items item
      join public.factory_product_stock_checks stock_check on stock_check.id = item.stock_check_id
      left join public.employees approver on approver.id = stock_check.approved_by
      where balance.source_type = 'adjustment'
        and lower(coalesce(stock_check.status, '')) = 'approved'
        and item.finished_good_id = balance.finished_good_id
        and item.adjustment_storage_location_id = balance.storage_location_id
        and item.variance_qty > 0
    ), aggregate_event as (
      select count(*) as event_count,
        coalesce(sum(exact_event.quantity), 0) as exact_quantity,
        min(exact_event.stock_check_id::text)::uuid as single_stock_check_id,
        min(exact_event.stock_check_reference) as single_stock_check_reference,
        min(exact_event.reason) as single_reason,
        min(exact_event.approved_by) as single_approved_by,
        min(exact_event.adjustment_date) as single_adjustment_date,
        jsonb_agg(jsonb_build_object(
          'event_id', exact_event.stock_check_item_id,
          'stock_check_id', exact_event.stock_check_id,
          'stock_check_reference', exact_event.stock_check_reference,
          'adjustment_date', exact_event.adjustment_date,
          'quantity', exact_event.quantity,
          'reason', exact_event.reason,
          'approved_by', exact_event.approved_by
        ) order by exact_event.adjustment_date, exact_event.stock_check_item_id) as events
      from exact_event
    )
    select aggregate_event.*, greatest(balance.opening_qty - aggregate_event.exact_quantity, 0) as carried_forward_qty
    from aggregate_event
  ) adjustment_events on true
  where balance.id = p_batch_balance_id;

  return v_detail;
end;
$$;

revoke all on function public.factory_get_finished_good_batch_traceability_detail(uuid) from public, anon;
grant execute on function public.factory_get_finished_good_batch_traceability_detail(uuid) to authenticated;

comment on function public.factory_get_finished_good_batch_traceability_detail(uuid)
is 'Returns read-only Finished Goods batch provenance, including exact persisted Production Raw Material allocations when available.';