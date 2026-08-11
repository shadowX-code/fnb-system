-- Enrich the Batch Traceability detail view without changing inventory state.

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
        'source_event_at', case
          when balance.source_type = 'production' then production.completed_at
          else null
        end,
        'stock_check_id', case
          when balance.source_type = 'adjustment'
           and adjustment_events.event_count = 1
           and adjustment_events.carried_forward_qty = 0
          then adjustment_events.single_stock_check_id
        end,
        'stock_check_reference', case
          when balance.source_type = 'adjustment'
           and adjustment_events.event_count = 1
           and adjustment_events.carried_forward_qty = 0
          then adjustment_events.single_stock_check_reference
        end,
        'adjustment_reason', case
          when balance.source_type = 'adjustment'
           and adjustment_events.event_count = 1
           and adjustment_events.carried_forward_qty = 0
          then adjustment_events.single_reason
        end,
        'adjustment_approved_by', case
          when balance.source_type = 'adjustment'
           and adjustment_events.event_count = 1
           and adjustment_events.carried_forward_qty = 0
          then adjustment_events.single_approved_by
        end,
        'adjustment_date', case
          when balance.source_type = 'adjustment'
           and adjustment_events.event_count = 1
           and adjustment_events.carried_forward_qty = 0
          then adjustment_events.single_adjustment_date
        end,
        'positive_adjustment_events', coalesce(
          adjustment_events.events,
          '[]'::jsonb
        ),
        'adjustment_carried_forward_qty', case
          when balance.source_type = 'adjustment'
          then adjustment_events.carried_forward_qty
          else 0
        end,
        'stock_check_adjustments', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'adjustment_id', adjustment.id,
              'stock_check_id', adjustment_check.id,
              'stock_check_reference', nullif(btrim(adjustment_check.check_no), ''),
              'adjustment_date', coalesce(adjustment_check.approved_at, adjustment.created_at),
              'quantity', adjustment.quantity,
              'reason', nullif(btrim(stock_check_item.variance_reason), '')
            )
            order by coalesce(adjustment_check.approved_at, adjustment.created_at), adjustment.id
          )
          from public.factory_product_stock_check_batch_adjustments adjustment
          join public.factory_product_stock_check_items stock_check_item
            on stock_check_item.id = adjustment.stock_check_item_id
          join public.factory_product_stock_checks adjustment_check
            on adjustment_check.id = stock_check_item.stock_check_id
          where adjustment.batch_balance_id = balance.id
            and lower(coalesce(adjustment_check.status, '')) = 'approved'
        ), '[]'::jsonb)
      )
  into v_detail
  from public.factory_finished_good_batch_balances balance
  join public.factory_finished_goods finished_good
    on finished_good.id = balance.finished_good_id
  left join public.factory_product_families product_family
    on product_family.id = finished_good.product_family_id
  left join public.factory_productions production
    on production.id = balance.production_id
  left join public.factory_job_orders job
    on job.id = production.job_order_id
  left join lateral (
    with exact_event as (
      select item.id as stock_check_item_id,
        stock_check.id as stock_check_id,
        nullif(btrim(stock_check.check_no), '') as stock_check_reference,
        stock_check.approved_at as adjustment_date,
        item.variance_qty as quantity,
        nullif(btrim(item.variance_reason), '') as reason,
        coalesce(
          nullif(btrim(approver.nickname), ''),
          nullif(btrim(approver.full_name), '')
        ) as approved_by
      from public.factory_product_stock_check_items item
      join public.factory_product_stock_checks stock_check
        on stock_check.id = item.stock_check_id
      left join public.employees approver
        on approver.id = stock_check.approved_by
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
    select aggregate_event.*,
      greatest(balance.opening_qty - aggregate_event.exact_quantity, 0) as carried_forward_qty
    from aggregate_event
  ) adjustment_events on true
  where balance.id = p_batch_balance_id;

  return v_detail;
end;
$$;

revoke all on function public.factory_get_finished_good_batch_traceability_detail(uuid)
from public, anon;
grant execute on function public.factory_get_finished_good_batch_traceability_detail(uuid)
to authenticated;

comment on function public.factory_get_finished_good_batch_traceability_detail(uuid)
is 'Returns read-only operator metadata, exact adjustment events where reconstructable, and explicit carried-forward adjustment history for one batch balance.';
